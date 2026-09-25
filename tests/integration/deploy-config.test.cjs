const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {build}=require('../../deploy/vercel/build.cjs');
test('Vercel proxies root and community APIs, serves only public files, preserves PWA paths',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'afiliados-vercel-'));
 try{
  const routes=build('https://backend.example',dir);
  const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
  function match(url){for(const route of routes){if(!route.src)continue;const m=url.match(new RegExp('^'+route.src));if(m)return {...route,destination:route.dest?.replace(/\$(\d+)/g,(_,n)=>m[Number(n)]||'')};}}
  assert.equal(match('/api/status').destination,'https://backend.example/api/status');
  assert.equal(match(`/affiliates/${a}/${b}/api/login`).destination,`https://backend.example/affiliates/${a}/${b}/api/login`);
  assert.equal(match(`/affiliates/${a}/${b}/sw.js`).destination,'/sw.js');
  assert.equal(match(`/affiliates/${a}/${b}/`).destination,'/index.html');
  assert.equal(match(`/affiliates/${a}/${b}`).status,308);
  assert.equal(match(`/affiliates/${a}/${b}/api/members`).headers['Cache-Control'],'no-store');
  assert.equal(fs.existsSync(path.join(dir,'static/server.cjs')),false);
  assert.equal(fs.existsSync(path.join(dir,'static/data')),false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'static/app-config.json'),'utf8')),{apiBase:''});
  assert.throws(()=>build('http://localhost:4180',dir));
  assert.throws(()=>build('https://user:secret@backend.example',dir));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
