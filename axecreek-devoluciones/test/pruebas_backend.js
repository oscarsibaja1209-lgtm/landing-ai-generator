// Pruebas de punta a punta del backend (Codigo.gs) contra los datos reales del Excel.
// Uso: TZ=America/Bogota node pruebas_backend.js <hoja.json> <Codigo.gs>
'use strict';
const vm = require('vm');
const { crearMock } = require('./gas_mock');
const [, , rutaJson, rutaGs] = process.argv;

let fallos = 0, pasos = 0;
function ok(cond, msg, extra) { pasos++; if (cond) console.log('  ✔ ' + msg); else { fallos++; console.log('  ✘ ' + msg + (extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 400) : '')); } }
function titulo(t) { console.log('\n■ ' + t); }

const m = crearMock(rutaJson, { formatoTextoGuia: true });
const ctx = m.cargar(rutaGs);
// Cada llamada simula una ejecución nueva de Apps Script (sin memoria entre llamadas)
function run(fn, ...args) { vm.runInContext('_nov=null;_usuarioMemo={};_ss=null;', ctx); const t0 = Date.now(); const r = ctx[fn](...args); run.ms = Date.now() - t0; return r; }
const NOV = () => m.hojas.NOVEDADES.filas;
const C = vm.runInContext('COL', ctx), E = vm.runInContext('E', ctx), EB = vm.runInContext('EB', ctx);
const guiasOriginales = NOV().slice(3).map(r => r[2]);

// Usuarios de prueba
const U = m.hojas.CONFIG_USUARIOS.filas;
const nuevos = [
  ['Gestor Prueba', 'gestor@dropi.co', 'Gestión', '', 'SI', '', ''],
  ['Comercial Premium', 'comercial@dropi.co', 'Comercial', '', 'SI', '', 'PREMIUM, PREMIUM EXCLUSIVO'],
  ['Coordinadora Prueba', 'coord@trans.com', 'Transportadora', 'Coordinadora', 'SI', '', ''],
  ['Envia Prueba', 'envia@trans.com', 'Transportadora', 'Envía', 'SI', '', ''],
  ['Bodega Medellin', 'bodega.mde@dropi.co', 'Bodega Dropi', '', 'SI', 'Medellín', ''],
  ['Bodega Cali', 'bodega.cali@dropi.co', 'Bodega Dropi', '', 'SI', 'CALI', ''],
  ['Control Indem', 'indem@dropi.co', 'Indemnizaciones', '', 'SI', '', '']
];
nuevos.forEach(n => U.push(n));
function login(email) {
  const r1 = run('solicitarAccesoOTP', email);
  if (!r1.ok) throw new Error('OTP ' + email + ': ' + r1.msg);
  const otp = m.correos[m.correos.length - 1].htmlBody.match(/>(\d{6})</)[1];
  const r2 = run('validarCodigoOTP', email, otp);
  return r2.token;
}

titulo('1. Login OTP y sesión');
const tAdmin = login('oscar.sibaja@dropi.co');
ok(!!tAdmin, 'Admin entra con código OTP');
const tGest = login('gestor@dropi.co'), tCom = login('comercial@dropi.co'), tCoord = login('coord@trans.com'), tEnvia = login('envia@trans.com');
const tMde = login('bodega.mde@dropi.co'), tCali = login('bodega.cali@dropi.co'), tInd = login('indem@dropi.co');
ok(run('solicitarAccesoOTP', 'nadie@x.com').ok === false, 'Correo no registrado es rechazado');
ok(run('validarCodigoOTP', 'gestor@dropi.co', '000000').ok === false, 'Código incorrecto es rechazado');
const ui = run('getDatosIniciales', tCoord);
ok(ui.usuario.rol === 'Transportadora' && ui.usuario.tabs.join() === 'dashboard,buscador,ingreso,gestion', 'Transportadora ve solo sus pestañas', ui.usuario && ui.usuario.tabs);
ok(run('getDatosIniciales', tMde).usuario.sede === 'MEDELLIN', 'Bodega Medellín queda con sede MEDELLIN');

titulo('2. Métricas antes de migrar (los estados viejos se leen como nuevos)');
const d0 = run('getDatosIniciales', tAdmin);
const s0 = d0.stats;
const suma = o => Object.values(o).reduce((a, b) => a + b, 0);
ok(s0.total === 10675, 'Total registros = 10.675', s0.total);
ok(suma(s0.porEstado) === 10675, 'Suma de estados = 10.675', suma(s0.porEstado));
ok(s0.unicas > 9600 && s0.unicas < 10675, 'Guías únicas (sin contar reingresos): ' + s0.unicas, s0.unicas);
ok(s0.porEstado[E.SOL_NOTIF] === 8658 && s0.porEstado[E.BOD_NOTIF] === 938 && s0.porEstado[E.RECH_NOTIF] === 354 && s0.porEstado[E.RECH_LISTA] === 92, 'Conteos por estado coinciden con el Excel', s0.porEstado);
ok(s0.rechazadas === 446, 'Rechazadas = 446 (92 por notificar + 354 notificadas)', s0.rechazadas);
ok(d0.migracionPendiente === 10185, 'Detecta filas con estados viejos para migrar', d0.migracionPendiente);
console.log('    tiempo getDatosIniciales:', run.ms, 'ms');
const sc = run('getMetricasFiltradas', {}, tCoord).stats;
ok(sc.total === 4780, 'Coordinadora solo ve sus 4.780 registros', sc.total);

titulo('3. Migración (vista previa, aplicar, repetir)');
const pv = run('previsualizarMigracion', tAdmin);
ok(pv.ok && pv.total === 10675, 'Vista previa analiza 10.675 filas', pv);
console.log('    cambios:', JSON.stringify(pv.cambios));
ok(run('previsualizarMigracion', tGest).ok === false, 'Gestión no puede migrar (solo Admin)');
const mig = run('ejecutarMigracion', tAdmin);
ok(mig.ok && /drive/.test(mig.backup), 'Migración aplicada con respaldo en Drive', mig);
const estadosHoja = {}; NOV().slice(3).forEach(r => { if (r[2]) estadosHoja[r[C.ESTADO]] = (estadosHoja[r[C.ESTADO]] || 0) + 1; });
ok(estadosHoja[E.SOL_NOTIF] === 8658 && estadosHoja[E.BOD_NOTIF] === 937 && estadosHoja[E.CULM_BOD] === 1 && !estadosHoja['Culminado - Notificado'], 'La hoja quedó con los estados nuevos', estadosHoja);
const transito = NOV().slice(3).filter(r => r[C.ESTADO_RECEPCION] === EB.TRANSITO).length;
ok(transito === 937, '937 en tránsito + 1 que ya estaba recibida pasa a Culminado en bodega', transito);
ok(NOV()[2][C.FECHA_DEVOLUCION] === 'Fecha Devolución' && NOV()[2][C.INTENTO] === 'Intento #', 'Encabezados nuevos escritos');
const conIntento2 = NOV().slice(3).filter(r => r[C.INTENTO] === 2).length;
ok(conIntento2 > 0, 'Reingresos numerados (intento #2): ' + conIntento2);
ok(['CONFIG_BODEGAS_DROPI', 'CONFIG_PARAMETROS', 'HISTORIAL_REEMPLAZATORIAS', 'RECHAZOS_BODEGA'].every(n => m.hojas[n]), 'Pestañas nuevas creadas');
ok(m.hojas.CONFIG_DESPLEGABLES.filas[2][0] === 'Pendiente' && m.hojas.CONFIG_DESPLEGABLES.filas[13][0] === E.CULM_BOD, 'Desplegable de estados actualizado');
const pv2 = run('previsualizarMigracion', tAdmin);
ok(Object.keys(pv2.cambios).length === 0 && pv2.intentos === 0, 'Repetir la migración no cambia nada (idempotente)', pv2);
ok(NOV().slice(3).map(r => r[2]).every((g, i) => g === guiasOriginales[i]), 'Ningún número de guía cambió (ceros a la izquierda intactos)');
// direcciones de bodegas
run('guardarBodegaDropi', { rowIndex: 4, ciudad: 'MEDELLIN', direccion: 'Calle 10 # 20-30 Bodega Dropi MDE', contacto: 'Jefe bodega', telefono: '3000000000', activa: 'SI' }, tAdmin);
ok(m.hojas.CONFIG_BODEGAS_DROPI.filas[3][1] === 'Calle 10 # 20-30 Bodega Dropi MDE', 'Dirección de bodega Medellín guardada en la hoja');
ok(run('guardarParametro', 'VALOR_COBRO_MENSUAL', 3000, tAdmin).ok, 'Valor de cobro cambiado a 3.000 desde Configuración');

titulo('4. Gestión y solución');
const g1 = run('getGruposBodegaPaginados', {}, 1, 20, tGest);
ok(g1.ok && g1.bandeja === E.PENDIENTE && g1.totalGuias === 490, 'Por defecto muestra solo Pendientes (490)', { b: g1.bandeja, t: g1.totalGuias, msg: g1.msg });
console.log('    tiempo bandeja gestión:', run.ms, 'ms · bodegas:', g1.totalBodegas);
ok(g1.conteo[E.SOL_NOTIF] === 8658, 'Conteo de bandejas incluye notificadas sin confirmar');
const conPrevia = g1.gruposArray.filter(x => x.solucionPrevia).length;
const gAll = run('getGruposBodegaPaginados', {}, 1, 0, tGest);
const totalPrevia = gAll.gruposArray.filter(x => x.solucionPrevia).length;
ok(totalPrevia > 0, `Detecta bodegas con solución anterior (${totalPrevia} bodegas con pendientes ya tuvieron solución)`);
const gTodos = run('getGruposBodegaPaginados', { estado: '' }, 1, 20, tGest);
ok(gTodos.totalGuias === 10675, 'Bandeja "Todas" muestra 10.675');
const gTexto = run('getGruposBodegaPaginados', { estado: '', texto: '85910404261778' }, 1, 20, tGest);
ok(gTexto.totalGuias >= 1, 'Búsqueda por número de guía funciona', gTexto.totalGuias);
const gCoord = run('getGruposBodegaPaginados', {}, 1, 20, tCoord);
ok(gCoord.gruposArray.every(gr => gr.guias.every(x => x.trans === 'Coordinadora')) && gCoord.gruposArray.every(gr => !gr.solucionPrevia), 'Transportadora en "Mis guías" solo ve las suyas');
// tomar pendientes
const pend = gAll.gruposArray.flatMap(x => x.guias);
const filaA = pend[0].row, filaB = pend[1].row, filaC = pend[2].row;
let r = run('guardarSolucion', [filaA], { estado: E.SOL_LISTA }, tGest);
ok(!r.ok && r.errores[0].motivo === 'Falta la dirección nueva', 'No deja "Solución lista" sin dirección nueva', r);
r = run('guardarSolucion', [filaA], { estado: E.SOL_LISTA, dirNueva: 'Cra 1 # 2-3', obsDropi: 'Proveedor confirma' }, tGest);
ok(r.ok && NOV()[filaA - 1][C.ESTADO] === E.SOL_LISTA && NOV()[filaA - 1][C.DIR_NUEVA] === 'Cra 1 # 2-3' && NOV()[filaA - 1][C.ASESOR_GEST] === 'Gestor Prueba', 'Solución guardada con dirección y asesor');
const antesB = NOV()[filaB - 1].slice();
r = run('guardarSolucion', [filaB], { estado: E.BOD_LISTA, ciudadDestino: 'Medellín' }, tGest);
ok(r.ok && NOV()[filaB - 1][C.CIUDAD_DESTINO] === 'MEDELLIN' && /Calle 10 # 20-30/.test(NOV()[filaB - 1][C.DIR_NUEVA]), 'Bodega Medellín: la dirección se llena sola desde la configuración', NOV()[filaB - 1][C.DIR_NUEVA]);
ok(NOV()[filaB - 1][C.EMAIL_PROV] === antesB[C.EMAIL_PROV] && NOV()[filaB - 1][C.TEL_PROV] === antesB[C.TEL_PROV], 'No borra datos del proveedor que no se enviaron');
r = run('guardarSolucion', [filaB], { estado: E.BOD_LISTA }, tGest);
ok(!r.ok, 'Enviar a bodega sin ciudad es rechazado');
// guía premium a comercial
const premium = pend.find(x => /PREMIUM/.test(x.categoria));
r = run('guardarSolucion', [premium.row], { estado: E.GEST_COM, obsDropi: 'Sin contacto, se pasa a comercial' }, tGest);
ok(r.ok, 'Gestión pasa una guía PREMIUM a comercial');

titulo('5. Comercial');
const gc = run('getGruposBodegaPaginados', { modo: 'comercial' }, 1, 50, tCom);
const filasCom = gc.gruposArray.flatMap(x => x.guias);
ok(gc.ok && filasCom.length > 0 && filasCom.every(x => x.estado === E.GEST_COM && /PREMIUM/.test(x.categoria)), 'Comercial solo ve "En gestión comercial" de su categoría', { n: filasCom.length, msg: gc.msg });
ok(filasCom.some(x => x.row === premium.row), 'Le aparece la guía que le pasó Gestión');
ok(run('getGruposBodegaPaginados', {}, 1, 20, tCom).ok === false, 'Comercial no puede abrir Gestión');
r = run('guardarSolucion', [premium.row], { estado: E.COM_SIN }, tCom);
ok(!r.ok && /observación/.test(r.msg), 'Sin contacto exige observación');
r = run('guardarSolucion', [premium.row], { estado: E.COM_SIN, obsDropi: 'No contesta 3 llamadas' }, tCom);
ok(r.ok && NOV()[premium.row - 1][C.ESTADO] === E.COM_SIN, 'Comercial devuelve a logística: "Comercial sin contacto"');
r = run('guardarSolucion', [premium.row], { estado: E.SOL_LISTA, dirNueva: 'x' }, tCom);
ok(!r.ok, 'Comercial no puede tocar guías que ya no están en su bandeja');
r = run('guardarSolucion', [filaC], { estado: E.BOD_LISTA, ciudadDestino: 'CALI' }, tCom);
ok(!r.ok, 'Comercial no puede enviar a bodega');

titulo('6. Correos a transportadora');
const transB = NOV()[filaB - 1][C.TRANSPORTADORA];
let pc = run('previsualizarCorreo', { tipoEnvio: 'bodega', transportadora: transB, ciudadBodega: 'CALI' }, tGest);
ok(pc.ok && pc.total === 0, 'Correo de bodega Cali no incluye la guía de Medellín', pc);
pc = run('previsualizarCorreo', { tipoEnvio: 'bodega', transportadora: transB, ciudadBodega: 'MEDELLIN' }, tGest);
ok(pc.ok && pc.total >= 1 && /Calle 10 # 20-30/.test(pc.html) && /solo recibe las guías de esta lista/.test(pc.html), 'Vista previa del correo de bodega con dirección y advertencia');
const nCorreos = m.correos.length;
r = run('enviarCorreoTransportadora', { tipoEnvio: 'bodega', transportadora: transB, ciudadBodega: 'MEDELLIN', para: 'ops@trans.com' }, tGest);
const mail = m.correos[m.correos.length - 1];
ok(r.ok && m.correos.length === nCorreos + 1 && mail.replyTo === 'gestor@dropi.co' && /Gestor Prueba/.test(mail.name) && /gestor@dropi.co/.test(mail.cc), 'Correo sale firmado por el gestor (nombre, responder-a y copia)', { name: mail.name, replyTo: mail.replyTo, cc: mail.cc });
ok(NOV()[filaB - 1][C.ESTADO] === E.BOD_NOTIF && NOV()[filaB - 1][C.ESTADO_RECEPCION] === EB.TRANSITO, 'Guía pasa a "Bodega Dropi notificada" y "En tránsito"');
const transA = NOV()[filaA - 1][C.TRANSPORTADORA];
r = run('enviarCorreoTransportadora', { tipoEnvio: 'solucion', transportadora: transA, para: 'ops@trans.com' }, tGest);
ok(r.ok && NOV()[filaA - 1][C.ESTADO] === E.SOL_NOTIF && NOV()[filaA - 1][C.FECHA_NOTIF], 'Correo de soluciones: pasa a "Solución notificada" con fecha', r.msg);
ok(/confírmennos cuando cada guía sea entregada/.test(m.correos[m.correos.length - 1].htmlBody), 'El correo pide confirmar la entrega');
ok(run('enviarCorreoTransportadora', { tipoEnvio: 'solucion', transportadora: transA, para: 'x@y.com' }, tCom).ok === false, 'Comercial no puede enviar correos');

titulo('7. Confirmar entregas (culminar)');
const solNotif = NOV().map((r, i) => ({ r, fila: i + 1 })).filter(x => x.fila >= 4 && x.r[C.ESTADO] === E.SOL_NOTIF);
const deCoord = solNotif.filter(x => x.r[C.TRANSPORTADORA] === 'Coordinadora').slice(0, 2).map(x => x.fila);
const deEnvia = solNotif.find(x => x.r[C.TRANSPORTADORA] === 'Envía').fila;
r = run('confirmarEntregas', deCoord.concat([deEnvia]), tCoord);
ok(r.ok && NOV()[deCoord[0] - 1][C.ESTADO] === E.CULM_ENT && NOV()[deEnvia - 1][C.ESTADO] === E.SOL_NOTIF, 'Coordinadora culmina las suyas y no puede tocar las de Envía', r);
const masivo = solNotif.filter(x => x.r[C.ESTADO] === E.SOL_NOTIF).map(x => x.fila);
m.stats.setValues = 0;
r = run('confirmarEntregas', masivo, tGest);
ok(r.ok && NOV().filter(x => x[C.ESTADO] === E.CULM_ENT).length >= masivo.length, `Confirmación masiva de ${masivo.length} guías`, r.msg);
console.log('    tiempo:', run.ms, 'ms · escrituras a la hoja:', m.stats.setValues);
ok(m.stats.setValues <= 5, 'La confirmación masiva usa pocas escrituras (rápida)', m.stats.setValues);

titulo('8. Bodega Dropi (escáner, recepción, rechazos)');
const bm = run('getBodegasDropiData', {}, tMde);
ok(bm.ok && bm.stats.transito === 172 && bm.ciudad === 'MEDELLIN', 'Bodega Medellín ve 171 + 1 nueva en tránsito', bm.stats);
console.log('    tiempo panel bodega:', run.ms, 'ms · índice de escaneo:', bm.indice.length, 'guías');
ok(bm.rows.every(x => x.ciudadDestino.toUpperCase().startsWith('MEDELL')), 'Solo ve guías de Medellín');
const bcali = run('getBodegasDropiData', {}, tCali);
ok(bcali.stats.transito === 220, 'Bodega Cali ve sus 220', bcali.stats);
ok(run('getGruposBodegaPaginados', {}, 1, 10, tMde).ok === false, 'Bodega no puede abrir Gestión');
const itemMde = bm.indice.find(x => x.e === 'T' && x.row !== filaB);
r = run('recibirGuiasBodega', [itemMde.row], '', tMde);
ok(r.ok && NOV()[itemMde.row - 1][C.ESTADO] === E.CULM_BOD && NOV()[itemMde.row - 1][C.ESTADO_RECEPCION] === EB.RECIBIDO, 'Recibir guía → "Culminado - en Bodega Dropi" y "Recibido en Bodega"');
r = run('recibirGuiasBodega', [itemMde.row], '', tMde);
ok(!r.ok && r.errores[0].yaRecibida, 'Recibir dos veces avisa "ya estaba recibida"');
const itemCali = bcali.indice.find(x => x.e === 'T');
r = run('recibirGuiasBodega', [itemCali.row], '', tMde);
ok(!r.ok && /otra bodega/.test(r.errores[0].motivo), 'Medellín no puede recibir una guía de Cali');
const remB = NOV()[filaB - 1][C.GUIA_REMP] || NOV()[filaB - 1][C.GUIA];
const codCali = NOV()[itemCali.row - 1][C.GUIA];
const solNotifGuia = NOV()[deEnvia - 1][C.GUIA];
r = run('registrarRechazoBodega', ['99999999999999', codCali, solNotifGuia, String(remB), NOV()[itemMde.row - 1][C.GUIA]], tMde);
const tipos = r.resultados.map(x => x.tipo + ':' + (x.motivo || ''));
ok(r.resultados[0].tipo === 'rechazo' && /No existe/.test(r.resultados[0].motivo), 'Guía desconocida → NO RECIBIR (no existe)');
ok(r.resultados[1].tipo === 'rechazo' && /otra bodega/.test(r.resultados[1].motivo), 'Guía de Cali en Medellín → NO RECIBIR (otra bodega)');
ok(r.resultados[2].tipo === 'rechazo' && /no se envió a bodega/.test(r.resultados[2].motivo), 'Guía que no se mandó a bodega → NO RECIBIR');
ok(r.resultados[3].tipo === 'recibida', 'Guía válida que no estaba en la lista local → se recibe', tipos);
ok(r.resultados[4].tipo === 'ya', 'Guía ya recibida → aviso "ya estaba recibida"');
ok(m.hojas.RECHAZOS_BODEGA.filas.length === 4, '3 rechazos quedan registrados para Gestión', m.hojas.RECHAZOS_BODEGA.filas.length);

titulo('9. Guías rechazadas en bodega: vincular reemplazatoria nueva');
const rech = run('getRechazosBodega', {}, tGest);
ok(rech.ok && rech.porResolver === 3, 'Gestión ve 3 por resolver');
const enTransito = NOV().map((x, i) => ({ x, fila: i + 1 })).find(z => z.fila > 3 && z.x[C.ESTADO_RECEPCION] === EB.TRANSITO && String(z.x[C.CIUDAD_DESTINO]).toUpperCase().startsWith('MEDELL'));
const bus = run('buscarGuiaInicial', String(enTransito.x[C.GUIA]), tGest);
ok(bus.ok && bus.resultados.some(x => x.row === enTransito.fila), 'Busca la guía inicial para vincular');
const rDesconocida = rech.rows.find(x => /No existe/.test(x.motivo));
r = run('resolverRechazo', rDesconocida.id, 'vincular', enTransito.fila, tGest);
ok(r.ok && NOV()[enTransito.fila - 1][C.GUIA_REMP] === '99999999999999', 'La guía nueva queda como reemplazatoria', r);
ok(m.hojas.HISTORIAL_REEMPLAZATORIAS.filas.length >= 2, 'Historial de reemplazatorias guarda las anteriores y la nueva', m.hojas.HISTORIAL_REEMPLAZATORIAS.filas);
r = run('registrarRechazoBodega', ['99999999999999'], tMde);
ok(r.resultados[0].tipo === 'recibida', 'Al volver a escanearla, la bodega ya la puede recibir');
r = run('resolverRechazo', rDesconocida.id, 'vincular', enTransito.fila, tGest);
ok(!r.ok, 'No deja resolver dos veces el mismo rechazo');
const ficha = run('getFichaGuia', enTransito.fila, tGest);
ok(ficha.ok && ficha.reemplazatorias.some(x => x.guia === '99999999999999') && ficha.eventos.length >= 2, 'La ficha muestra historial y reemplazatorias', ficha.reemplazatorias);

titulo('10. Buscador de la transportadora (sin guía ni transportadora)');
const bs = run('buscarSoluciones', { campo: 'bodega', valores: '6208\n123456789' }, tEnvia);
ok(bs.ok && bs.resultados.length > 0, 'Encuentra soluciones por ID bodega', bs.msg);
ok(bs.resultados.every(x => !('guia' in x) && !('trans' in x) && !('asesor' in x)), 'Los resultados NO incluyen guía, transportadora ni asesor');
ok(bs.sinResultado.indexOf('123456789') >= 0, 'Informa los valores sin resultado');
ok(bs.resultados.every(x => [E.SOL_NOTIF, E.CULM_ENT, E.BOD_NOTIF, E.CULM_BOD].indexOf(x.estado) >= 0), 'Solo trae soluciones notificadas o culminadas (nunca pendientes)');
const muchos = Array.from({ length: 501 }, (_, i) => String(i));
ok(run('buscarSoluciones', { campo: 'todos', valores: muchos }, tEnvia).ok === false, 'Respeta el máximo de 500 valores');
const bs2 = run('buscarSoluciones', { campo: 'todos', valores: Array.from({ length: 500 }, (_, i) => String(3000000000 + i)) }, tEnvia);
console.log('    tiempo búsqueda de 500 valores:', run.ms, 'ms');

titulo('11. Ingreso por plantilla (sin datos corridos) y reingresos');
const existente = String(NOV()[3][C.GUIA]);
const v = run('validarIngreso', { transportadora: 'Coordinadora', filas: [
  { guia: '0123456789012', tipoNov: 'DIRECCIÓN ERRADA', obsTrans: 'obs 1' },
  { guia: '0123456789013', tipoNov: '' },
  { guia: '0123456789012', tipoNov: 'X' },
  { guia: existente, tipoNov: 'SE NEGÓ A RECIBIR' },
  { guia: '0123456789014', tipoNov: 'NO SE UBICA', obsTrans: 'obs 3', guiaRemp: '0999' }
] }, tCoord);
ok(v.ok && v.resumen.lista === 2 && v.resumen.error === 2 && v.resumen.existe === 1, 'Valida: 2 listas, 2 errores, 1 ya registrada', v.resumen || v.msg);
ok(run('validarIngreso', { transportadora: 'Envía', filas: [{ guia: '1', tipoNov: 'x' }] }, tCoord).ok === false, 'Coordinadora no puede subir guías de Envía');
const antes = NOV().length;
r = run('ingresarNovedades', { transportadora: 'Coordinadora', filas: v.filas, reingresar: [existente] }, tCoord);
ok(r.ok && r.guardadas === 3, '3 guías guardadas (2 nuevas + 1 reingreso)', r);
const nuevas = NOV().slice(antes);
ok(nuevas[0][C.GUIA] === '0123456789012' && nuevas[0][C.OBS_TRANS] === 'obs 1', 'Cero inicial conservado y cada dato en su fila');
ok(nuevas[2][C.GUIA] === '0123456789014' && nuevas[2][C.OBS_TRANS] === 'obs 3' && nuevas[2][C.GUIA_REMP] === '0999', 'Fila 5 conserva su observación y su reemplazatoria (no se corrió)');
ok(nuevas[1][C.INTENTO] >= 2 && nuevas[1][C.ESTADO] === E.PENDIENTE, 'Reingreso queda como intento #' + nuevas[1][C.INTENTO]);

titulo('12. WhatsApp');
const w = run('getGruposWsp', {}, tGest);
ok(w.ok && w.wspArray.length > 0 && w.wspArray.every(x => x.msg.indexOf('Gestor Prueba') >= 0), 'Arma mensajes por bodega firmados por el asesor', w.msg);
const bodW = w.wspArray.find(x => x.pendientes > 0);
r = run('registrarEnvioWsp', bodW.bodega, tGest);
ok(r.ok && r.movidas === bodW.pendientes && r.enviadosHoy === 1, 'Al enviar: cuenta el mensaje y pasa las pendientes a "En gestión logística"', r);
const wc = run('getGruposWsp', {}, tCom);
ok(wc.ok && wc.wspArray.every(x => /PREMIUM/.test(x.categoria)), 'Comercial solo arma WhatsApp de su categoría');

titulo('13. Indemnizaciones');
// simular una guía recibida hace 3 meses
const filaVieja = itemMde.row;
NOV()[filaVieja - 1][C.FECHA_RECEP_FISICA] = new m.CDate(new Date().getFullYear(), new Date().getMonth() - 3, 15);
const pi = run('getPanelIndemnizacion', {}, tInd);
const cobrosVieja = m.hojas.COBROS_INDEMNIZACION.filas.filter(x => x[1] === filaVieja);
ok(pi.ok && cobrosVieja.length === 3 && cobrosVieja.every(x => x[6] === 3000), 'Genera 3 meses cumplidos a $3.000 (valor de la configuración)', cobrosVieja);
ok(pi.enGracia.length >= 1, 'Guías recibidas este mes aparecen "en periodo de gracia"');
const nCob = m.hojas.COBROS_INDEMNIZACION.filas.length;
const pi2 = run('getPanelIndemnizacion', {}, tInd);
ok(m.hojas.COBROS_INDEMNIZACION.filas.length === nCob, 'Abrir el panel otra vez no duplica cobros');
r = run('marcarCobroIndemnizacion', [pi2.rows[0].cobroRowIndex], { estadoCobro: 'Cobrado al proveedor' }, tInd);
ok(r.ok && m.hojas.COBROS_INDEMNIZACION.filas[pi2.rows[0].cobroRowIndex - 1][7] === 'Cobrado al proveedor', 'Marca un cobro como cobrado');
r = run('actualizarEstadoBodega', [filaVieja], { estado: EB.RETIRADO }, tInd);
ok(r.ok && NOV()[filaVieja - 1][C.ESTADO_RECEPCION] === EB.RETIRADO, '"Retirado por el proveedor" detiene el cobro');
ok(run('getPanelIndemnizacion', {}, tCoord).ok === false && run('getGruposBodegaPaginados', {}, 1, 10, tInd).ok === false, 'Indemnizaciones solo ve su panel; transportadora no ve indemnizaciones');
ok(run('exportarIndemnizacionCSV', {}, tInd).ok, 'Exporta indemnizaciones');

titulo('14. Cruce Excel Dropi y exportaciones');
const rc = run('getRowsParaCruce', tGest);
ok(rc.ok && rc.rows.length === NOV().length - 3, 'Índice de cruce con todas las guías');
const filaX = rc.rows[5];
r = run('guardarCargaDropi', [{ guia: filaX[0], sheetRow: filaX[1], idBodega: '7777', categoria: 'PREMIUM', estatusDropi: 'NOVEDAD' }], tGest);
ok(r.ok && String(NOV()[filaX[1] - 1][C.ID_BODEGA]) === '7777', 'Cruce actualiza datos del proveedor');
ok(run('getRowsParaCruce', tCoord).ok === false, 'Transportadora no puede usar el cruce');
const ex = run('exportarDatosExcel', { estado: E.PENDIENTE }, tGest);
ok(ex.ok && ex.total > 0, 'Exporta Excel filtrado (' + ex.total + ' filas)');

titulo('15. Configuración y permisos');
ok(run('getConfigGeneral', tGest).ok === false && run('getConfigGeneral', tAdmin).ok, 'Solo Admin entra a Configuración');
r = run('guardarUsuario', { nombre: 'Nueva Bodega', email: 'nb@dropi.co', rol: 'Bodega Dropi', sede: 'CALI', activo: 'SI' }, tAdmin);
ok(r.ok && login('nb@dropi.co'), 'Admin crea usuario de bodega y puede entrar');
ok(run('guardarUsuario', { nombre: 'X', email: 'x@dropi.co', rol: 'Bodega Dropi', activo: 'SI' }, tAdmin).ok === false, 'Usuario de bodega sin ciudad es rechazado');

titulo('16. Integridad final');
const sf = run('getMetricasFiltradas', {}, tAdmin).stats;
ok(sf.total === 10678 && suma(sf.porEstado) === sf.total, 'Totales cuadran después de todas las operaciones (10.675 + 3 nuevas)', { total: sf.total, suma: suma(sf.porEstado) });
ok(NOV().slice(3, 3 + guiasOriginales.length).map(r => r[2]).every((g, i) => g === guiasOriginales[i]), 'Ninguna guía original fue alterada');

console.log(`\nResultado: ${pasos - fallos}/${pasos} pruebas OK` + (fallos ? ` · ${fallos} FALLARON` : ''));
process.exit(fallos ? 1 : 0);
