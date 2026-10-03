import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {startBridge} from '../../bridge/server.mjs';
import {encodeReferencePixels} from '../../bridge/reference-pixels.mjs';
import {REFERENCE_PREPARATION_LIMITS as limits} from '../../contracts/reference-preparation.mjs';
import {hash} from '../../src/generation/compiler.mjs';

const png=encodeReferencePixels(1,1,Buffer.from([12,34,56,255]));
function request(ownerId){return {format:'ReferenceGenerationPreparationRequest',version:1,
  generation:{key:ownerId,prompt:'参考图的立面比例，隐藏区域明确作为假设',agent:'codex',model:'gpt-6.1-sol',effort:'max',generationMode:'scene',sceneWorkflow:'components',qualityTier:'lite',assemblyConfirmed:true},
  upload:{format:'UserReferenceUpload',version:1,mode:'inspire',references:[{png:png.toString('base64'),annotation:{purpose:'style',view:'unknown',caption:'石材与玻璃'}}]}};}
const consent=p=>({format:'ReferenceSendConfirmation',version:1,ownerId:p.ownerId,requestHash:p.requestHash,setHash:p.referenceSetHash,provider:p.provider,model:p.model,accepted:true});
async function fixture(t,models){
  const dataDir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reference-api-')));let generationCalls=0,discoveryCalls=0,service;
  const adapter={close(){},async models(){discoveryCalls++;return models?models():[{id:'gpt-6.1-sol',supportsImages:true}];},async generate(){generationCalls++;throw Error('Free reference preparation must not invoke a model');}};
  const start=async()=>{service=await startBridge({dataDir,adapter});return service;};await start();
  t.after(async()=>{await service.close();await fs.rm(dataDir,{recursive:true,force:true});});
  const headers=()=>({Authorization:`Bearer ${service.connection.token}`,'Content-Type':'application/json'}),base=()=>`http://127.0.0.1:${service.connection.port}`;
  const fetcher=(route,input,extra={})=>fetch(base()+route,{method:input===undefined?'GET':'POST',headers:headers(),body:input===undefined?undefined:JSON.stringify(input),...extra});
  const json=async(route,input,extra)=>{const r=await fetcher(route,input,extra);return {status:r.status,value:await r.json()};};
  return {dataDir,start,service:()=>service,fetcher,json,headers,base,calls:()=>generationCalls,discoveryCalls:()=>discoveryCalls};
}
test('authenticated reference preparation API is exact loopback-only and discloses no send authority',async t=>{
  const f=await fixture(t),route='/v1/reference-preparations/capabilities';
  assert.equal((await f.fetcher(route,undefined,{headers:{}})).status,401);
  assert.equal((await f.fetcher(route,undefined,{headers:{...f.headers(),Origin:'https://example.com'}})).status,403);
  // Fetch implementations can rewrite Host. Inspect an actual HTTP request
  // with the wrong Host instead of assuming a custom Fetch header was sent.
  const wrongHost=await new Promise((resolve,reject)=>{
    const req=http.request(f.base()+route,{headers:{...f.headers(),Host:'localhost:'+f.service().connection.port}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.on('error',reject);req.end();
  });assert.equal(wrongHost,403);
  const {status,value}=await f.json(route);assert.equal(status,200);assert.equal(value.sendingImplemented,false);assert.equal(value.generationSubmitted,false);
  assert.equal(f.calls(),0);assert.equal(f.discoveryCalls(),0);
});
test('prepare, exact PNG preview and confirmation survive restart without creating a generation job',async t=>{
  const f=await fixture(t),ownerId=randomUUID(),route=`/v1/reference-drafts/${ownerId}`,input=request(ownerId);
  const first=await f.json(route+'/prepare',input);assert.equal(first.status,200,first.value.error);const p=first.value,prepared=route+'/preparations/'+p.preparationHash;
  assert.deepEqual((await f.json(route+'/prepare',input)).value,p);assert.deepEqual((await f.json(prepared)).value,p);
  const image=await f.fetcher(prepared+'/images/'+p.references[0].id);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
  assert.equal(image.headers.get('etag'),p.references[0].sha256);assert.equal(image.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
  const confirmed=await f.json(prepared+'/confirm',consent(p));assert.equal(confirmed.status,200,confirmed.value.error);assert.equal(confirmed.value.callsReserved,0);
  assert.equal(confirmed.value.generationSubmitted,false);assert.equal(confirmed.value.sendingImplemented,false);assert.equal(confirmed.value.canAuthorizePlacement,false);
  assert.deepEqual((await f.json(prepared+'/confirm',consent(p))).value,confirmed.value);assert.equal((await f.json('/v1/jobs')).value.jobs.length,0);
  await f.service().close();await f.start();assert.deepEqual((await f.json(prepared)).value,p);assert.deepEqual((await f.json(prepared+'/confirm',consent(p))).value,confirmed.value);
  assert.equal(f.calls(),0);assert.deepEqual(await fs.readdir(path.join(f.dataDir,'jobs')),[]);
});
test('image editor restore advertises only reads and transports exact original inventory bytes, not reencoded JSON',async t=>{
  const f=await fixture(t),ownerId=randomUUID(),route=`/v1/reference-drafts/${ownerId}`;
  const p=(await f.json(route+'/prepare',request(ownerId))).value,prepared=route+'/preparations/'+p.preparationHash;
  const file=path.join(f.dataDir,'reference-drafts',ownerId,'preparations',p.preparationHash,'preparation.json');
  const original=Buffer.from(JSON.stringify(p,null,2)+'\n');await fs.writeFile(file,original);
  const cap=(await f.json('/v1/reference-image-restore/capabilities')).value;
  assert.equal(cap.version,1);assert.equal(cap.readOnly,true);assert.equal(cap.newEditorOwnerRequired,true);
  assert.equal(cap.generationAuthorityTransferred,false);assert.equal(cap.additionalModelCalls,0);assert.equal(cap.worldWrites,0);assert.equal(cap.canAuthorizePlacement,false);
  const scope=(await f.json(route+'/archive')).value;
  const item=scope.files.find(v=>v.path===`preparations/${p.preparationHash}/preparation.json`);
  assert.equal(item.sha256,hash(original));assert.equal(item.bytes,original.length);
  for(let i=0;i<2;i++){
    const response=await f.fetcher(prepared+'/record');assert.equal(response.status,200);
    assert.equal(response.headers.get('etag'),item.sha256);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),original);
  }
  assert.deepEqual((await f.json(route+'/archive')).value,scope);assert.deepEqual(await fs.readFile(file),original);
  assert.equal((await f.json(prepared+'/record',{})).status,405);
  assert.equal((await f.fetcher(prepared+'/record',undefined,{headers:{}})).status,401);
  assert.notEqual((await f.json(`/v1/reference-drafts/${randomUUID()}/preparations/${p.preparationHash}/record`)).status,200);
  assert.equal(f.calls(),0);assert.deepEqual(await fs.readdir(path.join(f.dataDir,'jobs')),[]);
});
test('corrupt original record read preserves the failed bytes and never creates a substitute preparation',async t=>{
  const f=await fixture(t),ownerId=randomUUID(),route=`/v1/reference-drafts/${ownerId}`,p=(await f.json(route+'/prepare',request(ownerId))).value;
  const parent=path.join(f.dataDir,'reference-drafts',ownerId,'preparations'),file=path.join(parent,p.preparationHash,'preparation.json');
  const corrupt=Buffer.from(JSON.stringify({...p,model:'changed-without-original-hash'}));await fs.writeFile(file,corrupt);
  const result=await f.json(route+'/preparations/'+p.preparationHash+'/record');assert.equal(result.status,400);
  assert.deepEqual(await fs.readFile(file),corrupt);assert.deepEqual(await fs.readdir(parent),[p.preparationHash]);assert.equal(f.calls(),0);
});
test('unsupported model input is rejected before preparing or calling any provider',async t=>{
  const f=await fixture(t,()=>[{id:'gpt-6.1-sol',supportsImages:false}]),ownerId=randomUUID();
  const r=await f.json(`/v1/reference-drafts/${ownerId}/prepare`,request(ownerId));assert.equal(r.status,400);assert.match(r.value.error,/not advertised/);
  assert.equal(f.calls(),0);await assert.rejects(fs.stat(path.join(f.dataDir,'reference-drafts')),e=>e.code==='ENOENT');
});
test('image capability is rechecked at confirmation instead of trusting the earlier response',async t=>{
  let supportsImages=true;const f=await fixture(t,()=>[{id:'gpt-6.1-sol',supportsImages}]),ownerId=randomUUID(),route=`/v1/reference-drafts/${ownerId}`;
  const p=(await f.json(route+'/prepare',request(ownerId))).value;supportsImages=false;
  const r=await f.json(route+'/preparations/'+p.preparationHash+'/confirm',consent(p));assert.equal(r.status,400);assert.match(r.value.error,/not advertised/);assert.equal(f.calls(),0);
});
test('malformed UTF-8 is rejected unchanged for preparation and confirmation',async t=>{
  const f=await fixture(t),ownerId=randomUUID(),route=`/v1/reference-drafts/${ownerId}`,bad=Buffer.from([0xff]);
  let r=await f.json(route+'/prepare',{}, {body:bad});assert.equal(r.status,400);assert.equal(f.discoveryCalls(),0);
  const p=(await f.json(route+'/prepare',request(ownerId))).value;
  r=await f.json(route+'/preparations/'+p.preparationHash+'/confirm',{}, {body:bad});assert.equal(r.status,400);assert.match(r.value.error,/encoded data|UTF-8/i);assert.equal(f.calls(),0);
});
test('ordinary job and preflight routes reject every reference field rather than silently ignoring it',async t=>{
  const f=await fixture(t);
  for(const route of ['/v1/jobs','/v1/preflight'])for(const field of ['referenceUpload','referenceSet','referenceInput','referenceImages','referenceConfirmation','referencePreparationHash','userImages']){
    const r=await f.json(route,{key:randomUUID(),prompt:'tower',agent:'codex',model:'gpt-6.1-sol',[field]:null});
    assert.equal(r.status,400);assert.match(r.value.error,/versioned reference preparation/);
  }
  assert.equal(f.calls(),0);assert.equal((await f.json('/v1/jobs')).value.jobs.length,0);
});
test('reference routes cannot be used as send endpoints, arbitrary paths or cross-owner reads',async t=>{
  const f=await fixture(t),ownerId=randomUUID(),route=`/v1/reference-drafts/${ownerId}`,p=(await f.json(route+'/prepare',request(ownerId))).value;
  const prepared=route+'/preparations/'+p.preparationHash;
  assert.equal((await f.json(prepared,{})).status,405);assert.equal((await f.json(prepared+'/confirm')).status,405);
  assert.notEqual((await f.json(prepared+'/send',{})).status,200);
  assert.notEqual((await f.json(prepared+'/images/'+'b'.repeat(64))).status,200);
  assert.notEqual((await f.json(`/v1/reference-drafts/${randomUUID()}/preparations/${p.preparationHash}`)).status,200);
  assert.equal(f.calls(),0);assert.equal((await f.json('/v1/jobs')).value.jobs.length,0);
});
test('slow capability discovery holds the single preparation lane and prevents model config races',async t=>{
  let release,entered;const blocked=new Promise(resolve=>{release=resolve;}),seen=new Promise(resolve=>{entered=resolve;});
  const f=await fixture(t,async()=>{entered();await blocked;return [{id:'gpt-6.1-sol',supportsImages:true}];}),ownerId=randomUUID(),route=`/v1/reference-drafts/${ownerId}/prepare`;
  const original=f.json(route,request(ownerId));await seen;
  try{
    assert.equal((await f.json(route,request(ownerId))).status,429);
    assert.equal((await f.json('/v1/config/codex-path',{codexPath:''})).status,409);
  }finally{release();}
  const p=await original;assert.equal(p.status,200,p.value.error);assert.equal(f.calls(),0);
});
test('declared oversized bodies fail before ingestion, discovery or provider calls',async t=>{
  const f=await fixture(t),ownerId=randomUUID();
  const status=await new Promise((resolve,reject)=>{
    const req=http.request(f.base()+`/v1/reference-drafts/${ownerId}/prepare`,{method:'POST',headers:{...f.headers(),'Content-Length':limits.inputBytes+1}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.on('error',reject);req.end('{}');
  });
  assert.equal(status,413);assert.equal(f.discoveryCalls(),0);assert.equal(f.calls(),0);
});
