import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {startBridge} from '../../bridge/server.mjs';
import {ReferencePreparationStore} from '../../bridge/reference-preparation.mjs';
import {encodeReferencePixels} from '../../bridge/reference-pixels.mjs';
import {REFERENCE_PREPARATION_LIMITS as limits} from '../../contracts/reference-preparation.mjs';
import {hash} from '../../src/generation/compiler.mjs';

const png=encodeReferencePixels(2,1,Buffer.from([12,34,56,255,78,90,12,255]));
const input=(caption='立面',count=2)=>({format:'ReferencePixelPreparationRequest',version:1,upload:{format:'UserReferenceUpload',version:1,mode:'multi-view',
  references:Array.from({length:count},(_,i)=>({png:png.toString('base64'),annotation:{purpose:'exterior',view:i?'side':'front',caption}}))}});
async function fixture(t){
  const dataDir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'pure-reference-pixels-')));let service,calls=0,discoveries=0;
  const adapter={close(){},async models(){discoveries++;throw Error('Pixel preparation must not discover a model');},async generate(){calls++;throw Error('Pixel preparation must not invoke a model');}};
  const start=async()=>{service=await startBridge({dataDir,adapter});};await start();
  t.after(async()=>{await service.close();await fs.rm(dataDir,{recursive:true,force:true});});
  const base=()=>`http://127.0.0.1:${service.connection.port}`,headers=()=>({Authorization:`Bearer ${service.connection.token}`,'Content-Type':'application/json'});
  const request=(route,value,extra={})=>fetch(base()+route,{method:value===undefined?'GET':'POST',headers:headers(),body:value===undefined?undefined:JSON.stringify(value),...extra});
  const json=async(...args)=>{const r=await request(...args);return {status:r.status,value:await r.json()};};
  return {dataDir,start,base,headers,close:()=>service.close(),request,json,calls:()=>calls,discoveries:()=>discoveries};
}
test('pixel preparation advertises zero model discovery, calls, world writes and consent transfer',async t=>{
  const f=await fixture(t),r=await f.json('/v1/reference-pixels/capabilities');assert.equal(r.status,200);
  assert.equal(r.value.pixelPreparationImplemented,true);assert.equal(r.value.modelDiscovery,false);assert.equal(r.value.modelCalls,0);assert.equal(r.value.worldWrites,0);
  assert.equal(r.value.generationAuthorityTransferred,false);assert.equal(r.value.canAuthorizePlacement,false);assert.deepEqual(r.value.limits,{inputBytes:limits.inputBytes,maximumImages:4,lanes:1});
  assert.equal((await f.request('/v1/reference-pixels/capabilities',{})).status,405);assert.equal((await f.request('/v1/reference-pixels/capabilities?model=other')).status,400);
  assert.equal(f.calls(),0);assert.equal(f.discoveries(),0);
});
test('pixel-only import reads exact manifest and images after restart without a generation preparation or model selection',async t=>{
  const f=await fixture(t),owner=randomUUID(),prefix=`/v1/reference-drafts/${owner}`,r=await f.json(prefix+'/pixels',input());assert.equal(r.status,200,r.value.error);
  const m=r.value,{setHash,...content}=m;assert.equal(hash(content),setHash);assert.equal(m.ownerId,owner);assert.equal(m.references.length,2);assert.equal(m.canAuthorizePlacement,false);
  assert.deepEqual((await f.json(prefix+'/pixels',input())).value,m);
  const route=prefix+'/sets/'+setHash;assert.deepEqual((await f.json(route)).value,m);
  for(const record of m.references){const image=await f.request(route+'/images/'+record.id);assert.equal(image.status,200);assert.equal(image.headers.get('etag'),record.sha256);assert.equal(image.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);}
  assert.deepEqual(await fs.readdir(path.join(f.dataDir,'reference-drafts',owner)),['reference-sets']);
  await f.close();await f.start();assert.deepEqual((await f.json(route)).value,m);assert.deepEqual(await fs.readdir(path.join(f.dataDir,'jobs')),[]);assert.equal(f.calls(),0);assert.equal(f.discoveries(),0);
});
test('pixel routes enforce pairing, Origin, exact method/query and MIME without model discovery',async t=>{
  const f=await fixture(t),route=`/v1/reference-drafts/${randomUUID()}/pixels`;
  assert.equal((await f.request(route,input(),{headers:{}})).status,401);
  assert.equal((await f.request(route,input(),{headers:{Origin:'https://example.com'}})).status,403);
  assert.equal((await f.request(route)).status,405);assert.equal((await f.request(route+'?model=other',input())).status,400);
  for(const mime of ['text/plain','application/jsonp','application/json; charset=latin1'])assert.equal((await f.request(route,input(),{headers:{...f.headers(),'Content-Type':mime}})).status,400);
  const original=f.request;const r=await original(route,input());assert.equal(r.status,200);const m=await r.json();
  assert.equal((await f.request(`/v1/reference-drafts/${m.ownerId}/sets/${m.setHash}`,{})).status,405);
  assert.equal((await f.request(`/v1/reference-drafts/${m.ownerId}/sets/${m.setHash}?setHash=${m.setHash}`)).status,400);
  assert.equal(f.calls(),0);assert.equal(f.discoveries(),0);
});
test('declared oversized pixel bodies reject before ingestion while exact GET bodies are forbidden',async t=>{
  const f=await fixture(t),route=`/v1/reference-drafts/${randomUUID()}/pixels`;
  // The first request deliberately does NOT transmit its declared body. A
  // fresh socket is required for the second request: reusing that incomplete
  // HTTP stream tests the client pool, not the server's independent GET gate.
  const raw=(url,method,length)=>new Promise((resolve,reject)=>{const r=http.request(f.base()+url,{method,agent:false,headers:{...f.headers(),'Content-Length':length}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});r.on('error',reject);r.end('{}');});
  assert.equal(await raw(route,'POST',limits.inputBytes+1),413);
  assert.equal(await raw(route.replace('/pixels','/sets/'+'a'.repeat(64)),'GET',2),400);
  assert.equal(await raw('/v1/reference-pixels/capabilities','GET',2),400);
  await assert.rejects(fs.stat(path.join(f.dataDir,'reference-drafts')),e=>e.code==='ENOENT');assert.equal(f.discoveries(),0);
});
test('all model, task, file, consent, budget and generation fields reject rather than passing to legacy generation',async t=>{
  const f=await fixture(t),route=`/v1/reference-drafts/${randomUUID()}/pixels`;
  for(const key of ['generation','model','prompt','world','budget','confirmation','path','url','operation','runtimeHash','capability']){
    const value=input();value[key]=null;assert.equal((await f.json(route,value)).status,400,key);
  }
  for(const key of ['path','url','filename']){const value=input();value.upload.references[0][key]='unselected';assert.equal((await f.json(route,value)).status,400,key);}
  await assert.rejects(fs.stat(path.join(f.dataDir,'reference-drafts')),e=>e.code==='ENOENT');assert.equal(f.calls(),0);assert.equal(f.discoveries(),0);
});
test('invalid UTF-8, duplicate escaped keys, trailing commas and JSON fences are not repaired for pixel HTTP',async t=>{
  const f=await fixture(t),route=`/v1/reference-drafts/${randomUUID()}/pixels`,good=JSON.stringify(input());
  for(const body of [Buffer.from([0xff]),'','{"format":"ignored",'+good.slice(1),good.replace('"version":1','"version":1,"\\u0076ersion":1'),good.slice(0,-1)+',}', '```json\n'+good+'\n```'])
    assert.equal((await f.json(route,{}, {body})).status,400);
  await assert.rejects(fs.stat(path.join(f.dataDir,'reference-drafts')),e=>e.code==='ENOENT');assert.equal(f.calls(),0);assert.equal(f.discoveries(),0);
});
test('one shared worker lane holds pixel import and prevents ordinary preparation/archive work from running in parallel',async t=>{
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'pixel-worker-'))),store=new ReferencePreparationStore({dataDir:dir}),owner=randomUUID();
  t.after(async()=>{await store.close();await fs.rm(dir,{recursive:true,force:true});});
  const original=store.operation('pixel-prepare',owner,{input:Buffer.from(JSON.stringify(input()))});
  assert.equal(store.busy(),true);await assert.rejects(store.operation('archive-list',null),/lane full/);await assert.rejects(store.operation('prepare',owner,{input:Buffer.from('{}')}),/lane full/);
  const manifest=await original;assert.deepEqual(await store.operation('pixel-get',owner,{setHash:manifest.setHash}),manifest);assert.equal(store.busy(),false);
});
test('pixel sets share the bounded four-set quota, allow original reads and reject fifth imports without eviction',async t=>{
  const f=await fixture(t),owner=randomUUID(),prefix=`/v1/reference-drafts/${owner}`,sets=[];
  for(let i=0;i<4;i++){const r=await f.json(prefix+'/pixels',input('不同标注'+i));assert.equal(r.status,200,r.value.error);sets.push(r.value);}
  assert.equal((await f.json(prefix+'/pixels',input('第五套'))).status,400);
  assert.deepEqual((await f.json(prefix+'/pixels',input('不同标注0'))).value,sets[0]);
  assert.deepEqual((await f.json(prefix+'/sets/'+sets[0].setHash)).value,sets[0]);
  assert.deepEqual((await fs.readdir(path.join(f.dataDir,'reference-drafts',owner,'reference-sets'))).sort(),sets.map(m=>m.setHash).sort());assert.equal(f.calls(),0);
});
test('cross-owner/set/image and extra SEND paths cannot read other data or create a new task',async t=>{
  const f=await fixture(t),owner=randomUUID(),prefix=`/v1/reference-drafts/${owner}`,m=(await f.json(prefix+'/pixels',input())).value;
  for(const route of [`/v1/reference-drafts/${randomUUID()}/sets/${m.setHash}`,prefix+'/sets/'+'a'.repeat(64),prefix+'/sets/'+m.setHash+'/images/'+'b'.repeat(64),prefix+'/pixels/send',prefix+'/sets/'+m.setHash+'/confirm'])
    assert.notEqual((await f.json(route)).status,200);
  assert.equal((await f.json(prefix+'/pixels',{format:'ReferenceGenerationPreparationRequest',version:1,generation:{},upload:input().upload})).status,400);
  assert.deepEqual(await fs.readdir(path.join(f.dataDir,'jobs')),[]);assert.equal(f.calls(),0);
});
test('corrupted stored image is preserved and fails the manifest and exact pixel reader with no replacement',async t=>{
  const f=await fixture(t),owner=randomUUID(),prefix=`/v1/reference-drafts/${owner}`,m=(await f.json(prefix+'/pixels',input())).value;
  const file=path.join(f.dataDir,'reference-drafts',owner,'reference-sets',m.setHash,'image-0.png'),changed=Buffer.from(png);changed[changed.length-1]^=1;await fs.writeFile(file,changed);
  for(const route of [prefix+'/sets/'+m.setHash,prefix+'/sets/'+m.setHash+'/images/'+m.references[0].id])assert.equal((await f.json(route)).status,400);
  assert.equal((await f.json(prefix+'/pixels',input())).status,400);assert.deepEqual(await fs.readFile(file),changed);assert.equal(f.calls(),0);assert.equal(f.discoveries(),0);
});
test('pure pixel drafts use the original explicit archive contract and never transfer generation confirmation',async t=>{
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'pixel-archive-'))),store=new ReferencePreparationStore({dataDir:dir}),owner=randomUUID();
  t.after(async()=>{await store.close();await fs.rm(dir,{recursive:true,force:true});});
  const m=await store.operation('pixel-prepare',owner,{input:Buffer.from(JSON.stringify(input()))}),snapshot=await store.operation('archive-snapshot',owner);
  assert.deepEqual(snapshot.preparationHashes,[]);assert.deepEqual(snapshot.setHashes,[m.setHash]);assert.equal(snapshot.additionalModelCalls,0);
  const confirmation={format:'ReferenceDraftArchiveConfirmation',version:1,action:'archive-reference-draft',actionId:randomUUID(),ownerId:owner,snapshotHash:snapshot.snapshotHash,accepted:true};
  await store.operation('archive-confirm',owner,{input:Buffer.from(JSON.stringify(confirmation))});
  await assert.rejects(store.operation('pixel-prepare',owner,{input:Buffer.from(JSON.stringify(input('不会复活归档')))}));
  assert.equal((await store.operation('archive-list',null)).drafts.length,0);
});
