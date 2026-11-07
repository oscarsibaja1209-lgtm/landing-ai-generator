# Novedades Devoluciones — Dropi (Google Apps Script)

- `entrega/Codigo.txt` → pegar completo en el archivo **Codigo.gs** del proyecto de Apps Script.
- `entrega/Index.txt` → pegar completo en el archivo HTML llamado **Index** (el nombre debe ser exactamente `Index`).
- `src/` contiene los mismos archivos con su extensión real.
- `test/` contiene el simulador de Google Sheets y las pruebas automáticas (backend, interfaz en Chromium y carga).

## Cómo correr las pruebas
```
python3 test/xlsx_a_json.py <Novedades.xlsx> /tmp/hoja.json
TZ=America/Bogota node test/pruebas_backend.js /tmp/hoja.json src/Codigo.gs
TZ=America/Bogota node test/pruebas_ui.js /tmp/hoja.json src/Codigo.gs src/Index.html <carpeta_libs> <carpeta_capturas>
TZ=America/Bogota node test/pruebas_carga.js /tmp/hoja.json src/Codigo.gs
```
`<carpeta_libs>` necesita `npm i chart.js@4.4.0 xlsx@0.18.5 html5-qrcode@2.3.8 @fortawesome/fontawesome-free@6.4.0`.
Los datos reales del Excel no se guardan en el repositorio.
