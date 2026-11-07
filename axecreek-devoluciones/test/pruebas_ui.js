// Pruebas de la interfaz (Index.html) en Chromium real, conectada al backend (Codigo.gs) simulado con los datos del Excel.
// Uso: TZ=America/Bogota node pruebas_ui.js <hoja.json> <Codigo.gs> <Index.html> <carpetaLibs> <carpetaCapturas>
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { chromium } = require('playwright');
const { crearMock } = require('./gas_mock');
const [, , rutaJson, rutaGs, rutaHtml, libs, capturas] = process.argv;
fs.mkdirSync(capturas, { recursive: true });

let fallos = 0, pasos = 0;
function ok(c, msg, extra) { pasos++; if (c) console.log('  ✔ ' + msg); else { fallos++; console.log('  ✘ ' + msg + (extra !== undefined ? ' → ' + String(extra).slice(0, 300) : '')); } }
function titulo(t) { console.log('\n■ ' + t); }

const m = crearMock(rutaJson, { formatoTextoGuia: true });
const ctx = m.cargar(rutaGs);
const U = m.hojas.CONFIG_USUARIOS.filas;
[['Gestor Prueba', 'gestor@dropi.co', 'Gestión', '', 'SI', '', ''], ['Comercial Premium', 'comercial@dropi.co', 'Comercial', '', 'SI', '', 'PREMIUM, PREMIUM EXCLUSIVO'],
 ['Envia Prueba', 'envia@trans.com', 'Transportadora', 'Envía', 'SI', '', ''], ['Bodega Medellin', 'bodega.mde@dropi.co', 'Bodega Dropi', '', 'SI', 'MEDELLIN', ''], ['Control Indem', 'indem@dropi.co', 'Indemnizaciones', '', 'SI', '', '']].forEach(r => U.push(r));

const esFecha = v => Object.prototype.toString.call(v) === '[object Date]';
function buscaFecha(o, ruta) { if (esFecha(o)) return ruta; if (o && typeof o === 'object') { for (const k of Object.keys(o)) { const r = buscaFecha(o[k], ruta + '.' + k); if (r) return r; } } return null; }
const fechasFiltradas = [];
function llamar(fn, args) {
  vm.runInContext('_nov=null;_usuarioMemo={};_ss=null;', ctx);
  if (typeof ctx[fn] !== 'function') throw new Error('Función inexistente en el backend: ' + fn);
  const r = ctx[fn](...args);
  const f = buscaFecha(r, fn); if (f) fechasFiltradas.push(f); // Apps Script no puede devolver Date al navegador
  return r === undefined ? null : JSON.parse(JSON.stringify(r));
}
function tokenDe(email) {
  llamar('solicitarAccesoOTP', [email]);
  const otp = m.correos[m.correos.length - 1].htmlBody.match(/>(\d{6})</)[1];
  return llamar('validarCodigoOTP', [email, otp]).token;
}
// Evaluador de plantillas como HtmlService (<? ?> y <?= ?>)
function evaluarPlantilla(src, vars) {
  const partes = src.split(/(<\?=?[\s\S]*?\?>)/);
  let code = 'const out=[];';
  partes.forEach(p => {
    if (p.startsWith('<?=')) code += `out.push(String(${p.slice(3, -2)}).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'));`;
    else if (p.startsWith('<?')) code += p.slice(2, -2) + '\n';
    else code += `out.push(${JSON.stringify(p)});`;
  });
  return new Function('sessionToken', 'ScriptApp', code + 'return out.join("");')(vars.sessionToken, { getService: () => ({ getUrl: () => 'https://app.test/exec' }) });
}
const LIBS = {
  'xlsx.full.min.js': path.join(libs, 'node_modules/xlsx/dist/xlsx.full.min.js'),
  'chart.umd.min.js': path.join(libs, 'node_modules/chart.js/dist/chart.umd.js'),
  'html5-qrcode.min.js': path.join(libs, 'node_modules/html5-qrcode/html5-qrcode.min.js'),
  'all.min.css': path.join(libs, 'node_modules/@fortawesome/fontawesome-free/css/all.min.css'),
  'exceljs.min.js': path.join(libs, 'node_modules/exceljs/dist/exceljs.min.js')
};
const plantilla = fs.readFileSync(rutaHtml, 'utf8');
const SHIM = `window.google={script:{url:{getLocation:cb=>setTimeout(()=>cb({hash:'',parameters:{}}),0)},history:{replace(){}},run:(function mk(ok,fail){return new Proxy({},{get(_,k){if(k==='withSuccessHandler')return f=>mk(f,fail);if(k==='withFailureHandler')return f=>mk(ok,f);return (...a)=>{window.__gs(k,JSON.stringify(a)).then(r=>{const v=JSON.parse(r);if(v&&v.__err){fail&&fail(new Error(v.__err));}else ok&&ok(v);});};}});})()}};`;

async function nuevaPagina(browser, token, opts) {
  const page = await browser.newPage(Object.assign({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, opts || {}));
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/Failed to load resource|favicon/.test(msg.text())) errores.push(msg.text()); });
  await page.exposeFunction('__gs', (fn, args) => { try { return JSON.stringify(llamar(fn, JSON.parse(args))); } catch (e) { return JSON.stringify({ __err: e.message }); } });
  await page.addInitScript(SHIM);
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('https://app.test/')) return route.fulfill({ contentType: 'text/html', body: evaluarPlantilla(plantilla, { sessionToken: token || '' }) });
    const k = Object.keys(LIBS).find(n => u.endsWith('/' + n));
    if (k) return route.fulfill({ path: LIBS[k], contentType: k.endsWith('.css') ? 'text/css' : 'application/javascript' });
    if (/webfonts\//.test(u)) { const f = path.join(libs, 'node_modules/@fortawesome/fontawesome-free/webfonts', u.split('/').pop()); return fs.existsSync(f) ? route.fulfill({ path: f }) : route.fulfill({ status: 404, body: '' }); }
    if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return route.continue().catch(() => route.fulfill({ contentType: 'text/css', body: '' }));
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('https://app.test/');
  page.errores = errores;
  return page;
}
const esperarToast = (page, re) => page.waitForFunction(r => [...document.querySelectorAll('#toast div')].some(d => new RegExp(r).test(d.textContent)), re.source, { timeout: 15000 });
async function foto(page, nombre, escala) { await page.waitForTimeout(250); await page.screenshot({ path: path.join(capturas, nombre + '.png'), fullPage: false }); }

(async () => {
  titulo('0. Revisiones para el servidor de Google (HtmlService)');
  const js = plantilla.split('<script>')[1].split('</script>')[0];
  ok(js.indexOf('<?') < 0, 'Ningún scriptlet <? ?> dentro del JavaScript');
  const lineasConTpl = js.split('\n').filter(l => (l.match(/`/g) || []).length % 2 === 1).length;
  ok(lineasConTpl === 0, 'Ningún texto con comillas invertidas ocupa varias líneas', lineasConTpl);
  const codigoSinComentarios = js.split('\n').filter(l => !l.trim().startsWith('//')).map(l => l.replace(/;\s*\/\/ se arma así.*$/, ';')).join('\n');
  ok(!/\/\/|\/\*/.test(codigoSinComentarios), 'No hay "//" ni "/*" dentro del código (Google los toma como comentario y corta la línea)');
  const browser = await chromium.launch();
  titulo('1. Login con código y dashboard (Admin)');
  let page = await nuevaPagina(browser, '');
  await page.fill('#loginEmail', 'oscar.sibaja@dropi.co');
  await page.click('#btnOtp');
  await page.waitForSelector('#paso2:not(.hidden)');
  const otp = m.correos[m.correos.length - 1].htmlBody.match(/>(\d{6})</)[1];
  await page.fill('#loginOtp', otp);
  await page.click('#btnVerificar');
  await page.waitForSelector('#app:not(.hidden)', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('#dKpis .v') && document.querySelector('#dKpis .v').textContent.length > 0);
  const total = await page.textContent('#dKpis .kpi:first-child .v');
  ok(total.replace(/\D/g, '') === '10675', 'Dashboard muestra 10.675 registros', total);
  ok(/10\.675/.test(await page.textContent('#dSuma')), 'Estados suman 10.675');
  ok(await page.isVisible('#dMigra .alert'), 'Avisa al Admin que hay estados viejos por actualizar');
  ok((await page.$$('#nav button')).length === 12, 'Admin ve las 12 secciones');
  await page.waitForTimeout(400);
  await foto(page, '01_dashboard');
  await page.selectOption('#dTrans', 'Envía'); await page.click('text=Aplicar');
  await page.waitForFunction(() => /3\.804/.test(document.querySelector('#dKpis .v').textContent));
  ok(true, 'Filtro por transportadora (Envía = 3.804)');

  titulo('2. Configuración: migración con copia de seguridad');
  await page.click('#nav-config');
  await page.waitForSelector('#uTabla table');
  await page.click('text=1. Ver qué va a cambiar');
  await page.waitForSelector('#cfgMigra .list-kv');
  ok(/8\.658/.test(await page.textContent('#cfgMigra')), 'Vista previa muestra 8.658 → Solución notificada');
  await page.click('text=2. Respaldar y aplicar');
  await page.click('#cfSi');
  await page.waitForSelector('#cfgMigra .alert.ok', { timeout: 20000 });
  ok(/Estructura y estados actualizados/.test(await page.textContent('#cfgMigra')) && /RESPALDO MIGRACION/.test(await page.textContent('#cfgMigra')), 'Migración por pasos aplicada y respaldo creado');
  await page.click('#cfgBodegas .btn >> nth=2');
  await page.fill('#b_dir', 'Calle 10 # 20-30, Itagüí'); await page.fill('#b_contacto', 'Jefe de bodega'); await page.fill('#b_tel', '3001112233'); await page.fill('#b_correo', 'bodega.mde@dropi.co');
  await page.click('#modal .btn-p'); await esperarToast(page, /Bodega guardada/);
  ok(m.hojas.CONFIG_BODEGAS_DROPI.filas.some(r => r[1] === 'Calle 10 # 20-30, Itagüí'), 'Dirección de la bodega guardada desde la app');
  await page.fill('#par_CONTACTO_URGENTE', 'Camilo · 300 000 0000'); await page.click('#cfgParams .btn >> nth=1'); await esperarToast(page, /Parámetro guardado/);
  ok(true, 'Contacto urgente guardado');
  await foto(page, '02_configuracion');
  ok(page.errores.length === 0, 'Sin errores de JavaScript (Admin)', page.errores.join(' | '));
  await page.close();

  const tGest = tokenDe('gestor@dropi.co');
  titulo('3. Gestión y solución (Gestión)');
  page = await nuevaPagina(browser, tGest);
  await page.waitForSelector('#app:not(.hidden)');
  ok((await page.$$('#nav button')).length === 11 && !(await page.$('#nav-config')), 'Gestión ve todo menos Configuración');
  await page.click('#nav-gestion');
  await page.waitForSelector('#gLista .grp');
  ok(/Pendiente\s*490/.test(await page.textContent('#gBandejas .chip.on')), 'Bandeja Pendiente (490) abierta por defecto');
  await foto(page, '03_gestion');
  await page.selectOption('#gBodega', 'CON_ID'); await page.click('#gFiltros .btn-p');
  await page.waitForFunction(() => document.querySelector('#gLista .grp .t') && !/Sin ID/.test(document.querySelector('#gLista .grp .t').textContent));
  ok(await page.isVisible('#gLista .alert.warn'), 'Muestra aviso "esta bodega ya tuvo solución"');
  await foto(page, '03b_gestion_solucion_previa');
  await page.selectOption('#gBodega', ''); await page.click('#gFiltros .btn-p'); await page.waitForTimeout(500);
  await page.click('#gLista .grp >> nth=0 >> text=Ficha');
  await page.waitForSelector('#f_estado');
  await page.selectOption('#f_estado', 'Para Bodega Dropi - por notificar');
  await page.selectOption('#f_ciudadDestino', 'MEDELLIN');
  ok(/Itagüí/.test(await page.inputValue('#f_dirNueva')), 'Al elegir Bodega Medellín la dirección se llena sola');
  await foto(page, '04_ficha');
  const filaFicha = await page.evaluate(() => S.ficha.ficha.row);
  await page.click('#btnFicha'); await esperarToast(page, /Guía actualizada/);
  ok(m.hojas.NOVEDADES.filas[filaFicha - 1][26] === 'Para Bodega Dropi - por notificar', 'Ficha guardada en la hoja');
  // selección masiva
  await page.click('#gLista .grp >> nth=1 >> thead input[type=checkbox]');
  await page.waitForSelector('#gBulk:not(.hidden)');
  ok(!(await page.$('#gBulk .btn-ok')), 'En Pendientes NO aparece "Confirmar entregadas" (solo en su bandeja)');
  const selMasivo = await page.evaluate(() => [...S.gest.sel]);
  await page.click('#gBulk >> text=Gestionar seleccionadas');
  await page.selectOption('#bkEstado', 'Solución lista - por notificar');
  await page.fill('#bkDir', 'Carrera 50 # 10-20'); await page.fill('#bkCiudadP', 'PEREIRA'); await page.fill('#bkDepto', 'RISARALDA'); await page.fill('#bkTel', '3205556677'); await page.fill('#bkObs', 'Proveedor cambió de ciudad');
  await foto(page, '03c_masivo');
  await page.click('#btnMasivo');
  await page.waitForSelector('#modal.on >> text=Entendido');
  const fm = m.hojas.NOVEDADES.filas[selMasivo[0] - 1];
  ok(fm[26] === 'Solución lista - por notificar' && fm[21] === 'PEREIRA' && fm[22] === 'RISARALDA' && String(fm[18]) === '3205556677' && fm[24] === 'Carrera 50 # 10-20', 'Masivo guarda dirección, ciudad, departamento y teléfono en todas las seleccionadas', fm.slice(18, 27).join(' | '));
  ok(selMasivo.every(r => m.hojas.NOVEDADES.filas[r - 1][21] === 'PEREIRA'), 'Las ' + selMasivo.length + ' guías seleccionadas quedaron con la ciudad nueva');
  await page.click('#modal >> text=Entendido');
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('#gFiltros >> text=Exportar')]);
  const rutaX = path.join(capturas, 'export_gestion.xlsx'); await descarga.saveAs(rutaX);
  const XL = require(path.join(libs, 'node_modules/xlsx'));
  const wbx = XL.readFile(rutaX); const sh = wbx.Sheets[wbx.SheetNames[0]]; const filasX = XL.utils.sheet_to_json(sh, { header: 1 });
  ok(/\.xlsx$/.test(descarga.suggestedFilename()) && filasX[0][0] === 'Fecha novedad' && filasX[0].length === 22 && filasX.length > 1, 'Exporta Excel (.xlsx) con cada dato en su columna', filasX[0] && filasX[0].join(','));
  ok(sh['C2'] && sh['C2'].t === 's', 'En el Excel la guía queda como texto (no pierde ceros)');
  // bandeja notificadas
  await page.click('#gBandejas >> text=Notificadas sin confirmar');
  await page.waitForFunction(() => /Notificadas sin confirmar/.test(document.querySelector('#gBandejas .chip.on').textContent));
  ok(/8\.658/.test(await page.textContent('#gBandejas .chip.on')), 'Bandeja de notificadas sin confirmar: 8.658');

  await page.click('#nav-ingreso'); await page.selectOption('#iTrans', 'Coordinadora');
  ok(await page.isVisible('#mlRemp'), 'Coordinadora sí muestra guías reemplazatorias');
  await page.selectOption('#iTrans', 'TCC'); ok(await page.isVisible('#mlRemp'), 'TCC sí muestra guías reemplazatorias');
  await page.selectOption('#iTrans', 'Interrapidísimo'); ok(await page.isVisible('#mlRemp') && await page.isVisible('#mlIdInter'), 'Interrapidísimo muestra reemplazatorias y sus campos propios');
  await page.selectOption('#iTrans', 'Veloces'); ok(!(await page.isVisible('#mlRemp')) && !(await page.isVisible('#mlCuenta')), 'Veloces no muestra reemplazatorias ni campos de otras transportadoras');
  titulo('4. Correos a transportadora');
  await page.click('#nav-correos');
  await page.click('#mTipos >> text=Envío a Bodega Dropi');
  const transFicha = m.hojas.NOVEDADES.filas[filaFicha - 1][1];
  await page.selectOption('#mTrans', transFicha); await page.selectOption('#mBod', 'MEDELLIN');
  ok(await page.isVisible('#mCopiaWrap') && /bodega.mde@dropi.co/.test(await page.textContent('#mCopiaTxt')), 'Ofrece enviar copia al correo de la Bodega Medellín');
  await page.click('text=Vista previa');
  await page.waitForSelector('#mFrame');
  const frameHtml = await page.$eval('#mFrame', f => f.srcdoc);
  ok(/Itagüí/.test(frameHtml) && /solo recibe las guías de esta lista/.test(frameHtml), 'Vista previa del correo con dirección de bodega');
  await foto(page, '05_correo');
  await page.fill('#mPara', 'ops@transportadora.com');
  await page.click('text=Enviar correo'); await page.click('#cfSi');
  await esperarToast(page, /Correo enviado/);
  ok(/bodega.mde@dropi.co/.test(m.correos[m.correos.length - 1].cc), 'El correo lleva copia a la bodega');
  await page.selectOption('#mTrans', ''); await page.fill('#mPara', ''); await page.selectOption('#mTrans', transFicha);
  await page.waitForFunction(() => document.querySelector('#mPara').value === 'ops@transportadora.com');
  ok(true, 'Al volver a elegir la transportadora, el correo de destino se llena solo');
  ok(m.hojas.NOVEDADES.filas[filaFicha - 1][26] === 'Bodega Dropi notificada', 'Guía quedó "Bodega Dropi notificada"');

  titulo('5. WhatsApp');
  await page.click('#nav-whatsapp');
  await page.waitForSelector('#wPrev .wa-prev');
  ok(/Gestor Prueba/.test(await page.textContent('#wMsg')), 'Mensaje firmado por el asesor');
  await foto(page, '06_whatsapp');
  ok(page.errores.length === 0, 'Sin errores de JavaScript (Gestión)', page.errores.join(' | '));
  await page.close();

  titulo('6. Bodega Dropi Medellín: escáner');
  const tMde = tokenDe('bodega.mde@dropi.co');
  page = await nuevaPagina(browser, tMde);
  await page.waitForSelector('#oTabla table');
  ok((await page.$$('#nav button')).length === 1, 'Bodega solo ve su sección');
  const filas = m.hojas.NOVEDADES.filas;
  const valida = filas.find((r, i) => i > 2 && r[28] === 'En tránsito a bodega' && /MEDELL/i.test(r[31]));
  await page.fill('#oScan', String(valida[2])); await page.press('#oScan', 'Enter');
  await page.waitForSelector('.res.ok');
  ok(/RECIBIDA EN BODEGA/.test(await page.textContent('#oResultado')), 'Guía válida: verde "Recibida" al instante');
  await page.waitForTimeout(1200);
  ok(filas.find(r => r[2] === valida[2] && r[28] === 'Recibido en Bodega'), 'Se guardó la recepción en la hoja');
  await page.fill('#oScan', String(valida[2])); await page.press('#oScan', 'Enter');
  await page.waitForSelector('.res.warn');
  ok(true, 'Segunda lectura: "Ya estaba recibida"');
  await page.fill('#oScan', '55555555555555'); await page.press('#oScan', 'Enter');
  await page.waitForSelector('.res.bad', { timeout: 10000 });
  ok(/NO RECIBIR/.test(await page.textContent('#oResultado')) && /Camilo/.test(await page.textContent('#oResultado')), 'Guía desconocida: rojo "NO RECIBIR" con el contacto configurado');
  ok(await page.evaluate(() => document.activeElement.id === 'oScan'), 'El campo queda listo para la siguiente lectura');
  await foto(page, '07_bodega_escaner');
  const otras = filas.filter((r, i) => i > 2 && r[28] === 'En tránsito a bodega' && /MEDELL/i.test(r[31])).slice(0, 3).map(r => r[2]);
  await page.fill('#oMasiva', otras.join('\n') + '\n44444444444444'); await page.click('#tab-bodega >> text=Revisar');
  await page.waitForSelector('#oMasivaRes .list-kv');
  await page.click('#oMasivaRes .btn-p');
  await page.waitForSelector('#oMasivaRes .alert.ok', { timeout: 10000 });
  ok(/3 guía\(s\) recibida/.test(await page.textContent('#oMasivaRes')) && /NO RECIBIR 1/.test(await page.textContent('#oMasivaRes')), 'Búsqueda masiva: 3 recibidas y 1 NO RECIBIR');
  await page.click('#oTabla tbody tr:first-child td.g', { clickCount: 2 });
  ok(await page.evaluate(() => document.activeElement.id !== 'oScan' && String(window.getSelection()).length > 0), 'En Bodega se puede seleccionar y copiar una guía de la tabla');
  const [dlB] = await Promise.all([page.waitForEvent('download'), page.click('#tab-bodega >> text=Exportar')]);
  ok(/\.xlsx$/.test(dlB.suggestedFilename()), 'Bodega exporta Excel (.xlsx)');
  ok(page.errores.length === 0, 'Sin errores de JavaScript (Bodega)', page.errores.join(' | '));
  await page.close();
  page = await nuevaPagina(browser, tMde, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.waitForSelector('#oTabla table');
  const anchoOk = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok(anchoOk, 'En celular no hay desplazamiento horizontal');
  await foto(page, '08_bodega_celular');
  await page.close();

  titulo('7. Guías rechazadas en bodega (Gestión vincula)');
  page = await nuevaPagina(browser, tGest);
  await page.waitForSelector('#app:not(.hidden)');
  await page.click('#nav-rechazos');
  await page.waitForSelector('#rTabla table');
  await page.click('#rTabla button:has-text("Resolver") >> nth=0');
  await page.waitForTimeout(300); if (page.errores.length) console.log('    errores:', page.errores);
  const transito = filas.find((r, i) => i > 2 && r[28] === 'En tránsito a bodega' && /MEDELL/i.test(r[31]));
  await page.fill('#rBuscar', String(transito[2])); await page.click('#rPanel >> text=Buscar');
  await page.waitForSelector('#rRes .radio-card');
  await page.click('#rRes .radio-card >> nth=0');
  await foto(page, '09_rechazos');
  await page.click('#rVinc'); await esperarToast(page, /Vinculada/);
  ok(filas.some(r => ['55555555555555', '44444444444444'].indexOf(String(r[3])) >= 0), 'Guía leída quedó como reemplazatoria nueva');
  ok(page.errores.length === 0, 'Sin errores de JavaScript (Rechazos)', page.errores.join(' | '));
  await page.close();

  titulo('8. Transportadora: buscador e ingreso por plantilla');
  const tEnvia = tokenDe('envia@trans.com');
  page = await nuevaPagina(browser, tEnvia);
  await page.waitForSelector('#app:not(.hidden)');
  ok((await page.$$('#nav button')).length === 4, 'Transportadora ve 4 secciones');
  await page.click('#nav-buscador');
  await page.click('#bCampos >> text=ID bodega');
  await page.fill('#bValores', '6208\n37749');
  await page.click('#tab-buscador button.btn-p');
  await page.waitForSelector('#bRes table');
  const encabezados = await page.$$eval('#bRes th', t => t.map(x => x.textContent.trim()));
  ok(encabezados.indexOf('Guía') < 0 && encabezados.indexOf('Transportadora') < 0, 'Resultados sin columna de guía ni transportadora', encabezados.join(','));
  const textoRes = await page.textContent('#bRes');
  const guiasDeBodega = filas.filter(r => String(r[15]) === '6208').map(r => String(r[2]));
  ok(!guiasDeBodega.some(g => textoRes.indexOf(g) >= 0), 'Ningún número de guía aparece en los resultados');
  await foto(page, '10_buscador');
  await page.click('#nav-ingreso');
  ok(await page.$eval('#iTrans', s => s.disabled && s.value === 'Envía'), 'Transportadora fija en Envía');
  await page.waitForSelector('#mlGuias');
  ok(await page.isVisible('#mlCuenta'), 'Formulario por líneas con campos de Envía (cuenta y fecha de captura)');
  ok(!(await page.isVisible('#mlRemp')), 'Envía NO muestra guías reemplazatorias');
  await page.fill('#mlGuias', '014188880001\n014188880002\n014188880002\n014188880003');
  await page.fill('#mlTipo', 'DIRECCION ERRADA\nNO SE UBICA');
  await page.click('#tab-ingreso >> text=Revisar y registrar novedades');
  await page.waitForSelector('#mlAviso .alert.bad');
  ok(/no coinciden/.test(await page.textContent('#mlAviso')), 'Si un campo no tiene las mismas líneas que las guías, avisa y no guarda nada');
  await page.fill('#mlTipo', 'DIRECCION ERRADA\nNO SE UBICA\nREPETIDA\nSE NEGO');
  await page.fill('#mlEstado', '\nDEV\nDEV\nDEV');
  await page.fill('#mlObs', 'misma para todas');
  await page.fill('#mlCuenta', 'C1\nC2\nC2\nC3');
  ok(/se usa para las 4 guías/.test(await page.textContent('#cnt_mlObs')), 'Una sola observación se aplica a todas');
  await foto(page, '11a_ingreso_lineas');
  await page.click('#tab-ingreso >> text=Revisar y registrar novedades');
  await page.waitForSelector('#iRevision table');
  ok(/repetida en el mismo archivo/.test(await page.textContent('#iRevision')), 'La guía repetida se marca y no se guarda dos veces');
  await page.click('#btnGuardarIng'); await esperarToast(page, /guardadas/);
  const g1 = filas.find(r => r[2] === '014188880001'), g2 = filas.filter(r => r[2] === '014188880002'), g3 = filas.find(r => r[2] === '014188880003');
  ok(g1 && g1[4] === 'DIRECCION ERRADA' && g1[5] === '' && g1[8] === 'C1' && g1[6] === 'misma para todas', 'Guía 1 con su tipo, estado vacío y su cuenta');
  ok(g2.length === 1 && g2[0][4] === 'NO SE UBICA' && g2[0][8] === 'C2', 'Guía repetida guardada una sola vez con SUS datos');
  ok(g3 && g3[4] === 'SE NEGO' && g3[5] === 'DEV' && g3[8] === 'C3', 'Guía 4 conserva sus datos aunque la 3 era repetida (nada se corrió)');
  const XLSX = require(path.join(libs, 'node_modules/xlsx'));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['GUIA', 'TIPO NOVEDAD', 'ESTADO TRANSPORTADORA', 'OBSERVACIONES', 'CUENTA', 'FECHA CAPTURA'], ['014199990001', 'DIRECCION ERRADA', 'DEVOLUCION', 'obs uno', 'C1', '01/11/2026'], ['', 'X', 'DEVOLUCION', 'sin guía', '', ''], [String(filas.find(r => r[1] === 'Envía')[2]), 'SE NEGO A RECIBIR', '', 'reingreso', '', '']]), 'Novedades');
  const archivo = path.join(capturas, 'plantilla_prueba.xlsx'); XLSX.writeFile(wb, archivo);
  await page.setInputFiles('#iArchivo', archivo);
  await page.waitForSelector('#iRevision table');
  const rev = await page.textContent('#iRevision');
  ok(/Lista/.test(rev) && /Error/.test(rev) && /Ya registrada/.test(rev), 'Revisión muestra lista, error y ya registrada');
  await page.check('.chkReing');
  await foto(page, '11_ingreso');
  await page.click('#btnGuardarIng'); await esperarToast(page, /guardadas/);
  ok(filas.some(r => r[2] === '014199990001' && r[6] === 'obs uno' && r[8] === 'C1'), 'Guía guardada con cero inicial y sus datos en la misma fila');
  ok(page.errores.length === 0, 'Sin errores de JavaScript (Transportadora)', page.errores.join(' | '));
  await page.close();

  titulo('9. Comercial e Indemnizaciones');
  page = await nuevaPagina(browser, tokenDe('comercial@dropi.co'));
  await page.waitForSelector('#kLista .grp, #kLista .empty');
  ok((await page.$$('#nav button')).length === 3, 'Comercial ve 3 secciones');
  if (await page.$('#kLista .grp')) { await page.click('#kLista .grp >> nth=0 >> text=Gestionar proveedor'); await page.waitForSelector('#kDir'); await page.fill('#kDir', 'Calle 1 # 2-3'); await page.fill('#kCiudad', 'MANIZALES'); await page.fill('#kTel', '3157778899'); await page.fill('#kObs', 'Confirmado por teléfono'); await foto(page, '12_comercial'); await page.click('#btnCom'); await esperarToast(page, /actualizada/); ok(m.hojas.NOVEDADES.filas.some(r => r[21] === 'MANIZALES' && String(r[18]) === '3157778899' && r[26] === 'Solución lista - por notificar'), 'Comercial guarda solución con ciudad y celular nuevos'); }
  ok(page.errores.length === 0, 'Sin errores de JavaScript (Comercial)', page.errores.join(' | '));
  await page.close();
  page = await nuevaPagina(browser, tokenDe('indem@dropi.co'));
  await page.waitForSelector('#nKpis .kpi');
  ok((await page.$$('#nav button')).length === 1, 'Indemnizaciones solo ve su panel');
  await foto(page, '13_indemnizaciones');
  ok(page.errores.length === 0, 'Sin errores de JavaScript (Indemnizaciones)', page.errores.join(' | '));
  await page.close();

  titulo('10. Comunicación navegador ↔ servidor');
  ok(fechasFiltradas.length === 0, 'El servidor nunca devuelve objetos Date (Apps Script no los permite)', fechasFiltradas.join(', '));

  await browser.close();
  console.log(`\nResultado UI: ${pasos - fallos}/${pasos} pruebas OK` + (fallos ? ` · ${fallos} FALLARON` : ''));
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(2); });
