const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('Railway image serves frontend and API from one service',()=>{
 const cfg=JSON.parse(fs.readFileSync('railway.json','utf8'));
 assert.equal(cfg.build.builder,'DOCKERFILE');
 const dockerfile=fs.readFileSync(cfg.build.dockerfilePath,'utf8');
 assert.equal(cfg.deploy.startCommand,'node dist/src/affiliates/production.js');
 assert.equal(cfg.deploy.healthcheckPath,'/healthz');
 assert.equal(cfg.deploy.numReplicas,1);
 assert.match(dockerfile,/^COPY affiliates\/server\.cjs \.\/affiliates\/server\.cjs$/m);
 assert.match(dockerfile,/^COPY affiliates\/web \.\/affiliates\/web$/m);
 assert.ok(fs.existsSync('affiliates/web/index.html'));
 assert.deepEqual(JSON.parse(fs.readFileSync('affiliates/web/app-config.json','utf8')),{apiBase:''});
 assert.equal(fs.existsSync('vercel.json'),false);
});
