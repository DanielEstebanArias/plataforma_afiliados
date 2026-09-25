const fs = require('node:fs');
const path = require('node:path');
const endpoint = process.argv[2];
if (!endpoint) {
  console.error('Uso: node prepare-native.cjs https://afiliados.tu-dominio.com');
  process.exit(1);
}
const url = new URL(endpoint);
if (
  url.protocol !== 'https:' ||
  url.username ||
  url.password ||
  (url.pathname !== '/' && !/^\/affiliates\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/?$/.test(url.pathname)) ||
  url.search ||
  url.hash
) {
  console.error('Indica el origen HTTPS o la ruta de la aplicación /affiliates/tenantId/appId, sin credenciales ni parámetros.');
  process.exit(1);
}
const out = path.join(__dirname, 'native-web');
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(__dirname, 'web'), out, { recursive: true });
fs.writeFileSync(
  path.join(out, 'app-config.json'),
  JSON.stringify({ apiBase: url.origin + url.pathname.replace(/\/$/,'') }, null, 2),
);
console.log(
  'Recursos móviles preparados. Ahora ejecuta npx cap sync. La configuración web local permanece intacta.',
);
