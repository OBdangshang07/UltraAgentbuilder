import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {startBridge} from '../../bridge/server.mjs';
import {coupledResourceFixture} from './coupled-assembly-resource-fixture.mjs';
import {readCoupledReferenceWorldAssemblyJobRecord} from '../../bridge/coupled-reference-world-assembly-job-data.mjs';
import {COUPLED_REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY} from '../../bridge/coupled-reference-world-assembly-candidate.mjs';
import {NATIVE_RENDERER} from '../../bridge/native-evidence.mjs';
import {fixtureUpload} from './native-evidence-fixtures.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {syntheticJointTaskWait} from './synthetic-joint-task-wait.mjs';

// REAL authenticated loopback, owner, complete task and resource workers.
// All provider answers, reference pixels and native render uploads SYNTHETIC.
// No real account, model charge, game, native lease or world mutation.
const prefix='/v1/coupled-reference-world-assembly',legacy='/v1/reference-world-assembly';
async function fixture(t,{tier='lite',sending=true,enabled=true,defaults=false,holdModels,afterGenerate}={}){
  const h=await coupledResourceFixture(t,{tier,images:tier==='ultra'?4:1});
  h.f.jobDirectory=path.join(h.resources.root,h.f.ownerId);
  let app,implementation,queries=0,supportsImages=true,efforts=['high','max'];
  const adapter={models:async()=>{queries++;await holdModels?.();return [{id:h.f.generation.model,supportsImages,efforts}];},
    generate:async request=>{
      if(!implementation){const original=await readCoupledReferenceWorldAssemblyJobRecord({dataDir:h.f.dataDir,id:h.f.ownerId});
        implementation=(await h.executionOptions({referenceInput:original.value.referenceInput})).adapter;}
      const result=await implementation.generate(request);await afterGenerate?.(request,h.calls.length);return result;
    },close(){}};
  const reopen=async(send=sending,prepare=enabled)=>{app=await startBridge({dataDir:h.f.dataDir,adapter,referenceWorldPatchSending:true,
    referenceWorldAssemblyPreparation:true,referenceWorldAssemblySending:true,
    ...(defaults?{}:{coupledReferenceWorldAssemblyPreparation:prepare,coupledReferenceWorldAssemblySending:send})});};
  await reopen();t.after(()=>app.close());
  function request(route,{method='GET',value,bytes,headers={},loseAck=false}={}){
    const payload=value!==undefined||bytes?bytes??Buffer.from(JSON.stringify(value)):null;
    return new Promise((resolve,reject)=>{
      const req=http.request({hostname:'127.0.0.1',port:app.connection.port,path:route,method,
        headers:{Authorization:`Bearer ${app.connection.token}`,...(payload?{'Content-Type':'application/json; charset=utf-8','Content-Length':payload.length}:{}),...headers}},res=>{
        if(loseAck){resolve({status:res.statusCode});res.destroy();return;}
        const chunks=[];res.on('data',part=>chunks.push(part));res.on('error',reject);res.on('end',()=>{try{
          const bytes=Buffer.concat(chunks),json=/application\/json/.test(res.headers['content-type']??'');
          resolve({status:res.statusCode,headers:new Headers(res.headers),bytes,value:json?JSON.parse(bytes):null});
        }catch(error){reject(error);}});
      });req.on('error',reject);req.end(payload);
    });
  }
  const body={format:'CoupledReferenceWorldAssemblyJobRequest',version:1,purpose:'coupled-reference-world-assembly',contextId:h.contextId,
    referenceOwnerId:h.f.ownerId,referenceSetHash:h.f.manifest.setHash,generation:h.f.generation,send:h.send};
  const job=prefix+'/jobs/'+h.f.ownerId,prepareRoute=prefix+'/contexts/'+h.contextId+'/prepare';
  const preparation={referenceOwnerId:h.f.ownerId,referenceSetHash:h.f.manifest.setHash,generation:h.f.generation};
  const heartbeat=()=>request('/v1/renderers/heartbeat',{method:'POST',value:{renderer:NATIVE_RENDERER,assetOnly:true}});
  async function status(){const response=await request(job);assert.equal(response.status,200,response.value?.error);return response.value;}
  async function native(id){
    const base=job+'/native-evidence/'+id,result=await request(base+'/request');assert.equal(result.status,200,result.value?.error);
    const data=result.value,manifest=await request(base+'/manifest'),cells=await request(base+'/cells');
    assert.equal(data.requestHash,id);assert.equal(data.canAuthorizePlacement,false);assert.equal(manifest.status,200,manifest.value?.error);
    assert.equal(cells.status,200,cells.value?.error);assert.equal(cells.headers.get('content-type'),'application/octet-stream');
    assert.equal(hash(cells.bytes),data.cellsHash);assert.equal(manifest.value.assetHash,data.assetHash);
    assert.deepEqual(manifest.value.dimensions,data.dimensions);assert.equal(cells.bytes.length,data.dimensions.width*data.dimensions.height*data.dimensions.length*2);
    return data;
  }
  async function until(predicate,{render=false}={}){
    const wait=syntheticJointTaskWait(),uploaded=new Set();let last=null,polls=0;
    while(!wait.expired()){
      await heartbeat();const current=await status();last=current;polls++;
      wait.observe(current,{syntheticCalls:h.calls.length,uploadedNativeRequests:uploaded.size});if(wait.expired())break;
      if(predicate(current))return current;
      if(render&&current.nativeEvidence?.state==='waiting'&&!uploaded.has(current.nativeEvidence.id)){
        const data=await native(current.nativeEvidence.id),accepted=await request(job+'/native-evidence/'+data.requestHash+'/upload',{method:'POST',value:fixtureUpload(data)});
        assert.equal(accepted.status,200,accepted.value?.error);assert.equal(accepted.value.accepted,true);assert.equal(accepted.value.canAuthorizePlacement,false);uploaded.add(data.requestHash);
      }
      if(!['running','starting'].includes(current.state))assert.fail('Original coupled task stopped: '+JSON.stringify(current));
      await delay(50);
    }
    assert.fail('Original synthetic coupled HTTP wait: '+JSON.stringify({...wait.snapshot(),polls,syntheticCalls:h.calls.length,last}));
  }
  async function incompleteBody(){const bytes=Buffer.from(JSON.stringify(body));await new Promise(resolve=>{
    const req=http.request({hostname:'127.0.0.1',port:app.connection.port,path:prefix+'/jobs',method:'POST',
      headers:{Authorization:`Bearer ${app.connection.token}`,'Content-Type':'application/json','Content-Length':bytes.length}},()=>{});
    req.on('error',()=>resolve());req.write(bytes.subarray(0,bytes.length-5));setTimeout(()=>{req.destroy();resolve();},30);
  });}
  return {...h,request,body,job,prepareRoute,preparation,heartbeat,status,native,until,incompleteBody,reopen,close:()=>app.close(),
    queries:()=>queries,setImages:value=>{supportsImages=value;},setEfforts:value=>{efforts=value;}};
}

test('independent coupled preparation has its own v1 consent and does not consume a legacy reservation',async t=>{
  const h=await fixture(t,{sending:false}),cap=await h.request(prefix+'/capabilities');assert.equal(cap.status,200);
  assert.equal(cap.value.format,'CoupledReferenceWorldAssemblyCapabilities');assert.equal(cap.value.version,1);assert.equal(cap.value.preparationEnabled,true);
  assert.equal(cap.value.sendingEnabled,false);assert.equal(cap.value.legacyConsentTransferable,false);assert.equal(cap.value.canAuthorizePlacement,false);
  for(let i=0;i<2;i++){const r=await h.request(h.prepareRoute,{method:'POST',value:h.preparation});assert.equal(r.status,200,r.value?.error);assert.deepEqual(r.value,h.prepared);}
  const old=await h.request(legacy+'/contexts/'+h.contextId+'/prepare',{method:'POST',value:h.preparation});
  assert.equal(old.status,200,old.value?.error);assert.equal(old.value.format,'ReferenceWorldAssemblyPreparation');assert.equal(old.value.version,2);
  assert.notEqual(old.value.preparationHash,h.prepared.preparationHash);assert.equal(h.calls.length,0);
  assert.deepEqual((await h.request(prefix+'/jobs')).value.jobs,[]);assert.deepEqual((await h.request(legacy+'/jobs')).value.jobs,[]);
  await assert.rejects(fs.stat(h.resources.root),{code:'ENOENT'});
});

test('new coupled process default remains disabled despite an enabled legacy service and supplied enable fields',async t=>{
  const h=await fixture(t,{sending:false,enabled:false,defaults:true}),cap=(await h.request(prefix+'/capabilities')).value;
  assert.equal(cap.preparationEnabled,false);assert.equal(cap.sendingEnabled,false);
  assert.equal((await h.request(legacy+'/capabilities')).value.sendingEnabled,true);
  assert.equal((await h.request(h.prepareRoute,{method:'POST',value:{...h.preparation,enabled:true}})).status,409);
  assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body})).status,409);
  assert.equal(h.calls.length,0);assert.equal(h.queries(),0);await assert.rejects(fs.stat(h.resources.root),{code:'ENOENT'});
});

test('new coupled HTTP enforces exact paired privacy, fatal UTF-8, quotas, methods and no legacy consent transfer',async t=>{
  const h=await fixture(t);
  assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body})).status,409);assert.equal(h.queries(),0);
  for(const [headers,status]of [[{Authorization:'Bearer synthetic-invalid'},401],[{Origin:'https://invalid.example'},403],[{Host:'localhost'},403]])
    assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body,headers})).status,status);
  for(const [route,method,status]of [[h.job,'POST',405],[h.job+'/send','POST',404],[prefix+'/jobs?enabled=true','POST',400],
    [prefix+'/capabilities','POST',405],[h.job+'/native-cells','GET',400],[h.job+'/parts/0?candidateHash='+'a'.repeat(64)+'&extra=1','GET',400]])
    assert.equal((await h.request(route,{method,...(method==='POST'?{value:{}}:{})})).status,status);
  assert.equal((await h.request(prefix+'/jobs',{method:'POST',bytes:Buffer.from([123,34,255,34,58,49,125])})).status,400);
  assert.equal((await h.request(prefix+'/jobs',{method:'POST',bytes:Buffer.alloc(32769,32)})).status,413);
  assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body,headers:{'Content-Type':'text/plain'}})).status,400);
  await h.incompleteBody();await delay(50);assert.equal(h.calls.length,0);assert.equal(h.queries(),0);
  await h.heartbeat();
  const old={...h.body,format:'ReferenceWorldAssemblyJobRequest',version:2,purpose:'reference-world-assembly',
    send:{...h.body.send,format:'ReferenceWorldAssemblySend',version:2,purpose:'reference-world-assembly'}};
  assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:old})).status,409);
  assert.equal((await h.request(legacy+'/jobs',{method:'POST',value:h.body})).status,409);
  for(const key of ['directory','runtimeHash','selectedCapability','operation','canAuthorizePlacement'])
    assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:{...h.body,[key]:'unauthorized'}})).status,409);
  h.setImages(false);assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body})).status,409);
  h.setImages(true);h.setEfforts(['high']);assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body})).status,409);
  assert.equal(h.calls.length,0);
});

for(const tier of ['lite','ultra'])test(tier+' new coupled HTTP completes one original task, native transport and every exact-file candidate member',{timeout:600000},async t=>{
  const h=await fixture(t,{tier});await h.heartbeat();
  const starts=await Promise.all([h.request(prefix+'/jobs',{method:'POST',value:h.body}),h.request(prefix+'/jobs',{method:'POST',value:h.body})]);
  assert.deepEqual(starts.map(v=>v.status).sort((a,b)=>a-b),[202,429]);
  const final=await h.until(v=>v.state==='preview-ready',{render:true});assert.equal(final.reservedCalls,tier==='ultra'?17:8);
  assert.equal(h.calls.length,final.reservedCalls);assert.equal(final.canAuthorizePlacement,false);assert.equal(final.worldWrites,0);
  assert.equal(final.candidate.partIsApplyScope,false);
  const calls=h.calls.length,queries=h.queries();assert.deepEqual((await h.request(prefix+'/jobs',{method:'POST',value:h.body})).value,final);
  assert.equal(h.queries(),queries);assert.equal(h.calls.length,calls);
  assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:{...h.body,contextId:randomUUID()}})).status,409);
  const query='?candidateHash='+final.candidate.candidateHash,metadata=await h.request(h.job+'/candidate'+query);
  assert.equal(metadata.status,200,metadata.value?.error);assert.equal(metadata.value.completeSetVerified,true);
  assert.equal(metadata.value.version,1);assert.equal(metadata.value.purpose,'coupled-reference-world-assembly');
  const c=metadata.value.candidate,folder=path.join(h.f.jobDirectory,COUPLED_REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY);
  assert.equal(c.pairCount,1);assert.equal(c.operationCount,final.candidate.operationCount);
  async function exact(file){
    assert.ok(file.encoding==='utf8'||file.encoding==='base64');const bytes=Buffer.from(file.data,file.encoding==='utf8'?'utf8':'base64');
    assert.equal(bytes.length,file.bytes);assert.equal(hash(bytes),file.sha256);assert.deepEqual(bytes,await fs.readFile(path.join(folder,file.path)));
    return bytes;
  }
  for(const f of metadata.value.files)await exact(f);
  assert.deepEqual(metadata.value.files.map(f=>f.path),['native-manifest.json','coupling-plan.json','patch-set.json','binding.json']);
  const cells=await h.request(h.job+'/native-cells'+query);assert.equal(cells.status,200,cells.value?.error);
  assert.equal(cells.value.file.path,'cells.bin');const bytes=await exact(cells.value.file);
  const manifest=JSON.parse(metadata.value.files.find(f=>f.path==='native-manifest.json').data);assert.equal(hash(bytes),manifest.cellsHash);
  for(let i=0;i<c.partCount;i++){
    const part=await h.request(h.job+'/parts/'+i+query);assert.equal(part.status,200,part.value?.error);
    assert.equal(part.value.index,i);assert.equal(part.value.partCount,c.partCount);assert.equal(part.value.completeSetVerified,true);
    assert.equal(part.value.partIsApplyScope,false);assert.equal(part.value.canAuthorizePlacement,false);
    for(const f of part.value.files)await exact(f);
  }
  if(tier==='ultra'){assert.equal(manifest.dimensions.height,224);assert.equal(c.partCount,7);}
  for(const suffix of ['/candidate','/native-cells'])assert.equal((await h.request(h.job+suffix)).status,400);
  assert.equal((await h.request(h.job+'/parts/999'+query)).status,409);
  assert.equal((await h.request(h.job+'/candidate?candidateHash='+'a'.repeat(64))).status,409);
  assert.doesNotMatch(JSON.stringify(final),/Bearer|referenceInput|ownerReference|\.png|[A-Z]:[\\/]/);
  await h.close();await h.reopen(false,false);const retained=await h.status();assert.equal(retained.state,'preview-ready');assert.equal(retained.canResume,false);
  assert.equal((await h.request(h.job+'/candidate'+query)).status,200);assert.equal((await h.request(h.job+'/native-cells'+query)).status,200);
  assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body})).status,409);assert.equal(h.calls.length,calls);
  const last=path.join(folder,'part-'+String(c.partCount-1).padStart(3,'0')+'.json'),original=await fs.readFile(last);await fs.appendFile(last,' ');
  for(const suffix of ['/candidate','/native-cells','/parts/0'])assert.equal((await h.request(h.job+suffix+query)).status,409);
  assert.equal((await h.request(h.job)).status,409);await fs.writeFile(last,original);
  assert.equal((await h.request(h.job+'/parts/0'+query)).status,200);assert.equal(h.calls.length,calls);assert.equal(h.queries(),queries);
  t.diagnostic(JSON.stringify({tier,syntheticCalls:calls,parts:c.partCount,operations:c.operationCount,actualModelCalls:0,gameLaunches:0,worldWrites:0}));
});

test('lost new coupled SEND acknowledgement keeps the original task running and fences every other mutation lane',async t=>{
  const h=await fixture(t);await h.heartbeat();assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body,loseAck:true})).status,202);
  await h.until(v=>v.nativeEvidence?.state==='waiting');assert.equal((await h.request('/v1/health')).status,200);
  for(const route of ['/v1/config/codex',`/v1/reference-drafts/${h.f.ownerId}/pixels`,`/v1/world-contexts/${h.contextId}/discard`,
    '/v1/jobs','/v1/reference-generation-jobs','/v2/world-patch/send'])assert.equal((await h.request(route,{method:'POST',value:{}})).status,409,route);
  for(const route of [legacy+'/contexts/'+h.contextId+'/prepare','/v1/reference-world-patch/contexts/'+h.contextId+'/disclosure'])
    assert.equal((await h.request(route,{method:'POST',value:{}})).status,429,route);
  assert.equal((await h.request(h.prepareRoute,{method:'POST',value:h.preparation})).status,429);
  const before=h.calls.length;assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body})).status,200);assert.equal(h.calls.length,before);
  const final=await h.until(v=>v.state==='preview-ready',{render:true});assert.equal(final.reservedCalls,8);assert.equal(h.calls.length,8);
});

test('new preparation discovery fences legacy writers and stays cancellable on close',async t=>{
  let entered,release;const started=new Promise(resolve=>{entered=resolve;}),hold=new Promise(resolve=>{release=resolve;});
  const h=await fixture(t,{sending:false,holdModels:async()=>{entered();await hold;}}),pending=h.request(h.prepareRoute,{method:'POST',value:h.preparation});await started;
  assert.equal((await h.request('/v1/health')).status,200);
  assert.equal((await h.request(legacy+'/contexts/'+h.contextId+'/prepare',{method:'POST',value:h.preparation})).status,429);
  assert.equal((await h.request('/v1/jobs',{method:'POST',value:{}})).status,409);
  await h.close();assert.equal((await pending).status,503);release();
  for(const name of ['connection.json','bridge.lock'])await assert.rejects(fs.stat(path.join(h.f.dataDir,name)),{code:'ENOENT'});
  await h.reopen();assert.equal((await h.request(h.prepareRoute,{method:'POST',value:h.preparation})).status,200);assert.equal(h.calls.length,0);
});

test('an original legacy preparation in flight also fences new coupled preparation and SEND',async t=>{
  let entered,release;const started=new Promise(resolve=>{entered=resolve;}),hold=new Promise(resolve=>{release=resolve;});
  const h=await fixture(t,{holdModels:async()=>{entered();await hold;}});
  const pending=h.request(legacy+'/contexts/'+h.contextId+'/prepare',{method:'POST',value:h.preparation});await started;
  assert.equal((await h.request(h.prepareRoute,{method:'POST',value:h.preparation})).status,429);
  assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body})).status,429);
  assert.equal((await h.request(prefix+'/capabilities')).status,200);assert.equal(h.queries(),1);assert.equal(h.calls.length,0);
  release();const result=await pending;assert.equal(result.status,200,result.value?.error);assert.equal(result.value.version,2);
});

test('new preparation discovery publishes only the fixed sanitized closed-query diagnostic',async t=>{
  const diagnostic={format:'WindowsOwnerQueryFailure',version:1,reason:'query-failed',phase:'boot-before',
    helperStarted:true,helperClosed:true,helperExitCode:1,helperExitSignal:null,spawnCode:null,ownershipRecovered:false,canAuthorizePlacement:false};
  const h=await fixture(t,{sending:false,holdModels:async()=>{throw Object.assign(Error('synthetic-private-discovery-stderr'),
    {code:'WINDOWS_OWNER_QUERY_FAILED',observationDiagnostic:diagnostic});}});
  const response=await h.request(h.prepareRoute,{method:'POST',value:h.preparation});assert.equal(response.status,409);
  assert.deepEqual(response.value.diagnostic,diagnostic);assert.doesNotMatch(JSON.stringify(response.value),/synthetic-private/);
  assert.equal(h.queries(),1);assert.equal(h.calls.length,0);assert.deepEqual((await h.request(prefix+'/jobs')).value.jobs,[]);
});

test('new coupled explicit cancellation and close preserve the original pending task without adoption or resend',async t=>{
  for(const action of ['cancel','close']){
    let entered;const started=new Promise(resolve=>{entered=resolve;});
    const h=await fixture(t,{afterGenerate:async request=>{entered();await new Promise((_,reject)=>{
      const abort=()=>reject(request.signal.reason);request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();
    });}});await h.heartbeat();assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body})).status,202);await started;
    if(action==='cancel'){
      assert.equal((await h.request(h.job+'/cancel',{method:'POST',value:{confirmed:false}})).status,400);
      const stopped=await h.request(h.job+'/cancel',{method:'POST',value:{confirmed:true}});assert.equal(stopped.status,200,stopped.value?.error);
      assert.equal(stopped.value.status.state,'cancelled-needs-original-inspection');assert.equal(stopped.value.unknownProviderOutcomeNotRepeated,true);
    }
    await h.close();await h.reopen();const retained=await h.status();assert.equal(retained.state,'unknown-needs-original-inspection');
    assert.equal(retained.pendingCalls,1);assert.equal(retained.canResume,false);assert.equal(retained.originalLiveExecutionOnly,false);
    assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body})).status,200);assert.equal(h.calls.length,1);
    assert.equal((await h.request(prefix+'/jobs')).value.jobs[0].pendingCalls,1);await h.close();
  }
});
