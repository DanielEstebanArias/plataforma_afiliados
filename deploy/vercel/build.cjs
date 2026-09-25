const fs = require('node:fs');
const path = require('node:path');
function build(origin, output = '.vercel/output') {
  const url = new URL(origin || '');
  if(url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('RAILWAY_BACKEND_URL debe ser un origen HTTPS sin ruta ni credenciales.');
  const source = path.resolve('affiliates/web');
  fs.mkdirSync(path.join(output,'static'), {recursive:true});
  // Only the allowlisted public web directory is ever published.
  fs.cpSync(source,path.join(output,'static'),{recursive:true});
  fs.writeFileSync(path.join(output,'static/app-config.json'),JSON.stringify({apiBase:''}));
  const community = '/affiliates/([0-9a-f-]{36})/([0-9a-f-]{36})';
  const assets = fs.readdirSync(source).filter(n=>fs.statSync(path.join(source,n)).isFile());
  const routes = [
    {src:'/api(?:/(.*))?$', dest:url.origin+'/api/$1', headers:{'Cache-Control':'no-store'}},
    {src:community+'/api(?:/(.*))?$', dest:url.origin+'/affiliates/$1/$2/api/$3',headers:{'Cache-Control':'no-store'}},
    {src:community+'$',status:308,headers:{Location:'/affiliates/$1/$2/'}},
    {src:community+'/$',dest:'/index.html',headers:{'Cache-Control':'no-cache'}},
    ...assets.map(file=>({src:community+'/'+file.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$',dest:'/'+file,headers:{'Cache-Control':'no-cache'}})),
    {src:'/(.*)',headers:{'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Cache-Control':'no-cache'},continue:true},
    {handle:'filesystem'},
    {src:'/',dest:'/index.html'},
    {src:'/(.*)',status:404,dest:'/404.html'}
  ];
  fs.writeFileSync(path.join(output,'static/404.html'),'<h1>Página no encontrada</h1>');
  fs.writeFileSync(path.join(output,'config.json'),JSON.stringify({version:3,routes},null,2));
  return routes;
}
module.exports={build};
if(require.main===module){build(process.env.RAILWAY_BACKEND_URL); console.log('Frontend y rutas de comunidades preparados para Vercel.');}
