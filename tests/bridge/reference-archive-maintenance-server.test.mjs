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
import {referenceArchiveMaintenanceOperation} from '../../bridge/reference-archive-maintenance.mjs';

async function tree(root){const files=[];
  async function walk(relative=''){for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
    const name=relative?relative+'/'+entry.name:entry.name;if(entry.isDirectory())await walk(name);
    else files.push({path:name,sha256:hash(await fs.readFile(path.join(root,name)))});
  }}await walk();return files.sort((a,b)=>a.path.localeCompare(b.path));
}
async function fixture(t){
  const dataDir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reference-maintenance-api-')));let service,calls=0,discovery=0;
  const adapter={close(){},async models(){discovery++;return [{id:'gpt-6.1-sol',supportsImages:true}];},async generate(){calls++;throw Error('Maintenance must not invoke models');}};
  const start=async()=>{service=await startBridge({dataDir,adapter,claudeAdapter:adapter,deepseekAdapter:adapter});};await start();
  t.after(async()=>{await service.close();await fs.rm(dataDir,{recursive:true,force:true});});
  const base=()=>`http://127.0.0.1:${service.connection.port}`,headers=()=>({Authorization:'Bearer '+service.connection.token,'Content-Type':'application/json'});
  const fetcher=(route,input,extra={})=>fetch(base()+route,{method:input===undefined?'GET':'POST',headers:headers(),body:input===undefined?undefined:JSON.stringify(input),...extra});
  const json=async(route,input,extra)=>{const r=await fetcher(route,input,extra);return {status:r.status,value:await r.json()};};
  const ownerId=randomUUID(),prefix='/v1/reference-drafts/'+ownerId;
  const request={format:'ReferenceGenerationPreparationRequest',version:2,generation:{key:ownerId,prompt:'纯离线参考图测试',agent:'codex',model:'gpt-6.1-sol',effort:'max',
    generationMode:'scene',sceneWorkflow:'components',qualityTier:'lite',assemblyConfirmed:true,assemblyRecovery:'safe'},
    upload:{format:'UserReferenceUpload',version:1,mode:'inspire',references:[{png:encodeReferencePixels(2,1,Buffer.from([1,2,3,255,4,5,6,255])).toString('base64'),
      annotation:{purpose:'style',view:'unknown',caption:'纯离线已知像素'}}]}};
  const preparation=await json(prefix+'/prepare',request);assert.equal(preparation.status,200,preparation.value.error);
  const snapshot=await json(prefix+'/archive');assert.equal(snapshot.status,200,snapshot.value.error);
  const archiveConsent={format:'ReferenceDraftArchiveConfirmation',version:1,action:'archive-reference-draft',actionId:randomUUID(),ownerId,snapshotHash:snapshot.value.snapshotHash,accepted:true};
  const archiveReceipt=await json(prefix+'/archive',archiveConsent);assert.equal(archiveReceipt.status,200,archiveReceipt.value.error);
  const root=path.join(dataDir,'reference-archives',archiveConsent.actionId),target=path.join(root,ownerId),source=path.join(dataDir,'reference-drafts',ownerId);
  const route=purpose=>prefix+'/archive/'+archiveConsent.actionId+'/'+purpose;
  const consent=(s,actionId=randomUUID())=>({format:'ReferenceArchiveMaintenanceConfirmation',version:1,
    action:s.purpose==='purge'?'permanently-purge-archived-reference':'restore-archived-reference',actionId,archiveActionId:s.archiveActionId,ownerId:s.ownerId,
    snapshotHash:s.snapshotHash,accepted:true,...(s.purpose==='purge'?{permanentDeletionAccepted:true,retainedCopiesAcknowledged:true}:{})});
  const direct=(c,hooks)=>referenceArchiveMaintenanceOperation({dataDir,ownerId,archiveActionId:archiveConsent.actionId,
    operation:c.action.startsWith('permanently')?'archive-purge-confirm':'archive-restore-confirm',input:Buffer.from(JSON.stringify(c))},hooks);
  return {dataDir,ownerId,prefix,preparation:preparation.value,archiveConsent,archiveReceipt:archiveReceipt.value,root,target,source,route,consent,direct,
    base,headers,fetcher,json,start,service:()=>service,calls:()=>calls,discovery:()=>discovery};
}

test('HTTP maintenance snapshots require exact pairing/loopback and remain read-only without discovery',async t=>{
  const f=await fixture(t),before=await tree(f.dataDir),discovery=f.discovery();
  for(const purpose of ['restore','purge']){
    const route=f.route(purpose);assert.equal((await f.fetcher(route,undefined,{headers:{}})).status,401);
    assert.equal((await f.fetcher(route,undefined,{headers:{...f.headers(),Origin:'https://example.com'}})).status,403);
    const wrongHost=await new Promise((resolve,reject)=>{const req=http.request(f.base()+route,{agent:false,headers:{...f.headers(),Host:'localhost'}},res=>{
      res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});assert.equal(wrongHost,403);
    const result=await f.json(route);assert.equal(result.status,200,result.value.error);assert.equal(result.value.purpose,purpose);
    assert.equal(result.value.retainsJobOriginals,true);assert.equal(result.value.restoresGenerationAuthority,false);
    assert.equal(result.value.worldWrites,0);assert.equal(result.value.additionalModelCalls,0);
  }
  assert.deepEqual(await tree(f.dataDir),before);assert.equal(f.discovery(),discovery);assert.equal(f.calls(),0);
});
test('HTTP restore and purge survive restart and old archive POST never repeats the move',async t=>{
  for(const purpose of ['restore','purge']){
    const f=await fixture(t),bytes=await tree(f.target),snapshot=await f.json(f.route(purpose)),c=f.consent(snapshot.value);
    const result=await f.json(f.route(purpose),c);assert.equal(result.status,200,result.value.error);assert.equal(result.value.state,purpose==='restore'?'restored':'purged');
    const original=await tree(f.root);await f.service().close();await f.start();
    assert.deepEqual((await f.json(f.route(purpose)+'/'+c.actionId)).value,result.value);
    assert.deepEqual((await f.json(f.route(purpose),c)).value,result.value);
    assert.deepEqual((await f.json(f.prefix+'/archive',f.archiveConsent)).value,f.archiveReceipt);
    const current=await f.json(f.prefix+'/archive/'+f.archiveConsent.actionId);assert.equal(current.status,200,current.value.error);
    assert.equal(current.value.state,result.value.state);assert.deepEqual(current.value.originalArchiveReceipt,f.archiveReceipt);
    assert.deepEqual(await tree(f.root),original);
    if(purpose==='restore')assert.deepEqual(await tree(f.source),bytes);else await assert.rejects(fs.stat(f.source),e=>e.code==='ENOENT');
    assert.equal((await f.json('/v1/jobs')).value.jobs.length,0);assert.equal(f.calls(),0);
  }
});
test('HTTP resumes only original maintenance after move/unlink/final-rmdir reply loss and never mutates on GET',async t=>{
  for(const phase of ['move','unlink','rmdir']){
    const f=await fixture(t),purpose=phase==='move'?'restore':'purge',s=await f.json(f.route(purpose)),c=f.consent(s.value);
    await f.service().close();let operations=0;
    const hooks=phase==='move'?{async rename(a,b){operations++;await fs.rename(a,b);throw Error('Lost original move reply');}}:
      phase==='unlink'?{async unlink(file){operations++;await fs.unlink(file);throw Error('Lost original unlink reply');}}:
      {async rmdir(folder){operations++;await fs.rmdir(folder);if(folder===f.target)throw Error('Lost original final rmdir reply');}};
    await assert.rejects(f.direct(c,hooks),/Lost original/);const count=operations;await f.start();
    const before=await tree(f.dataDir),status=await f.json(f.route(purpose)+'/'+c.actionId);
    assert.equal(status.status,200,status.value.error);assert.equal(status.value.resumeSameAction,true);
    assert.deepEqual(await tree(f.dataDir),before);assert.equal(operations,count);
    assert.equal((await f.json(f.route(purpose),f.consent(s.value))).status,400);
    const resumed=await f.json(f.route(purpose),c);assert.equal(resumed.status,200,resumed.value.error);assert.equal(resumed.value.state,purpose==='restore'?'restored':'purged');
    if(phase==='unlink'){
      const receipt=JSON.parse(await fs.readFile(path.join(f.root,'maintenance',c.actionId,'file-0.json')));assert.equal(receipt.disposition,'absent-after-intent');
    }
    assert.equal(f.calls(),0);
  }
});
test('HTTP maintenance rejects malformed, changed consent, cross-owner and broad methods with all archived bytes retained',async t=>{
  const f=await fixture(t),s=(await f.json(f.route('purge'))).value,c=f.consent(s),before=await tree(f.dataDir);
  for(const purpose of ['restore','purge']){
    assert.equal((await f.fetcher(f.route(purpose),undefined,{method:'DELETE'})).status,405);
    assert.equal((await f.json(f.route(purpose)+'/'+c.actionId,{})).status,405);
    assert.equal((await f.json(f.route(purpose),{}, {body:Buffer.from([255])})).status,400);
  }
  for(const change of [{accepted:false},{permanentDeletionAccepted:false},{retainedCopiesAcknowledged:false},{path:'C:/private'},
    {ownerId:randomUUID()},{archiveActionId:randomUUID()},{snapshotHash:'b'.repeat(64)}])assert.equal((await f.json(f.route('purge'),{...c,...change})).status,400);
  assert.equal((await f.json(f.route('restore'),c)).status,400);
  assert.equal((await f.json(`/v1/reference-drafts/${randomUUID()}/archive/${f.archiveConsent.actionId}/purge`,c)).status,400);
  assert.equal((await f.json(f.prefix+'/archive/'+randomUUID()+'/purge',c)).status,400);
  assert.deepEqual(await tree(f.dataDir),before);assert.equal(f.calls(),0);
});
test('HTTP oversized maintenance body rejects before discovery or durable intent creation',async t=>{
  const f=await fixture(t),before=await tree(f.dataDir),discovery=f.discovery();
  for(const purpose of ['restore','purge']){
    // Deliberately incomplete/rejected bodies must not lend their closing
    // sockets to the next independent test request through Node's global agent.
    const status=await new Promise((resolve,reject)=>{const req=http.request(f.base()+f.route(purpose),{agent:false,method:'POST',headers:{...f.headers(),'Content-Length':4097}},res=>{
      res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end('{}');});assert.equal(status,413);
  }
  assert.deepEqual(await tree(f.dataDir),before);assert.equal(f.discovery(),discovery);assert.equal(f.calls(),0);
});
test('HTTP partial maintenance body excludes upload/SEND/config lanes and disconnect preserves source',async t=>{
  const f=await fixture(t),s=(await f.json(f.route('purge'))).value,c=f.consent(s),body=JSON.stringify(c),before=await tree(f.dataDir),discovery=f.discovery();
  // Synchronize the actual inbound POST headers first. Starting a GET probe
  // before this handshake would itself occupy the lane and reject our POST,
  // testing the inverse race rather than an interrupted upload.
  let entered,failed;const headersAccepted=new Promise((resolve,reject)=>{entered=resolve;failed=reject;});
  const req=http.request(f.base()+f.route('purge'),{agent:false,method:'POST',headers:{...f.headers(),Expect:'100-continue','Content-Length':Buffer.byteLength(body)}},res=>{
    res.resume();failed(Error('Partial POST ended before the deliberate disconnect: '+res.statusCode));});
  req.on('error',failed);req.once('continue',()=>{req.write(body.slice(0,5));entered();});req.flushHeaders();
  let busy;
  try{
    await headersAccepted;
    for(let i=0;i<100;i++){busy=await f.json(f.route('restore'));if(busy.status===429)break;await new Promise(resolve=>setTimeout(resolve,5));}
    assert.equal(busy.status,429);
    assert.equal((await f.json(f.prefix+'/prepare',{})).status,429);
    assert.equal((await f.json('/v1/reference-drafts')).status,429);
    assert.equal((await f.json('/v1/config/codex-path',{codexPath:''})).status,409);
  }finally{req.destroy();}
  let released;
  for(let i=0;i<100;i++){released=await f.json(f.route('purge'));if(released.status!==429)break;await new Promise(resolve=>setTimeout(resolve,5));}
  assert.equal(released.status,200,released.value.error);assert.deepEqual(await tree(f.dataDir),before);
  assert.equal(f.discovery(),discovery);assert.equal(f.calls(),0);
});
test('HTTP changed survivors after interrupted purge stop recovery and remain byte-identical on GET or POST',async t=>{
  const f=await fixture(t),s=(await f.json(f.route('purge'))).value,c=f.consent(s);await f.service().close();
  await assert.rejects(f.direct(c,{unlink(){throw Error('Pause before first delete');}}),/Pause/);
  const survivor=path.join(f.target,s.inventory.files[0].path);await fs.writeFile(survivor,'later local edit');await f.start();
  const before=await tree(f.dataDir);assert.equal((await f.json(f.route('purge')+'/'+c.actionId)).status,400);
  assert.equal((await f.json(f.route('purge'),c)).status,400);assert.deepEqual(await tree(f.dataDir),before);assert.equal(f.calls(),0);
});
test('HTTP original archive record is authenticated read-only history and survives restart/maintenance',async t=>{
  for(const purpose of ['restore','purge']){
    const f=await fixture(t),route=f.prefix+'/archive/'+f.archiveConsent.actionId+'/record',before=await tree(f.dataDir),discovery=f.discovery();
    assert.equal((await f.fetcher(route,undefined,{headers:{}})).status,401);
    assert.equal((await f.fetcher(route,undefined,{headers:{...f.headers(),Origin:'https://example.com'}})).status,403);
    for(const method of ['POST','DELETE','PUT'])assert.equal((await f.fetcher(route,{}, {method})).status,405);
    const wrongHost=await new Promise((resolve,reject)=>{const req=http.request(f.base()+route,{agent:false,headers:{...f.headers(),Host:'localhost'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});assert.equal(wrongHost,403);
    const original=await f.json(route);assert.equal(original.status,200,original.value.error);
    const {recordHash,...content}=original.value;assert.equal(hash(content),recordHash);assert.equal(original.value.maintenance,null);
    assert.deepEqual(original.value.originalIntent.confirmation,f.archiveConsent);assert.deepEqual(original.value.status,f.archiveReceipt);
    assert.deepEqual(await tree(f.dataDir),before);assert.equal(f.discovery(),discovery);
    const s=await f.json(f.route(purpose)),c=f.consent(s.value),completed=await f.json(f.route(purpose),c);assert.equal(completed.status,200,completed.value.error);
    await f.service().close();await f.start();const after=await tree(f.dataDir),record=await f.json(route);assert.equal(record.status,200,record.value.error);
    assert.deepEqual(record.value.originalIntent,original.value.originalIntent);assert.deepEqual(record.value.maintenance.intent.confirmation,c);
    assert.deepEqual(record.value.maintenance.status,completed.value);assert.deepEqual(record.value.status.maintenance,completed.value);
    assert.deepEqual(await tree(f.dataDir),after);assert.equal(f.calls(),0);assert.equal((await f.json('/v1/jobs')).value.jobs.length,0);
    assert.equal((await f.json(`/v1/reference-drafts/${randomUUID()}/archive/${f.archiveConsent.actionId}/record`)).status,400);
    assert.equal((await f.json(f.prefix+'/archive/'+randomUUID()+'/record')).status,400);
  }
});
