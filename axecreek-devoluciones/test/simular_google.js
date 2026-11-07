// Simula el peor caso del procesamiento de Google: todo "//" se toma como inicio de comentario y se borra
// hasta el final de la línea (aunque esté dentro de un texto). Si el JS resultante no compila, la página falla.
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const js = html.split('<script>')[1].split('</script>')[0];
const procesado = js.split('\n').map(l => { const k = l.indexOf('//'); return k >= 0 ? l.slice(0, k) : l; }).join('\n');
try { new Function(procesado); console.log(process.argv[2].split('/').pop(), '→ compila OK'); }
catch (e) { console.log(process.argv[2].split('/').pop(), '→ ERROR:', e.message); process.exitCode = 1; }
