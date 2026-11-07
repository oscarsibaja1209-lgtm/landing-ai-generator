// ============================================================
//   SISTEMA NOVEDADES DEVOLUCIONES — DROPI
//   Archivo: Codigo.gs  |  Versión 2026.11 (Premium Edition)
//   Estados nuevos · Roles · Bodegas Dropi · Historial de reemplazatorias
//   Rendimiento: 1 lectura por petición, escrituras agrupadas, LockService
// ============================================================

const SPREADSHEET_ID = '1Ddjg_VREakp4JSNjcQVVI80cWrBowfDbpY3pID-ePcg';
const ADMIN_EMAIL = 'oscar.sibaja@dropi.co';
const TZ = 'GMT-5';
const LOCK_WAIT_TIME = 30000;
const FILA_INICIO = 4;          // primera fila de datos en NOVEDADES (1-based)
const NCOL = 37;                // columnas que maneja el sistema en NOVEDADES

const TABS = Object.freeze({
  NOVEDADES:       'NOVEDADES',
  TRANSPORTADORAS: 'CONFIG_TRANSPORTADORAS',
  USUARIOS:        'CONFIG_USUARIOS',
  DESPLEGABLES:    'CONFIG_DESPLEGABLES',
  LOG:             'LOG',
  INDEMNIZACION:   'COBROS_INDEMNIZACION',
  BODEGAS:         'CONFIG_BODEGAS_DROPI',
  PARAMETROS:      'CONFIG_PARAMETROS',
  REEMPLAZOS:      'HISTORIAL_REEMPLAZATORIAS',
  RECHAZOS:        'RECHAZOS_BODEGA',
  CORREOS:         'CONFIG_CORREOS'
});

// Columnas hoja NOVEDADES (base 0)
const COL = Object.freeze({
  FECHA_SOL: 0, TRANSPORTADORA: 1, GUIA: 2, GUIA_REMP: 3, TIPO_NOV: 4, ESTADO_TRANS: 5, OBS_TRANS: 6,
  ASESOR_REP: 7, CUENTA: 8, FECHA_CAP: 9, ID_INTER: 10, BOD_INTER: 11, FECHA_SOL_DROPI: 12,
  ID_ORDEN: 13, ESTATUS_DROPI: 14, ID_BODEGA: 15, EMAIL_PROV: 16, CATEGORIA: 17, TEL_PROV: 18,
  TEL_TIENDA: 19, MARCA_BLANCA: 20, CIUDAD: 21, DEPTO: 22, DIR_ANTIGUA: 23, DIR_NUEVA: 24,
  OBS_DROPI: 25, ESTADO: 26, ASESOR_GEST: 27,
  ESTADO_RECEPCION: 28, FECHA_RECEP_FISICA: 29, OBS_BODEGA: 30, CIUDAD_DESTINO: 31,
  FECHA_DEVOLUCION: 32, INTENTO: 33, FECHA_NOTIF: 34, FECHA_CIERRE: 35, CONFIRMADO_POR: 36
});
const HEADERS_NUEVOS = { 32: 'Fecha Devolución', 33: 'Intento #', 34: 'Fecha Notificación', 35: 'Fecha Cierre', 36: 'Confirmado por' };

// Columnas hoja COBROS_INDEMNIZACION (base 0)
const COL_COBRO = Object.freeze({
  FECHA_GEN: 0, ROW_NOVEDADES: 1, GUIA: 2, ID_BODEGA: 3, TRANSPORTADORA: 4,
  MES: 5, VALOR: 6, ESTADO_COBRO: 7, FECHA_COBRO: 8
});

// ── ESTADOS ─────────────────────────────────────────────────
const E = Object.freeze({
  PENDIENTE:  'Pendiente',
  GEST_LOG:   'En gestión logística',
  GEST_COM:   'En gestión comercial',
  COM_SIN:    'Comercial sin contacto',
  SOL_LISTA:  'Solución lista - por notificar',
  BOD_LISTA:  'Para Bodega Dropi - por notificar',
  RECH_LISTA: 'Rechazada - por notificar',
  SOL_NOTIF:  'Solución notificada',
  BOD_NOTIF:  'Bodega Dropi notificada',
  RECH_NOTIF: 'Rechazada notificada',
  CULM_ENT:   'Culminado - entregado al proveedor',
  CULM_BOD:   'Culminado - en Bodega Dropi'
});
const ESTADOS_ORDEN = [E.PENDIENTE, E.GEST_LOG, E.GEST_COM, E.COM_SIN, E.SOL_LISTA, E.BOD_LISTA, E.RECH_LISTA,
  E.SOL_NOTIF, E.BOD_NOTIF, E.RECH_NOTIF, E.CULM_ENT, E.CULM_BOD];
const ESTADOS_LEGADO = Object.freeze({
  'En proceso con proveedor': E.GEST_LOG,
  'Gestión con comercial': E.GEST_COM,
  'Culminado': E.SOL_LISTA,
  'Culminado - Notificado': E.SOL_NOTIF,
  'Enviado a Bodega Dropi': E.BOD_LISTA,
  'Bodega Dropi - Notificado': E.BOD_NOTIF,
  'Solicitud Rechazada': E.RECH_LISTA,
  'Rechazada - Notificado': E.RECH_NOTIF
});
const ESTADOS_ACTIVOS = [E.PENDIENTE, E.GEST_LOG, E.GEST_COM, E.COM_SIN];
const ESTADOS_SOLUCION = [E.SOL_NOTIF, E.CULM_ENT, E.BOD_NOTIF, E.CULM_BOD];

// Estado físico en Bodega Dropi (columna ESTADO RECEPCION)
const EB = Object.freeze({
  TRANSITO:  'En tránsito a bodega',
  RECIBIDO:  'Recibido en Bodega',
  RETIRADO:  'Retirado por el proveedor',
  REENVIADO: 'Reenviado al proveedor'
});
const EB_LEGADO = Object.freeze({ 'Entregado al proveedor': EB.RETIRADO, 'Devuelto': EB.REENVIADO, 'Pendiente Recibir': EB.TRANSITO });
const EB_SIN_COBRO = [EB.RETIRADO, EB.REENVIADO];

// ── ROLES Y PESTAÑAS ────────────────────────────────────────
const R = Object.freeze({ ADMIN: 'Admin', GESTION: 'Gestión', COMERCIAL: 'Comercial', TRANS: 'Transportadora', BODEGA: 'Bodega Dropi', INDEM: 'Indemnizaciones' });
const TABS_POR_ROL = {
  'Admin':           ['dashboard', 'ingreso', 'cruce', 'buscador', 'gestion', 'comercial', 'whatsapp', 'correos', 'bodega', 'rechazos', 'indemnizacion', 'config'],
  'Gestión':         ['dashboard', 'ingreso', 'cruce', 'buscador', 'gestion', 'comercial', 'whatsapp', 'correos', 'bodega', 'rechazos', 'indemnizacion'],
  'Comercial':       ['comercial', 'whatsapp', 'dashboard'],
  'Transportadora':  ['dashboard', 'buscador', 'ingreso', 'gestion'],
  'Bodega Dropi':    ['bodega'],
  'Indemnizaciones': ['indemnizacion']
};
const PARAM_DEFAULTS = {
  VALOR_COBRO_MENSUAL: 2000,
  CONTACTO_URGENTE: 'Responsable de Gestión Dropi',
  LIMITE_WSP_DIA: 60,
  CRM_WEBHOOK_URL: '',
  MAX_BUSQUEDA: 500
};

// ── UTILIDADES ──────────────────────────────────────────────
function txt_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function normTxt_(s) { return txt_(s).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function normCode_(s) { return txt_(s).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function sinCeros_(s) { return s.replace(/^0+/, ''); }
function sanitizarCSV_(valor) { const str = txt_(valor); return /^[=+\-@]/.test(str) ? "'" + str : str; }
function escapeHtml_(u) { return txt_(u).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }
function hoy_() { return Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy'); }
function fastFormatDate(d) {
  if (!(d instanceof Date)) return d === null || d === undefined ? '' : d;
  return Utilities.formatDate(d, TZ, 'dd/MM/yyyy');
}
function f_(d) { return txt_(fastFormatDate(d)); }
function parseFecha(str, esFinDia) { if (!str) return null; const d = new Date(str + 'T00:00:00'); if (esFinDia) d.setHours(23, 59, 59); return isNaN(d) ? null : d; }
function parseFechaStr(val) {
  if (!val) return null; if (val instanceof Date) return val;
  const p = txt_(val).split(/[\/\- T:]/); if (p.length < 3) return null;
  let y, m, d;
  if (p[0].length === 4) { y = +p[0]; m = +p[1] - 1; d = +p[2]; } else { d = +p[0]; m = +p[1] - 1; y = +p[2]; }
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  if (y < 100) y += 2000;
  return new Date(y, m, d);
}
function bodegaReal_(v) { const b = txt_(v); const u = b.toUpperCase(); return (b === '-' || u === 'N/A' || u === 'NA') ? '' : b; }
function estadoDe_(r) { const e = txt_(r[COL.ESTADO]) || E.PENDIENTE; return ESTADOS_LEGADO[e] || e; }
function estadoBodegaDe_(r) {
  const eb = txt_(r[COL.ESTADO_RECEPCION]);
  if (eb) return EB_LEGADO[eb] || eb;
  return estadoDe_(r) === E.BOD_NOTIF ? EB.TRANSITO : '';
}
function ciudadKey_(s) { return normTxt_(s); }
function csvCelda_(c) { const val = sanitizarCSV_(c); if (/^\d+$/.test(val) && val.length >= 4) return '"\t' + val.replace(/"/g, '""') + '"'; return '"' + val.replace(/"/g, '""') + '"'; }
function aCSV_(headers, filas) { return '﻿' + headers.join(';') + '\r\n' + filas.map(f => f.map(csvCelda_).join(';')).join('\r\n') + '\r\n'; }

// ── ACCESO A LA HOJA (con memoria por ejecución) ────────────
let _ss = null, _nov = null;
function ss_() { return _ss || (_ss = SpreadsheetApp.openById(SPREADSHEET_ID)); }
function hoja_(nombre) { return ss_().getSheetByName(nombre); }
function asegurarHoja_(nombre, headers) {
  let ws = hoja_(nombre);
  if (!ws) { ws = ss_().insertSheet(nombre); ws.getRange(1, 1, 1, headers.length).setValues([headers]); }
  return ws;
}
function asegurarColumnas_(ws) { if (ws.getMaxColumns() < NCOL) ws.insertColumnsAfter(ws.getMaxColumns(), NCOL - ws.getMaxColumns()); }
// Lee NOVEDADES una sola vez por ejecución. data[i] = fila i+1 de la hoja.
function nov_() {
  if (_nov) return _nov;
  const ws = hoja_(TABS.NOVEDADES);
  asegurarColumnas_(ws);
  const lr = ws.getLastRow();
  const data = lr >= 1 ? ws.getRange(1, 1, lr, NCOL).getValues() : [];
  _nov = { ws, data };
  return _nov;
}
function resetNov_() { _nov = null; }

// Escritura agrupada: cambios = { filaHoja: true } sobre _nov.data (ya modificado en memoria).
// Escribe solo el rango de columnas tocadas; agrupa filas contiguas en un solo setValues.
function escribirCambios_(filas, colMin, colMax) {
  if (!filas.length) return;
  const { ws, data } = nov_();
  const ordenadas = filas.slice().sort((a, b) => a - b);
  const ancho = colMax - colMin + 1;
  // Muchas filas dispersas: un solo bloque (1 llamada) es mucho más rápido que cientos de llamadas pequeñas.
  // Filas cercanas se escriben juntas en un bloque, pero ningún bloque pasa de 1.500 filas
  // (bloques muy grandes pueden agotar el tiempo de espera de Google Sheets).
  const hueco = ordenadas.length > 40 ? 60 : 3;
  let i = 0;
  while (i < ordenadas.length) {
    let j = i;
    while (j + 1 < ordenadas.length && ordenadas[j + 1] - ordenadas[j] <= hueco && ordenadas[j + 1] - ordenadas[i] < 1500) j++;
    const ini = ordenadas[i], fin = ordenadas[j];
    const bloque = [];
    for (let f = ini; f <= fin; f++) bloque.push(data[f - 1].slice(colMin, colMax + 1));
    ws.getRange(ini, colMin + 1, fin - ini + 1, ancho).setValues(bloque);
    i = j + 1;
  }
  SpreadsheetApp.flush();
}

// ── CONFIGURACIÓN CACHEADA ──────────────────────────────────
function cacheJSON_(clave, segundos, fn) {
  const cache = CacheService.getScriptCache();
  const c = cache.get(clave);
  if (c) { try { return JSON.parse(c); } catch (e) {} }
  const v = fn();
  try { cache.put(clave, JSON.stringify(v), segundos); } catch (e) {}
  return v;
}
function clearCache(nombre) { CacheService.getScriptCache().remove('CACHE_' + nombre); }
function leerHojaConfig_(nombre) {
  return cacheJSON_('CACHE_' + nombre, 21600, () => { const ws = hoja_(nombre); return ws ? ws.getDataRange().getValues().map(r => r.map(c => c instanceof Date ? fastFormatDate(c) : c)) : []; });
}
function getParametros_() {
  const p = Object.assign({}, PARAM_DEFAULTS);
  const data = leerHojaConfig_(TABS.PARAMETROS);
  for (let i = 1; i < data.length; i++) {
    const k = txt_(data[i][0]); if (!k) continue;
    const v = data[i][1];
    p[k] = (typeof PARAM_DEFAULTS[k] === 'number') ? (Number(v) || PARAM_DEFAULTS[k]) : txt_(v);
  }
  return p;
}
function getBodegasDropi_() {
  const data = leerHojaConfig_(TABS.BODEGAS);
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const c = txt_(data[i][0]); if (!c) continue;
    const b = { rowIndex: i + 1, ciudad: c, clave: ciudadKey_(c), direccion: txt_(data[i][1]), contacto: txt_(data[i][2]), telefono: txt_(data[i][3]), activa: normTxt_(data[i][4] || 'SI') !== 'NO', correo: txt_(data[i][5]) };
    const prev = out.findIndex(x => x.clave === b.clave);
    if (prev < 0) out.push(b); else if (!out[prev].direccion && b.direccion) out[prev] = b; // ciudad repetida: gana la que tiene dirección
  }
  if (!out.length) ['BOGOTA', 'CALI', 'MEDELLIN'].forEach(c => out.push({ rowIndex: 0, ciudad: c, clave: c, direccion: '', contacto: '', telefono: '', activa: true, correo: '' }));
  return out;
}
function bodegaPorCiudad_(ciudad) { const k = ciudadKey_(ciudad); return getBodegasDropi_().find(b => b.clave === k) || null; }

// ── WEB APP ─────────────────────────────────────────────────
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  template.sessionToken = (e && e.parameter && e.parameter.sid) || '';
  return template.evaluate()
    .setTitle('Novedades Devoluciones — Dropi')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

// ── AUTENTICACIÓN OTP ───────────────────────────────────────
function solicitarAccesoOTP(email) {
  const emailClean = txt_(email).toLowerCase();
  if (!emailClean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean)) return { ok: false, msg: 'Correo inválido.' };
  const cache = CacheService.getScriptCache();
  let registrado = emailClean === ADMIN_EMAIL.toLowerCase();
  if (!registrado) {
    const data = leerHojaConfig_(TABS.USUARIOS);
    for (let i = 1; i < data.length; i++) {
      if (txt_(data[i][1]).toLowerCase() === emailClean && normTxt_(data[i][4]) === 'SI') { registrado = true; break; }
    }
  }
  if (!registrado) return { ok: false, msg: 'Correo no registrado o inactivo.' };
  const intentos = parseInt(cache.get('RATE_OTP_' + emailClean) || '0');
  if (intentos >= 3) return { ok: false, msg: 'Demasiados intentos. Espera 5 minutos.' };
  cache.put('RATE_OTP_' + emailClean, String(intentos + 1), 300);
  cache.remove('ATTEMPTS_OTP_' + emailClean);
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  cache.put('OTP_' + emailClean, otp, 300);
  MailApp.sendEmail({
    to: emailClean, subject: 'Código de seguridad - Novedades Dropi', name: 'Novedades Dropi',
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:480px;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden"><div style="height:6px;background:#FF6D00"></div><div style="padding:26px"><h2 style="margin:0 0 6px;color:#111827">Tu código de acceso</h2><p style="color:#4B5563;margin:0 0 18px">Úsalo para ingresar a Novedades Devoluciones. Vence en 5 minutos.</p><div style="background:#FFF7ED;border:1px dashed #FDBA74;text-align:center;padding:16px;border-radius:10px"><span style="letter-spacing:8px;color:#9A3412;font-size:30px;font-weight:800">${otp}</span></div></div></div>`
  });
  return { ok: true, msg: 'Código enviado al correo.' };
}
function validarCodigoOTP(email, otp) {
  const emailClean = txt_(email).toLowerCase(); const otpClean = txt_(otp);
  const cache = CacheService.getScriptCache();
  const stored = cache.get('OTP_' + emailClean);
  if (!stored) return { ok: false, msg: 'Código expirado o no solicitado.' };
  const fails = parseInt(cache.get('ATTEMPTS_OTP_' + emailClean) || '0');
  if (fails >= 5) { cache.remove('OTP_' + emailClean); return { ok: false, msg: 'Demasiados intentos fallidos. Solicita otro código.' }; }
  if (stored !== otpClean) { cache.put('ATTEMPTS_OTP_' + emailClean, String(fails + 1), 300); return { ok: false, msg: 'Código incorrecto.' }; }
  cache.remove('OTP_' + emailClean); cache.remove('ATTEMPTS_OTP_' + emailClean);
  const token = Utilities.getUuid();
  cache.put('SESSION_' + token, emailClean, 21600);
  return { ok: true, token };
}
function validarAccesoOTP(email, otp) { return validarCodigoOTP(email, otp); }
function cerrarSesion(token) { if (token) CacheService.getScriptCache().remove('SESSION_' + token); return { ok: true }; }

function normRol_(s) {
  const n = normTxt_(s);
  if (n === 'ADMIN' || n === 'ADMINISTRADOR') return R.ADMIN;
  if (n.indexOf('GESTION') === 0 || n === 'LOGISTICA' || n === 'ASESOR') return R.GESTION;
  if (n.indexOf('COMERCIAL') === 0) return R.COMERCIAL;
  if (n.indexOf('TRANSPORTADORA') === 0) return R.TRANS;
  if (n.indexOf('BODEGA') >= 0) return R.BODEGA;
  if (n.indexOf('INDEMNIZ') === 0) return R.INDEM;
  return txt_(s);
}
let _usuarioMemo = {};
function getUsuarioActualContexto(tokenSesion) {
  const memoKey = tokenSesion || '_';
  if (_usuarioMemo[memoKey]) return _usuarioMemo[memoKey];
  let email = '';
  try { email = Session.getActiveUser().getEmail(); } catch (e) {}
  if (tokenSesion) { const c = CacheService.getScriptCache().get('SESSION_' + tokenSesion); if (c) email = c; }
  if (!email) return { error: 'REQUIRES_FALLBACK_LOGIN' };
  let u = null;
  if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    u = { nombre: 'Oscar Sibaja', email: ADMIN_EMAIL, rol: R.ADMIN, transportadora: '', sede: 'TODAS', categorias: ['TODAS'] };
  } else {
    const data = leerHojaConfig_(TABS.USUARIOS);
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0] || txt_(row[1]).toLowerCase() !== email.toLowerCase()) continue;
      if (normTxt_(row[4]) !== 'SI') return { error: 'Usuario inactivo.' };
      const cats = txt_(row[6]) ? txt_(row[6]).split(/[,;]/).map(normTxt_).filter(Boolean) : ['TODAS'];
      u = { nombre: txt_(row[0]), email: txt_(row[1]), rol: normRol_(row[2]), transportadora: txt_(row[3]), sede: ciudadKey_(row[5] || 'TODAS') || 'TODAS', categorias: cats };
      break;
    }
  }
  if (!u) return { error: 'Tu correo no está registrado.' };
  u.tabs = TABS_POR_ROL[u.rol] || ['dashboard'];
  _usuarioMemo[memoKey] = u;
  return u;
}
function exigir_(token, tab) {
  const u = getUsuarioActualContexto(token);
  if (u.error) throw new Error(u.error);
  if (tab && u.tabs.indexOf(tab) < 0) throw new Error('No tienes permiso para esta sección.');
  return u;
}
function esStaff_(u) { return u.rol === R.ADMIN || u.rol === R.GESTION; }
function enAlcance_(u, r) {
  if (u.rol === R.TRANS) return normTxt_(r[COL.TRANSPORTADORA]) === normTxt_(u.transportadora);
  if (u.rol === R.COMERCIAL) return u.categorias.indexOf('TODAS') >= 0 || u.categorias.indexOf(normTxt_(r[COL.CATEGORIA])) >= 0;
  if (u.rol === R.BODEGA) return u.sede === 'TODAS' || ciudadKey_(r[COL.CIUDAD_DESTINO]) === u.sede;
  return true;
}
function registrarLog_(u, accion, guias, detalle) {
  try { hoja_(TABS.LOG).appendRow([Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm:ss'), u.email, sanitizarCSV_(accion), sanitizarCSV_(String(guias).slice(0, 45000)), sanitizarCSV_(detalle)]); } catch (e) {}
}
function registrarLog(accion, guias, detalle, token) { const u = getUsuarioActualContexto(token); if (!u.error) registrarLog_(u, accion, guias, detalle); }
function conLock_(fn) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(LOCK_WAIT_TIME); return fn(); }
  catch (e) { return { ok: false, msg: e.message || String(e) }; }
  finally { try { lock.releaseLock(); } catch (e) {} }
}
function seguro_(fn) { try { return fn(); } catch (e) { return { ok: false, msg: e.message || String(e) }; } }

// ── DATOS INICIALES Y MÉTRICAS ──────────────────────────────
function getDatosIniciales(tokenSesion) {
  try {
    const u = getUsuarioActualContexto(tokenSesion);
    if (u.error) return { error: u.error };
    const transData = leerHojaConfig_(TABS.TRANSPORTADORAS);
    const transportadoras = [];
    for (let i = 1; i < transData.length; i++) if (txt_(transData[i][0]) && normTxt_(transData[i][1]) === 'SI' && txt_(transData[i][0]) !== 'Transportadora') transportadoras.push(txt_(transData[i][0]));
    const p = getParametros_();
    const out = {
      usuario: u, transportadoras, estados: ESTADOS_ORDEN, estadosBodega: [EB.TRANSITO, EB.RECIBIDO, EB.RETIRADO, EB.REENVIADO],
      bodegasDropi: getBodegasDropi_().filter(b => b.activa).map(b => ({ ciudad: b.ciudad, clave: b.clave, direccion: b.direccion, correo: b.correo })),
      parametros: { VALOR_COBRO_MENSUAL: p.VALOR_COBRO_MENSUAL, LIMITE_WSP_DIA: p.LIMITE_WSP_DIA, CONTACTO_URGENTE: p.CONTACTO_URGENTE, MAX_BUSQUEDA: p.MAX_BUSQUEDA, CRM: !!p.CRM_WEBHOOK_URL },
      isIAConfigured: !!(PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY'))
    };
    if (u.tabs.indexOf('dashboard') >= 0) {
      const m = getMetricasFiltradas({}, tokenSesion);
      out.stats = m.stats;
      out.migracionPendiente = m.legado || 0;
    }
    return out;
  } catch (e) { return { error: e.message || String(e) }; }
}

function calcularStats_(filas, tipoFecha) {
  const s = { total: 0, unicas: 0, porEstado: {}, porTransportadora: {}, porTipo: {}, porCategoria: {}, porMarca: {}, porBodega: {}, porDepto: {}, porDia: {}, bodegaCiudad: {} };
  ESTADOS_ORDEN.forEach(e => s.porEstado[e] = 0);
  const guias = new Set();
  filas.forEach(r => {
    s.total++;
    guias.add(normCode_(r[COL.GUIA]));
    const est = estadoDe_(r);
    s.porEstado[est] = (s.porEstado[est] || 0) + 1;
    const inc = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };
    inc(s.porTransportadora, txt_(r[COL.TRANSPORTADORA]) || 'Sin transportadora');
    inc(s.porTipo, normTxt_(r[COL.TIPO_NOV]) || 'SIN TIPO');
    const cat = normTxt_(r[COL.CATEGORIA]); inc(s.porCategoria, cat && cat !== '-' ? cat : 'SIN CATEGORÍA');
    const mb = txt_(r[COL.MARCA_BLANCA]); inc(s.porMarca, mb && mb !== '-' ? mb : 'Sin marca');
    const b = bodegaReal_(r[COL.ID_BODEGA]); if (b) inc(s.porBodega, b);
    inc(s.porDepto, normTxt_(r[COL.DEPTO]) || 'SIN DEPTO');
    const fd = parseFechaStr(tipoFecha === 'gestion' ? r[COL.FECHA_SOL_DROPI] : r[COL.FECHA_SOL]);
    if (fd) inc(s.porDia, Utilities.formatDate(fd, TZ, 'yyyy-MM-dd'));
    const eb = estadoBodegaDe_(r);
    if (eb) {
      const c = ciudadKey_(r[COL.CIUDAD_DESTINO]) || 'SIN CIUDAD';
      if (!s.bodegaCiudad[c]) s.bodegaCiudad[c] = { transito: 0, recibidas: 0, cerradas: 0 };
      if (eb === EB.TRANSITO) s.bodegaCiudad[c].transito++; else if (eb === EB.RECIBIDO) s.bodegaCiudad[c].recibidas++; else s.bodegaCiudad[c].cerradas++;
    }
  });
  const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
  s.unicas = guias.size;
  s.reingresos = s.total - s.unicas;
  const pe = s.porEstado;
  s.pendientes = pe[E.PENDIENTE];
  s.enGestion = pe[E.GEST_LOG] + pe[E.GEST_COM] + pe[E.COM_SIN];
  s.porNotificar = pe[E.SOL_LISTA] + pe[E.BOD_LISTA];
  s.notificadasSinConfirmar = pe[E.SOL_NOTIF] + pe[E.BOD_NOTIF];
  s.rechazadas = pe[E.RECH_LISTA] + pe[E.RECH_NOTIF];
  s.culminadas = pe[E.CULM_ENT] + pe[E.CULM_BOD];
  s.topTransportadoras = top(s.porTransportadora, 20);
  s.topTipos = top(s.porTipo, 15);
  s.topCategorias = top(s.porCategoria, 10);
  s.topMarcas = top(s.porMarca, 10);
  s.topBodegas = top(s.porBodega, 10);
  s.topDeptos = top(s.porDepto, 10);
  s.dias = Object.entries(s.porDia).sort((a, b) => a[0] < b[0] ? -1 : 1).slice(-30);
  delete s.porTransportadora; delete s.porTipo; delete s.porCategoria; delete s.porMarca; delete s.porBodega; delete s.porDepto; delete s.porDia;
  return s;
}

function getMetricasFiltradas(filtros, tokenSesion) {
  return seguro_(() => {
    const u = exigir_(tokenSesion, 'dashboard');
    const f = filtros || {};
    const { data } = nov_();
    const dStart = f.fechaInicio ? parseFecha(f.fechaInicio) : null;
    const dEnd = f.fechaFin ? parseFecha(f.fechaFin, true) : null;
    const tipoF = f.tipoFecha || 'solicitud';
    const fCiudad = f.ciudad ? normTxt_(f.ciudad) : '';
    const filas = []; let legado = 0;
    for (let i = FILA_INICIO - 1; i < data.length; i++) {
      const r = data[i];
      if (!txt_(r[COL.GUIA])) continue;
      if (ESTADOS_LEGADO[txt_(r[COL.ESTADO])]) legado++;
      if (!enAlcance_(u, r)) continue;
      if (f.transportadora && txt_(r[COL.TRANSPORTADORA]) !== f.transportadora) continue;
      if (f.estado && estadoDe_(r) !== f.estado) continue;
      if (fCiudad && normTxt_(r[COL.CIUDAD]).indexOf(fCiudad) < 0 && normTxt_(r[COL.CIUDAD_DESTINO]).indexOf(fCiudad) < 0) continue;
      if (dStart || dEnd) {
        const fd = parseFechaStr(tipoF === 'gestion' ? r[COL.FECHA_SOL_DROPI] : r[COL.FECHA_SOL]);
        if (!fd || (dStart && fd < dStart) || (dEnd && fd > dEnd)) continue;
      }
      filas.push(r);
    }
    return { ok: true, stats: calcularStats_(filas, tipoF), legado };
  });
}

function getRendimientoAsesores(fechaDeseada, tokenSesion) {
  return seguro_(() => {
    const u = exigir_(tokenSesion, 'dashboard');
    if (!esStaff_(u)) return { ok: true, data: {} };
    const { data } = nov_();
    const objetivo = fechaDeseada ? Utilities.formatDate(parseFecha(fechaDeseada), TZ, 'dd/MM/yyyy') : '';
    const out = {};
    for (let i = FILA_INICIO - 1; i < data.length; i++) {
      const r = data[i]; const a = txt_(r[COL.ASESOR_GEST]); if (!a || a === 'Sin asignar') continue;
      const fd = parseFechaStr(r[COL.FECHA_SOL_DROPI]);
      if (objetivo && (!fd || Utilities.formatDate(fd, TZ, 'dd/MM/yyyy') !== objetivo)) continue;
      const est = estadoDe_(r);
      if (!out[a]) out[a] = { total: 0, estados: {} };
      out[a].total++; out[a].estados[est] = (out[a].estados[est] || 0) + 1;
    }
    return { ok: true, data: out };
  });
}

// ── INGRESO DE NOVEDADES (por filas: imposible que se corran los datos) ──
function indiceGuias_() {
  const { data } = nov_();
  const idx = {};
  for (let i = FILA_INICIO - 1; i < data.length; i++) {
    const g = normCode_(data[i][COL.GUIA]); if (!g) continue;
    (idx[g] = idx[g] || []).push(i + 1);
  }
  return idx;
}
function validarFilasIngreso_(u, payload) {
  const trans = txt_(payload.transportadora);
  if (!trans) throw new Error('Selecciona la transportadora.');
  if (u.rol === R.TRANS && normTxt_(trans) !== normTxt_(u.transportadora)) throw new Error('Solo puedes subir guías de tu transportadora.');
  const filas = Array.isArray(payload.filas) ? payload.filas : [];
  if (!filas.length) throw new Error('No hay filas para procesar.');
  if (filas.length > 3000) throw new Error('Máximo 3.000 guías por carga.');
  const idx = indiceGuias_(); const { data } = nov_();
  const vistos = {};
  return filas.map((f, n) => {
    const guia = txt_(f.guia).replace(/\s+/g, '');
    const out = { n: n + 1, guia, guiaRemp: txt_(f.guiaRemp), tipoNov: txt_(f.tipoNov), estadoTrans: txt_(f.estadoTrans), obsTrans: txt_(f.obsTrans), cuenta: txt_(f.cuenta), fechaCap: txt_(f.fechaCap), idInter: txt_(f.idInter), bodInter: txt_(f.bodInter) };
    const k = normCode_(guia);
    if (!k) { out.resultado = 'error'; out.motivo = 'Falta el número de guía'; return out; }
    if (vistos[k]) { out.resultado = 'error'; out.motivo = 'Guía repetida en el mismo archivo (fila ' + vistos[k] + ')'; return out; }
    vistos[k] = n + 1;
    if (idx[k]) {
      const ult = data[idx[k][idx[k].length - 1] - 1];
      out.resultado = 'existe'; out.veces = idx[k].length;
      out.motivo = 'Ya registrada ' + idx[k].length + ' vez/veces · Estado: ' + estadoDe_(ult) + (txt_(ult[COL.DIR_NUEVA]) ? ' · Solución: ' + txt_(ult[COL.DIR_NUEVA]) : '');
      return out;
    }
    out.resultado = 'lista'; out.motivo = 'Se guarda como Pendiente';
    return out;
  });
}
function validarIngreso(payload, tokenSesion) {
  return seguro_(() => {
    const u = exigir_(tokenSesion, 'ingreso');
    const filas = validarFilasIngreso_(u, payload);
    const res = { lista: 0, existe: 0, error: 0 };
    filas.forEach(f => res[f.resultado]++);
    return { ok: true, filas, resumen: res };
  });
}
function ingresarNovedades(payload, tokenSesion) {
  return conLock_(() => {
    const u = exigir_(tokenSesion, 'ingreso');
    resetNov_();
    const filas = validarFilasIngreso_(u, payload);
    const reing = new Set((payload.reingresar || []).map(normCode_));
    const idx = indiceGuias_();
    const fecha = sanitizarCSV_(payload.fechaSolicitud ? Utilities.formatDate(parseFecha(payload.fechaSolicitud), TZ, 'dd/MM/yyyy') : hoy_());
    const nuevas = [];
    filas.forEach(f => {
      if (f.resultado === 'error') return;
      if (f.resultado === 'existe' && !reing.has(normCode_(f.guia))) return;
      const row = new Array(NCOL).fill('');
      row[COL.FECHA_SOL] = fecha; row[COL.TRANSPORTADORA] = sanitizarCSV_(payload.transportadora);
      row[COL.GUIA] = sanitizarCSV_(f.guia); row[COL.GUIA_REMP] = sanitizarCSV_(f.guiaRemp);
      row[COL.TIPO_NOV] = sanitizarCSV_(f.tipoNov); row[COL.ESTADO_TRANS] = sanitizarCSV_(f.estadoTrans); row[COL.OBS_TRANS] = sanitizarCSV_(f.obsTrans);
      row[COL.ASESOR_REP] = sanitizarCSV_(u.nombre); row[COL.CUENTA] = sanitizarCSV_(f.cuenta); row[COL.FECHA_CAP] = sanitizarCSV_(f.fechaCap);
      row[COL.ID_INTER] = sanitizarCSV_(f.idInter); row[COL.BOD_INTER] = sanitizarCSV_(f.bodInter);
      row[COL.ESTADO] = E.PENDIENTE;
      row[COL.INTENTO] = ((idx[normCode_(f.guia)] || []).length + 1);
      nuevas.push(row);
    });
    if (!nuevas.length) return { ok: false, msg: 'No quedaron guías nuevas para guardar.' };
    const { ws } = nov_();
    const inicio = Math.max(ws.getLastRow() + 1, FILA_INICIO);
    ws.getRange(inicio, COL.GUIA + 1, nuevas.length, 2).setNumberFormat('@');
    ws.getRange(inicio, COL.ID_INTER + 1, nuevas.length, 1).setNumberFormat('@');
    ws.getRange(inicio, 1, nuevas.length, NCOL).setValues(nuevas);
    SpreadsheetApp.flush();
    resetNov_();
    const reingresos = nuevas.filter(r => r[COL.INTENTO] > 1).length;
    registrarLog_(u, 'INGRESO MASIVO', nuevas.map(r => r[COL.GUIA]).join(', '), `${payload.transportadora} — ${nuevas.length} guías (${reingresos} reingresos)`);
    return { ok: true, msg: `${nuevas.length} guías guardadas${reingresos ? ' (' + reingresos + ' reingresos)' : ''}.`, guardadas: nuevas.length };
  });
}

// ── BUSCADOR DE SOLUCIONES (transportadora: sin guía ni transportadora) ──
function buscarSoluciones(payload, tokenSesion) {
  return seguro_(() => {
    const u = exigir_(tokenSesion, 'buscador');
    const p = getParametros_();
    const campo = payload.campo || 'todos';
    const valores = (Array.isArray(payload.valores) ? payload.valores : String(payload.valores || '').split(/[\n,;]+/)).map(txt_).filter(Boolean);
    if (!valores.length) return { ok: false, msg: 'Escribe al menos un valor.' };
    if (valores.length > p.MAX_BUSQUEDA) return { ok: false, msg: `Máximo ${p.MAX_BUSQUEDA} valores por búsqueda.` };
    const CAMPOS = { guia: [COL.GUIA], remp: [COL.GUIA_REMP], inter: [COL.ID_INTER], bodega: [COL.ID_BODEGA], email: [COL.EMAIL_PROV], tel: [COL.TEL_PROV], tienda: [COL.TEL_TIENDA] };
    const NOMBRES = { guia: 'número de guía', remp: 'guía reemplazatoria', inter: 'ID Interrapidísimo', bodega: 'ID bodega', email: 'email del proveedor', tel: 'teléfono del proveedor', tienda: 'teléfono de la tienda' };
    const claves = campo === 'todos' ? Object.keys(CAMPOS) : [campo];
    const norm = (v, k) => k === 'email' ? txt_(v).toLowerCase() : (k === 'tel' || k === 'tienda') ? txt_(v).replace(/\D/g, '').slice(-10) : sinCeros_(normCode_(v));
    const buscados = {}; // clave|valorNorm -> valor original
    valores.forEach(v => claves.forEach(k => { const n = norm(v, k); if (n) buscados[k + '|' + n] = v; }));
    const { data } = nov_();
    const resultados = []; const encontrados = new Set(); const vistos = {};
    for (let i = data.length - 1; i >= FILA_INICIO - 1; i--) {
      const r = data[i]; if (!txt_(r[COL.GUIA])) continue;
      const est = estadoDe_(r);
      if (ESTADOS_SOLUCION.indexOf(est) < 0) continue;
      for (let c = 0; c < claves.length; c++) {
        const k = claves[c];
        const n = norm(r[CAMPOS[k][0]], k); if (!n) continue;
        const v = buscados[k + '|' + n];
        if (v === undefined) continue;
        encontrados.add(v);
        const item = {
          coincide: 'Por ' + NOMBRES[k],
          fecha: f_(r[COL.FECHA_SOL_DROPI]) || f_(r[COL.FECHA_SOL]),
          dirNueva: txt_(r[COL.DIR_NUEVA]) || (est === E.BOD_NOTIF || est === E.CULM_BOD ? 'Bodega Dropi ' + txt_(r[COL.CIUDAD_DESTINO]) : ''),
          ciudad: txt_(r[COL.CIUDAD]), depto: txt_(r[COL.DEPTO]),
          obs: txt_(r[COL.OBS_DROPI]), estado: est, guias: 1
        };
        // La misma solución aplicada a varias guías se muestra una sola vez, con el conteo
        const clave = [item.coincide, item.fecha, normTxt_(item.dirNueva), item.estado].join('|');
        if (vistos[clave] !== undefined) resultados[vistos[clave]].guias++;
        else if (resultados.length < 500) { vistos[clave] = resultados.length; resultados.push(item); }
        break;
      }
    }
    return { ok: true, resultados, sinResultado: valores.filter(v => !encontrados.has(v)) };
  });
}

// ── GESTIÓN Y SOLUCIÓN ──────────────────────────────────────
function filaCompacta_(r, fila) {
  return {
    row: fila, guia: f_(r[COL.GUIA]), guiaRemp: f_(r[COL.GUIA_REMP]), trans: txt_(r[COL.TRANSPORTADORA]), tipoNov: txt_(r[COL.TIPO_NOV]),
    estadoTrans: txt_(r[COL.ESTADO_TRANS]), obsTrans: txt_(r[COL.OBS_TRANS]), fechaSol: f_(r[COL.FECHA_SOL]), estado: estadoDe_(r),
    intento: Number(r[COL.INTENTO]) || 1, idBodega: bodegaReal_(r[COL.ID_BODEGA]), categoria: txt_(r[COL.CATEGORIA]), marca: txt_(r[COL.MARCA_BLANCA]),
    ciudad: txt_(r[COL.CIUDAD]), depto: txt_(r[COL.DEPTO]), telProv: f_(r[COL.TEL_PROV]), telTienda: f_(r[COL.TEL_TIENDA]), emailProv: txt_(r[COL.EMAIL_PROV]),
    dirAnt: txt_(r[COL.DIR_ANTIGUA]), dirNueva: txt_(r[COL.DIR_NUEVA]), obsDropi: txt_(r[COL.OBS_DROPI]), ciudadDestino: txt_(r[COL.CIUDAD_DESTINO]),
    asesor: txt_(r[COL.ASESOR_GEST]), fechaSolDropi: f_(r[COL.FECHA_SOL_DROPI]), estatusDropi: txt_(r[COL.ESTATUS_DROPI]), cuenta: txt_(r[COL.CUENTA]),
    fechaCap: f_(r[COL.FECHA_CAP]), idInter: f_(r[COL.ID_INTER]), bodInter: txt_(r[COL.BOD_INTER]), idOrden: f_(r[COL.ID_ORDEN]),
    estadoBodega: estadoBodegaDe_(r), fechaNotif: f_(r[COL.FECHA_NOTIF]), fechaCierre: f_(r[COL.FECHA_CIERRE])
  };
}
function coincideFiltros_(u, r, f, fd) {
  if (f.transportadora && txt_(r[COL.TRANSPORTADORA]) !== f.transportadora) return false;
  const bod = bodegaReal_(r[COL.ID_BODEGA]);
  if (f.bodegaStatus === 'CON_ID' && !bod) return false;
  if (f.bodegaStatus === 'SIN_ID' && bod) return false;
  if (f.idBodega && bod.indexOf(txt_(f.idBodega)) < 0) return false;
  if (f.categoriaFiltro) {
    const cat = normTxt_(r[COL.CATEGORIA]); const em = txt_(r[COL.EMAIL_PROV]).toLowerCase(); const mb = normTxt_(r[COL.MARCA_BLANCA]);
    const ok = (f.categoriaFiltro === 'GOEVERY' && em === 'dropi-provider@goevery.co') || (f.categoriaFiltro === 'MARCA_BLANCA' && mb && mb !== 'DROPI' && mb !== 'SIN MARCA' && mb !== '-') || cat === normTxt_(f.categoriaFiltro);
    if (!ok) return false;
  }
  if (f.captura) { const fc = parseFechaStr(r[COL.FECHA_CAP]); if (!fc || Utilities.formatDate(fc, TZ, 'yyyy-MM') !== f.captura) return false; }
  if (f.depto && normTxt_(r[COL.DEPTO]).indexOf(normTxt_(f.depto)) < 0) return false;
  if (f.ciudad && normTxt_(r[COL.CIUDAD]).indexOf(normTxt_(f.ciudad)) < 0) return false;
  if (fd.terminos) {
    const g = sinCeros_(normCode_(r[COL.GUIA])), gr = sinCeros_(normCode_(r[COL.GUIA_REMP])), gi = sinCeros_(normCode_(r[COL.ID_INTER]));
    let ok = false;
    for (let t of fd.terminos) { if (t === g || t === gr || t === gi || (t.length >= 4 && (bod === t))) { ok = true; break; } }
    if (!ok && fd.textoLibre) { const fila = r.join(' ').toLowerCase(); ok = fila.indexOf(fd.textoLibre) >= 0; }
    if (!ok) return false;
  }
  if (fd.dStart || fd.dEnd) {
    const fe = parseFechaStr(f.tipoFecha === 'gestion' ? r[COL.FECHA_SOL_DROPI] : r[COL.FECHA_SOL]);
    if (!fe || (fd.dStart && fe < fd.dStart) || (fd.dEnd && fe > fd.dEnd)) return false;
  }
  return true;
}
function getGruposBodegaPaginados(filtros, pagina, porPagina, tokenSesion) {
  return seguro_(() => {
    const f = filtros || {};
    const modoComercial = f.modo === 'comercial';
    const u = exigir_(tokenSesion, modoComercial ? 'comercial' : 'gestion');
    const { data } = nov_();
    const texto = txt_(f.texto);
    const terminos = texto ? texto.split(/[\s,;]+/).map(t => sinCeros_(normCode_(t))).filter(Boolean) : null;
    const fd = { terminos, textoLibre: texto && texto.split(/[\s,;]+/).length === 1 && texto.length >= 4 ? texto.toLowerCase() : '', dStart: f.fechaInicio ? parseFecha(f.fechaInicio) : null, dEnd: f.fechaFin ? parseFecha(f.fechaFin, true) : null };
    const bandeja = f.estado !== undefined ? f.estado : (u.rol === R.TRANS ? '' : E.PENDIENTE);
    const conteo = {}; ESTADOS_ORDEN.forEach(e => conteo[e] = 0);
    const solPrevia = {}; const grupos = {};
    for (let i = FILA_INICIO - 1; i < data.length; i++) {
      const r = data[i]; const guia = txt_(r[COL.GUIA]); if (!guia) continue;
      if (!enAlcance_(u, r)) continue;
      const est = estadoDe_(r);
      const bod = bodegaReal_(r[COL.ID_BODEGA]);
      if (bod && (est === E.SOL_NOTIF || est === E.CULM_ENT || est === E.SOL_LISTA) && txt_(r[COL.DIR_NUEVA])) {
        const fe = parseFechaStr(r[COL.FECHA_SOL_DROPI]) || parseFechaStr(r[COL.FECHA_SOL]);
        const prev = solPrevia[bod];
        if (!prev || (fe && (!prev._t || fe >= prev._t))) solPrevia[bod] = { _t: fe, fila: i + 1, fecha: fe ? fastFormatDate(fe) : '', dirNueva: txt_(r[COL.DIR_NUEVA]), ciudad: txt_(r[COL.CIUDAD]), depto: txt_(r[COL.DEPTO]), estado: est, obs: txt_(r[COL.OBS_DROPI]), telProv: f_(r[COL.TEL_PROV]) };
      }
      if (modoComercial && est !== E.GEST_COM) continue;
      if (!coincideFiltros_(u, r, f, fd)) continue;
      conteo[est]++;
      if (!modoComercial && bandeja && est !== bandeja) continue;
      const key = bod || ('Sin ID - ' + guia);
      (grupos[key] = grupos[key] || []).push(i);
    }
    const contarPend = arr => arr.reduce((n, i) => n + (estadoDe_(data[i]) === E.PENDIENTE ? 1 : 0), 0);
    const llaves = Object.keys(grupos).sort((a, b) => {
      const sa = a.indexOf('Sin ID - ') === 0, sb = b.indexOf('Sin ID - ') === 0;
      if (sa !== sb) return sa ? -1 : 1;
      return (contarPend(grupos[b]) - contarPend(grupos[a])) || (grupos[b].length - grupos[a].length);
    });
    const pp = parseInt(porPagina) || 0, pg = Math.max(1, parseInt(pagina) || 1);
    const pagLlaves = pp ? llaves.slice((pg - 1) * pp, pg * pp) : llaves;
    const totalGuias = llaves.reduce((n, k) => n + grupos[k].length, 0);
    const ocultarSol = u.rol === R.TRANS;
    const gruposArray = pagLlaves.map(k => {
      const filas = grupos[k].map(i => filaCompacta_(data[i], i + 1));
      const sp = solPrevia[k];
      const propias = new Set(grupos[k].map(i => i + 1));
      return { bodega: k, guias: filas, solucionPrevia: !ocultarSol && sp && !propias.has(sp.fila) ? { fecha: sp.fecha, dirNueva: sp.dirNueva, ciudad: sp.ciudad, depto: sp.depto, estado: sp.estado, obs: sp.obs, telProv: sp.telProv } : null };
    });
    return { ok: true, gruposArray, conteo, bandeja, totalBodegas: llaves.length, totalGuias, pagina: pg, porPagina: pp, totalPaginas: pp ? Math.max(1, Math.ceil(llaves.length / pp)) : 1 };
  });
}

function reemplazosPorFila_() {
  const ws = hoja_(TABS.REEMPLAZOS); const out = {};
  if (!ws || ws.getLastRow() < 2) return out;
  ws.getRange(2, 1, ws.getLastRow() - 1, 7).getValues().forEach((r, i) => {
    const fila = Number(r[1]); if (!fila) return;
    (out[fila] = out[fila] || []).push({ fecha: f_(r[0]), guia: f_(r[3]), intento: r[4], origen: txt_(r[5]), usuario: txt_(r[6]) });
  });
  return out;
}
function getFichaGuia(fila, tokenSesion) {
  return seguro_(() => {
    const u = exigir_(tokenSesion);
    const { data } = nov_();
    const r = data[fila - 1];
    if (!r || fila < FILA_INICIO || !txt_(r[COL.GUIA])) return { ok: false, msg: 'Guía no encontrada.' };
    if (!enAlcance_(u, r) && !esStaff_(u)) return { ok: false, msg: 'Sin acceso a esta guía.' };
    const g = sinCeros_(normCode_(r[COL.GUIA]));
    const rem = reemplazosPorFila_();
    const eventos = []; const remps = [];
    for (let i = FILA_INICIO - 1; i < data.length; i++) {
      const x = data[i];
      if (sinCeros_(normCode_(x[COL.GUIA])) !== g) continue;
      const n = Number(x[COL.INTENTO]) || 1; const fila_i = i + 1;
      eventos.push({ orden: 1, fecha: f_(x[COL.FECHA_SOL]), titulo: (n > 1 ? 'Reingreso #' + n : 'Subida #1') + ' · ' + txt_(x[COL.TRANSPORTADORA]), detalle: txt_(x[COL.TIPO_NOV]) + (txt_(x[COL.OBS_TRANS]) ? ' · ' + txt_(x[COL.OBS_TRANS]) : ''), tipo: 'subida' });
      if (txt_(x[COL.ASESOR_GEST]) || txt_(x[COL.DIR_NUEVA])) eventos.push({ orden: 2, fecha: f_(x[COL.FECHA_SOL_DROPI]), titulo: 'Gestión · ' + estadoDe_(x), detalle: (txt_(x[COL.DIR_NUEVA]) ? 'Dirección: ' + txt_(x[COL.DIR_NUEVA]) + ' · ' : '') + (txt_(x[COL.OBS_DROPI]) || '') + (txt_(x[COL.ASESOR_GEST]) ? ' · ' + txt_(x[COL.ASESOR_GEST]) : ''), tipo: 'gestion' });
      if (txt_(x[COL.FECHA_NOTIF])) eventos.push({ orden: 3, fecha: f_(x[COL.FECHA_NOTIF]), titulo: 'Notificada a la transportadora', detalle: estadoDe_(x), tipo: 'notif' });
      const eb = estadoBodegaDe_(x);
      if (eb && eb !== EB.TRANSITO) eventos.push({ orden: 4, fecha: f_(x[COL.FECHA_RECEP_FISICA]), titulo: 'Bodega Dropi · ' + eb, detalle: txt_(x[COL.CIUDAD_DESTINO]) + (txt_(x[COL.OBS_BODEGA]) ? ' · ' + txt_(x[COL.OBS_BODEGA]) : ''), tipo: 'bodega' });
      if (txt_(x[COL.FECHA_CIERRE])) eventos.push({ orden: 5, fecha: f_(x[COL.FECHA_CIERRE]), titulo: 'Cerrada · ' + estadoDe_(x), detalle: txt_(x[COL.CONFIRMADO_POR]), tipo: 'cierre' });
      if (txt_(x[COL.GUIA_REMP])) remps.push({ guia: f_(x[COL.GUIA_REMP]), origen: 'Transportadora (al subir)', fecha: f_(x[COL.FECHA_SOL]), usuario: '' });
      (rem[fila_i] || []).forEach(h => { if (!remps.some(z => z.guia === h.guia)) remps.push(h); });
    }
    const valor = s => { const d = parseFechaStr(s); return d ? d.getTime() : 0; };
    eventos.sort((a, b) => (valor(b.fecha) - valor(a.fecha)) || (b.orden - a.orden));
    const ficha = filaCompacta_(r, fila);
    if (u.rol === R.TRANS) { ficha.emailProv = ''; ficha.telTienda = ''; }
    return { ok: true, ficha, eventos, reemplazatorias: remps };
  });
}

// Actualiza guías. datos: solo se escriben los campos enviados (nunca borra lo que no se manda).
const CAMPOS_EDITABLES = { fechaSolucion: COL.FECHA_SOL_DROPI, idOrden: COL.ID_ORDEN, estatusDropi: COL.ESTATUS_DROPI, idBodega: COL.ID_BODEGA, fechaCap: COL.FECHA_CAP,
  emailProv: COL.EMAIL_PROV, categoria: COL.CATEGORIA, telProv: COL.TEL_PROV, telTienda: COL.TEL_TIENDA, marcaBlanca: COL.MARCA_BLANCA, ciudad: COL.CIUDAD, depto: COL.DEPTO,
  dirAntigua: COL.DIR_ANTIGUA, dirNueva: COL.DIR_NUEVA, obsDropi: COL.OBS_DROPI, ciudadDestino: COL.CIUDAD_DESTINO, idInter: COL.ID_INTER, bodInter: COL.BOD_INTER };
function guardarSolucion(ids, datos, tokenSesion) {
  return conLock_(() => {
    const u = getUsuarioActualContexto(tokenSesion); if (u.error) throw new Error(u.error);
    const esCom = u.rol === R.COMERCIAL;
    if (!esStaff_(u) && !esCom) throw new Error('Tu rol no puede gestionar soluciones.');
    datos = datos || {};
    const filas = (ids || []).map(Number).filter(n => n >= FILA_INICIO);
    if (!filas.length) throw new Error('Selecciona al menos una guía.');
    resetNov_();
    const { data } = nov_();
    const nuevoEstado = datos.estado ? (ESTADOS_LEGADO[datos.estado] || datos.estado) : '';
    if (nuevoEstado && ESTADOS_ORDEN.indexOf(nuevoEstado) < 0) throw new Error('Estado no válido.');
    if (esCom && nuevoEstado && [E.SOL_LISTA, E.COM_SIN, E.GEST_COM].indexOf(nuevoEstado) < 0) throw new Error('Comercial solo puede dar solución o devolver sin contacto.');
    if (nuevoEstado === E.COM_SIN && !txt_(datos.obsDropi)) throw new Error('Escribe una observación de por qué no hubo contacto.');
    let bodega = null;
    if (nuevoEstado === E.BOD_LISTA) {
      bodega = bodegaPorCiudad_(datos.ciudadDestino);
      if (!bodega) throw new Error('Elige la Bodega Dropi destino.');
    }
    const hoy = hoy_(); const ok = [], errores = [];
    filas.forEach(fila => {
      const r = data[fila - 1];
      if (!r || !txt_(r[COL.GUIA])) { errores.push({ fila, motivo: 'Fila vacía' }); return; }
      const actual = estadoDe_(r);
      if (esCom && (actual !== E.GEST_COM || !enAlcance_(u, r))) { errores.push({ fila, guia: f_(r[COL.GUIA]), motivo: 'No está en tu bandeja comercial' }); return; }
      if (nuevoEstado === E.SOL_LISTA && !txt_(datos.dirNueva) && !txt_(r[COL.DIR_NUEVA])) { errores.push({ fila, guia: f_(r[COL.GUIA]), motivo: 'Falta la dirección nueva' }); return; }
      if (nuevoEstado === E.CULM_ENT && actual !== E.SOL_NOTIF && actual !== E.SOL_LISTA) { errores.push({ fila, guia: f_(r[COL.GUIA]), motivo: 'Solo se culmina una solución notificada' }); return; }
      Object.keys(CAMPOS_EDITABLES).forEach(k => { if (datos[k] !== undefined && datos[k] !== null && (txt_(datos[k]) !== '' || datos.permitirVacios)) r[CAMPOS_EDITABLES[k]] = sanitizarCSV_(datos[k]); });
      if (nuevoEstado) {
        r[COL.ESTADO] = nuevoEstado;
        if (nuevoEstado === E.BOD_LISTA) {
          r[COL.CIUDAD_DESTINO] = bodega.ciudad;
          if (!txt_(datos.dirNueva)) r[COL.DIR_NUEVA] = sanitizarCSV_('Bodega Dropi ' + bodega.ciudad + (bodega.direccion ? ' - ' + bodega.direccion : ''));
        }
        if (nuevoEstado === E.CULM_ENT) { r[COL.FECHA_CIERRE] = hoy; r[COL.CONFIRMADO_POR] = sanitizarCSV_(u.nombre); }
        if (datos.fechaSolucion === undefined && [E.GEST_LOG, E.GEST_COM, E.COM_SIN, E.SOL_LISTA, E.BOD_LISTA, E.RECH_LISTA].indexOf(nuevoEstado) >= 0) r[COL.FECHA_SOL_DROPI] = hoy;
      }
      if (nuevoEstado !== E.CULM_ENT) r[COL.ASESOR_GEST] = sanitizarCSV_(u.nombre);
      ok.push(fila);
    });
    escribirCambios_(ok, COL.FECHA_CAP, COL.CONFIRMADO_POR);
    if (ok.length) registrarLog_(u, 'GESTIÓN SOLUCIÓN', ok.map(fl => f_(data[fl - 1][COL.GUIA])).join(', '), `Estado: ${nuevoEstado || '(sin cambio)'} — ${ok.length} guías`);
    return { ok: ok.length > 0, msg: `${ok.length} guía(s) actualizada(s)` + (errores.length ? ` · ${errores.length} no se pudieron` : '') + '.', actualizadas: ok.length, errores };
  });
}
function confirmarEntregas(ids, tokenSesion) {
  return conLock_(() => {
    const u = exigir_(tokenSesion, 'gestion');
    resetNov_();
    const { data } = nov_();
    const hoy = hoy_(); const ok = [], errores = [];
    (ids || []).map(Number).forEach(fila => {
      const r = data[fila - 1];
      if (!r || fila < FILA_INICIO) return;
      if (!enAlcance_(u, r)) { errores.push({ fila, motivo: 'Sin acceso' }); return; }
      if (estadoDe_(r) !== E.SOL_NOTIF) { errores.push({ fila, guia: f_(r[COL.GUIA]), motivo: 'No está en Solución notificada' }); return; }
      r[COL.ESTADO] = E.CULM_ENT; r[COL.FECHA_CIERRE] = hoy; r[COL.CONFIRMADO_POR] = sanitizarCSV_(u.nombre + (u.rol === R.TRANS ? ' (' + u.transportadora + ')' : ''));
      ok.push(fila);
    });
    escribirCambios_(ok, COL.ESTADO, COL.CONFIRMADO_POR);
    if (ok.length) registrarLog_(u, 'CONFIRMAR ENTREGA', ok.map(fl => f_(data[fl - 1][COL.GUIA])).join(', '), `${ok.length} guías culminadas`);
    return { ok: ok.length > 0, msg: `${ok.length} guía(s) culminada(s)` + (errores.length ? ` · ${errores.length} omitidas` : '') + '.', errores };
  });
}
function agregarReemplazatoria(fila, guiaRemp, tokenSesion) {
  return conLock_(() => {
    const u = exigir_(tokenSesion, 'gestion');
    if (!esStaff_(u)) throw new Error('Solo Gestión o Admin.');
    return vincularReemplazatoria_(u, Number(fila), guiaRemp, 'Gestión (ficha)');
  });
}
function vincularReemplazatoria_(u, fila, guiaRemp, origen) {
  const g = txt_(guiaRemp).replace(/\s+/g, '');
  if (!normCode_(g)) throw new Error('Escribe la guía reemplazatoria.');
  const { ws, data } = nov_();
  const r = data[fila - 1];
  if (!r || !txt_(r[COL.GUIA])) throw new Error('Guía inicial no encontrada.');
  const wsH = asegurarHoja_(TABS.REEMPLAZOS, ['Fecha', 'Row Novedades', 'Guía inicial', 'Guía reemplazatoria', 'Intento', 'Origen', 'Usuario']);
  const previas = reemplazosPorFila_()[fila] || [];
  const intento = previas.length + (txt_(r[COL.GUIA_REMP]) ? 1 : 0) + 1;
  if (txt_(r[COL.GUIA_REMP]) && !previas.some(p => normCode_(p.guia) === normCode_(r[COL.GUIA_REMP]))) {
    wsH.appendRow([hoy_(), fila, "'" + f_(r[COL.GUIA]), "'" + f_(r[COL.GUIA_REMP]), intento - 1, 'Registrada antes', '']);
  }
  wsH.appendRow([hoy_(), fila, "'" + f_(r[COL.GUIA]), "'" + g, intento, origen, u.nombre]);
  const celda = ws.getRange(fila, COL.GUIA_REMP + 1);
  celda.setNumberFormat('@'); celda.setValue(g);
  r[COL.GUIA_REMP] = g;
  registrarLog_(u, 'NUEVA REEMPLAZATORIA', f_(r[COL.GUIA]), `#${intento}: ${g} (${origen})`);
  return { ok: true, msg: `Reemplazatoria #${intento} registrada.`, intento };
}

// ── WHATSAPP ────────────────────────────────────────────────
function claveWsp_(u) { return 'WSP_' + u.email + '_' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd'); }
function getGruposWsp(filtros, tokenSesion) {
  return seguro_(() => {
    const u = exigir_(tokenSesion, 'whatsapp');
    const f = filtros || {};
    const { data } = nov_();
    const activos = u.rol === R.COMERCIAL ? [E.GEST_COM] : [E.PENDIENTE, E.GEST_LOG, E.COM_SIN];
    const grupos = {};
    for (let i = FILA_INICIO - 1; i < data.length; i++) {
      const r = data[i]; if (!txt_(r[COL.GUIA])) continue;
      if (!enAlcance_(u, r)) continue;
      const est = estadoDe_(r);
      if (activos.indexOf(est) < 0) continue;
      if (f.estado && est !== f.estado) continue;
      if (f.transportadora && txt_(r[COL.TRANSPORTADORA]) !== f.transportadora) continue;
      if (f.categoria && normTxt_(r[COL.CATEGORIA]) !== normTxt_(f.categoria)) continue;
      const bod = bodegaReal_(r[COL.ID_BODEGA]); if (!bod) continue;
      if (f.busqueda && bod.indexOf(txt_(f.busqueda)) < 0) continue;
      (grupos[bod] = grupos[bod] || []).push(r);
    }
    const NL = '\n';
    const wspArray = Object.keys(grupos).map(bod => {
      const gs = grupos[bod];
      const prov = gs.find(r => txt_(r[COL.TEL_PROV])) || gs[0];
      const porTrans = {};
      gs.forEach(r => { const t = txt_(r[COL.TRANSPORTADORA]); (porTrans[t] = porTrans[t] || []).push(f_(r[COL.GUIA])); });
      const lineas = Object.keys(porTrans).map(t => `- ${t}: ${porTrans[t].join(', ')}`).join(NL);
      const tipos = [...new Set(gs.map(r => txt_(r[COL.TIPO_NOV])).filter(Boolean))].join(', ');
      const ciudad = txt_(prov[COL.CIUDAD]); const depto = txt_(prov[COL.DEPTO]);
      const loc = ciudad ? ciudad + (depto ? ' - ' + depto : '') : 'No registrada';
      const dir = txt_(prov[COL.DIR_ANTIGUA]) || txt_(prov[COL.DIR_NUEVA]) || '(sin dirección)';
      const obs = txt_(prov[COL.OBS_DROPI]);
      const msgConfirmar = `Cordial saludo. Mi nombre es *${u.nombre}* del equipo de Dropi.${NL}${NL}Me comunico con usted para informarle que se han realizado múltiples intentos de devolución de su(s) paquete(s) a la bodega registrada, sin que haya sido posible concretar la entrega.${NL}${NL}*ID Bodega:* ${bod}${NL}` + (tipos ? `*Novedad reportada:* ${tipos}${NL}` : '') + `${NL}*Guías en proceso de devolución:*${NL}${lineas}${NL}${NL}*Ciudad / Departamento:* ${loc}${NL}*Dirección registrada:* ${dir}${NL}${NL}¡IMPORTANTE! Las transportadoras han intentado la devolución sin éxito. *De no recibir respuesta oportuna o no poder concretar la entrega, el paquete entrará en un proceso de rezagos.*${NL}${NL}Por favor, confírmenos lo siguiente:${NL}1. ¿La dirección registrada es correcta?${NL}2. ¿Es una unidad residencial o centro comercial?${NL}3. En caso de cambio, ¿cuál sería la nueva dirección exacta?${NL}` + (obs ? `${NL}*Observación Dropi:* ${obs}${NL}` : '') + `${NL}Quedamos atentos a su pronta respuesta para gestionar la solución. Muchas gracias.`;
      const msgUltimo = `Cordial saludo. Le escribe *${u.nombre}* de Dropi.${NL}${NL}*ÚLTIMO AVISO* sobre la devolución de sus guías (ID Bodega ${bod}):${NL}${lineas}${NL}${NL}No hemos recibido confirmación de una dirección de entrega. Si no tenemos respuesta, los paquetes se enviarán a la *Bodega Dropi* y podrán generar un cobro mensual por almacenamiento.${NL}${NL}Por favor, confírmenos hoy la dirección donde puede recibirlos. Gracias.`;
      return {
        bodega: bod, guias: gs.length, pendientes: gs.filter(r => estadoDe_(r) === E.PENDIENTE).length,
        tel: f_(prov[COL.TEL_PROV]), telTienda: f_(prov[COL.TEL_TIENDA]), categoria: txt_(prov[COL.CATEGORIA]), ciudad: loc,
        estados: [...new Set(gs.map(estadoDe_))], trans: Object.keys(porTrans), msg: msgConfirmar, msgUltimo
      };
    }).sort((a, b) => (b.pendientes - a.pendientes) || (b.guias - a.guias));
    const p = getParametros_();
    return { ok: true, wspArray, enviadosHoy: parseInt(CacheService.getScriptCache().get(claveWsp_(u)) || '0'), limite: p.LIMITE_WSP_DIA, crm: !!p.CRM_WEBHOOK_URL };
  });
}
function registrarEnvioWsp(idBodega, tokenSesion) {
  return conLock_(() => {
    const u = exigir_(tokenSesion, 'whatsapp');
    const cache = CacheService.getScriptCache();
    const n = parseInt(cache.get(claveWsp_(u)) || '0') + 1;
    cache.put(claveWsp_(u), String(n), 21600);
    let movidas = 0;
    if (esStaff_(u)) {
      resetNov_();
      const { data } = nov_(); const filas = []; const hoy = hoy_();
      for (let i = FILA_INICIO - 1; i < data.length; i++) {
        const r = data[i];
        if (bodegaReal_(r[COL.ID_BODEGA]) !== txt_(idBodega) || estadoDe_(r) !== E.PENDIENTE) continue;
        r[COL.ESTADO] = E.GEST_LOG; r[COL.ASESOR_GEST] = sanitizarCSV_(u.nombre); r[COL.FECHA_SOL_DROPI] = hoy;
        filas.push(i + 1);
      }
      escribirCambios_(filas, COL.FECHA_SOL_DROPI, COL.ASESOR_GEST);
      movidas = filas.length;
      if (movidas) registrarLog_(u, 'WSP ENVIADO', idBodega, `${movidas} guías pasaron a ${E.GEST_LOG}`);
    }
    const lim = getParametros_().LIMITE_WSP_DIA;
    return { ok: true, enviadosHoy: n, limite: lim, movidas, aviso: n >= lim ? 'Llegaste al límite sugerido de hoy. Para cuidar tu número, continúa mañana o usa el CRM.' : (n >= lim * 0.8 ? 'Estás cerca del límite sugerido de hoy.' : '') };
  });
}
function enviarWspCRM(payload, tokenSesion) {
  return seguro_(() => {
    const u = exigir_(tokenSesion, 'whatsapp');
    const url = getParametros_().CRM_WEBHOOK_URL;
    if (!url) return { ok: false, msg: 'CRM no configurado. Agrega CRM_WEBHOOK_URL en Configuración.' };
    const resp = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ origen: 'novedades-dropi', asesor: u.email, idBodega: payload.idBodega, telefono: payload.telefono, mensaje: payload.mensaje }) });
    const code = resp.getResponseCode();
    if (code >= 300) return { ok: false, msg: 'El CRM respondió con error ' + code };
    registrarEnvioWsp(payload.idBodega, tokenSesion);
    return { ok: true, msg: 'Mensaje enviado por el CRM.' };
  });
}
function actualizarEstadoBodegaWsp(idBodega, tokenSesion) { return registrarEnvioWsp(idBodega, tokenSesion); }

// ── CORREOS A TRANSPORTADORAS ───────────────────────────────
// Destinatarios guardados por transportadora (pestaña CONFIG_CORREOS): se llenan solos y se actualizan al enviar.
function leerDestinatarios_() { const out = {}; const d = leerHojaConfig_(TABS.CORREOS); for (let i = 1; i < d.length; i++) { const t = txt_(d[i][0]); if (t) out[normTxt_(t)] = { fila: i + 1, nombre: t, para: txt_(d[i][1]), cc: txt_(d[i][2]) }; } return out; }
function getDestinatariosCorreo(transportadora, tokenSesion) {
  return seguro_(() => { exigir_(tokenSesion, 'correos'); const x = leerDestinatarios_()[normTxt_(transportadora)]; return { ok: true, para: x ? x.para : '', cc: x ? x.cc : '' }; });
}
function guardarDestinatarios_(u, transportadora, para, cc) {
  const ws = asegurarHoja_(TABS.CORREOS, ['Transportadora', 'Para', 'CC', 'Actualizado por', 'Fecha']);
  const x = leerDestinatarios_()[normTxt_(transportadora)];
  if (x && x.para === txt_(para) && x.cc === txt_(cc)) return false;
  const fila = [txt_(transportadora), txt_(para), txt_(cc), u.nombre, hoy_()];
  if (x) ws.getRange(x.fila, 1, 1, 5).setValues([fila]); else ws.appendRow(fila);
  clearCache(TABS.CORREOS);
  registrarLog_(u, 'DESTINATARIOS CORREO', transportadora, txt_(para) + ' | CC: ' + txt_(cc));
  return true;
}
const TIPOS_CORREO = {
  solucion: { desde: E.SOL_LISTA, hacia: E.SOL_NOTIF, titulo: 'Soluciones de novedades de devolución' },
  bodega:   { desde: E.BOD_LISTA, hacia: E.BOD_NOTIF, titulo: 'Devoluciones a Bodega Dropi' },
  rechazada:{ desde: E.RECH_LISTA, hacia: E.RECH_NOTIF, titulo: 'Solicitudes rechazadas' }
};
function filasCorreo_(u, p) {
  const tipo = TIPOS_CORREO[p.tipoEnvio]; if (!tipo) throw new Error('Tipo de envío no válido.');
  if (!p.transportadora) throw new Error('Elige la transportadora.');
  let bodega = null;
  if (p.tipoEnvio === 'bodega') { bodega = bodegaPorCiudad_(p.ciudadBodega); if (!bodega) throw new Error('Elige la Bodega Dropi destino.'); }
  const { data } = nov_();
  const dStart = p.fechaInicio ? parseFecha(p.fechaInicio) : null; const dEnd = p.fechaFin ? parseFecha(p.fechaFin, true) : null;
  const filas = [];
  for (let i = FILA_INICIO - 1; i < data.length; i++) {
    const r = data[i]; if (!txt_(r[COL.GUIA])) continue;
    if (txt_(r[COL.TRANSPORTADORA]) !== p.transportadora) continue;
    if (estadoDe_(r) !== tipo.desde) continue;
    if (bodega && ciudadKey_(r[COL.CIUDAD_DESTINO]) !== bodega.clave) continue;
    if (p.depto && normTxt_(r[COL.DEPTO]).indexOf(normTxt_(p.depto)) < 0) continue;
    if (p.ciudad && normTxt_(r[COL.CIUDAD]).indexOf(normTxt_(p.ciudad)) < 0) continue;
    if (dStart || dEnd) { const fe = parseFechaStr(r[COL.FECHA_SOL_DROPI]); if (fe && ((dStart && fe < dStart) || (dEnd && fe > dEnd))) continue; }
    filas.push(i + 1);
  }
  return { tipo, bodega, filas };
}
function construirCorreo_(u, p, tipo, bodega, filasData) {
  const fecha = hoy_(); const n = filasData.length;
  const esBod = p.tipoEnvio === 'bodega', esRech = p.tipoEnvio === 'rechazada';
  const asunto = esBod ? `Devoluciones a Bodega Dropi ${bodega.ciudad} · ${p.transportadora} · ${fecha} · ${n} guías`
    : esRech ? `Solicitudes rechazadas · ${p.transportadora} · ${fecha} · ${n} guías`
    : `Soluciones de novedades de devolución · ${p.transportadora} · ${fecha} · ${n} guías`;
  const th = 'padding:9px 8px;text-align:left;font-size:12px;color:#FFFFFF;background:#111827;';
  const td = 'padding:9px 8px;font-size:12px;border-bottom:1px solid #E5E7EB;vertical-align:top;';
  let cols, celdas;
  if (esBod) { cols = ['Guía', 'Guía reemplazatoria', 'ID bodega proveedor', 'Ciudad origen', 'Observación']; celdas = r => [f_(r[COL.GUIA]), f_(r[COL.GUIA_REMP]) || '—', bodegaReal_(r[COL.ID_BODEGA]) || '—', txt_(r[COL.CIUDAD]), txt_(r[COL.OBS_DROPI])]; }
  else if (esRech) { cols = ['Guía', 'Guía reemplazatoria', 'Tipo de novedad', 'Motivo del rechazo']; celdas = r => [f_(r[COL.GUIA]), f_(r[COL.GUIA_REMP]) || '—', txt_(r[COL.TIPO_NOV]), txt_(r[COL.OBS_DROPI])]; }
  else { cols = ['Guía', 'Guía reempl.', 'ID bodega', 'Dirección nueva', 'Ciudad / Depto', 'Tel. proveedor', 'Observación']; celdas = r => [f_(r[COL.GUIA]), f_(r[COL.GUIA_REMP]) || '—', bodegaReal_(r[COL.ID_BODEGA]) || '—', txt_(r[COL.DIR_NUEVA]), txt_(r[COL.CIUDAD]) + ' / ' + txt_(r[COL.DEPTO]), f_(r[COL.TEL_PROV]), txt_(r[COL.OBS_DROPI])]; }
  const filasHtml = filasData.slice(0, 400).map(r => '<tr>' + celdas(r).map((c, k) => `<td style="${td}${k === 0 ? 'font-weight:700;' : ''}">${escapeHtml_(c)}</td>`).join('') + '</tr>').join('');
  const extra = n > 400 ? `<p style="font-size:12px;color:#4B5563">Se muestran 400 de ${n} guías. El detalle completo va en el archivo adjunto.</p>` : '';
  const intro = esBod ? `No logramos contacto con el proveedor de las siguientes guías. Por favor, <strong>envíenlas a nuestra Bodega Dropi ${escapeHtml_(bodega.ciudad)}</strong>. La bodega confirmará la recepción al escanearlas.`
    : esRech ? 'Les informamos que las siguientes solicitudes fueron rechazadas por los motivos indicados.'
    : 'Les compartimos las soluciones de las siguientes guías reportadas. Por favor, realicen el nuevo intento de entrega a la dirección indicada y <strong>confírmennos cuando cada guía sea entregada al proveedor</strong>, respondiendo este correo o en el aplicativo, para cerrarla en nuestro sistema.';
  const bloqueBodega = esBod ? `<div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:10px;padding:14px 16px;margin:16px 0"><div style="font-size:11px;font-weight:800;color:#9A3412;letter-spacing:.5px">DIRECCIÓN DE ENTREGA</div><div style="font-size:16px;font-weight:800;color:#7C2D12;margin-top:4px">Bodega Dropi ${escapeHtml_(bodega.ciudad)}</div><div style="font-size:14px;color:#7C2D12">${escapeHtml_(bodega.direccion || '[Dirección pendiente en CONFIG_BODEGAS_DROPI]')}</div>${bodega.contacto || bodega.telefono ? `<div style="font-size:13px;color:#7C2D12">Contacto: ${escapeHtml_(bodega.contacto)} ${escapeHtml_(bodega.telefono)}</div>` : ''}</div><div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:12px 14px;font-size:13px;color:#991B1B;margin-bottom:16px"><strong>Importante:</strong> la bodega solo recibe las guías de esta lista. Si generan una guía reemplazatoria nueva, infórmenla antes del envío respondiendo este correo.</div>` : '';
  const pedirConfirmacion = !esRech ? `<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:14px;margin-top:16px;font-size:13px;color:#374151"><strong>¿Cómo confirmar?</strong><br>${esBod ? 'Confírmennos la fecha de despacho a la bodega.' : 'Respondan este correo con las guías entregadas o márquenlas en el aplicativo en "Mis guías".'}</div>` : '';
  const html = `<div style="background:#EEF0F3;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#111827"><div style="max-width:760px;margin:0 auto;background:#FFFFFF;border-radius:14px;overflow:hidden"><div style="height:6px;background:#FF6D00"></div><div style="padding:26px 28px"><div style="font-size:12px;font-weight:700;color:#4B5563;letter-spacing:.4px">NOVEDADES DE DEVOLUCIÓN · DROPI</div><h1 style="margin:8px 0 14px;font-size:22px">${escapeHtml_(tipo.titulo)}${esBod ? ' · ' + escapeHtml_(bodega.ciudad) : ''}</h1><p style="font-size:14px;line-height:1.6;color:#374151;margin:0 0 10px">Hola, equipo de ${escapeHtml_(p.transportadora)}:</p><p style="font-size:14px;line-height:1.6;color:#374151;margin:0">${intro}</p><table role="presentation" style="width:100%;margin:16px 0;border-collapse:separate;border-spacing:8px 0"><tr><td style="background:#FFF7ED;border-radius:10px;padding:10px 12px"><div style="font-size:11px;color:#9A3412;font-weight:700">GUÍAS</div><div style="font-size:20px;font-weight:800;color:#7C2D12">${n}</div></td><td style="background:#F3F4F6;border-radius:10px;padding:10px 12px"><div style="font-size:11px;color:#374151;font-weight:700">FECHA</div><div style="font-size:15px;font-weight:800">${fecha}</div></td><td style="background:#F3F4F6;border-radius:10px;padding:10px 12px"><div style="font-size:11px;color:#374151;font-weight:700">GESTOR</div><div style="font-size:13px;font-weight:800">${escapeHtml_(u.nombre)}</div></td></tr></table>${bloqueBodega}<table style="width:100%;border-collapse:collapse"><thead><tr>${cols.map(c => `<th style="${th}">${c}</th>`).join('')}</tr></thead><tbody>${filasHtml}</tbody></table>${extra}${pedirConfirmacion}<p style="font-size:14px;line-height:1.6;color:#374151;margin-top:18px">Quedamos atentos.<br><strong>${escapeHtml_(u.nombre)}</strong><br>Gestión de novedades · Dropi</p></div></div></div>`;
  const csv = aCSV_(cols, filasData.map(celdas));
  const nombreArchivo = `Dropi_${p.transportadora}_${esBod ? 'Bodega' + bodega.ciudad + '_' : ''}${fecha.replace(/\//g, '-')}.csv`;
  return { asunto, html, csv, nombreArchivo };
}
function previsualizarCorreo(payload, tokenSesion) {
  return seguro_(() => {
    const u = exigir_(tokenSesion, 'correos');
    const { tipo, bodega, filas } = filasCorreo_(u, payload);
    const { data } = nov_();
    if (!filas.length) return { ok: true, total: 0, msg: 'No hay guías para este envío.' };
    const c = construirCorreo_(u, payload, tipo, bodega, filas.map(f => data[f - 1]));
    return { ok: true, total: filas.length, asunto: c.asunto, html: c.html };
  });
}
function enviarCorreoTransportadora(payload, tokenSesion) {
  return conLock_(() => {
    const u = exigir_(tokenSesion, 'correos');
    if (!txt_(payload.para)) throw new Error('Escribe el correo de destino.');
    resetNov_();
    const { tipo, bodega, filas } = filasCorreo_(u, payload);
    if (!filas.length) return { ok: false, msg: 'No hay guías para el reporte.' };
    const { data } = nov_();
    const c = construirCorreo_(u, payload, tipo, bodega, filas.map(f => data[f - 1]));
    const ccBodega = (bodega && bodega.correo && payload.copiarBodega !== false) ? bodega.correo : '';
    const cc = [txt_(payload.cc), ccBodega, u.email].filter(Boolean).join(',');
    MailApp.sendEmail({ to: payload.para, cc, replyTo: u.email, name: u.nombre + ' · Dropi', subject: c.asunto, htmlBody: c.html, attachments: [Utilities.newBlob(c.csv, 'text/csv', c.nombreArchivo)] });
    const hoy = hoy_();
    filas.forEach(fl => {
      const r = data[fl - 1];
      r[COL.ESTADO] = tipo.hacia; r[COL.FECHA_NOTIF] = hoy;
      if (tipo.hacia === E.BOD_NOTIF) { r[COL.ESTADO_RECEPCION] = EB.TRANSITO; r[COL.CIUDAD_DESTINO] = bodega.ciudad; }
      if (tipo.hacia === E.RECH_NOTIF) { r[COL.FECHA_CIERRE] = hoy; }
    });
    escribirCambios_(filas, COL.ESTADO, COL.FECHA_CIERRE);
    registrarLog_(u, 'CORREO ENVIADO', payload.transportadora, `${filas.length} guías -> ${payload.para} (${tipo.hacia})`);
    let recordados = false;
    if (payload.recordar !== false) { try { recordados = guardarDestinatarios_(u, payload.transportadora, payload.para, payload.cc); } catch (e) {} }
    return { ok: true, msg: `Correo enviado a ${payload.para}${ccBodega ? ' (copia a la bodega ' + bodega.ciudad + ')' : ''}. ${filas.length} guías pasaron a "${tipo.hacia}".` + (recordados ? ' Destinatarios guardados para ' + payload.transportadora + '.' : '') };
  });
}

// ── BODEGA DROPI ────────────────────────────────────────────
function codigosDeFila_(r, rem) {
  const out = [normCode_(r[COL.GUIA]), normCode_(r[COL.GUIA_REMP])];
  (rem || []).forEach(h => out.push(normCode_(h.guia)));
  return [...new Set(out.filter(Boolean))];
}
function getBodegasDropiData(filtros, tokenSesion) {
  return seguro_(() => {
    const u = exigir_(tokenSesion, 'bodega');
    const f = filtros || {};
    const { data } = nov_();
    const rem = reemplazosPorFila_();
    const ciudadSel = u.rol === R.BODEGA ? u.sede : ciudadKey_(f.ciudadDestino || '');
    const fGuia = f.guia ? sinCeros_(normCode_(f.guia)) : '';
    const dStart = f.fechaIni ? parseFecha(f.fechaIni) : null, dEnd = f.fechaFin ? parseFecha(f.fechaFin, true) : null;
    const filas = []; const indice = [];
    const st = { transito: 0, recibidas: 0, recibidasHoy: 0, cerradas: 0 };
    const hoy = hoy_();
    for (let i = FILA_INICIO - 1; i < data.length; i++) {
      const r = data[i]; if (!txt_(r[COL.GUIA])) continue;
      const eb = estadoBodegaDe_(r); if (!eb) continue;
      if (ciudadSel && ciudadSel !== 'TODAS' && ciudadKey_(r[COL.CIUDAD_DESTINO]) !== ciudadSel) continue;
      const cods = codigosDeFila_(r, rem[i + 1]);
      if (eb === EB.TRANSITO || eb === EB.RECIBIDO) indice.push({ c: cods, row: i + 1, e: eb === EB.TRANSITO ? 'T' : 'R', g: f_(r[COL.GUIA]), f: f_(r[COL.FECHA_RECEP_FISICA]), ciu: txt_(r[COL.CIUDAD_DESTINO]) });
      if (eb === EB.TRANSITO) st.transito++; else if (eb === EB.RECIBIDO) { st.recibidas++; if (f_(r[COL.FECHA_RECEP_FISICA]) === hoy) st.recibidasHoy++; } else st.cerradas++;
      if (f.transportadora && txt_(r[COL.TRANSPORTADORA]) !== f.transportadora) continue;
      if (f.estadoRecep && eb !== f.estadoRecep) continue;
      if (f.idBodega && bodegaReal_(r[COL.ID_BODEGA]).indexOf(txt_(f.idBodega)) < 0) continue;
      if (fGuia && !cods.some(c => sinCeros_(c).indexOf(fGuia) >= 0)) continue;
      if (dStart || dEnd) { const fr = parseFechaStr(r[COL.FECHA_RECEP_FISICA]) || parseFechaStr(r[COL.FECHA_NOTIF]); if (!fr || (dStart && fr < dStart) || (dEnd && fr > dEnd)) continue; }
      filas.push({ row: i + 1, guia: f_(r[COL.GUIA]), remps: [f_(r[COL.GUIA_REMP])].concat((rem[i + 1] || []).map(h => h.guia)).filter((v, k, a) => v && a.indexOf(v) === k),
        trans: txt_(r[COL.TRANSPORTADORA]), idBodega: bodegaReal_(r[COL.ID_BODEGA]), ciudadDestino: txt_(r[COL.CIUDAD_DESTINO]), estadoBodega: eb,
        fechaNotif: f_(r[COL.FECHA_NOTIF]) || f_(r[COL.FECHA_SOL_DROPI]), fechaRecep: f_(r[COL.FECHA_RECEP_FISICA]), obs: txt_(r[COL.OBS_BODEGA]), categoria: txt_(r[COL.CATEGORIA]), fechaDevolucion: f_(r[COL.FECHA_DEVOLUCION]) });
    }
    const orden = { [EB.TRANSITO]: 0, [EB.RECIBIDO]: 1, [EB.RETIRADO]: 2, [EB.REENVIADO]: 2 };
    filas.sort((a, b) => (orden[a.estadoBodega] - orden[b.estadoBodega]) || (b.row - a.row));
    const pp = f.porPagina !== undefined ? parseInt(f.porPagina) : 100, pg = Math.max(1, parseInt(f.pagina) || 1);
    return { ok: true, rows: pp ? filas.slice((pg - 1) * pp, pg * pp) : filas, totalFilas: filas.length, pagina: pg, porPagina: pp, totalPaginas: pp ? Math.max(1, Math.ceil(filas.length / pp)) : 1, stats: st, indice, ciudad: ciudadSel || 'TODAS', contacto: getParametros_().CONTACTO_URGENTE };
  });
}
function recibirGuiasBodega(filas, obs, tokenSesion) {
  return conLock_(() => {
    const u = exigir_(tokenSesion, 'bodega');
    resetNov_();
    const { ws, data } = nov_();
    const hoy = hoy_(); const ok = [], errores = [];
    (filas || []).map(Number).forEach(fila => {
      const r = data[fila - 1];
      if (!r || fila < FILA_INICIO || !txt_(r[COL.GUIA])) { errores.push({ fila, motivo: 'No existe' }); return; }
      if (u.rol === R.BODEGA && u.sede !== 'TODAS' && ciudadKey_(r[COL.CIUDAD_DESTINO]) !== u.sede) { errores.push({ fila, guia: f_(r[COL.GUIA]), motivo: 'Notificada para otra bodega (' + txt_(r[COL.CIUDAD_DESTINO]) + ')' }); return; }
      const eb = estadoBodegaDe_(r);
      if (eb === EB.RECIBIDO) { errores.push({ fila, guia: f_(r[COL.GUIA]), motivo: 'Ya estaba recibida (' + f_(r[COL.FECHA_RECEP_FISICA]) + ')', yaRecibida: true }); return; }
      if (eb !== EB.TRANSITO) { errores.push({ fila, guia: f_(r[COL.GUIA]), motivo: 'No fue notificada para Bodega Dropi' }); return; }
      r[COL.ESTADO_RECEPCION] = EB.RECIBIDO; r[COL.FECHA_RECEP_FISICA] = hoy; r[COL.OBS_BODEGA] = sanitizarCSV_(obs || 'Recibida por ' + u.nombre);
      r[COL.ESTADO] = E.CULM_BOD; r[COL.FECHA_CIERRE] = hoy; r[COL.CONFIRMADO_POR] = sanitizarCSV_(u.nombre + ' (bodega)');
      ok.push(fila);
    });
    escribirCambios_(ok, COL.ESTADO, COL.CONFIRMADO_POR);
    if (ok.length) {
      registrarLog_(u, 'RECEPCIÓN BODEGA', ok.map(fl => f_(data[fl - 1][COL.GUIA])).join(', '), `${ok.length} guías recibidas`);
      try { registrarCobrosInicialesParaFilas_(ws, ok); } catch (e) {}
    }
    return { ok: ok.length > 0, msg: `${ok.length} guía(s) recibida(s)` + (errores.length ? ` · ${errores.length} con novedad` : '') + '.', recibidas: ok, errores };
  });
}
// Clasifica códigos que la bodega leyó y NO estaban en su lista. Si resultan válidos, los recibe.
function registrarRechazoBodega(codigos, tokenSesion) {
  return conLock_(() => {
    const u = exigir_(tokenSesion, 'bodega');
    resetNov_();
    const { data } = nov_();
    const rem = reemplazosPorFila_();
    const lista = (codigos || []).map(txt_).filter(Boolean).slice(0, 500);
    const mapa = {};
    for (let i = FILA_INICIO - 1; i < data.length; i++) {
      const r = data[i]; if (!txt_(r[COL.GUIA])) continue;
      codigosDeFila_(r, rem[i + 1]).forEach(c => { const k = sinCeros_(c); (mapa[k] = mapa[k] || []).push(i + 1); });
    }
    const buscar = cod => {
      const c = sinCeros_(normCode_(cod));
      if (mapa[c]) return mapa[c];
      if (c.length >= 10) { for (const k in mapa) { if (k.length >= 10 && (c.indexOf(k) >= 0 || k.indexOf(c) >= 0)) return mapa[k]; } }
      return null;
    };
    const ciudadUsuario = u.rol === R.BODEGA ? u.sede : 'TODAS';
    const resultados = []; const recibir = []; const logs = [];
    lista.forEach(cod => {
      const filas = buscar(cod);
      if (!filas) { resultados.push({ codigo: cod, tipo: 'rechazo', motivo: 'No existe en el sistema' }); logs.push([cod, 'No existe en el sistema', '']); return; }
      const fila = filas[filas.length - 1]; const r = data[fila - 1];
      const eb = estadoBodegaDe_(r); const ciu = ciudadKey_(r[COL.CIUDAD_DESTINO]);
      if (eb === EB.RECIBIDO) { resultados.push({ codigo: cod, tipo: 'ya', motivo: 'Ya estaba recibida el ' + f_(r[COL.FECHA_RECEP_FISICA]), guia: f_(r[COL.GUIA]) }); return; }
      if (eb !== EB.TRANSITO) { const m = 'Existe, pero no se envió a bodega (estado: ' + estadoDe_(r) + ')'; resultados.push({ codigo: cod, tipo: 'rechazo', motivo: m, guia: f_(r[COL.GUIA]) }); logs.push([cod, m, fila]); return; }
      if (ciudadUsuario !== 'TODAS' && ciu !== ciudadUsuario) { const m = 'Notificada para otra bodega (' + txt_(r[COL.CIUDAD_DESTINO]) + ')'; resultados.push({ codigo: cod, tipo: 'rechazo', motivo: m, guia: f_(r[COL.GUIA]) }); logs.push([cod, m, fila]); return; }
      recibir.push(fila); resultados.push({ codigo: cod, tipo: 'recibida', guia: f_(r[COL.GUIA]), row: fila });
    });
    if (logs.length) {
      const ws = asegurarHoja_(TABS.RECHAZOS, ['Fecha y hora', 'Guía leída', 'Bodega Dropi', 'Usuario', 'Motivo', 'Estado', 'Row Novedades', 'Resuelto por', 'Fecha resolución']);
      const ahora = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
      const ciudadTxt = ciudadUsuario === 'TODAS' ? 'Sin ciudad' : ciudadUsuario;
      ws.getRange(ws.getLastRow() + 1, 1, logs.length, 9).setValues(logs.map(l => [ahora, "'" + l[0], ciudadTxt, u.nombre, l[1], 'Por resolver', l[2], '', '']));
      registrarLog_(u, 'RECHAZO BODEGA', logs.map(l => l[0]).join(', '), `${logs.length} guías no recibidas`);
    }
    if (recibir.length) {
      const { ws, data: d } = nov_(); const hoy = hoy_();
      recibir.forEach(fl => { const r = d[fl - 1]; r[COL.ESTADO_RECEPCION] = EB.RECIBIDO; r[COL.FECHA_RECEP_FISICA] = hoy; r[COL.OBS_BODEGA] = 'Escaneada por ' + u.nombre; r[COL.ESTADO] = E.CULM_BOD; r[COL.FECHA_CIERRE] = hoy; r[COL.CONFIRMADO_POR] = u.nombre + ' (bodega)'; });
      escribirCambios_(recibir, COL.ESTADO, COL.CONFIRMADO_POR);
      try { registrarCobrosInicialesParaFilas_(ws, recibir); } catch (e) {}
    }
    return { ok: true, resultados, contacto: getParametros_().CONTACTO_URGENTE };
  });
}
function actualizarEstadoBodega(ids, datos, tokenSesion) {
  return conLock_(() => {
    const u = getUsuarioActualContexto(tokenSesion); if (u.error) throw new Error(u.error);
    if (!(esStaff_(u) || u.rol === R.INDEM || u.rol === R.BODEGA)) throw new Error('Sin permisos.');
    const est = EB_LEGADO[datos.estado] || datos.estado;
    if (EB_SIN_COBRO.indexOf(est) < 0) throw new Error('Estado no válido.');
    resetNov_();
    const { data } = nov_(); const ok = [];
    const fecha = datos.fecha ? Utilities.formatDate(parseFecha(datos.fecha), TZ, 'dd/MM/yyyy') : hoy_();
    (ids || []).map(Number).forEach(fila => {
      const r = data[fila - 1]; if (!r || fila < FILA_INICIO) return;
      if (u.rol === R.BODEGA && !enAlcance_(u, r)) return;
      if (estadoBodegaDe_(r) !== EB.RECIBIDO) return;
      r[COL.ESTADO_RECEPCION] = est; r[COL.FECHA_DEVOLUCION] = fecha;
      if (datos.obs) r[COL.OBS_BODEGA] = sanitizarCSV_(datos.obs);
      ok.push(fila);
    });
    escribirCambios_(ok, COL.ESTADO_RECEPCION, COL.FECHA_DEVOLUCION);
    if (ok.length) registrarLog_(u, 'CIERRE BODEGA', ok.map(fl => f_(data[fl - 1][COL.GUIA])).join(', '), `${ok.length} → ${est} (se detiene el cobro)`);
    return { ok: ok.length > 0, msg: ok.length ? `${ok.length} guía(s) marcadas como "${est}". El cobro se detiene.` : 'Ninguna guía seleccionada estaba "Recibido en Bodega".' };
  });
}
function guardarRecepcionBodega(ids, datos, tokenSesion) {
  const est = EB_LEGADO[(datos || {}).estado] || (datos || {}).estado;
  if (est === EB.RECIBIDO) return recibirGuiasBodega(ids, (datos || {}).obs, tokenSesion);
  return actualizarEstadoBodega(ids, Object.assign({}, datos, { estado: est, fecha: (datos || {}).fechaDevolucion || (datos || {}).fecha }), tokenSesion);
}
function exportarBodegasDropiCSV(filtros, tokenSesion) {
  const res = getBodegasDropiData(Object.assign({}, filtros || {}, { porPagina: 0, pagina: 1 }), tokenSesion);
  if (!res.ok) return res;
  return { ok: true, nombre: 'Bodega Dropi', headers: ['Guía inicial', 'Guías reemplazatorias', 'Transportadora', 'ID bodega', 'Categoría', 'Bodega Dropi', 'Estado bodega', 'Fecha notificación', 'Fecha recepción', 'Fecha devolución', 'Observaciones'],
    rows: res.rows.map(r => [r.guia, r.remps.join(' → '), r.trans, r.idBodega, r.categoria, r.ciudadDestino, r.estadoBodega, r.fechaNotif, r.fechaRecep, r.fechaDevolucion, r.obs]), texto: [0, 1, 3], fechas: [7, 8, 9] };
}

// ── GUÍAS RECHAZADAS EN BODEGA ──────────────────────────────
function getRechazosBodega(filtros, tokenSesion) {
  return seguro_(() => {
    exigir_(tokenSesion, 'rechazos');
    const ws = hoja_(TABS.RECHAZOS);
    if (!ws || ws.getLastRow() < 2) return { ok: true, rows: [], porResolver: 0 };
    const f = filtros || {};
    const vals = ws.getRange(2, 1, ws.getLastRow() - 1, 9).getValues();
    const rows = vals.map((v, i) => ({ id: i + 2, fecha: f_(v[0]), guia: f_(v[1]), ciudad: txt_(v[2]), usuario: txt_(v[3]), motivo: txt_(v[4]), estado: txt_(v[5]) || 'Por resolver', fila: Number(v[6]) || '', resueltoPor: txt_(v[7]), fechaRes: f_(v[8]) }));
    const porResolver = rows.filter(r => r.estado === 'Por resolver').length;
    const out = rows.filter(r => (!f.estado || r.estado === f.estado)).reverse().slice(0, 500);
    return { ok: true, rows: out, porResolver };
  });
}
function buscarGuiaInicial(codigo, tokenSesion) {
  return seguro_(() => {
    exigir_(tokenSesion, 'rechazos');
    const c = sinCeros_(normCode_(codigo)); if (!c) return { ok: false, msg: 'Escribe la guía.' };
    const { data } = nov_(); const rem = reemplazosPorFila_(); const out = [];
    for (let i = data.length - 1; i >= FILA_INICIO - 1; i--) {
      const r = data[i]; if (!txt_(r[COL.GUIA])) continue;
      if (codigosDeFila_(r, rem[i + 1]).some(x => sinCeros_(x) === c)) {
        out.push({ row: i + 1, guia: f_(r[COL.GUIA]), trans: txt_(r[COL.TRANSPORTADORA]), estado: estadoDe_(r), ciudadDestino: txt_(r[COL.CIUDAD_DESTINO]), estadoBodega: estadoBodegaDe_(r), remps: [f_(r[COL.GUIA_REMP])].concat((rem[i + 1] || []).map(h => h.guia)).filter((v, k, a) => v && a.indexOf(v) === k) });
        if (out.length >= 5) break;
      }
    }
    return { ok: true, resultados: out };
  });
}
function resolverRechazo(idRechazo, accion, filaInicial, tokenSesion) {
  return conLock_(() => {
    const u = exigir_(tokenSesion, 'rechazos');
    const ws = hoja_(TABS.RECHAZOS); const id = Number(idRechazo);
    if (!ws || id < 2 || id > ws.getLastRow()) throw new Error('Registro no encontrado.');
    const v = ws.getRange(id, 1, 1, 9).getValues()[0];
    if (txt_(v[5]) !== 'Por resolver' && txt_(v[5]) !== '') throw new Error('Este rechazo ya fue resuelto.');
    const codigo = txt_(v[1]).replace(/^'/, '');
    let msg;
    if (accion === 'vincular') {
      resetNov_();
      const fila = Number(filaInicial);
      vincularReemplazatoria_(u, fila, codigo, 'Bodega (guía sin identificar)');
      const { data } = nov_(); const r = data[fila - 1];
      const ciudad = txt_(v[2]);
      if (estadoBodegaDe_(r) !== EB.RECIBIDO) {
        const bod = bodegaPorCiudad_(ciudad);
        r[COL.ESTADO] = E.BOD_NOTIF; r[COL.ESTADO_RECEPCION] = EB.TRANSITO;
        if (bod) r[COL.CIUDAD_DESTINO] = bod.ciudad;
        if (!txt_(r[COL.FECHA_NOTIF])) r[COL.FECHA_NOTIF] = hoy_();
        escribirCambios_([fila], COL.ESTADO, COL.FECHA_NOTIF);
      }
      ws.getRange(id, 6, 1, 4).setValues([['Vinculada', fila, u.nombre, hoy_()]]);
      msg = 'Vinculada como reemplazatoria. La bodega ya puede escanearla y recibirla.';
    } else if (accion === 'no_recibir') {
      ws.getRange(id, 6, 1, 4).setValues([['No recibir', v[6], u.nombre, hoy_()]]);
      msg = 'Marcada como "No recibir".';
    } else throw new Error('Acción no válida.');
    registrarLog_(u, 'RECHAZO RESUELTO', codigo, msg);
    return { ok: true, msg };
  });
}

// ── CRUCE EXCEL DROPI ───────────────────────────────────────
function getRowsParaCruce(tokenSesion) {
  return seguro_(() => {
    exigir_(tokenSesion, 'cruce');
    const { data } = nov_(); const rows = [];
    for (let i = FILA_INICIO - 1; i < data.length; i++) { const g = f_(data[i][COL.GUIA]); if (g) rows.push([g, i + 1, bodegaReal_(data[i][COL.ID_BODEGA]) ? 1 : 0, estadoDe_(data[i]) === E.PENDIENTE ? 1 : 0]); }
    return { ok: true, rows };
  });
}
function guardarCargaDropi(datos, tokenSesion) {
  return conLock_(() => {
    const u = exigir_(tokenSesion, 'cruce');
    resetNov_();
    const { data } = nov_();
    const MAP = { estatusDropi: COL.ESTATUS_DROPI, idBodega: COL.ID_BODEGA, emailProv: COL.EMAIL_PROV, categoria: COL.CATEGORIA, telProv: COL.TEL_PROV, telTienda: COL.TEL_TIENDA, marcaBlanca: COL.MARCA_BLANCA, ciudad: COL.CIUDAD, depto: COL.DEPTO, dirAntigua: COL.DIR_ANTIGUA };
    const ok = [];
    (datos || []).forEach(d => {
      const fila = parseInt(d.sheetRow); const r = data[fila - 1];
      if (!r || fila < FILA_INICIO) return;
      if (normCode_(r[COL.GUIA]) !== normCode_(d.guia) && sinCeros_(normCode_(r[COL.GUIA])) !== sinCeros_(normCode_(d.guia))) return;
      Object.keys(MAP).forEach(k => { if (txt_(d[k])) r[MAP[k]] = sanitizarCSV_(d[k]); });
      ok.push(fila);
    });
    escribirCambios_(ok, COL.ESTATUS_DROPI, COL.DIR_ANTIGUA);
    if (ok.length) registrarLog_(u, 'CARGA EXCEL DROPI', (datos || []).slice(0, 3000).map(d => d.guia).join(', '), `${ok.length} guías actualizadas`);
    return { ok: true, msg: `${ok.length} guías actualizadas desde el Excel de Dropi.` };
  });
}

// ── EXPORTAR ────────────────────────────────────────────────
function exportarDatosExcel(filtros, tokenSesion) {
  return seguro_(() => {
    const u = exigir_(tokenSesion);
    const f = filtros || {};
    const { data } = nov_();
    const texto = txt_(f.texto);
    const fd = { terminos: texto ? texto.split(/[\s,;]+/).map(t => sinCeros_(normCode_(t))).filter(Boolean) : null, textoLibre: '', dStart: f.fechaInicio ? parseFecha(f.fechaInicio) : null, dEnd: f.fechaFin ? parseFecha(f.fechaFin, true) : null };
    const filas = [];
    for (let i = FILA_INICIO - 1; i < data.length; i++) {
      const r = data[i]; if (!txt_(r[COL.GUIA]) || !enAlcance_(u, r)) continue;
      if (f.estado && estadoDe_(r) !== f.estado) continue;
      if (!coincideFiltros_(u, r, f, fd)) continue;
      filas.push([f_(r[COL.FECHA_SOL]), r[COL.TRANSPORTADORA], f_(r[COL.GUIA]), f_(r[COL.GUIA_REMP]), r[COL.INTENTO] || 1, f_(r[COL.FECHA_CAP]), r[COL.TIPO_NOV], bodegaReal_(r[COL.ID_BODEGA]), r[COL.ESTATUS_DROPI], estadoDe_(r), u.rol === R.TRANS ? '' : r[COL.EMAIL_PROV], r[COL.CIUDAD], r[COL.DEPTO], r[COL.DIR_NUEVA], u.rol === R.TRANS ? '' : f_(r[COL.TEL_PROV]), r[COL.OBS_DROPI], f_(r[COL.FECHA_SOL_DROPI]), r[COL.ASESOR_GEST], r[COL.CIUDAD_DESTINO], estadoBodegaDe_(r), f_(r[COL.FECHA_NOTIF]), f_(r[COL.FECHA_CIERRE])]);
    }
    return { ok: true, nombre: 'Novedades', headers: ['Fecha novedad', 'Transportadora', 'Guía', 'Guía reemplazatoria', 'Intento', 'Fecha captura (Envía)', 'Tipo novedad', 'ID bodega', 'Estatus Dropi', 'Estado', 'Email proveedor', 'Ciudad', 'Departamento', 'Dirección nueva', 'Teléfono proveedor', 'Observaciones Dropi', 'Fecha solución Dropi', 'Asesor gestión', 'Bodega Dropi destino', 'Estado bodega', 'Fecha notificación', 'Fecha cierre'], rows: filas.slice(Number(f.desde) || 0, (Number(f.desde) || 0) + (Number(f.limite) || 2500)).map(f2 => f2.map(v => v === null || v === undefined ? '' : (v instanceof Date ? fastFormatDate(v) : v))), total: filas.length, desde: Number(f.desde) || 0, texto: [2, 3, 7, 14], fechas: [0, 5, 16, 20, 21] };
  });
}

// ── CONFIGURACIÓN (solo Admin) ──────────────────────────────
function getConfigGeneral(tokenSesion) {
  return seguro_(() => {
    exigir_(tokenSesion, 'config');
    const ws = hoja_(TABS.USUARIOS);
    const usuarios = ws.getDataRange().getValues().map((r, i) => ({ rowIndex: i + 1, nombre: txt_(r[0]), email: txt_(r[1]), rol: normRol_(r[2]), transportadora: txt_(r[3]), activo: txt_(r[4]) || 'SI', sede: txt_(r[5]), categorias: txt_(r[6]) }))
      .filter((r, i) => i >= 1 && r.nombre && r.email && r.email.indexOf('@') > 0);
    const p = getParametros_();
    const dest = leerDestinatarios_();
    return { ok: true, destinatarios: Object.keys(dest).map(k => ({ transportadora: dest[k].nombre, para: dest[k].para, cc: dest[k].cc })), usuarios, bodegas: getBodegasDropi_(), parametros: Object.keys(PARAM_DEFAULTS).map(k => ({ clave: k, valor: p[k] })), roles: Object.values(R), iaConfigurada: !!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') };
  });
}
function getUsuarios(tokenSesion) { const r = getConfigGeneral(tokenSesion); return r.ok ? { ok: true, rows: r.usuarios } : r; }
function guardarUsuario(datos, tokenSesion) {
  return conLock_(() => {
    const u = exigir_(tokenSesion, 'config');
    const ws = hoja_(TABS.USUARIOS);
    if (ws.getMaxColumns() < 7) ws.insertColumnsAfter(ws.getMaxColumns(), 7 - ws.getMaxColumns());
    if (!txt_(ws.getRange(2, 6).getValue())) ws.getRange(2, 6, 1, 2).setValues([['Sede (Bodega Dropi)', 'Categorías (Comercial)']]);
    const email = txt_(datos.email).toLowerCase();
    if (!txt_(datos.nombre) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Nombre y correo válidos son obligatorios.');
    const rol = normRol_(datos.rol);
    if (!TABS_POR_ROL[rol]) throw new Error('Rol no válido.');
    if (rol === R.TRANS && !txt_(datos.transportadora)) throw new Error('Elige la transportadora del usuario.');
    if (rol === R.BODEGA && !txt_(datos.sede)) throw new Error('Elige la ciudad de la bodega.');
    const fila = [txt_(datos.nombre), email, rol, rol === R.TRANS ? txt_(datos.transportadora) : '', normTxt_(datos.activo) === 'NO' ? 'NO' : 'SI', rol === R.BODEGA ? txt_(datos.sede) : '', rol === R.COMERCIAL ? txt_(datos.categorias) : ''];
    if (datos.rowIndex) ws.getRange(parseInt(datos.rowIndex), 1, 1, 7).setValues([fila]);
    else {
      const ex = ws.getDataRange().getValues().findIndex(r => txt_(r[1]).toLowerCase() === email);
      if (ex >= 0) ws.getRange(ex + 1, 1, 1, 7).setValues([fila]); else ws.appendRow(fila);
    }
    clearCache(TABS.USUARIOS);
    registrarLog_(u, 'USUARIO GUARDADO', email, rol);
    return { ok: true, msg: 'Usuario guardado.' };
  });
}
function guardarBodegaDropi(datos, tokenSesion) {
  return conLock_(() => {
    const u = exigir_(tokenSesion, 'config');
    const ws = asegurarHoja_(TABS.BODEGAS, ['Ciudad', 'Dirección', 'Contacto', 'Teléfono', 'Activa (SI/NO)', 'Correo bodega']);
    if (!txt_(datos.ciudad)) throw new Error('La ciudad es obligatoria.');
    if (ws.getMaxColumns() < 6) ws.insertColumnsAfter(ws.getMaxColumns(), 6 - ws.getMaxColumns());
    if (!txt_(ws.getRange(1, 6).getValue())) ws.getRange(1, 6).setValue('Correo bodega');
    const fila = [normTxt_(datos.ciudad), txt_(datos.direccion), txt_(datos.contacto), "'" + txt_(datos.telefono), normTxt_(datos.activa) === 'NO' ? 'NO' : 'SI', txt_(datos.correo)];
    let fila_i = parseInt(datos.rowIndex) || 0;
    if (!fila_i) { const ex = ws.getDataRange().getValues().findIndex((r, i) => i > 0 && normTxt_(r[0]) === fila[0]); if (ex > 0) fila_i = ex + 1; }
    if (fila_i > 1) ws.getRange(fila_i, 1, 1, 6).setValues([fila]); else ws.appendRow(fila);
    clearCache(TABS.BODEGAS);
    registrarLog_(u, 'BODEGA DROPI', fila[0], fila[1]);
    return { ok: true, msg: 'Bodega guardada.' };
  });
}
function guardarParametro(clave, valor, tokenSesion) {
  return conLock_(() => {
    const u = exigir_(tokenSesion, 'config');
    if (!(clave in PARAM_DEFAULTS)) throw new Error('Parámetro desconocido.');
    if (typeof PARAM_DEFAULTS[clave] === 'number' && !(Number(valor) > 0)) throw new Error('Debe ser un número mayor que cero.');
    const ws = asegurarHoja_(TABS.PARAMETROS, ['Parámetro', 'Valor', 'Descripción']);
    const vals = ws.getDataRange().getValues();
    const i = vals.findIndex(r => txt_(r[0]) === clave);
    if (i >= 0) ws.getRange(i + 1, 2).setValue(valor); else ws.appendRow([clave, valor, '']);
    clearCache(TABS.PARAMETROS);
    registrarLog_(u, 'PARÁMETRO', clave, String(valor));
    return { ok: true, msg: 'Parámetro guardado.' };
  });
}

// ── ACTUALIZAR ESTRUCTURA Y ESTADOS (MIGRACIÓN) ─────────────
function analizarMigracion_() {
  const { data } = nov_();
  const cambios = {}; let bodegaTransito = 0, bodegaRecibida = 0, intentos = 0, ebLegado = 0, total = 0;
  const vistos = {};
  for (let i = FILA_INICIO - 1; i < data.length; i++) {
    const r = data[i]; const g = sinCeros_(normCode_(r[COL.GUIA])); if (!g) continue;
    total++;
    vistos[g] = (vistos[g] || 0) + 1;
    if (!Number(r[COL.INTENTO]) || Number(r[COL.INTENTO]) !== vistos[g]) intentos++;
    const est = txt_(r[COL.ESTADO]) || E.PENDIENTE;
    const nuevo = ESTADOS_LEGADO[est] || est;
    const ebAct = txt_(r[COL.ESTADO_RECEPCION]);
    if (EB_LEGADO[ebAct]) ebLegado++;
    if (nuevo === E.BOD_NOTIF && (EB_LEGADO[ebAct] || ebAct) === EB.RECIBIDO) { const k = est + ' → ' + E.CULM_BOD; cambios[k] = (cambios[k] || 0) + 1; bodegaRecibida++; continue; }
    if (nuevo === E.BOD_NOTIF && !ebAct) bodegaTransito++;
    if (nuevo !== est) { const k = est + ' → ' + nuevo; cambios[k] = (cambios[k] || 0) + 1; }
  }
  const faltan = [TABS.BODEGAS, TABS.PARAMETROS, TABS.REEMPLAZOS, TABS.RECHAZOS].filter(t => !hoja_(t));
  return { total, cambios, bodegaTransito, bodegaRecibida, intentos, ebLegado, hojasNuevas: faltan };
}
function previsualizarMigracion(tokenSesion) {
  return seguro_(() => { exigir_(tokenSesion, 'config'); return Object.assign({ ok: true }, analizarMigracion_()); });
}
// La migración se hace POR PASOS (varias llamadas cortas) para no superar el tiempo de espera de Google.
// Respaldo liviano: guarda en una pestaña oculta solo lo que la migración cambia (estado, estado bodega, intento).
const LOTE_MIGRACION = 2500;
function ejecutarMigracion(tokenSesion) { return migrarPaso('respaldo', 0, tokenSesion); }
function migrarPaso(paso, desde, tokenSesion) {
  return conLock_(() => {
    const u = exigir_(tokenSesion, 'config');
    if (paso === 'respaldo') {
      const { data } = nov_();
      const sello = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH.mm');
      const nombre = 'RESPALDO MIGRACION ' + sello;
      const ws = hoja_(nombre) || ss_().insertSheet(nombre);
      const filas = [['Fila NOVEDADES', 'Guía', 'Estado (antes)', 'Estado recepción (antes)', 'Intento (antes)']];
      for (let i = FILA_INICIO - 1; i < data.length; i++) { if (txt_(data[i][COL.GUIA])) filas.push([i + 1, "'" + f_(data[i][COL.GUIA]), txt_(data[i][COL.ESTADO]), txt_(data[i][COL.ESTADO_RECEPCION]), txt_(data[i][COL.INTENTO])]); }
      for (let k = 0; k < filas.length; k += 5000) { const b = filas.slice(k, k + 5000); ws.getRange(k + 1, 1, b.length, 5).setValues(b); }
      try { ws.hideSheet(); } catch (e) {}
      registrarLog_(u, 'MIGRACIÓN · RESPALDO', nombre, (filas.length - 1) + ' filas');
      return { ok: true, siguiente: 'config', desde: 0, msg: 'Respaldo creado en la pestaña oculta "' + nombre + '".', respaldo: nombre };
    }
    if (paso === 'config') {
      const wsB = asegurarHoja_(TABS.BODEGAS, ['Ciudad', 'Dirección', 'Contacto', 'Teléfono', 'Activa (SI/NO)', 'Correo bodega']);
      if (wsB.getMaxColumns() < 6) wsB.insertColumnsAfter(wsB.getMaxColumns(), 6 - wsB.getMaxColumns());
      if (!txt_(wsB.getRange(1, 6).getValue())) wsB.getRange(1, 6).setValue('Correo bodega');
      if (wsB.getLastRow() < 2) wsB.getRange(2, 1, 3, 6).setValues([['BOGOTA', '', '', '', 'SI', ''], ['CALI', '', '', '', 'SI', ''], ['MEDELLIN', '', '', '', 'SI', '']]);
      const wsP = asegurarHoja_(TABS.PARAMETROS, ['Parámetro', 'Valor', 'Descripción']);
      if (wsP.getLastRow() < 2) wsP.getRange(2, 1, 5, 3).setValues([
        ['VALOR_COBRO_MENSUAL', PARAM_DEFAULTS.VALOR_COBRO_MENSUAL, 'Valor mensual de indemnización por guía en Bodega Dropi (aplica a los cobros nuevos)'],
        ['CONTACTO_URGENTE', PARAM_DEFAULTS.CONTACTO_URGENTE, 'Nombre y teléfono que ve la bodega cuando una guía NO se debe recibir'],
        ['LIMITE_WSP_DIA', PARAM_DEFAULTS.LIMITE_WSP_DIA, 'Límite sugerido de WhatsApp por asesor al día'],
        ['CRM_WEBHOOK_URL', '', 'URL del CRM para enviar WhatsApp por API (vacío = manual)'],
        ['MAX_BUSQUEDA', PARAM_DEFAULTS.MAX_BUSQUEDA, 'Máximo de valores por búsqueda en el buscador de soluciones']]);
      asegurarHoja_(TABS.REEMPLAZOS, ['Fecha', 'Row Novedades', 'Guía inicial', 'Guía reemplazatoria', 'Intento', 'Origen', 'Usuario']);
      asegurarHoja_(TABS.RECHAZOS, ['Fecha y hora', 'Guía leída', 'Bodega Dropi', 'Usuario', 'Motivo', 'Estado', 'Row Novedades', 'Resuelto por', 'Fecha resolución']);
      const wsU = hoja_(TABS.USUARIOS);
      if (wsU.getMaxColumns() < 7) wsU.insertColumnsAfter(wsU.getMaxColumns(), 7 - wsU.getMaxColumns());
      wsU.getRange(2, 6, 1, 2).setValues([['Sede (Bodega Dropi)', 'Categorías (Comercial)']]);
      const wsD = hoja_(TABS.DESPLEGABLES);
      if (wsD) { const n = Math.max(wsD.getLastRow() - 2, 1); wsD.getRange(3, 1, n, 1).clearContent(); wsD.getRange(3, 1, ESTADOS_ORDEN.length, 1).setValues(ESTADOS_ORDEN.map(e => [e])); }
      const ws = hoja_(TABS.NOVEDADES); asegurarColumnas_(ws);
      const cab = ws.getRange(3, 33, 1, 5).getValues()[0];
      [32, 33, 34, 35, 36].forEach((c, k) => { cab[k] = HEADERS_NUEVOS[c]; });
      ws.getRange(3, 33, 1, 5).setValues([cab]);
      [TABS.BODEGAS, TABS.PARAMETROS, TABS.USUARIOS, TABS.DESPLEGABLES].forEach(clearCache);
      return { ok: true, siguiente: 'estados', desde: FILA_INICIO, msg: 'Pestañas y encabezados listos.' };
    }
    if (paso === 'estados') {
      const { ws, data } = nov_();
      const ini = Math.max(FILA_INICIO, Number(desde) || FILA_INICIO);
      const fin = Math.min(data.length, ini + LOTE_MIGRACION - 1);
      if (ini > data.length) return { ok: true, siguiente: 'fin', desde: 0, total: data.length - FILA_INICIO + 1, msg: 'Estados actualizados.' };
      const vistos = {};
      for (let i = FILA_INICIO - 1; i < ini - 1; i++) { const g = sinCeros_(normCode_(data[i][COL.GUIA])); if (g) vistos[g] = (vistos[g] || 0) + 1; }
      const colE = [], colB = [], colI = []; let cambiadas = 0;
      for (let i = ini - 1; i < fin; i++) {
        const r = data[i]; const g = sinCeros_(normCode_(r[COL.GUIA]));
        let est = txt_(r[COL.ESTADO]), eb = txt_(r[COL.ESTADO_RECEPCION]); let intento = r[COL.INTENTO];
        if (g) {
          const e0 = est, b0 = eb;
          est = ESTADOS_LEGADO[est] || est || E.PENDIENTE; eb = EB_LEGADO[eb] || eb;
          if (est === E.BOD_NOTIF && !eb) eb = EB.TRANSITO;
          if (est === E.BOD_NOTIF && eb === EB.RECIBIDO) est = E.CULM_BOD;
          vistos[g] = (vistos[g] || 0) + 1; if (Number(intento) !== vistos[g]) { intento = vistos[g]; cambiadas++; }
          if (e0 !== est || b0 !== eb) cambiadas++;
        }
        colE.push([est]); colB.push([eb]); colI.push([intento === undefined ? '' : intento]);
      }
      if (cambiadas) {
        const n = fin - ini + 1;
        ws.getRange(ini, COL.ESTADO + 1, n, 1).setValues(colE);
        ws.getRange(ini, COL.ESTADO_RECEPCION + 1, n, 1).setValues(colB);
        ws.getRange(ini, COL.INTENTO + 1, n, 1).setValues(colI);
        SpreadsheetApp.flush();
      }
      const total = data.length - FILA_INICIO + 1;
      if (fin >= data.length) { registrarLog_(u, 'MIGRACIÓN', 'TODO', 'Estados actualizados en ' + total + ' filas'); return { ok: true, siguiente: 'fin', desde: 0, total, msg: 'Estructura y estados actualizados.' }; }
      return { ok: true, siguiente: 'estados', desde: fin + 1, total, avance: fin - FILA_INICIO + 1, msg: 'Procesadas ' + (fin - FILA_INICIO + 1) + ' de ' + total + ' filas.' };
    }
    throw new Error('Paso desconocido.');
  });
}

// ── INTELIGENCIA ARTIFICIAL (Gemini, opcional) ──────────────
function procesarTextoConIA(promptTipo, textoEntrada, apiKeyGlobalClient, tokenSesion) {
  return seguro_(() => {
    exigir_(tokenSesion);
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) return { ok: false, msg: 'API Key no configurada.' };
    if (!textoEntrada) return { ok: false, msg: 'No hay datos.' };
    let prompt;
    if (promptTipo === 'TRADUCIR_WSP') prompt = `Eres un experto de Dropi. Reescribe esto en 1 frase empática y profesional para el cliente: "${textoEntrada}"`;
    else if (promptTipo === 'ANALIZAR_GESTION') prompt = `Analista logístico de Dropi. Lee la observación: "${textoEntrada}". Estados posibles: "${E.GEST_LOG}" (seguimos contactando al proveedor), "${E.GEST_COM}" (pasar a comercial), "${E.SOL_LISTA}" (hay dirección nueva confirmada), "${E.BOD_LISTA}" (sin contacto, enviar a bodega), "${E.RECH_LISTA}" (la solicitud no aplica). Devuelve SOLO JSON: {"estadoSugerido": "Estado", "observacionLimpia": "Resumen"}`;
    else return { ok: false, msg: 'Tipo desconocido.' };
    const resp = UrlFetchApp.fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1 } }) });
    const json = JSON.parse(resp.getContentText());
    if (json.error) return { ok: false, msg: 'Error IA: ' + json.error.message };
    let t = json.candidates[0].content.parts[0].text.trim();
    if (promptTipo === 'ANALIZAR_GESTION') { t = t.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim(); return { ok: true, tipo: 'json', data: JSON.parse(t) }; }
    return { ok: true, tipo: 'texto', texto: t };
  });
}
function guardarGeminiKey(key, tokenSesion) {
  return seguro_(() => { exigir_(tokenSesion, 'config'); PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', txt_(key)); return { ok: true, msg: 'API Key guardada.' }; });
}

// ============================================================
//   INDEMNIZACIONES — cobro mensual por guía en Bodega Dropi
//   Regla: solo meses YA completados desde la recepción. El valor
//   se toma de CONFIG_PARAMETROS al generar cada cobro nuevo.
// ============================================================
function getOrCreateIndemnizacionSheet_() {
  let ws = hoja_(TABS.INDEMNIZACION);
  if (!ws) {
    ws = ss_().insertSheet(TABS.INDEMNIZACION);
    ws.appendRow(['Fecha Generación', 'Row Novedades', 'Guía', 'ID Bodega', 'Transportadora', 'Mes', 'Valor', 'Estado Cobro', 'Fecha Cobro']);
    ws.getRange(2, COL_COBRO.MES + 1, Math.max(ws.getMaxRows() - 1, 1), 1).setNumberFormat('@');
  }
  return ws;
}
function normalizarMes_(val) { return val instanceof Date ? Utilities.formatDate(val, TZ, 'yyyy-MM') : txt_(val); }
function leerCobros_(ws) { const lr = ws.getLastRow(); return lr > 1 ? ws.getRange(2, 1, lr - 1, 9).getValues() : []; }
function contarMesesCompletos_(fRec, ahora) { if (!fRec) return 0; const m = (ahora.getFullYear() - fRec.getFullYear()) * 12 + (ahora.getMonth() - fRec.getMonth()); return m < 0 ? 0 : m; }
function cobrosFaltantes_(filaNov, r, existentes, valor, fechaGen, limite) {
  const out = [];
  let fRec = parseFechaStr(r[COL.FECHA_RECEP_FISICA]); if (!fRec) return out;
  const cursor = new Date(fRec.getFullYear(), fRec.getMonth(), 1);
  while (cursor < limite) {
    const mes = Utilities.formatDate(cursor, TZ, 'yyyy-MM'); const key = filaNov + '|' + mes;
    if (!existentes.has(key)) { out.push([fechaGen, filaNov, sanitizarCSV_(f_(r[COL.GUIA])), sanitizarCSV_(bodegaReal_(r[COL.ID_BODEGA])), sanitizarCSV_(txt_(r[COL.TRANSPORTADORA])), mes, valor, 'Pendiente de cobro', '']); existentes.add(key); }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}
function escribirCobros_(ws, filas) {
  if (!filas.length) return;
  const ini = ws.getLastRow() + 1;
  ws.getRange(ini, COL_COBRO.MES + 1, filas.length, 1).setNumberFormat('@');
  ws.getRange(ini, 1, filas.length, 9).setValues(filas);
  SpreadsheetApp.flush();
}
function registrarCobrosInicialesParaFilas_(wsNovedades, filasNovedades) {
  if (!filasNovedades || !filasNovedades.length) return;
  const wsC = getOrCreateIndemnizacionSheet_();
  const existentes = new Set(leerCobros_(wsC).map(c => c[COL_COBRO.ROW_NOVEDADES] + '|' + normalizarMes_(c[COL_COBRO.MES])));
  const now = new Date(); const limite = new Date(now.getFullYear(), now.getMonth(), 1);
  const valor = getParametros_().VALOR_COBRO_MENSUAL; const fechaGen = hoy_();
  const { data } = nov_(); let nuevas = [];
  filasNovedades.forEach(fl => { const r = data[fl - 1]; if (r) nuevas = nuevas.concat(cobrosFaltantes_(fl, r, existentes, valor, fechaGen, limite)); });
  escribirCobros_(wsC, nuevas);
}
function sincronizarTodoIndemnizacion(tokenSesion) {
  return conLock_(() => {
    const u = exigir_(tokenSesion, 'indemnizacion');
    resetNov_();
    const { data } = nov_(); const wsC = getOrCreateIndemnizacionSheet_();
    const existentes = new Set(leerCobros_(wsC).map(c => c[COL_COBRO.ROW_NOVEDADES] + '|' + normalizarMes_(c[COL_COBRO.MES])));
    const now = new Date(); const limite = new Date(now.getFullYear(), now.getMonth(), 1);
    const valor = getParametros_().VALOR_COBRO_MENSUAL; const fechaGen = hoy_(); let nuevas = [];
    for (let i = FILA_INICIO - 1; i < data.length; i++) { const r = data[i]; if (txt_(r[COL.GUIA]) && estadoBodegaDe_(r) === EB.RECIBIDO) nuevas = nuevas.concat(cobrosFaltantes_(i + 1, r, existentes, valor, fechaGen, limite)); }
    escribirCobros_(wsC, nuevas);
    if (nuevas.length) registrarLog_(u, 'SYNC INDEMNIZACIÓN', 'TODO', `${nuevas.length} cobros generados`);
    return { ok: true, msg: nuevas.length ? `${nuevas.length} cobro(s) generado(s).` : 'Todo estaba al día, no había cobros faltantes.' };
  });
}
function repararIndemnizacion(tokenSesion) {
  return conLock_(() => {
    const u = exigir_(tokenSesion, 'config');
    const ws = getOrCreateIndemnizacionSheet_(); const lr = ws.getLastRow();
    if (lr < 2) return { ok: true, msg: 'No hay registros de cobro para revisar.' };
    const data = leerCobros_(ws); const mesActual = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
    const grupos = {};
    data.forEach(row => { const mes = normalizarMes_(row[COL_COBRO.MES]); const k = row[COL_COBRO.ROW_NOVEDADES] + '|' + mes; (grupos[k] = grupos[k] || []).push({ row, mes }); });
    let dup = 0, prem = 0, cobPrem = 0; const final = [];
    Object.values(grupos).forEach(arr => {
      let el = arr.find(x => txt_(x.row[COL_COBRO.ESTADO_COBRO]) === 'Cobrado al proveedor') || arr[0];
      dup += arr.length - 1;
      const cobrado = txt_(el.row[COL_COBRO.ESTADO_COBRO]) === 'Cobrado al proveedor';
      if (el.mes === mesActual && !cobrado) { prem++; return; }
      if (el.mes === mesActual && cobrado) cobPrem++;
      const fila = el.row.slice(); fila[COL_COBRO.MES] = el.mes; final.push(fila);
    });
    ws.getRange(2, 1, lr - 1, 9).clearContent();
    ws.getRange(2, COL_COBRO.MES + 1, Math.max(ws.getMaxRows() - 1, 1), 1).setNumberFormat('@');
    if (final.length) ws.getRange(2, 1, final.length, 9).setValues(final);
    SpreadsheetApp.flush();
    const partes = [];
    if (dup) partes.push(`${dup} duplicado(s) eliminado(s)`);
    if (prem) partes.push(`${prem} cobro(s) del mes en curso eliminado(s)`);
    if (cobPrem) partes.push(`${cobPrem} cobro(s) del mes en curso ya marcados "Cobrado" — revísalos`);
    registrarLog_(u, 'REPARAR INDEMNIZACIÓN', 'TODO', partes.join(' | ') || 'Sin cambios');
    return { ok: true, msg: partes.length ? partes.join('. ') + '.' : 'Todo estaba correcto.' };
  });
}
function getPanelIndemnizacion(filtros, tokenSesion) {
  return seguro_(() => {
    const u = exigir_(tokenSesion, 'indemnizacion');
    const { data } = nov_();
    const wsC = getOrCreateIndemnizacionSheet_();
    let cobros = leerCobros_(wsC);
    // Rollover liviano: completa meses ya cumplidos de guías que siguen en bodega
    const now = new Date(); const limite = new Date(now.getFullYear(), now.getMonth(), 1);
    const existentes = new Set(cobros.map(c => c[COL_COBRO.ROW_NOVEDADES] + '|' + normalizarMes_(c[COL_COBRO.MES])));
    const conCobro = new Set(cobros.map(c => Number(c[COL_COBRO.ROW_NOVEDADES])));
    const valor = getParametros_().VALOR_COBRO_MENSUAL; const fechaGen = hoy_();
    let nuevas = []; const enGracia = []; let enBodega = 0;
    for (let i = FILA_INICIO - 1; i < data.length; i++) {
      const r = data[i]; if (!txt_(r[COL.GUIA]) || estadoBodegaDe_(r) !== EB.RECIBIDO) continue;
      enBodega++;
      const extra = cobrosFaltantes_(i + 1, r, existentes, valor, fechaGen, limite);
      nuevas = nuevas.concat(extra);
      if (!conCobro.has(i + 1) && !extra.length) { const fr = parseFechaStr(r[COL.FECHA_RECEP_FISICA]); enGracia.push({ guia: f_(r[COL.GUIA]), idBod: bodegaReal_(r[COL.ID_BODEGA]) || 'Sin ID', trans: txt_(r[COL.TRANSPORTADORA]), ciudad: txt_(r[COL.CIUDAD_DESTINO]), fRecFisica: f_(fr), primerCobroDisponible: fr ? Utilities.formatDate(new Date(fr.getFullYear(), fr.getMonth() + 1, 1), TZ, 'dd/MM/yyyy') : '' }); }
    }
    if (nuevas.length) { escribirCobros_(wsC, nuevas); cobros = cobros.concat(nuevas); }
    const f = filtros || {};
    const rows = []; const porBodega = {}, porTrans = {}, porMes = {}, porGuia = {};
    cobros.forEach((c, idx) => {
      const fila = Number(c[COL_COBRO.ROW_NOVEDADES]); const r = data[fila - 1]; if (!r) return;
      const eb = estadoBodegaDe_(r) || EB.RECIBIDO; const bod = bodegaReal_(r[COL.ID_BODEGA]) || 'Sin ID'; const tr = txt_(r[COL.TRANSPORTADORA]) || 'Sin transportadora';
      const ciu = txt_(r[COL.CIUDAD_DESTINO]);
      if (f.transportadora && tr !== f.transportadora) return;
      if (f.estadoGuia && eb !== f.estadoGuia) return;
      if (f.bodegaExacta && bod !== f.bodegaExacta) return;
      if (f.bodega && bod.toLowerCase().indexOf(String(f.bodega).toLowerCase()) < 0) return;
      if (f.ciudadDestino && ciudadKey_(ciu) !== ciudadKey_(f.ciudadDestino)) return;
      const estC = txt_(c[COL_COBRO.ESTADO_COBRO]) || 'Pendiente de cobro';
      if (f.estadoCobro && estC !== f.estadoCobro) return;
      const mes = normalizarMes_(c[COL_COBRO.MES]); if (f.mes && mes !== f.mes) return;
      const v = Number(c[COL_COBRO.VALOR]) || 0; const cob = estC === 'Cobrado al proveedor';
      const fr = parseFechaStr(r[COL.FECHA_RECEP_FISICA]); const meses = contarMesesCompletos_(fr, now);
      rows.push({ cobroRowIndex: idx + 2, guia: f_(r[COL.GUIA]), guiaRemp: f_(r[COL.GUIA_REMP]), idBod: bod, trans: tr, ciudad: ciu, categoria: txt_(r[COL.CATEGORIA]), estadoRec: eb, fechaLlegadaBodega: f_(fr), fechaDevolucion: f_(r[COL.FECHA_DEVOLUCION]), mesesEnBodega: meses, mes, valor: v, estadoCobro: estC, fechaCobro: f_(c[COL_COBRO.FECHA_COBRO]), rowNovedades: fila });
      const add = (o, k, extra) => { if (!o[k]) o[k] = Object.assign({ valorTotal: 0, cobrado: 0, pendiente: 0, guias: {} }, extra); o[k].valorTotal += v; if (cob) o[k].cobrado += v; else o[k].pendiente += v; o[k].guias[fila] = 1; };
      add(porBodega, bod, { bodega: bod }); add(porTrans, tr, { transportadora: tr }); add(porMes, mes, { mes });
      if (!porGuia[fila]) porGuia[fila] = { guia: f_(r[COL.GUIA]), idBod: bod, trans: tr, estadoRec: eb, fechaLlegadaBodega: f_(fr), mesesEnBodega: meses, totalGenerado: 0, cobrado: 0, pendiente: 0 };
      porGuia[fila].totalGenerado += v; if (cob) porGuia[fila].cobrado += v; else porGuia[fila].pendiente += v;
    });
    const resumenBodegas = Object.values(porBodega).map(b => ({ bodega: b.bodega, cantidadGuias: Object.keys(b.guias).length, valorTotal: b.valorTotal, cobrado: b.cobrado, pendiente: b.pendiente, guiasDetalle: Object.values(porGuia).filter(g => g.idBod === b.bodega).sort((a, c2) => c2.pendiente - a.pendiente) })).sort((a, b) => b.pendiente - a.pendiente);
    const resumenTransportadoras = Object.values(porTrans).map(t => ({ transportadora: t.transportadora, cantidadGuias: Object.keys(t.guias).length, valorTotal: t.valorTotal, cobrado: t.cobrado, pendiente: t.pendiente })).sort((a, b) => b.pendiente - a.pendiente);
    const evolucionMensual = Object.values(porMes).map(m => ({ mes: m.mes, valorTotal: m.valorTotal, cobrado: m.cobrado, pendiente: m.pendiente })).sort((a, b) => a.mes < b.mes ? -1 : 1);
    const totales = resumenBodegas.reduce((a, b) => { a.guias += b.cantidadGuias; a.valorTotal += b.valorTotal; a.cobrado += b.cobrado; a.pendiente += b.pendiente; return a; }, { guias: 0, valorTotal: 0, cobrado: 0, pendiente: 0 });
    const gs = Object.values(porGuia);
    totales.enBodega = enBodega; totales.valorMensual = valor;
    totales.promedioMesesPorGuia = gs.length ? +(gs.reduce((s, g) => s + g.mesesEnBodega, 0) / gs.length).toFixed(1) : 0;
    totales.tasaRecaudo = totales.valorTotal ? +((totales.cobrado / totales.valorTotal) * 100).toFixed(1) : 0;
    totales.alertaGuiasAntiguas = gs.filter(g => g.mesesEnBodega >= 3 && g.estadoRec === EB.RECIBIDO).length;
    rows.sort((a, b) => { const ap = a.estadoCobro !== 'Cobrado al proveedor', bp = b.estadoCobro !== 'Cobrado al proveedor'; if (ap !== bp) return ap ? -1 : 1; if (a.mes !== b.mes) return a.mes < b.mes ? 1 : -1; return b.valor - a.valor; });
    const pp = f.porPagina !== undefined ? parseInt(f.porPagina) : 50, pg = Math.max(1, parseInt(f.pagina) || 1);
    return { ok: true, rows: pp ? rows.slice((pg - 1) * pp, pg * pp) : rows, resumenBodegas: resumenBodegas.slice(0, 200), resumenTransportadoras, evolucionMensual, totales, enGracia: enGracia.slice(0, 300), totalFilas: rows.length, pagina: pg, porPagina: pp, totalPaginas: pp ? Math.max(1, Math.ceil(rows.length / pp)) : 1 };
  });
}
function marcarCobroIndemnizacion(cobroIds, datos, tokenSesion) {
  return conLock_(() => {
    const u = exigir_(tokenSesion, 'indemnizacion');
    if (!Array.isArray(cobroIds) || !cobroIds.length) throw new Error('Selecciona al menos un registro.');
    const ws = getOrCreateIndemnizacionSheet_(); const lr = ws.getLastRow();
    const est = sanitizarCSV_(txt_((datos || {}).estadoCobro) || 'Cobrado al proveedor');
    const fecha = sanitizarCSV_((datos || {}).fechaCobro || hoy_());
    const filas = cobroIds.map(Number).filter(r => r >= 2 && r <= lr).sort((a, b) => a - b);
    if (!filas.length) return { ok: false, msg: 'Sin registros válidos.' };
    const ini = filas[0], fin = filas[filas.length - 1];
    const bloque = ws.getRange(ini, COL_COBRO.ESTADO_COBRO + 1, fin - ini + 1, 2).getValues();
    filas.forEach(f => { bloque[f - ini] = [est, est === 'Cobrado al proveedor' ? fecha : '']; });
    ws.getRange(ini, COL_COBRO.ESTADO_COBRO + 1, fin - ini + 1, 2).setValues(bloque);
    SpreadsheetApp.flush();
    registrarLog_(u, 'COBRO INDEMNIZACIÓN', filas.join(', '), `${filas.length} registro(s) -> ${est}`);
    return { ok: true, msg: `${filas.length} registro(s) actualizado(s).` };
  });
}
function exportarIndemnizacionCSV(filtros, tokenSesion) {
  const res = getPanelIndemnizacion(Object.assign({}, filtros || {}, { porPagina: 0, pagina: 1 }), tokenSesion);
  if (!res.ok) return res;
  return { ok: true, nombre: 'Indemnizaciones', headers: ['Guía', 'Guía reemplazatoria', 'ID bodega', 'Transportadora', 'Bodega Dropi', 'Categoría', 'Fecha llegada bodega', 'Meses en bodega', 'Estado guía', 'Fecha devolución', 'Mes cobro', 'Valor', 'Estado de cobro', 'Fecha de cobro'],
    rows: res.rows.map(r => [r.guia, r.guiaRemp, r.idBod, r.trans, r.ciudad, r.categoria, r.fechaLlegadaBodega, r.mesesEnBodega, r.estadoRec, r.fechaDevolucion, r.mes, r.valor, r.estadoCobro, r.fechaCobro]), texto: [0, 1, 2], fechas: [6, 9, 13], pesos: [11] };
}
