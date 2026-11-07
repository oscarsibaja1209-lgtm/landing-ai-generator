// Prueba de carga: multiplica NOVEDADES x5 (~53.000 filas) y mide tiempo y llamadas a la hoja por función.
'use strict';
const vm = require('vm'); const { crearMock } = require('./gas_mock');
const [, , rutaJson, rutaGs] = process.argv;
const m = crearMock(rutaJson, { formatoTextoGuia: true }); const ctx = m.cargar(rutaGs);
const N = m.hojas.NOVEDADES.filas; const base = N.slice(3);
for (let k = 1; k < 5; k++) base.forEach(r => { const c = r.slice(); c[2] = String(c[2]) + 'X' + k; N.push(c); });
const run = (fn, ...a) => { vm.runInContext('_nov=null;_usuarioMemo={};_ss=null;', ctx); Object.keys(m.stats).forEach(k => m.stats[k] = 0); const t = Date.now(); const r = ctx[fn](...a); return { r, ms: Date.now() - t, lecturas: m.stats.getValues, escrituras: m.stats.setValues, celdas: m.stats.celdasLeidas }; };
run('solicitarAccesoOTP', 'oscar.sibaja@dropi.co'); const otp = m.correos.at(-1).htmlBody.match(/>(\d{6})</)[1]; const t = run('validarCodigoOTP', 'oscar.sibaja@dropi.co', otp).r.token;
console.log('Filas en NOVEDADES:', N.length - 3);
const casos = [['getDatosIniciales', t], ['ejecutarMigracion', t], ['getMetricasFiltradas', {}, t], ['getGruposBodegaPaginados', {}, 1, 20, t], ['getBodegasDropiData', {}, t], ['buscarSoluciones', { campo: 'bodega', valores: '6208' }, t], ['getPanelIndemnizacion', {}, t], ['getGruposWsp', {}, t]];
casos.forEach(c => { const x = run(...c); console.log(`${c[0].padEnd(28)} ${String(x.ms).padStart(5)} ms en Node · ${x.lecturas} lecturas · ${x.escrituras} escrituras · ${x.celdas.toLocaleString('es-CO')} celdas leídas` + (x.r && x.r.ok === false ? ' · ERROR ' + x.r.msg : '')); });
const filas = N.map((r, i) => i + 1).filter(i => i > 3 && N[i - 1][26] === 'Solución notificada');
const x = run('confirmarEntregas', filas, t); console.log(`confirmarEntregas (${filas.length} guías)`.padEnd(28), x.ms, 'ms ·', x.escrituras, 'escrituras', x.r.msg);
const g = run('getGruposBodegaPaginados', {}, 1, 20, t); console.log('Tamaño respuesta bandeja:', Math.round(JSON.stringify(g.r).length / 1024), 'KB');
const b = run('getBodegasDropiData', {}, t); console.log('Tamaño respuesta bodega:', Math.round(JSON.stringify(b.r).length / 1024), 'KB');
const d = run('getDatosIniciales', t); console.log('Tamaño respuesta inicial:', Math.round(JSON.stringify(d.r).length / 1024), 'KB');
