// Simulador mínimo de Google Apps Script (SpreadsheetApp, CacheService, etc.) para pruebas locales.
// Imita el comportamiento de Sheets al escribir: textos numéricos se vuelven número salvo formato '@'
// o apóstrofe inicial, y 'dd/MM/yyyy' se vuelve fecha. Cuenta llamadas para medir rendimiento.
'use strict';
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

function crearMock(rutaJson, opciones = {}) {
  const ctx = vm.createContext({ console });
  const CDate = vm.runInContext('Date', ctx); // fechas del mismo "mundo" que el código, como en Apps Script
  const esFecha = v => Object.prototype.toString.call(v) === '[object Date]';
  const stats = { getValues: 0, setValues: 0, celdasLeidas: 0, celdasEscritas: 0, appendRow: 0 };
  const raw = JSON.parse(fs.readFileSync(rutaJson, 'utf8'));
  const revive = v => (v && typeof v === 'object' && v.__d) ? new CDate(v.__d) : v;

  function parsearComoSheets(v, formato) {
    if (typeof v !== 'string') return v;
    if (v.startsWith("'")) return v.slice(1);
    if (formato === '@') return v;
    if (/^-?\d+(\.\d+)?$/.test(v) && v.length < 16) return Number(v);
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new CDate(+m[3], +m[2] - 1, +m[1]);
    return v;
  }

  class Sheet {
    constructor(nombre, filas) {
      this.nombre = nombre;
      this.filas = filas.map(r => r.map(revive));
      this.maxCols = Math.max(26, ...this.filas.map(r => r.length));
      this.formatos = {};
      if (opciones.formatoTextoGuia && nombre === 'NOVEDADES') this.colTexto = new Set([3, 4]);
    }
    getName() { return this.nombre; }
    getLastRow() { for (let i = this.filas.length - 1; i >= 0; i--) if (this.filas[i].some(c => c !== '' && c !== null && c !== undefined)) return i + 1; return 0; }
    getLastColumn() { let m = 0; this.filas.forEach(r => { for (let j = r.length - 1; j >= 0; j--) if (r[j] !== '' && r[j] != null) { m = Math.max(m, j + 1); break; } }); return m; }
    getMaxColumns() { return this.maxCols; }
    getMaxRows() { return Math.max(1000, this.filas.length); }
    insertColumnsAfter(after, n) { this.maxCols += n; }
    getRange(r, c, nr = 1, nc = 1) { if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error(`Rango inválido ${r},${c},${nr},${nc}`); if (c + nc - 1 > this.maxCols) throw new Error('Columnas fuera del rango de la hoja'); return new Range(this, r, c, nr, nc); }
    getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
    appendRow(arr) { stats.appendRow++; const r = this.getLastRow() + 1; this._escribir(r, 1, [arr]); }
    formato(r, c) { return this.formatos[r + ',' + c] || (this.colTexto && this.colTexto.has(c) && r >= 4 ? '@' : ''); }
    _leer(r, c, nr, nc) {
      const out = [];
      for (let i = 0; i < nr; i++) { const fila = this.filas[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) { const v = fila[c - 1 + j]; o.push(v === undefined || v === null ? '' : (esFecha(v) ? new CDate(v.getTime()) : v)); } out.push(o); }
      stats.getValues++; stats.celdasLeidas += nr * nc; return out;
    }
    _escribir(r, c, vals) {
      vals.forEach((fila, i) => {
        while (this.filas.length < r + i) this.filas.push([]);
        const dest = this.filas[r - 1 + i];
        fila.forEach((v, j) => { while (dest.length < c + j) dest.push(''); dest[c - 1 + j] = parsearComoSheets(esFecha(v) ? new CDate(v.getTime()) : v, this.formato(r + i, c + j)); });
      });
      stats.setValues++; stats.celdasEscritas += vals.length * (vals[0] ? vals[0].length : 0);
    }
  }
  class Range {
    constructor(s, r, c, nr, nc) { Object.assign(this, { s, r, c, nr, nc }); }
    getValues() { return this.s._leer(this.r, this.c, this.nr, this.nc); }
    getValue() { return this.getValues()[0][0]; }
    setValues(v) { if (v.length !== this.nr || v.some(f => f.length !== this.nc)) throw new Error(`setValues: tamaño ${v.length}x${v[0] && v[0].length} no coincide con ${this.nr}x${this.nc}`); this.s._escribir(this.r, this.c, v); return this; }
    setValue(v) { this.s._escribir(this.r, this.c, [[v]]); return this; }
    setNumberFormat(f) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.s.formatos[(this.r + i) + ',' + (this.c + j)] = f; return this; }
    clearContent() { const vacio = []; for (let i = 0; i < this.nr; i++) vacio.push(new Array(this.nc).fill('')); this.s._escribir(this.r, this.c, vacio); return this; }
  }
  const hojas = {};
  Object.keys(raw).forEach(n => hojas[n] = new Sheet(n, raw[n]));
  const ss = {
    getSheetByName: n => hojas[n] || null,
    insertSheet: n => (hojas[n] = new Sheet(n, [])),
    getSheets: () => Object.values(hojas)
  };
  const cacheData = new Map();
  const correos = [];
  const props = {};
  const fmt2 = n => String(n).padStart(2, '0');
  const g = {
    SpreadsheetApp: { openById: () => ss, flush: () => {} },
    CacheService: { getScriptCache: () => ({
      get: k => cacheData.has(k) ? cacheData.get(k) : null,
      put: (k, v) => { if (String(v).length > 100000) throw new Error('Argument too large: value'); cacheData.set(k, String(v)); },
      remove: k => cacheData.delete(k)
    }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Session: { getActiveUser: () => ({ getEmail: () => '' }) },
    MailApp: { sendEmail: o => correos.push(o) },
    DriveApp: { getFileById: () => ({ makeCopy: n => ({ getUrl: () => 'https://drive.google.com/copia/' + encodeURIComponent(n) }) }) },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => '{}' }) },
    HtmlService: { createTemplateFromFile: () => ({ evaluate() { const o = { setTitle: () => o, addMetaTag: () => o, setXFrameOptionsMode: () => o }; return o; } }), XFrameOptionsMode: { DEFAULT: 'DEFAULT' } },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }) },
    Utilities: {
      Charset: { UTF_8: 'utf8' },
      getUuid: () => crypto.randomUUID(),
      base64Encode: s => Buffer.from(String(s), 'utf8').toString('base64'),
      newBlob: (data, tipo, nombre) => ({ data, tipo, nombre }),
      formatDate: (d, tz, pat) => {
        const x = new Date(d.getTime() - 5 * 3600 * 1000);
        return pat.replace('yyyy', x.getUTCFullYear()).replace('MM', fmt2(x.getUTCMonth() + 1)).replace('dd', fmt2(x.getUTCDate()))
          .replace('HH', fmt2(x.getUTCHours())).replace('mm', fmt2(x.getUTCMinutes())).replace('ss', fmt2(x.getUTCSeconds()));
      }
    }
  };
  Object.assign(ctx, g);
  return { ctx, CDate, hojas, stats, correos, cacheData, props, cargar(ruta) { vm.runInContext(fs.readFileSync(ruta, 'utf8'), ctx, { filename: ruta }); return ctx; } };
}
module.exports = { crearMock };
