import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {coupledResourceFixture} from './coupled-assembly-resource-fixture.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {durableJson} from '../../bridge/assembly-durability.mjs';
import {writeJointInvocationEnvelope} from '../../bridge/reference-world-patch-invocation-data.mjs';
import {createCoupledReferenceWorldAssemblyJobRegistry,coupledReferenceWorldAssemblyOriginalController} from '../../bridge/coupled-reference-world-assembly-job-registry.mjs';
import {readCoupledReferenceWorldAssemblyJobRecord} from '../../bridge/coupled-reference-world-assembly-job-data.mjs';
import {reserveCoupledReferenceWorldAssemblyExecution,beginCoupledReferenceWorldAssemblyExecution,checkCoupledReferenceWorldAssemblyExecution,finishCoupledReferenceWorldAssemblyExecution} from '../../bridge/coupled-reference-world-assembly-execution.mjs';
import {createCoupledReferenceWorldAssemblyRunner} from '../../bridge/coupled-reference-world-assembly-runner.mjs';
import {runCoupledReferenceWorldAssembly} from '../../bridge/coupled-reference-world-assembly.mjs';
import {referenceWorldAssemblyOriginalController} from '../../bridge/reference-world-assembly-job-registry.mjs';
import {COUPLED_REFERENCE_ASSEMBLY_TERMINAL_FAILURE_FILE} from '../../bridge/coupled-reference-world-assembly-terminal-failure.mjs';

// REAL Windows process-owner observations and durable live owner, but SYNTHETIC
// pixels/provider/render data. No account, model charge, game or player world.
async function fixture(t,options={}){
  const cleanups=[],h=await coupledResourceFixture({after:fn=>cleanups.push(fn)},options);
  t.after(async()=>{for(const fn of cleanups.reverse())await fn();});
  h.open=async()=>{const registry=await createCoupledReferenceWorldAssemblyJobRegistry({dataDir:h.f.dataDir,resources:h.resources});cleanups.push(()=>registry.close());return registry;};
  h.registry=await h.open();h.f.jobDirectory=path.join(h.registry.root,h.f.ownerId);
  h.request={format:'CoupledReferenceWorldAssemblyJobRequest',version:1,purpose:'coupled-reference-world-assembly',contextId:h.contextId,
    referenceOwnerId:h.f.ownerId,referenceSetHash:h.f.manifest.setHash,generation:h.f.generation,send:h.send};
  h.submission=()=>({request:structuredClone(h.request),selectedCapability:structuredClone(h.input.selectedCapability)});
  h.bind=async()=>{await h.registry.reserve(h.submission());const original=await readCoupledReferenceWorldAssemblyJobRecord({dataDir:h.f.dataDir,id:h.f.ownerId});
    h.executionOptions=await h.executionOptions({referenceInput:original.value.referenceInput});return original;};
  h.makeRunner=adapter=>{const runner=createCoupledReferenceWorldAssemblyRunner({registry:h.registry,adapter:adapter??h.executionOptions.adapter,nativeEvidence:h.executionOptions.nativeEvidence});cleanups.push(()=>runner.close());return runner;};
  return h;
}
const load=async file=>JSON.parse(await fs.readFile(file)).value;

test('new registered coupled SEND freezes one original reservation and rejects legacy/serialized owner adoption',async t=>{
  const h=await fixture(t),input=h.submission(),first=h.registry.reserve(input),duplicates=[h.registry.reserve(h.submission()),h.registry.reserve(h.submission())];
  input.request.generation.prompt='caller mutation after submission';input.selectedCapability.supportsImages=false;
  const [value,...others]=await Promise.all([first,...duplicates]);others.forEach(v=>assert.deepEqual(v,value));assert.equal(value.version,1);assert.equal(value.callsReservedAtReservation,0);
  assert.equal(value.originalRunnerTicketConsumed,false);assert.equal(value.canAuthorizePlacement,false);assert.equal(h.calls.length,0);
  const record=await readCoupledReferenceWorldAssemblyJobRecord({dataDir:h.f.dataDir,id:h.f.ownerId});assert.deepEqual(record.value.request,h.request);assert.equal(record.value.ownerReference.observation.process.pid,process.pid);
  assert.throws(()=>referenceWorldAssemblyOriginalController(h.registry));assert.throws(()=>coupledReferenceWorldAssemblyOriginalController({...h.registry}));
  const reopened=await h.open();assert.deepEqual(await reopened.get(value.id),value);await assert.rejects(reopened.takeOriginalDispatch(value.id),/no adoption/);
  const claims=await Promise.allSettled([h.registry.takeOriginalDispatch(value.id),h.registry.takeOriginalDispatch(value.id)]);assert.equal(claims.filter(v=>v.status==='fulfilled').length,1);
  await assert.rejects(h.registry.takeOriginalDispatch(value.id),/no adoption|repeat/);assert.equal(h.calls.length,0);
  const again=await h.open();await assert.rejects(again.takeOriginalDispatch(value.id),/no adoption/);
});

test('registered coupled generation requires its one-use opaque execution, not a copied token or disk packet',async t=>{
  const h=await fixture(t);await h.bind();
  await assert.rejects(runCoupledReferenceWorldAssembly(h.executionOptions),/exact live original execution/);assert.equal(h.calls.length,0);
  const {execution,packet}=await reserveCoupledReferenceWorldAssemblyExecution(h.registry,h.f.ownerId),signal=new AbortController().signal;
  await assert.rejects(beginCoupledReferenceWorldAssemblyExecution({execution:{...execution},directory:packet.directory,prepared:packet.prepared,signal}),/Exact live original/);
  await beginCoupledReferenceWorldAssemblyExecution({execution,directory:packet.directory,prepared:packet.prepared,signal});
  await assert.rejects(beginCoupledReferenceWorldAssemblyExecution({execution,directory:packet.directory,prepared:packet.prepared,signal}),/one-use/);
  finishCoupledReferenceWorldAssemblyExecution(execution);await assert.rejects(checkCoupledReferenceWorldAssemblyExecution({execution,directory:packet.directory,prepared:packet.prepared,freshCall:false}),/Exact live original/);
  assert.equal(h.calls.length,0);
});

async function pending(h,p,index){
  const root=path.join(h.f.jobDirectory,'assembly-journal');if(index===1){await fs.mkdir(root);await writeJointInvocationEnvelope(path.join(root,'identity.json'),{version:1,requestHash:p.preparationHash,policyHash:p.policyHash,runtimeHash:p.runtimeHash,maximumCalls:p.maximumCalls});}
  await writeJointInvocationEnvelope(path.join(root,'call-'+index+'.json'),{index,state:'pending',fingerprint:hash('authored-coupled-pending-'+index)});
  const count={count:index};await durableJson(path.join(root,'dispatched.json'),{value:count,sha256:hash(count)});
}

test('original first-call start expires, but an already started same-owner full task is not cut off by capture wallclock',async t=>{
  const h=await fixture(t);await h.bind();const {execution,packet}=await reserveCoupledReferenceWorldAssemblyExecution(h.registry,h.f.ownerId),p=packet.prepared;
  const options={execution,directory:packet.directory,prepared:p,signal:new AbortController().signal};await beginCoupledReferenceWorldAssemblyExecution(options);
  await pending(h,p,1);await checkCoupledReferenceWorldAssemblyExecution({...options,freshCall:true,index:1});
  const start=await load(path.join(h.f.jobDirectory,'original-execution-start.json'));assert.equal(start.firstCallFingerprint,hash('authored-coupled-pending-1'));assert.ok(start.createdAt<start.captureExpiresAt);
  const first=await load(path.join(h.f.jobDirectory,'assembly-journal','call-1.json')),closed={...first,state:'response',response:{syntheticClosure:true}};
  await durableJson(path.join(h.f.jobDirectory,'assembly-journal','call-1.json'),{value:closed,sha256:hash(closed)});
  t.mock.timers.enable({apis:['Date'],now:p.recordExpiresAt+1});await pending(h,p,2);await checkCoupledReferenceWorldAssemblyExecution({...options,freshCall:true,index:2});
  await checkCoupledReferenceWorldAssemblyExecution({...options,freshCall:false});assert.deepEqual(await load(path.join(h.f.jobDirectory,'original-execution-start.json')),start);
  finishCoupledReferenceWorldAssemblyExecution(execution);assert.equal(h.calls.length,0);
});

test('capture expiry before first registered coupled call never writes a start or invokes a provider',async t=>{
  const h=await fixture(t);await h.bind();const {execution,packet}=await reserveCoupledReferenceWorldAssemblyExecution(h.registry,h.f.ownerId),p=packet.prepared;
  const options={execution,directory:packet.directory,prepared:p,signal:new AbortController().signal};await beginCoupledReferenceWorldAssemblyExecution(options);await pending(h,p,1);
  t.mock.timers.enable({apis:['Date'],now:p.recordExpiresAt+1});await assert.rejects(checkCoupledReferenceWorldAssemblyExecution({...options,freshCall:true,index:1}),/expired before ORIGINAL first call/);
  await assert.rejects(fs.lstat(path.join(h.f.jobDirectory,'original-execution-start.json')),{code:'ENOENT'});finishCoupledReferenceWorldAssemblyExecution(execution);assert.equal(h.calls.length,0);
});

for(const tier of ['lite','ultra'])test(tier+' live coupled owner completes the SAME full native task and bounded exact-file transport',{timeout:600000},async t=>{
  const h=await fixture(t,{tier,images:tier==='ultra'?4:1}),original=await h.bind(),runner=h.makeRunner();
  await Promise.all([runner.start(h.f.ownerId),runner.start(h.f.ownerId),runner.start(h.f.ownerId)]);
  const status=await runner.wait(h.f.ownerId);
  if(status.state!=='preview-ready'){try{t.diagnostic(JSON.stringify(await load(path.join(h.f.jobDirectory,COUPLED_REFERENCE_ASSEMBLY_TERMINAL_FAILURE_FILE))));}catch{}}
  assert.equal(status.state,'preview-ready');assert.equal(status.reservedCalls,h.calls.length);assert.equal(h.calls.length,tier==='ultra'?17:8);assert.equal(status.canAuthorizePlacement,false);assert.equal(status.worldWrites,0);
  assert.deepEqual(await runner.start(h.f.ownerId),status);assert.equal(h.calls.length,status.reservedCalls);assert.equal(runner.busy(),false);
  const query={referenceInput:original.value.referenceInput,preparationHash:h.prepared.preparationHash,candidateHash:status.candidate.candidateHash};
  const metadata=await h.operation('metadata',query),c=metadata.candidate;assert.equal(c.pairCount,1);assert.equal(metadata.completeSetVerified,true);assert.equal(metadata.canAuthorizePlacement,false);
  for(const file of ['_owner.json','request.json','original-dispatch.json','original-execution-start.json'])assert.ok(c.proofFiles.some(p=>p.path===file));
  for(const file of metadata.files){const bytes=Buffer.from(file.data,'utf8');assert.equal(bytes.length,file.bytes);assert.equal(hash(bytes),file.sha256);if(file.path!=='binding.json')assert.equal(file.sha256,c.files.find(p=>p.path===file.path).sha256);}
  const manifest=JSON.parse(metadata.files.find(f=>f.path==='native-manifest.json').data),cells=await h.operation('native-cells',query),bytes=Buffer.from(cells.file.data,'base64');assert.equal(hash(bytes),manifest.cellsHash);assert.equal(bytes.length,manifest.dimensions.width*manifest.dimensions.height*manifest.dimensions.length*2);
  for(let index=0;index<c.partCount;index++){const part=await h.operation('part',{...query,partIndex:index});assert.equal(part.index,index);for(const file of part.files){assert.equal(hash(Buffer.from(file.data)),file.sha256);assert.equal(file.sha256,c.files.find(p=>p.path===file.path).sha256);}}
  const start=await load(path.join(h.f.jobDirectory,'original-execution-start.json'));assert.equal(start.lifetime,'original-started-task-full-budget');assert.equal(start.maximumCalls,h.prepared.maximumCalls);
  assert.equal(start.firstCallFingerprint,(await load(path.join(h.f.jobDirectory,'assembly-journal','call-1.json'))).fingerprint);
  const retained=await h.operation('job-status',{expectedRequestHash:hash(h.request)});assert.equal(retained.state,'preview-ready');assert.equal(retained.canResume,false);assert.equal(retained.originalLiveExecutionOnly,false);
  const other=await h.open();await assert.rejects(other.takeOriginalDispatch(h.f.ownerId),/no adoption/);assert.equal(h.calls.length,status.reservedCalls);
  if(tier==='ultra'){assert.equal(manifest.dimensions.height,224);assert.ok(c.partCount>1);}t.diagnostic(JSON.stringify({tier,calls:h.calls.length,parts:c.partCount,operations:c.operationCount,actualModelCalls:0,worldWrites:0}));
});

test('failed original coupled provider keeps its private cause and never restarts on duplicate or reopened registry',async t=>{
  const h=await fixture(t,{providerTurn:()=>{throw Object.assign(Error('authored coupled provider failure'),{code:'SYNTHETIC_PROVIDER_FAILURE'});}});await h.bind();const runner=h.makeRunner();
  await runner.start(h.f.ownerId);const status=await runner.wait(h.f.ownerId);assert.equal(status.state,'failed-needs-original-inspection');assert.equal(h.calls.length,1);assert.equal(status.candidate,null);
  const diagnostic=await load(path.join(h.f.jobDirectory,COUPLED_REFERENCE_ASSEMBLY_TERMINAL_FAILURE_FILE));assert.equal(diagnostic.format,'CoupledReferenceWorldAssemblyPrivateTerminalFailure');assert.equal(diagnostic.phase,'generation');assert.match(JSON.stringify(diagnostic.error),/authored coupled provider failure/);
  assert.equal(diagnostic.allowsNewModelCall,false);assert.deepEqual(await runner.start(h.f.ownerId),status);assert.equal(h.calls.length,1);
  const other=await h.open();await assert.rejects(other.takeOriginalDispatch(h.f.ownerId),/no adoption/);assert.equal(h.calls.length,1);
});

test('explicit cancellation retires only the original live coupled task without a second provider dispatch',async t=>{
  let entered;const started=new Promise(resolve=>{entered=resolve;});
  const h=await fixture(t,{providerTurn:({request})=>{entered();return new Promise((_,reject)=>{
    const abort=()=>reject(request.signal.reason??Error('authored coupled cancellation'));request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();
  });}});await h.bind();const runner=h.makeRunner();await runner.start(h.f.ownerId);await started;
  const stopped=await runner.cancel(h.f.ownerId);assert.equal(stopped.state,'cancelled-needs-original-inspection');assert.equal(stopped.candidate,null);assert.equal(stopped.worldWrites,0);assert.equal(h.calls.length,1);
  assert.deepEqual(await runner.start(h.f.ownerId),stopped);const other=await h.open();await assert.rejects(other.takeOriginalDispatch(h.f.ownerId),/no adoption/);assert.equal(h.calls.length,1);
  const diagnostic=await load(path.join(h.f.jobDirectory,COUPLED_REFERENCE_ASSEMBLY_TERMINAL_FAILURE_FILE));assert.equal(diagnostic.state,stopped.state);assert.equal(diagnostic.allowsNewModelCall,false);
});
