import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {startBridge} from '../../bridge/server.mjs';
import {jointResourceFixture} from './joint-assembly-resource-fixture.mjs';

const prefix='/v1/reference-world-assembly';
async function fixture(t,{tier='lite',enabled=true,holdModels}={}) {
  const h=await jointResourceFixture(t,{tier,images:tier==='lite'?1:4});let queries=0,imageSupport=true,efforts=['high','max'],app;
  const adapter={models:async()=>{queries++;await holdModels?.();return [{id:h.f.generation.model,supportsImages:imageSupport,efforts:efforts.map(reasoningEffort=>({reasoningEffort}))}];},
    generate:async()=>assert.fail('Free complete joint preparation must NEVER invoke a model'),close(){}};
  const reopen=async()=>{app=await startBridge({dataDir:h.f.dataDir,adapter,referenceWorldAssemblyPreparation:enabled,referenceWorldPatchSending:true});};
  await reopen();t.after(()=>app.close());
  const request=async(route,{method='GET',value,bytes,headers={}}={})=>{
    // Native HTTP preserves an intentionally invalid Host. Fetch normalizes
    // it to the URL's authority, which would test a valid request instead.
    const payload=value!==undefined||bytes?bytes??Buffer.from(JSON.stringify(value)):null;
    return new Promise((resolve,reject)=>{
      const req=http.request({hostname:'127.0.0.1',port:app.connection.port,path:route,method,
        headers:{Authorization:`Bearer ${app.connection.token}`,...(payload?{'Content-Type':'application/json; charset=utf-8','Content-Length':payload.length}:{}),...headers}},res=>{
        const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);
        res.on('end',()=>{try{resolve({status:res.statusCode,headers:new Headers(res.headers),value:JSON.parse(Buffer.concat(chunks))});}catch(error){reject(error);}});
      });req.on('error',reject);req.end(payload);
    });
  };
  return {...h,request,reopen,close:()=>app.close(),queries:()=>queries,setImages:v=>{imageSupport=v;},setEfforts:v=>{efforts=v;},
    route:`${prefix}/contexts/${h.contextId}/prepare`,body:{referenceOwnerId:h.f.ownerId,referenceSetHash:h.f.manifest.setHash,generation:h.f.generation}};
}

for(const tier of ['lite','pro','max','ultra'])test(tier+' paired HTTP preparation binds original pixels, W/P/environment and full-tier policy without any task or SEND',async t=>{
  const f=await fixture(t,{tier}),cap=await f.request(prefix+'/capabilities');assert.equal(cap.status,200);
  assert.equal(cap.value.version,2);assert.equal(cap.value.preparationEnabled,true);assert.equal(cap.value.sendingImplemented,false);
  assert.equal(cap.value.sendingEnabled,false);assert.equal(cap.value.canAuthorizePlacement,false);
  const response=await f.request(f.route,{method:'POST',value:f.body});assert.equal(response.status,200,response.value.error);
  assert.deepEqual(response.value,f.prepared);assert.equal(response.value.maximumCalls,{lite:8,pro:14,max:20,ultra:26}[tier]);
  assert.equal(response.value.snapshotHash,f.saved.record.snapshotHash);assert.equal(response.value.imageCount,tier==='lite'?1:4);
  assert.equal(response.value.modelSent,false);assert.equal(response.value.callsReserved,0);assert.equal(response.value.serverBaselineVerified,false);
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.deepEqual((await f.request(f.route,{method:'POST',value:f.body})).value,response.value);
  assert.equal(f.queries(),2);await assert.rejects(fs.stat(f.resources.root),e=>e.code==='ENOENT');
  await assert.rejects(fs.stat(path.join(f.f.dataDir,'reference-drafts',f.f.ownerId,'preparations')),e=>e.code==='ENOENT');
  assert.deepEqual((await f.request('/v1/jobs')).value.jobs,[]);
  assert.doesNotMatch(JSON.stringify(response.value),/connection\.json|Bearer|dataDir|directory|[A-Z]:[\\/]/);
});

test('normal default startup disables complete joint preparation; neither config nor a SEND body can enable it',async t=>{
  const f=await fixture(t,{enabled:false}),cap=await f.request(prefix+'/capabilities');
  assert.equal(cap.value.preparationEnabled,false);assert.equal(cap.value.sendingEnabled,false);
  assert.equal((await f.request(f.route,{method:'POST',value:f.body})).status,409);assert.equal(f.queries(),0);
  assert.equal((await f.request(prefix+'/jobs/'+f.f.ownerId+'/send',{method:'POST',value:{confirmed:true,enabled:true}})).status,404);
  assert.equal((await f.request(f.route+'?enabled=true',{method:'POST',value:f.body})).status,400);
  await assert.rejects(fs.stat(f.resources.root),e=>e.code==='ENOENT');
});

test('paired HTTP enforces exact Host, no Origin, bearer, route, method and fatal UTF-8 without model queries',async t=>{
  const f=await fixture(t);
  for(const [headers,status]of [[{Authorization:'Bearer synthetic-invalid'},401],[{Origin:'https://invalid.example'},403],[{Host:'localhost'},403]])
    assert.equal((await f.request(f.route,{method:'POST',value:f.body,headers})).status,status);
  for(const [route,method,status]of [[f.route,'GET',405],[prefix+'/capabilities','POST',405],[f.route+'?runtimeHash=other','POST',400],
    [prefix+'/jobs/'+f.f.ownerId+'/send','POST',404],[prefix+'/contexts/not-an-id/prepare','POST',404]])
    assert.equal((await f.request(route,{method,...(method==='POST'?{value:f.body}:{})})).status,status);
  assert.equal((await f.request(f.route,{method:'POST',bytes:Buffer.from([123,34,255,34,58,49,125])})).status,400);
  assert.equal((await f.request(f.route,{method:'POST',bytes:Buffer.alloc(32769,32)})).status,413);
  assert.equal((await f.request(f.route,{method:'POST',value:f.body,headers:{'Content-Type':'text/plain'}})).status,400);
  assert.equal((await f.request(prefix+'/capabilities',{bytes:Buffer.from('{}')})).status,400);
  assert.equal(f.queries(),0);await assert.rejects(fs.stat(f.resources.root),e=>e.code==='ENOENT');
});

test('HTTP callers cannot choose file paths, capability, runtime, provider or ordinary/v1 consent for a complete task',async t=>{
  const f=await fixture(t);
  for(const key of ['dataDir','directory','selectedCapability','runtimeHash','send','confirmation','enabled','operation','canAuthorizePlacement'])
    assert.equal((await f.request(f.route,{method:'POST',value:{...f.body,[key]:'unauthorized'}})).status,409);
  assert.equal(f.queries(),0);
  f.setImages(false);assert.equal((await f.request(f.route,{method:'POST',value:f.body})).status,409);
  f.setImages(true);f.setEfforts(['high']);assert.equal((await f.request(f.route,{method:'POST',value:f.body})).status,409);
  f.setEfforts(['high','max']);assert.equal((await f.request(f.route,{method:'POST',value:{...f.body,generation:{...f.body.generation,agent:'claude'}}})).status,400);
  assert.equal((await f.request(f.route,{method:'POST',value:{...f.body,referenceSetHash:'a'.repeat(64)}})).status,409);
  assert.equal((await f.request(f.route,{method:'POST',value:f.body})).status,200);
  await assert.rejects(fs.stat(f.resources.root),e=>e.code==='ENOENT');
});

test('in-flight complete preparation fences other joint lanes, configuration, attachments, contexts and model jobs while health remains responsive',async t=>{
  let started,release;const entered=new Promise(resolve=>{started=resolve;}),hold=new Promise(resolve=>{release=resolve;});
  const f=await fixture(t,{holdModels:async()=>{started();await hold;}}),pending=f.request(f.route,{method:'POST',value:f.body});await entered;
  assert.equal((await f.request('/v1/health')).status,200);
  assert.equal((await f.request(f.route,{method:'POST',value:f.body})).status,429);
  assert.equal((await f.request(`${prefix}/capabilities`)).status,200);
  for(const route of ['/v1/config/codex',`/v1/reference-drafts/${f.f.ownerId}/pixels`,`/v1/world-contexts/${f.contextId}/discard`,
    '/v1/jobs','/v1/reference-generation-jobs','/v2/world-patch/send'])
    assert.equal((await f.request(route,{method:'POST',value:{}})).status,409,route);
  assert.equal((await f.request(`/v1/reference-world-patch/contexts/${f.contextId}/disclosure`,{method:'POST',value:{intent:{}}})).status,429);
  release();assert.equal((await pending).status,200);assert.equal(f.queries(),1);
  assert.equal((await f.request(f.route,{method:'POST',value:f.body})).status,200);
});

test('service close cancels discovery without a SEND and removes its exact loopback connection/lock; reopening does not adopt a task',async t=>{
  let started,release;const entered=new Promise(resolve=>{started=resolve;}),hold=new Promise(resolve=>{release=resolve;});
  const f=await fixture(t,{holdModels:async()=>{started();await hold;}}),pending=f.request(f.route,{method:'POST',value:f.body});await entered;
  await f.close();assert.equal((await pending).status,503);release();
  for(const name of ['connection.json','bridge.lock'])await assert.rejects(fs.stat(path.join(f.f.dataDir,name)),e=>e.code==='ENOENT');
  await assert.rejects(fs.stat(f.resources.root),e=>e.code==='ENOENT');await f.reopen();
  assert.equal((await f.request(f.route,{method:'POST',value:f.body})).status,200);assert.equal(f.queries(),2);
});
