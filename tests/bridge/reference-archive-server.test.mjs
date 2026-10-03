import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {startBridge} from '../../bridge/server.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {encodeReferencePixels} from '../../bridge/reference-pixels.mjs';

async function fixture(t,{models}={}){
  const dataDir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reference-archive-api-')));let service,calls=0,discovery=0;
  const adapter={close(){},async models(){discovery++;return models?models():[{id:'gpt-6.1-sol',supportsImages:true}];},async generate(){calls++;throw Error('Archival must not invoke a model');}};
  const start=async()=>{service=await startBridge({dataDir,adapter,claudeAdapter:adapter,deepseekAdapter:adapter});};await start();
  t.after(async()=>{await service.close();await fs.rm(dataDir,{recursive:true,force:true});});
  const base=()=>`http://127.0.0.1:${service.connection.port}`,headers=()=>({Authorization:'Bearer '+service.connection.token,'Content-Type':'application/json'});
  const fetcher=(route,input,extra={})=>fetch(base()+route,{method:input===undefined?'GET':'POST',headers:headers(),body:input===undefined?undefined:JSON.stringify(input),...extra});
  const json=async(route,input,extra)=>{const r=await fetcher(route,input,extra);return {status:r.status,value:await r.json()};};
  const ownerId=randomUUID(),prefix='/v1/reference-drafts/'+ownerId;
  const request={format:'ReferenceGenerationPreparationRequest',version:2,generation:{key:ownerId,prompt:'现代办公楼参考',agent:'codex',model:'gpt-6.1-sol',effort:'max',
    generationMode:'scene',sceneWorkflow:'components',qualityTier:'lite',assemblyConfirmed:true,assemblyRecovery:'safe'},
    upload:{format:'UserReferenceUpload',version:1,mode:'inspire',references:[{png:encodeReferencePixels(1,1,Buffer.from([1,2,3,255])).toString('base64'),annotation:{purpose:'style',view:'unknown',caption:'纯离线测试图片'}}]}};
  return {dataDir,ownerId,prefix,request,base,headers,fetcher,json,start,service:()=>service,calls:()=>calls,discovery:()=>discovery};
}
const consent=(s,actionId=randomUUID())=>({format:'ReferenceDraftArchiveConfirmation',version:1,action:'archive-reference-draft',actionId,ownerId:s.ownerId,snapshotHash:s.snapshotHash,accepted:true});

test('archive capabilities and list enforce pairing, origin and exact loopback host without models/discovery',async t=>{
  const f=await fixture(t),route='/v1/reference-archives/capabilities';
  assert.equal((await f.fetcher(route,undefined,{headers:{}})).status,401);
  assert.equal((await f.fetcher(route,undefined,{headers:{...f.headers(),Origin:'https://example.com'}})).status,403);
  const wrongHost=await new Promise((resolve,reject)=>{const req=http.request(f.base()+route,{headers:{...f.headers(),Host:'localhost'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});
  assert.equal(wrongHost,403);const cap=await f.json(route);assert.equal(cap.status,200);assert.equal(cap.value.version,3);assert.equal(cap.value.originalRecordReadOnly,true);assert.equal(cap.value.permanentDeletionImplemented,true);
  assert.equal(cap.value.jobOriginalsAndAuditRetained,true);
  const list=await f.json('/v1/reference-drafts');assert.equal(list.status,200);assert.deepEqual(list.value.drafts,[]);assert.equal(f.calls(),0);assert.equal(f.discovery(),0);
});
test('exact confirmed archive and original action receipt survive Bridge restart; GET never deletes or generates',async t=>{
  const f=await fixture(t),p=await f.json(f.prefix+'/prepare',f.request);assert.equal(p.status,200,p.value.error);
  const source=path.join(f.dataDir,'reference-drafts',f.ownerId,'reference-sets',p.value.referenceSetHash,'image-0.png'),original=await fs.readFile(source);
  const observed=await f.json(f.prefix+'/archive');assert.equal(observed.status,200,observed.value.error);const c=consent(observed.value);
  const r=await f.json(f.prefix+'/archive',c);assert.equal(r.status,200,r.value.error);assert.equal(r.value.state,'archived');
  assert.deepEqual((await f.json(f.prefix+'/archive',c)).value,r.value);
  const target=path.join(f.dataDir,'reference-archives',c.actionId,f.ownerId,'reference-sets',p.value.referenceSetHash,'image-0.png');assert.deepEqual(await fs.readFile(target),original);
  await f.service().close();await f.start();
  assert.deepEqual((await f.json(f.prefix+'/archive/'+c.actionId)).value,r.value);assert.deepEqual((await f.json(f.prefix+'/archive',c)).value,r.value);
  assert.equal((await f.json(f.prefix+'/prepare',f.request)).status,400);
  assert.equal((await f.json('/v1/reference-drafts')).value.drafts.length,0);assert.equal((await f.json('/v1/jobs')).value.jobs.length,0);
  assert.equal(f.calls(),0);assert.equal(hash(await fs.readFile(target)),hash(original));
});
test('archive endpoints reject DELETE, path substitutions, cross-owner actions and malformed consent without source loss',async t=>{
  const f=await fixture(t);await f.json(f.prefix+'/prepare',f.request);
  assert.equal((await f.fetcher(f.prefix+'/archive',undefined,{method:'DELETE'})).status,405);
  assert.equal((await f.json('/v1/reference-drafts',{})).status,405);
  assert.equal((await f.json(f.prefix+'/archive',{path:'C:/private'})).status,400);
  assert.equal((await f.json(f.prefix+'/archive',{}, {body:Buffer.from([255])})).status,400);
  const s=(await f.json(f.prefix+'/archive')).value,c=consent(s);assert.equal((await f.json(f.prefix+'/archive',{...c,accepted:false})).status,400);
  assert.ok(await fs.stat(path.join(f.dataDir,'reference-drafts',f.ownerId)));await f.json(f.prefix+'/archive',c);
  assert.equal((await f.json(`/v1/reference-drafts/${randomUUID()}/archive/${c.actionId}`)).status,400);
  assert.equal((await f.json(f.prefix+'/archive/'+c.actionId,{})).status,405);assert.equal(f.calls(),0);
});
test('oversized archive body is rejected before reading input, discovery or preparing any intent',async t=>{
  const f=await fixture(t);await f.json(f.prefix+'/prepare',f.request);const before=f.discovery();
  const status=await new Promise((resolve,reject)=>{const req=http.request(f.base()+f.prefix+'/archive',{method:'POST',headers:{...f.headers(),'Content-Length':4097}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end('{}');});
  assert.equal(status,413);assert.equal(f.discovery(),before);assert.equal(f.calls(),0);
  await assert.rejects(fs.stat(path.join(f.dataDir,'reference-archives')),e=>e.code==='ENOENT');
});
test('upload capability discovery holds archive/configuration lane until original preparation completes',async t=>{
  let release,entered;const blocked=new Promise(resolve=>{release=resolve;}),seen=new Promise(resolve=>{entered=resolve;});
  const f=await fixture(t,{models:async()=>{entered();await blocked;return [{id:'gpt-6.1-sol',supportsImages:true}];}});
  const original=f.json(f.prefix+'/prepare',f.request);await seen;
  try{
    assert.equal((await f.json(f.prefix+'/archive')).status,429);assert.equal((await f.json('/v1/reference-drafts')).status,429);
    assert.equal((await f.json('/v1/config/codex-path',{codexPath:''})).status,409);
  }finally{release();}
  const result=await original;assert.equal(result.status,200,result.value.error);assert.equal(f.calls(),0);
});
