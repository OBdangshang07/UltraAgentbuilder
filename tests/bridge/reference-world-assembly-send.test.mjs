import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {startBridge} from '../../bridge/server.mjs';
import {jointResourceFixture} from './joint-assembly-resource-fixture.mjs';
import {readReferenceWorldAssemblyJobRecord} from '../../bridge/reference-world-assembly-job-data.mjs';
import {REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY} from '../../bridge/reference-world-assembly-candidate.mjs';
import {NATIVE_RENDERER} from '../../bridge/native-evidence.mjs';
import {fixtureUpload,fixturePng} from './native-evidence-fixtures.mjs';
import {hash} from '../../src/generation/compiler.mjs';

// Real paired HTTP, registry, ledger, shared pipeline and original native
// transport. Provider answers and transparent PNG pixels are SYNTHETIC: these
// tests prove no architectural quality, real image understanding or game writes.
const prefix='/v1/reference-world-assembly';
async function fixture(t,{tier='lite',sending=true,afterGenerate}={}) {
  const h=await jointResourceFixture(t,{tier,images:tier==='lite'?1:4});
  h.f.jobDirectory=path.join(h.resources.root,h.f.ownerId);
  let app,implementation,queries=0,supportsImages=true,efforts=['high','max'];
  const adapter={models:async()=>{queries++;return [{id:h.f.generation.model,supportsImages,efforts}];},
    generate:async request=>{
      if(!implementation){const original=await readReferenceWorldAssemblyJobRecord({dataDir:h.f.dataDir,id:h.f.ownerId});
        implementation=(await h.executionOptions({referenceInput:original.value.referenceInput})).adapter;}
      const result=await implementation.generate(request);
      await afterGenerate?.(request,h.calls.length);return result;
    },close(){}};
  const reopen=async(enabled=sending)=>{app=await startBridge({dataDir:h.f.dataDir,adapter,
    referenceWorldAssemblySending:enabled,referenceWorldPatchSending:true});};
  await reopen();t.after(()=>app.close());
  const request=async(route,{method='GET',value,bytes,headers={},loseAck=false}={})=>{
    const payload=value!==undefined||bytes?bytes??Buffer.from(JSON.stringify(value)):null;
    return new Promise((resolve,reject)=>{
      const req=http.request({hostname:'127.0.0.1',port:app.connection.port,path:route,method,
        headers:{Authorization:`Bearer ${app.connection.token}`,...(payload?{'Content-Type':'application/json; charset=utf-8','Content-Length':payload.length}:{}),...headers}},res=>{
        if(loseAck){resolve({status:res.statusCode});res.destroy();return;}
        const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);
        res.on('end',()=>{try{const bytes=Buffer.concat(chunks),json=/application\/json/.test(res.headers['content-type']??'');
          resolve({status:res.statusCode,headers:new Headers(res.headers),bytes,value:json?JSON.parse(bytes):null});}catch(error){reject(error);}});
      });req.on('error',reject);req.end(payload);
    });
  };
  const body={format:'ReferenceWorldAssemblyJobRequest',version:2,purpose:'reference-world-assembly',contextId:h.contextId,
    referenceOwnerId:h.f.ownerId,referenceSetHash:h.f.manifest.setHash,generation:h.f.generation,send:h.send};
  const job=prefix+'/jobs/'+h.f.ownerId;
  const heartbeat=()=>request('/v1/renderers/heartbeat',{method:'POST',value:{renderer:NATIVE_RENDERER,assetOnly:true}});
  const status=async()=>{const result=await request(job);assert.equal(result.status,200,result.value?.error);return result.value;};
  const nativeRoute=id=>job+'/native-evidence/'+id;
  async function native(id) {
    const route=nativeRoute(id),result=await request(route+'/request');assert.equal(result.status,200,result.value?.error);
    const requestData=result.value,manifest=await request(route+'/manifest'),cells=await request(route+'/cells');
    assert.equal(manifest.status,200,manifest.value?.error);assert.equal(cells.status,200,cells.value?.error);
    assert.equal(cells.headers.get('content-type'),'application/octet-stream');
    assert.equal(hash(cells.bytes),requestData.cellsHash);assert.equal(manifest.value.assetHash,requestData.assetHash);
    assert.deepEqual(manifest.value.dimensions,requestData.dimensions);
    assert.equal(cells.bytes.length,requestData.dimensions.width*requestData.dimensions.height*requestData.dimensions.length*2);
    assert.equal(requestData.requestHash,id);assert.equal(requestData.canAuthorizePlacement,false);return requestData;
  }
  async function until(predicate,{render=false}={}) {
    const deadline=Date.now()+180000,uploaded=new Set();
    while(Date.now()<deadline){await heartbeat();const current=await status();if(predicate(current))return current;
      if(render&&current.nativeEvidence?.state==='waiting'&&!uploaded.has(current.nativeEvidence.id)){
        const data=await native(current.nativeEvidence.id),accepted=await request(nativeRoute(data.requestHash)+'/upload',
          {method:'POST',value:fixtureUpload(data)});
        assert.equal(accepted.status,200,accepted.value?.error);assert.equal(accepted.value.accepted,true);
        assert.equal(accepted.value.canAuthorizePlacement,false);uploaded.add(data.requestHash);
      }
      if(current.state!=='running'&&current.state!=='starting')assert.fail('Original joint task stopped: '+JSON.stringify(current));
      await delay(50);
    }
    assert.fail('Original synthetic joint task did not reach its expected state');
  }
  return {...h,request,body,job,heartbeat,status,native,nativeRoute,until,reopen,close:()=>app.close(),
    queries:()=>queries,setImages:value=>{supportsImages=value;},setEfforts:value=>{efforts=value;},
    async incompleteBody(){const bytes=Buffer.from(JSON.stringify(body));await new Promise(resolve=>{
      const req=http.request({hostname:'127.0.0.1',port:app.connection.port,path:prefix+'/jobs',method:'POST',
        headers:{Authorization:`Bearer ${app.connection.token}`,'Content-Type':'application/json','Content-Length':bytes.length}},()=>{});
      req.on('error',()=>resolve());req.write(bytes.subarray(0,bytes.length-5));setTimeout(()=>{req.destroy();resolve();},30);
    });}
  };
}

for(const tier of ['lite','pro','max','ultra'])test(tier+' one paired full SEND runs automatically through actual native HTTP and all complete differences',async t=>{
  const h=await fixture(t,{tier});await h.heartbeat();
  const cap=(await h.request(prefix+'/capabilities')).value;
  assert.equal(cap.sendingImplemented,true);assert.equal(cap.sendingEnabled,true);assert.equal(cap.sharedFullPipeline,true);
  assert.equal(cap.nativeTransportImplemented,true);assert.equal(cap.playerUiImplemented,false);assert.equal(cap.placementImplemented,false);
  const starts=await Promise.all([h.request(prefix+'/jobs',{method:'POST',value:h.body}),h.request(prefix+'/jobs',{method:'POST',value:h.body})]);
  assert.deepEqual(starts.map(v=>v.status).sort((a,b)=>a-b),[202,429]);
  const final=await h.until(v=>v.state==='preview-ready',{render:true});assert.equal(final.reservedCalls,tier==='ultra'?17:8);
  assert.equal(h.calls.length,final.reservedCalls);assert.equal(final.maximumCalls,{lite:8,pro:14,max:20,ultra:26}[tier]);
  assert.equal(final.canAuthorizePlacement,false);assert.equal(final.candidate.partIsApplyScope,false);
  assert.equal(final.providerReceiptsIndependentlyAudited,false);assert.equal(final.worldWrites,0);
  const calls=h.calls.length,queries=h.queries(),duplicate=await h.request(prefix+'/jobs',{method:'POST',value:h.body});
  assert.equal(duplicate.status,200);assert.deepEqual(duplicate.value,final);assert.equal(h.queries(),queries);assert.equal(h.calls.length,calls);
  const changed=await h.request(prefix+'/jobs',{method:'POST',value:{...h.body,contextId:randomUUID()}});
  assert.equal(changed.status,409);
  const download='?candidateHash='+final.candidate.candidateHash,metadata=await h.request(h.job+'/candidate'+download);
  assert.equal(metadata.status,200,metadata.value?.error);assert.equal(metadata.value.originalCompleteSetReverified,true);
  assert.equal(metadata.value.candidate.snapshotHash,h.saved.record.snapshotHash);
  assert.deepEqual(metadata.value.candidate.origin,h.selection.edit.min);assert.equal(metadata.value.candidate.movable,false);
  let operations=0;
  for(let index=0;index<final.candidate.partCount;index++){
    const part=await h.request(h.job+'/parts/'+index+download);assert.equal(part.status,200,part.value?.error);
    assert.equal(part.value.candidateHash,final.candidate.candidateHash);assert.equal(part.value.completeSetVerified,true);
    assert.equal(part.value.partIsApplyScope,false);assert.equal(part.value.canAuthorizePlacement,false);
    assert.equal(part.value.patch.snapshotHash,h.saved.record.snapshotHash);operations+=part.value.patch.writes.length;
  }
  assert.equal(operations,final.candidate.operationCount);if(tier==='ultra')assert.ok(final.candidate.partCount>1);
  assert.equal((await h.request(h.job+'/candidate')).status,400);
  assert.equal((await h.request(h.job+'/parts/999'+download)).status,409);
  assert.equal((await h.request(h.job+'/candidate?candidateHash='+'a'.repeat(64))).status,409);
  const history=await h.request(prefix+'/jobs');assert.equal(history.status,200,history.value?.error);
  assert.equal(history.value.jobs.length,1);assert.equal(history.value.jobs[0].state,'preview-ready');
  assert.doesNotMatch(JSON.stringify(final),/Bearer|referenceInput|ownerReference|\.png|[A-Z]:[\\/]/);
  await h.close();await h.reopen(false);const retained=await h.status();assert.equal(retained.state,'preview-ready');
  assert.equal(retained.canResume,false);assert.equal(retained.originalLiveExecutionOnly,false);
  assert.equal((await h.request(prefix+'/jobs')).value.jobs[0].candidate.candidateHash,final.candidate.candidateHash);
  assert.equal((await h.request(h.job+'/candidate'+download)).status,200);
  assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body})).status,409);
  assert.equal(h.calls.length,calls);assert.equal(h.queries(),queries);
  const root=path.join(h.f.jobDirectory,REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY);
  const names=await fs.readdir(root),other=names.find(name=>/^part-/.test(name));
  await fs.appendFile(path.join(root,other),' ');
  assert.equal((await h.request(h.job+'/candidate'+download)).status,409);
  assert.equal((await h.request(h.job+'/parts/0'+download)).status,409);
  assert.equal((await h.request(h.job)).status,409);assert.equal(h.calls.length,calls);
});

test('unknown history and default disabled SEND stay readable and dispatch no models',async t=>{
  const h=await fixture(t,{sending:false});
  assert.deepEqual((await h.request(prefix+'/jobs')).value.jobs,[]);
  for(let i=0;i<12;i++)assert.equal((await h.request(prefix+'/jobs/'+randomUUID())).status,404);
  assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body})).status,409);
  assert.equal(h.queries(),0);assert.equal(h.calls.length,0);
  await assert.rejects(fs.stat(h.resources.root),{code:'ENOENT'});
});

test('partial and unknown full-task history are retained as errors, not empty jobs to repair or evict',async t=>{
  const h=await fixture(t);await fs.mkdir(h.f.jobDirectory);
  const file=path.join(h.f.jobDirectory,'request.json'),bytes=Buffer.from('synthetic incomplete reservation');await fs.writeFile(file,bytes);
  assert.equal((await h.request(h.job)).status,409);
  assert.equal((await h.request(prefix+'/jobs')).status,409);
  await h.heartbeat();assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body})).status,409);
  assert.deepEqual(await fs.readFile(file),bytes);assert.equal(h.queries(),0);assert.equal(h.calls.length,0);
});

test('full SEND requires advertised images, exact effort, original renderer, v2 consent and paired privacy boundary',async t=>{
  const h=await fixture(t);
  assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body})).status,409);assert.equal(h.queries(),0);
  await h.heartbeat();h.setImages(false);assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body})).status,409);
  h.setImages(true);h.setEfforts(['high']);assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body})).status,409);
  h.setEfforts(['high','max']);const queries=h.queries();
  for(const key of ['directory','runtimeHash','selectedCapability','operation','canAuthorizePlacement'])
    assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:{...h.body,[key]:'unauthorized'}})).status,409);
  assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:{...h.body,version:1}})).status,409);
  for(const [headers,status]of [[{Authorization:'Bearer synthetic-invalid'},401],[{Origin:'https://invalid.example'},403],[{Host:'localhost'},403]])
    assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body,headers})).status,status);
  for(const [route,method,status]of [[prefix+'/jobs?enabled=true','POST',400],[h.job+'/send','POST',404],[h.job,'POST',405],
    [h.job+'/native-evidence/'+'a'.repeat(64)+'/upload','GET',405]])
    assert.equal((await h.request(route,{method,value:{}})).status,status);
  assert.equal((await h.request(prefix+'/jobs',{method:'POST',bytes:Buffer.from([123,34,255,34,58,49,125])})).status,400);
  assert.equal((await h.request(prefix+'/jobs',{method:'POST',bytes:Buffer.alloc(32769,32)})).status,413);
  assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body,headers:{'Content-Type':'text/plain'}})).status,400);
  await h.incompleteBody();await delay(100);
  assert.equal(h.queries(),queries);assert.equal(h.calls.length,0);assert.deepEqual((await h.request(prefix+'/jobs')).value.jobs,[]);
});

test('losing full SEND acknowledgement does not stop or resend the original; config and other writers stay fenced',async t=>{
  const h=await fixture(t);await h.heartbeat();assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body,loseAck:true})).status,202);
  const waiting=await h.until(v=>v.nativeEvidence?.state==='waiting');assert.equal(waiting.state,'running');
  assert.equal((await h.request('/v1/health')).status,200);assert.equal((await h.request(prefix+'/capabilities')).status,200);
  for(const route of ['/v1/config/codex',`/v1/reference-drafts/${h.f.ownerId}/pixels`,`/v1/world-contexts/${h.contextId}/discard`,
    '/v1/jobs','/v1/reference-generation-jobs','/v2/world-patch/send'])
    assert.equal((await h.request(route,{method:'POST',value:{}})).status,409,route);
  assert.equal((await h.request(`${prefix}/contexts/${h.contextId}/prepare`,{method:'POST',value:{}})).status,429);
  const before=h.calls.length;assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body})).status,200);
  assert.equal(h.calls.length,before);const final=await h.until(v=>v.state==='preview-ready',{render:true});assert.equal(final.reservedCalls,8);
});

test('native HTTP rejects unrelated uploads, changed pins, oversized input and hardlinked receipt members BEFORE commitment',async t=>{
  const h=await fixture(t);await h.heartbeat();assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body})).status,202);
  const waiting=await h.until(v=>v.nativeEvidence?.state==='waiting'),id=waiting.nativeEvidence.id,data=await h.native(id);
  const upload=fixtureUpload(data),route=h.nativeRoute(id)+'/upload',folder=path.join(h.f.jobDirectory,'native-evidence',id);
  for(const value of [{...upload,requestHash:'a'.repeat(64)},{...upload,directory:'unauthorized'},
    {...upload,views:upload.views.map((v,i)=>i? v:{...v,id:'wrong-camera'})}])
    assert.equal((await h.request(route,{method:'POST',value})).status,409);
  assert.equal((await h.request(route,{method:'POST',bytes:Buffer.alloc(12000001,32)})).status,413);
  assert.equal((await h.request(h.nativeRoute('a'.repeat(64))+'/upload',{method:'POST',value:upload})).status,409);
  const source=path.join(h.f.dataDir,'synthetic-hardlink.png'),linked=path.join(folder,'view-0.png');
  await fs.writeFile(source,Buffer.from(fixturePng(),'base64'));await fs.link(source,linked);
  assert.equal((await h.request(route,{method:'POST',value:upload})).status,409);
  await assert.rejects(fs.stat(path.join(folder,'evidence.json')),{code:'ENOENT'});
  await fs.unlink(linked);
  const cellsFile=path.join(folder,'cells.bin'),cells=await fs.readFile(cellsFile);await fs.appendFile(cellsFile,Buffer.from([1]));
  assert.equal((await h.request(h.nativeRoute(id)+'/cells')).status,409);
  assert.equal((await h.request(route,{method:'POST',value:upload})).status,409);await fs.writeFile(cellsFile,cells);
  const final=await h.until(v=>v.state==='preview-ready',{render:true});assert.equal(final.reservedCalls,8);
  assert.equal((await h.request(route,{method:'POST',value:upload})).status,409);assert.equal(h.calls.length,8);
});

test('explicit cancellation and Bridge close retain original pending calls; reopen only inspects and never adopts or resends',async t=>{
  for(const action of ['cancel','close']){
    let entered;const waiting=new Promise(resolve=>{entered=resolve;});
    const h=await fixture(t,{afterGenerate:async request=>{entered();await new Promise((resolve,reject)=>{
      if(request.signal.aborted)reject(request.signal.reason);else request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true});
    });}});
    await h.heartbeat();assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body})).status,202);await waiting;
    if(action==='cancel'){
      assert.equal((await h.request(h.job+'/cancel',{method:'POST',value:{confirmed:false}})).status,400);
      const stopped=await h.request(h.job+'/cancel',{method:'POST',value:{confirmed:true}});
      assert.equal(stopped.status,200,stopped.value?.error);assert.equal(stopped.value.status.state,'cancelled-needs-original-inspection');
      assert.equal((await h.request(prefix+'/jobs',{method:'POST',value:h.body})).status,200);
    }
    await h.close();await h.reopen();const retained=await h.status();assert.equal(retained.state,'unknown-needs-original-inspection');
    assert.equal(retained.pendingCalls,1);assert.equal(retained.canResume,false);assert.equal(retained.originalLiveExecutionOnly,false);
    const duplicate=await h.request(prefix+'/jobs',{method:'POST',value:h.body});assert.equal(duplicate.status,200);
    assert.equal(duplicate.value.canResume,false);assert.equal(h.calls.length,1);
    const history=await h.request(prefix+'/jobs');assert.equal(history.status,200,history.value?.error);
    assert.equal(history.value.jobs[0].pendingCalls,1);assert.equal(history.value.allowsNewModelCall,false);
    const journal=path.join(h.f.jobDirectory,'assembly-journal'),countFile=path.join(journal,'dispatched.json'),countBytes=await fs.readFile(countFile);
    await fs.writeFile(countFile,JSON.stringify({value:{count:2},sha256:hash({count:2})}));
    assert.equal((await h.request(h.job)).status,409);await fs.writeFile(countFile,countBytes);
    const extra={index:2,fingerprint:'a'.repeat(64),state:'response'},extraFile=path.join(journal,'call-2.json');
    await fs.writeFile(extraFile,JSON.stringify({value:extra,sha256:hash(extra)}));
    assert.equal((await h.request(h.job)).status,409);await fs.unlink(extraFile);assert.equal(h.calls.length,1);
    await h.close();
  }
});
