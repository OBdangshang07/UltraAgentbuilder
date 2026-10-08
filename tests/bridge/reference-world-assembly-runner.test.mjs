import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {jointResourceFixture} from './joint-assembly-resource-fixture.mjs';
import {createReferenceWorldAssemblyJobRegistry,referenceWorldAssemblyOriginalController} from '../../bridge/reference-world-assembly-job-registry.mjs';
import {readReferenceWorldAssemblyJobRecord} from '../../bridge/reference-world-assembly-job-data.mjs';
import {createReferenceWorldAssemblyRunner} from '../../bridge/reference-world-assembly-runner.mjs';
import {reserveReferenceWorldAssemblyExecution} from '../../bridge/reference-world-assembly-execution.mjs';
import {runReferenceWorldAssembly} from '../../bridge/reference-world-assembly.mjs';
import {hash} from '../../src/generation/compiler.mjs';

// Real controller/ledger/shared pipeline, authored synthetic pixels/responses.
// No paid provider, game, account, snapshot refresh or world writer.
async function fixture(t,options={}) {
  const h=await jointResourceFixture(t,options);
  const registry=await createReferenceWorldAssemblyJobRegistry({dataDir:h.f.dataDir,resources:h.resources});t.after(()=>registry.close());
  h.f.jobDirectory=path.join(registry.root,h.f.ownerId);
  const request={format:'ReferenceWorldAssemblyJobRequest',version:2,purpose:'reference-world-assembly',contextId:h.contextId,
    referenceOwnerId:h.f.ownerId,referenceSetHash:h.f.manifest.setHash,generation:h.f.generation,send:h.send};
  await registry.reserve({request,selectedCapability:h.input.selectedCapability});
  const original=await readReferenceWorldAssemblyJobRecord({dataDir:h.f.dataDir,id:h.f.ownerId});
  const executionOptions=await h.executionOptions({referenceInput:original.value.referenceInput});
  h.makeRunner=adapter=>{const runner=createReferenceWorldAssemblyRunner({registry,adapter:adapter??executionOptions.adapter,nativeEvidence:executionOptions.nativeEvidence});
    t.after(()=>runner.close());return runner;};
  return {...h,registry,executionOptions,request};
}
const load=async file=>JSON.parse(await fs.readFile(file,'utf8')).value;
async function verifySuccess(h,status) {
  let diagnostic;
  if(status.state!=='preview-ready') {
    try{diagnostic=(await load(path.join(h.f.jobDirectory,'assembly-journal','call-1.json'))).error;}catch{}
  }
  assert.equal(status.state,'preview-ready',JSON.stringify(diagnostic));assert.equal(status.automaticRetries,0);
  assert.equal(status.canAuthorizePlacement,false);assert.equal(status.serverBaselineVerified,false);
  assert.equal(status.providerReceiptsIndependentlyAudited,false);assert.equal(status.worldWrites,0);
  assert.equal(status.reservedCalls,h.calls.length);assert.equal(status.candidate.partIsApplyScope,false);
  assert.equal(JSON.stringify(status).includes(h.f.dataDir),false);assert.doesNotMatch(JSON.stringify(status),/referenceInput|ownerReference|\.png/);
  const metadata=await h.operation('metadata',{referenceInput:h.executionOptions.referenceInput,
    preparationHash:h.prepared.preparationHash,candidateHash:status.candidate.candidateHash});
  for(const file of ['_owner.json','request.json','original-dispatch.json','original-execution-start.json'])
    assert.equal(metadata.candidate.proofFiles.some(pin=>pin.path===file),true);
}

for(const tier of ['lite','pro','max','ultra'])test(tier+' ONE original start automatically completes same full native pipeline; duplicates never dispatch again',async t=>{
  const h=await fixture(t,{tier,images:2}),runner=h.makeRunner();
  const starting=await Promise.all(Array.from({length:3},()=>runner.start(h.f.ownerId)));
  starting.forEach(value=>assert.equal(value.id,h.f.ownerId));
  const final=await runner.wait(h.f.ownerId);await verifySuccess(h,final);
  assert.equal(h.calls.length,tier==='ultra'?17:8);assert.equal(runner.busy(),false);
  assert.deepEqual(await runner.start(h.f.ownerId),final);assert.deepEqual(runner.get(h.f.ownerId),final);
  assert.equal(h.calls.length,final.reservedCalls);
  const start=await load(path.join(h.f.jobDirectory,'original-execution-start.json'));
  assert.equal(start.lifetime,'original-started-task-full-budget');assert.equal(start.maximumCalls,{lite:8,pro:14,max:20,ultra:26}[tier]);
  assert.equal(start.createdAt<start.captureExpiresAt,true);assert.equal(start.firstCallIndex,1);
  if(tier==='ultra')assert.equal(final.candidate.partCount>1,true);
});

test('a live original Ultra task may cross capture START expiry and still finish all mandatory calls and native parts',async t=>{
  const h=await fixture(t,{tier:'ultra'}),original=h.executionOptions.adapter;
  const adapter={models:original.models,generate:async request=>{
    const response=await original.generate(request);
    if(h.calls.length===1)t.mock.timers.enable({apis:['Date'],now:h.prepared.recordExpiresAt+5000});
    return response;
  }};
  const runner=h.makeRunner(adapter);await runner.start(h.f.ownerId);const final=await runner.wait(h.f.ownerId);
  await verifySuccess(h,final);assert.equal(h.calls.length,17);assert.equal(final.maximumCalls,26);
  const start=await load(path.join(h.f.jobDirectory,'original-execution-start.json'));
  assert.equal(start.createdAt<start.captureExpiresAt,true);assert.equal(Date.now()>start.captureExpiresAt,true);
  assert.equal(start.preparationHash,h.prepared.preparationHash);
});

test('the old internal path still rejects later fresh calls after expiry; no global TTL removal or inherited lifetime',async t=>{
  const h=await fixture(t),original=h.executionOptions.adapter;
  const adapter={models:original.models,generate:async request=>{const response=await original.generate(request);
    if(h.calls.length===1)t.mock.timers.enable({apis:['Date'],now:h.prepared.recordExpiresAt+5000});return response;}};
  await assert.rejects(runReferenceWorldAssembly({...h.executionOptions,adapter}),/expired/);assert.equal(h.calls.length,1);
  await assert.rejects(fs.stat(path.join(h.f.jobDirectory,'original-execution-start.json')),{code:'ENOENT'});
});

test('expired capture cannot START a new original task, even with a previously issued private handoff',async t=>{
  const h=await fixture(t),{execution}=await reserveReferenceWorldAssemblyExecution(h.registry,h.f.ownerId);
  t.mock.timers.enable({apis:['Date'],now:h.prepared.recordExpiresAt+1});
  await assert.rejects(runReferenceWorldAssembly({...h.executionOptions,execution}),/expired/);assert.equal(h.calls.length,0);
  await assert.rejects(fs.stat(path.join(h.f.jobDirectory,'original-execution-start.json')),{code:'ENOENT'});
  await assert.rejects(reserveReferenceWorldAssemblyExecution(h.registry,h.f.ownerId),/no adoption or repeat/);
});

test('serialized/replaced registry, forged/copied token and reopened controller cannot acquire full task execution',async t=>{
  const h=await fixture(t);assert.throws(()=>referenceWorldAssemblyOriginalController({...h.registry}),/Actual original/);
  assert.throws(()=>createReferenceWorldAssemblyRunner({registry:{...h.registry},adapter:h.executionOptions.adapter,nativeEvidence:h.executionOptions.nativeEvidence}),/Actual original/);
  const {execution}=await reserveReferenceWorldAssemblyExecution(h.registry,h.f.ownerId);
  for(const fake of [{},structuredClone(execution),{purpose:'original-reference-world-assembly-execution',confirmed:true}])
    await assert.rejects(runReferenceWorldAssembly({...h.executionOptions,execution:fake}),/Exact live original execution/);
  const second=await createReferenceWorldAssemblyJobRegistry({dataDir:h.f.dataDir,resources:h.resources});t.after(()=>second.close());
  await assert.rejects(reserveReferenceWorldAssemblyExecution(second,h.f.ownerId),/owner absent|no adoption/);
  assert.equal(h.calls.length,0);
  await runReferenceWorldAssembly({...h.executionOptions,execution});assert.equal(h.calls.length,8);
  await assert.rejects(runReferenceWorldAssembly({...h.executionOptions,execution}),/Exact live original execution/);
  assert.equal(h.calls.length,8);
});

test('original task-start marker tampering stops further dispatch, never adopts a self-rehashed lifetime',async t=>{
  const h=await fixture(t),original=h.executionOptions.adapter;
  const adapter={models:original.models,generate:async request=>{const response=await original.generate(request);
    if(h.calls.length===1){const file=path.join(h.f.jobDirectory,'original-execution-start.json'),value=await load(file);
      const changed={...value,maximumCalls:26};await fs.writeFile(file,JSON.stringify({value:changed,sha256:hash(changed)}));}
    return response;}};
  const runner=h.makeRunner(adapter);await runner.start(h.f.ownerId);const failed=await runner.wait(h.f.ownerId);
  assert.equal(failed.state,'failed-needs-original-inspection');assert.equal(h.calls.length,1);
  assert.equal(failed.automaticRetries,0);assert.equal(failed.candidate,null);
  assert.deepEqual(await runner.start(h.f.ownerId),failed);assert.equal(h.calls.length,1);
});

test('complete ORIGINAL candidate pins task-start evidence; changed marker cannot be served as a transport part',async t=>{
  const h=await fixture(t),runner=h.makeRunner();await runner.start(h.f.ownerId);const result=await runner.wait(h.f.ownerId);await verifySuccess(h,result);
  const file=path.join(h.f.jobDirectory,'original-execution-start.json'),value=await load(file),changed={...value,requestHash:'a'.repeat(64)};
  await fs.writeFile(file,JSON.stringify({value:changed,sha256:hash(changed)}));
  await assert.rejects(h.operation('part',{referenceInput:h.executionOptions.referenceInput,preparationHash:h.prepared.preparationHash,
    candidateHash:result.candidate.candidateHash,partIndex:0}));assert.equal(h.calls.length,8);
});

test('unknown task identifiers cannot fill the original runner quota or acquire a model call',async t=>{
  const h=await fixture(t),runner=h.makeRunner();
  for(let i=0;i<12;i++)await assert.rejects(runner.start(`00000000-0000-0000-0000-${String(i).padStart(12,'0')}`),/owner absent/);
  assert.equal(runner.busy(),false);await runner.start(h.f.ownerId);await verifySuccess(h,await runner.wait(h.f.ownerId));
});

test('explicit cancel retires original execution and later duplicate start cannot repeat a pending call',async t=>{
  const h=await fixture(t),original=h.executionOptions.adapter;let announce;
  const waiting=new Promise(resolve=>{announce=resolve;});
  const adapter={models:original.models,generate:async request=>{await original.generate(request);announce();
    await new Promise((resolve,reject)=>{if(request.signal.aborted)reject(request.signal.reason);
      else request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true});});}};
  const runner=h.makeRunner(adapter);await runner.start(h.f.ownerId);await waiting;const stopped=await runner.cancel(h.f.ownerId);
  assert.equal(stopped.state,'cancelled-needs-original-inspection');assert.equal(h.calls.length,1);
  assert.equal(stopped.reservedCalls,1);assert.equal(stopped.automaticRetries,0);assert.equal(stopped.candidate,null);
  assert.deepEqual(await runner.start(h.f.ownerId),stopped);assert.equal(h.calls.length,1);assert.equal(runner.busy(),false);
});

test('close rejects new starts and does not publish or reissue an uncertain first handoff',async t=>{
  const h=await fixture(t),runner=h.makeRunner(),work=runner.start(h.f.ownerId),rejected=assert.rejects(work,/closed|abort/);
  await runner.close();await rejected;assert.equal(runner.busy(),false);
  await assert.rejects(runner.start(h.f.ownerId),/closed/);assert.equal(h.calls.length,0);
});
