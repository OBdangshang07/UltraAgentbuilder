import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {jointResourceFixture,jointResourceBytes,jointResourceSend} from './joint-assembly-resource-fixture.mjs';
import {createReferenceWorldAssemblyJobRegistry} from '../../bridge/reference-world-assembly-job-registry.mjs';
import {readReferenceWorldAssemblyJobRecord,jointAssemblyJobBytes} from '../../bridge/reference-world-assembly-job-data.mjs';
import {REFERENCE_WORLD_ASSEMBLY_JOB_LIMITS,validateReferenceWorldAssemblyJobRequest} from '../../contracts/reference-world-assembly-job.mjs';
import {referencePreparationOperation} from '../../bridge/reference-preparation-worker.mjs';
import {hash} from '../../src/generation/compiler.mjs';

// Authored pixels/static blocks and the REAL Windows process-owner query.
// Synthetic adapters are used ONLY where explicitly testing the full shared
// production pipeline. No paid provider, account, game or player world.
const jobRequest=h=>({format:'ReferenceWorldAssemblyJobRequest',version:2,purpose:'reference-world-assembly',
  contextId:h.contextId,referenceOwnerId:h.f.ownerId,referenceSetHash:h.f.manifest.setHash,
  generation:structuredClone(h.f.generation),send:structuredClone(h.send)});
const submission=h=>({request:jobRequest(h),selectedCapability:structuredClone(h.input.selectedCapability)});
async function fixture(t,options={}) {
  const h=await jointResourceFixture(t,options);
  h.open=async()=>{const registry=await createReferenceWorldAssemblyJobRegistry({dataDir:h.f.dataDir,resources:h.resources});
    t.after(()=>registry.close());return registry;};
  h.registry=await h.open();h.f.jobDirectory=path.join(h.registry.root,h.f.ownerId);return h;
}
async function inventory(dir) {
  const result={};
  for(const name of await fs.readdir(dir)) {
    const file=path.join(dir,name),stat=await fs.lstat(file);
    result[name]=stat.isDirectory()&&!stat.isSymbolicLink()?await inventory(file)
      :stat.isFile()?hash(await fs.readFile(file)):'link';
  }
  return result;
}
const recordFile=h=>path.join(h.f.jobDirectory,'request.json');
const load=async file=>JSON.parse(await fs.readFile(file,'utf8')).value;
const rewrite=(file,value)=>fs.writeFile(file,JSON.stringify({value,sha256:hash(value)}));

test('new full SEND commits ORIGINAL owner/pixels/context last, reserving no model calls or placement',async t=>{
  const h=await fixture(t),before=await inventory(path.join(h.f.dataDir,'reference-drafts'));
  assert.equal(await h.registry.get(h.f.ownerId),null);
  const saved=await h.registry.reserve(submission(h));
  assert.equal(saved.reservationState,'send-consumed-not-dispatched');assert.equal(saved.sendConsumed,true);
  assert.equal(saved.maximumCalls,8);assert.equal(saved.callsReservedAtReservation,0);assert.equal(saved.modelSentAtReservation,false);
  assert.equal(saved.providerOutcome,'not-assessed-by-reservation-reader');assert.equal(saved.reservationInspectionOnly,true);
  for(const key of ['allowsNewModelCall','serverBaselineVerified','canAuthorizePlacement','originalRunnerTicketConsumed'])assert.equal(saved[key],false);
  assert.equal(saved.automaticRetries,0);assert.equal(saved.worldWrites,0);
  assert.equal(Object.isFrozen(saved),true);assert.equal(Object.isFrozen(saved.recipient),true);
  assert.equal(JSON.stringify(saved).includes(h.f.dataDir),false);
  assert.doesNotMatch(JSON.stringify(saved),/ownerReference|observation|image-0\.png|referenceInput|prompt/);
  const original=await load(recordFile(h));assert.deepEqual(original.request,jobRequest(h));
  assert.equal(original.ownerReference.observation.process.pid,process.pid);assert.equal(original.ownerReference.directory,h.f.jobDirectory);
  assert.deepEqual(await inventory(path.join(h.f.dataDir,'reference-drafts')),before);
  await assert.rejects(fs.stat(path.join(h.f.jobDirectory,'assembly-journal')),{code:'ENOENT'});
  await assert.rejects(fs.stat(path.join(h.f.dataDir,'reference-drafts',h.f.ownerId,'preparations')),{code:'ENOENT'});
  assert.deepEqual(await h.registry.list(),[saved]);assert.equal(h.calls.length,0);
});

test('concurrent identical requests reuse one committed reservation; later request mutation is frozen',async t=>{
  const h=await fixture(t),input=submission(h),pending=h.registry.reserve(input);
  const others=Array.from({length:3},()=>h.registry.reserve(submission(h)));
  input.request.generation.prompt='caller mutation AFTER submission';input.selectedCapability.supportsImages=false;
  const replies=await Promise.all([pending,...others]);replies.forEach(value=>assert.deepEqual(value,replies[0]));
  assert.deepEqual((await load(recordFile(h))).request,jobRequest(h));assert.equal(h.registry.busy(),false);
  const before=await inventory(h.f.dataDir);assert.deepEqual(await h.registry.reserve(submission(h)),replies[0]);
  assert.deepEqual(await inventory(h.f.dataDir),before);
});

test('independent and reopened registries can inspect history but never obtain original dispatch ownership',async t=>{
  const h=await fixture(t),saved=await h.registry.reserve(submission(h)),second=await h.open(),before=await inventory(h.f.dataDir);
  assert.deepEqual(await second.reserve(submission(h)),saved);
  await assert.rejects(second.takeOriginalDispatch(saved.id),/no adoption/);
  await h.registry.close();const reopened=await h.open();assert.deepEqual(await reopened.get(saved.id),saved);
  await assert.rejects(reopened.takeOriginalDispatch(saved.id),/no adoption/);
  assert.deepEqual(await inventory(h.f.dataDir),before);
});

test('only ONE concurrent original handoff persists a ticket; duplicates cannot spend it again',async t=>{
  const h=await fixture(t);await h.registry.reserve(submission(h));
  const results=await Promise.allSettled(Array.from({length:4},()=>h.registry.takeOriginalDispatch(h.f.ownerId)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const packet=results.find(r=>r.status==='fulfilled').value;
  assert.equal(packet.directory,h.f.jobDirectory);assert.deepEqual(packet.request,jobRequest(h));
  assert.equal(packet.originalLiveOwnerVerified,true);assert.equal(packet.originalOneUseHandoff,true);
  assert.equal(packet.providerCallReserved,false);assert.equal(packet.canAuthorizePlacement,false);
  assert.equal(packet.dispatchClaim.callsReservedAtClaim,0);assert.equal(Object.isFrozen(packet.referenceInput),true);
  const original=await readReferenceWorldAssemblyJobRecord({dataDir:h.f.dataDir,id:h.f.ownerId,expectedRequestHash:packet.requestHash});
  assert.deepEqual(original.dispatchClaim,packet.dispatchClaim);assert.equal(hash(original.dispatchClaim),packet.dispatchClaimHash);
  const before=await inventory(h.f.dataDir);await assert.rejects(h.registry.takeOriginalDispatch(h.f.ownerId),/no adoption or repeat/);
  const status=await h.registry.get(h.f.ownerId);assert.equal(status.originalRunnerTicketConsumed,true);
  assert.equal(status.providerOutcome,'not-assessed-by-reservation-reader');assert.deepEqual(await inventory(h.f.dataDir),before);
  await assert.rejects(fs.stat(path.join(h.f.jobDirectory,'assembly-journal')),{code:'ENOENT'});
});

for(const tier of ['lite','pro','max','ultra'])test(tier+' original FULL task handoff runs the SAME native shared pipeline, ledger and complete candidate set',async t=>{
  const h=await fixture(t,{tier,images:tier==='lite'?1:4}),saved=await h.registry.reserve(submission(h)),packet=await h.registry.takeOriginalDispatch(saved.id);
  const result=await h.run(packet);assert.equal(h.calls.length,tier==='ultra'?17:8);
  assert.equal(result.candidate.maximumCalls,{lite:8,pro:14,max:20,ultra:26}[tier]);
  assert.equal(result.candidate.reservedCalls,h.calls.length);assert.equal(result.records.length,h.calls.length);
  assert.equal(result.patches.length>0,true);assert.equal(result.candidate.canAuthorizePlacement,false);
  assert.equal(result.candidate.preparationHash,packet.prepared.preparationHash);
  if(tier==='ultra'){assert.equal(result.scene.bounds.height,224);assert.equal(result.patches.length>1,true);}
  // Reservation metadata must NOT reset or misreport the later provider ledger.
  const after=await h.registry.get(saved.id);assert.equal(after.originalRunnerTicketConsumed,true);
  assert.equal(after.providerOutcome,'not-assessed-by-reservation-reader');
  assert.equal(after.callsReservedAtReservation,0);assert.equal(after.allowsNewModelCall,false);
  await assert.rejects(h.registry.takeOriginalDispatch(saved.id),/no adoption or repeat/);
  assert.equal(h.calls.length,result.records.length);
});

test('altered full request, v1/ordinary authority and budget/path injections cannot create a job',async t=>{
  const h=await fixture(t),before=await inventory(h.f.dataDir);
  const base=jobRequest(h),wrong=[{...base,contextId:randomUUID()},{...base,referenceSetHash:'a'.repeat(64)},
    {...base,referenceOwnerId:randomUUID()},{...base,generation:{...base.generation,prompt:'changed'}},
    {...base,generation:{...base.generation,model:'other-model'}},{...base,generation:{...base.generation,effort:'high'}},
    {...base,generation:{...base.generation,qualityTier:'pro'}},{...base,version:1},
    {...base,send:{...base.send,maximumCalls:26}},{...base,send:{...base.send,confirmed:false}},
    {...base,send:{...base.send,purpose:'reference-world-patch-design'}},{...base,send:{...base.send,canAuthorizePlacement:true}},
    {...base,directory:h.f.jobDirectory},{...base,send:{format:'ReferenceGenerationSend',version:2,confirmed:true}}];
  for(const request of wrong)await assert.rejects(h.registry.reserve({request,selectedCapability:h.input.selectedCapability}));
  assert.deepEqual(await inventory(h.f.dataDir),before);assert.equal(h.calls.length,0);
});

test('duplicate and in-flight requests must preserve ORIGINAL prompt, full budget and image advertisement',async t=>{
  const h=await fixture(t),pending=h.registry.reserve(submission(h));
  const rejected=assert.rejects(h.registry.reserve({...submission(h),selectedCapability:{...h.input.selectedCapability,supportsImages:false}}),/differs/);
  await pending;await rejected;const before=await inventory(h.f.dataDir);
  for(const selectedCapability of [{...h.input.selectedCapability,id:'other'},{...h.input.selectedCapability,supportsImages:false},
    {...h.input.selectedCapability,efforts:['max','high']},{...h.input.selectedCapability,account:'caller-injection'}])
    await assert.rejects(h.registry.reserve({...submission(h),selectedCapability}),/differs/);
  await assert.rejects(h.registry.reserve({...submission(h),request:{...jobRequest(h),generation:{...h.f.generation,prompt:'changed'}}}),/differs/);
  assert.deepEqual(await inventory(h.f.dataDir),before);
});

test('expiry preserves historical reads, never refreshes source or authorizes a fresh handoff',async t=>{
  const h=await fixture(t),saved=await h.registry.reserve(submission(h)),before=await inventory(h.f.dataDir);
  t.mock.timers.enable({apis:['Date'],now:h.prepared.recordExpiresAt});
  assert.deepEqual(await h.registry.get(saved.id),saved);assert.deepEqual(await h.registry.reserve(submission(h)),saved);
  await assert.rejects(h.registry.takeOriginalDispatch(saved.id),/expired/);
  assert.deepEqual(await inventory(h.f.dataDir),before);
});

test('expiry BEFORE new original reservation does not leave a lock, owner, copied sources or request',async t=>{
  const h=await fixture(t),before=await inventory(h.f.dataDir);
  t.mock.timers.enable({apis:['Date'],now:h.prepared.recordExpiresAt});
  await assert.rejects(h.registry.reserve(submission(h)),/expired/);assert.deepEqual(await inventory(h.f.dataDir),before);
});

test('committed original input survives draft/context removal; reads and dispatch do not recreate or refresh them',async t=>{
  const h=await fixture(t),saved=await h.registry.reserve(submission(h));
  await fs.rename(path.join(h.f.dataDir,'reference-drafts'),path.join(h.f.dataDir,'synthetic-retained-drafts'));
  await fs.rename(path.join(h.f.dataDir,'world-contexts'),path.join(h.f.dataDir,'synthetic-retained-contexts'));
  const before=await inventory(h.f.dataDir);assert.deepEqual(await h.registry.get(saved.id),saved);
  assert.deepEqual(await h.registry.reserve(submission(h)),saved);
  const packet=await h.registry.takeOriginalDispatch(saved.id);assert.equal(packet.prepared.snapshotHash,h.prepared.snapshotHash);
  await assert.rejects(fs.stat(path.join(h.f.dataDir,'reference-drafts')),{code:'ENOENT'});
  await assert.rejects(fs.stat(path.join(h.f.dataDir,'world-contexts')),{code:'ENOENT'});
  const after=await inventory(h.f.dataDir);delete after['reference-world-assembly-jobs'][saved.id]['original-dispatch.json'];assert.deepEqual(after,before);
});

test('unknown cross-instance lock and partial ORIGINAL job are retained, never repaired or taken over',async t=>{
  const h=await fixture(t),lock=path.join(h.registry.root,'_reserve.lock');await fs.writeFile(lock,'synthetic partial claim',{flag:'wx'});
  let before=await inventory(h.f.dataDir);await assert.rejects(h.registry.reserve(submission(h)),/unknown/);assert.deepEqual(await inventory(h.f.dataDir),before);
  await fs.unlink(lock); // This test owns this authored synthetic corruption.
  await fs.mkdir(h.f.jobDirectory);await fs.writeFile(path.join(h.f.jobDirectory,'retained-remnant'),'preserve');
  before=await inventory(h.f.dataDir);await assert.rejects(h.registry.reserve(submission(h)));await assert.rejects(h.registry.get(h.f.ownerId));
  assert.deepEqual(await inventory(h.f.dataDir),before);
});

test('a separate ORIGINAL process owns the cross-process claim; its stopped partial task can never be adopted',async t=>{
  const h=await fixture(t),child=fork(fileURLToPath(new URL('../fixtures/reference-world-assembly-registry-process.mjs',import.meta.url)),[],
    {execArgv:[],windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill();await exited;});
  const state=new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);
    child.once('exit',()=>reject(Error('Owned synthetic publisher exited before its original commit checkpoint')));});
  child.send({dataDir:h.f.dataDir,...submission(h)});const message=await state;
  assert.equal(message.state,'before-original-request-commit');assert.equal(message.pid,child.pid);
  assert.equal(child.exitCode,null);assert.equal(child.signalCode,null);assert.equal(process.kill(child.pid,0),true);
  const owner=await load(path.join(h.f.jobDirectory,'_owner.json'));assert.equal(owner.pid,child.pid);
  let before=await inventory(h.f.dataDir);await assert.rejects(h.registry.reserve(submission(h)));
  assert.deepEqual(await inventory(h.f.dataDir),before);
  assert.ok(child.kill());await exited;before=await inventory(h.f.dataDir);
  await assert.rejects(h.registry.reserve(submission(h)));await assert.rejects(h.registry.get(h.f.ownerId));
  await assert.rejects(h.registry.takeOriginalDispatch(h.f.ownerId),/no adoption/);
  assert.deepEqual(await inventory(h.f.dataDir),before);assert.equal(h.calls.length,0);
});

test('unknown state before handoff burns ONLY original ticket and cannot be reported as unspent provider work',async t=>{
  const h=await fixture(t);await h.registry.reserve(submission(h));await fs.mkdir(path.join(h.f.jobDirectory,'assembly-journal'));
  const before=await inventory(h.f.dataDir);const status=await h.registry.get(h.f.ownerId);
  assert.equal(status.providerOutcome,'not-assessed-by-reservation-reader');
  await assert.rejects(h.registry.takeOriginalDispatch(h.f.ownerId),/Unknown/);
  await assert.rejects(h.registry.takeOriginalDispatch(h.f.ownerId),/no adoption or repeat/);
  assert.deepEqual(await inventory(h.f.dataDir),before);
});

for(const member of ['request.json','_owner.json','reference-world-assembly-v2/preparation.json',
  'reference-world-assembly-v2/payload.json'])test('ORIGINAL '+member+' corruption is detected without replacement or another owner',async t=>{
  const h=await fixture(t);await h.registry.reserve(submission(h));await fs.appendFile(path.join(h.f.jobDirectory,member),' synthetic corruption');
  const before=await inventory(h.f.dataDir);await assert.rejects(h.registry.get(h.f.ownerId));
  await assert.rejects(h.registry.takeOriginalDispatch(h.f.ownerId));assert.deepEqual(await inventory(h.f.dataDir),before);
});

test('changed copied ORIGINAL image bytes cannot be read, replaced, re-encoded or dispatched',async t=>{
  const h=await fixture(t);await h.registry.reserve(submission(h));
  const file=path.join(h.f.jobDirectory,'reference-input',h.f.ownerId,'reference-sets',h.f.manifest.setHash,'image-0.png');
  await fs.appendFile(file,'labelled synthetic pixel corruption');const before=await inventory(h.f.dataDir);
  await assert.rejects(h.registry.get(h.f.ownerId));await assert.rejects(h.registry.takeOriginalDispatch(h.f.ownerId));
  assert.deepEqual(await inventory(h.f.dataDir),before);assert.equal(h.calls.length,0);
});

test('self-rehashed request and dispatch pins are checked against original frozen inputs and in-memory identity',async t=>{
  const h=await fixture(t);await h.registry.reserve(submission(h));const original=await load(recordFile(h));
  const request={...original.request,generation:{...original.request.generation,prompt:'synthetic tamper'}};
  await rewrite(recordFile(h),{...original,request,requestHash:hash(request)});
  let before=await inventory(h.f.dataDir);await assert.rejects(h.registry.get(h.f.ownerId));assert.deepEqual(await inventory(h.f.dataDir),before);
  await rewrite(recordFile(h),original);const packet=await h.registry.takeOriginalDispatch(h.f.ownerId);
  const file=path.join(h.f.jobDirectory,'original-dispatch.json');await rewrite(file,{...packet.dispatchClaim,maximumCalls:26});
  before=await inventory(h.f.dataDir);await assert.rejects(h.registry.get(h.f.ownerId));assert.deepEqual(await inventory(h.f.dataDir),before);
});

test('record/owner/dispatch hardlinks and directory redirection never create reading or sending authority',async t=>{
  const h=await fixture(t);await h.registry.reserve(submission(h));const extra=path.join(h.f.dataDir,'synthetic-hardlink');
  for(const name of ['request.json','_owner.json']) {
    await fs.link(path.join(h.f.jobDirectory,name),extra);const before=await inventory(h.f.dataDir);
    await assert.rejects(h.registry.get(h.f.ownerId));assert.deepEqual(await inventory(h.f.dataDir),before);await fs.unlink(extra);
  }
  await h.registry.takeOriginalDispatch(h.f.ownerId);await fs.link(path.join(h.f.jobDirectory,'original-dispatch.json'),extra);
  await assert.rejects(h.registry.get(h.f.ownerId));await fs.unlink(extra);
  const retained=path.join(h.f.dataDir,'synthetic-retained-job');await fs.rename(h.f.jobDirectory,retained);
  await fs.symlink(retained,h.f.jobDirectory,process.platform==='win32'?'junction':'dir');const before=await inventory(h.f.dataDir);
  await assert.rejects(h.registry.get(h.f.ownerId));assert.deepEqual(await inventory(h.f.dataDir),before);
});

test('bounded record reads reject oversized bytes and detect growth without readFile allocation',async t=>{
  const h=await fixture(t),file=path.join(h.f.dataDir,'synthetic-member');await fs.writeFile(file,'abcd');
  await assert.rejects(jointAssemblyJobBytes(file,3),/byte quota/);
  const original=fs.open;let opened=false;
  t.mock.method(fs,'open',async function(target,...args){const handle=await original.call(fs,target,...args);
    if(target!==file)return handle;opened=true;const read=handle.read.bind(handle);let changed=false;
    handle.read=async(...params)=>{if(!changed){changed=true;await fs.appendFile(file,'growth');}return read(...params);};
    handle.readFile=()=>{throw Error('Unbounded readFile must never run');};return handle;});
  await assert.rejects(jointAssemblyJobBytes(file,64),/changed during read/);assert.equal(opened,true);
});

test('close retires original reservation and handoff operations without reissuing ownership',async t=>{
  const h=await fixture(t),before=await inventory(h.f.dataDir),pending=h.registry.reserve(submission(h)),rejected=assert.rejects(pending,/closed|cancelled/);
  await h.registry.close();await rejected;assert.equal(h.registry.busy(),false);assert.deepEqual(await inventory(h.f.dataDir),before);
  await assert.rejects(h.registry.reserve(submission(h)),/closed/);await assert.rejects(h.registry.takeOriginalDispatch(h.f.ownerId),/closed/);
  const second=await h.open();await second.reserve(submission(h));const work=second.takeOriginalDispatch(h.f.ownerId),stopped=assert.rejects(work,/closed|cancelled/);
  await second.close();await stopped;assert.equal(second.busy(),false);assert.equal(h.calls.length,0);
});

test('explicit cancellation retires only local reservation/handoff, retains history and cannot infer provider outcome',async t=>{
  const h=await fixture(t),pending=h.registry.reserve(submission(h)),rejected=assert.rejects(pending,/cancelled/);
  const cancelled=await h.registry.cancel(h.f.ownerId);await rejected;assert.equal(cancelled.allowsNewModelCall,false);assert.equal(h.registry.busy(),false);
  const saved=await h.registry.reserve(submission(h)),before=await inventory(h.f.dataDir);
  await h.registry.cancel(saved.id);await assert.rejects(h.registry.takeOriginalDispatch(saved.id),/no adoption or repeat/);
  assert.deepEqual(await h.registry.get(saved.id),saved);assert.deepEqual(await inventory(h.f.dataDir),before);
});

test('later runtime drift rejects original handoff without modifying frozen input or issuing a new owner',async t=>{
  const h=await fixture(t);await h.registry.reserve(submission(h));const before=await inventory(h.f.dataDir);
  const original=fs.readFile,runtimeFile=new URL('../../bridge/reference-world-assembly-job-registry.mjs',import.meta.url).href;
  t.mock.method(fs,'readFile',async function(file,...args){if(file instanceof URL&&file.href===runtimeFile)return Buffer.from('labelled synthetic runtime drift');return original.call(fs,file,...args);});
  await assert.rejects(h.registry.takeOriginalDispatch(h.f.ownerId),/runtime changed/);assert.deepEqual(await inventory(h.f.dataDir),before);
});

test('eight REAL original reservations enforce quota without evicting records or consuming a ninth SEND',async t=>{
  const h=await fixture(t);await h.registry.reserve(submission(h));
  async function another() {
    const ownerId=randomUUID(),upload={format:'UserReferenceUpload',version:1,mode:'reconstruct',references:[{png:(await fs.readFile(path.join(h.f.dataDir,
      'reference-drafts',h.f.ownerId,'reference-sets',h.f.manifest.setHash,'image-0.png'))).toString('base64'),annotation:{purpose:'exterior',view:'front',caption:'Synthetic history quota'}}]};
    const manifest=await referencePreparationOperation({dataDir:h.f.dataDir,ownerId,operation:'pixel-prepare',input:jointResourceBytes({format:'ReferencePixelPreparationRequest',version:1,upload})});
    const generation={...h.f.generation,key:ownerId},input={...h.input,referenceSetHash:manifest.setHash,generation};
    const prepared=await h.resources.operation('prepare',ownerId,jointResourceBytes(input));
    return {request:{...jobRequest(h),referenceOwnerId:ownerId,referenceSetHash:manifest.setHash,generation,send:jointResourceSend(prepared)},selectedCapability:input.selectedCapability};
  }
  for(let i=1;i<REFERENCE_WORLD_ASSEMBLY_JOB_LIMITS.records;i++)await h.registry.reserve(await another());
  assert.equal((await h.registry.list()).length,8);const ninth=await another(),before=await inventory(h.f.dataDir);
  await assert.rejects(h.registry.reserve(ninth),e=>e.statusCode===429);assert.deepEqual(await inventory(h.f.dataDir),before);
  await assert.rejects(fs.stat(path.join(h.registry.root,ninth.request.referenceOwnerId)),{code:'ENOENT'});
});

test('request schema/root ownership are strict; an unknown history entry is not evicted to make room',async t=>{
  const h=await fixture(t);
  for(const key of ['dataDir','runtimeHash','signal','maximumCalls','allowNewModelCall'])await assert.rejects(h.registry.reserve({...submission(h),[key]:'injection'}));
  assert.throws(()=>validateReferenceWorldAssemblyJobRequest({...jobRequest(h),generation:{...h.f.generation,prompt:'x'.repeat(REFERENCE_WORLD_ASSEMBLY_JOB_LIMITS.requestBytes)}}),/byte quota/);
  await assert.rejects(createReferenceWorldAssemblyJobRegistry({dataDir:h.f.dataDir,resources:{root:h.registry.root}}),/private full joint/);
  await fs.writeFile(path.join(h.registry.root,'synthetic-unknown'),'preserve');const before=await inventory(h.f.dataDir);
  await assert.rejects(h.registry.reserve(submission(h)),/Unknown/);await assert.rejects(h.registry.list(),/Unknown/);
  assert.deepEqual(await inventory(h.f.dataDir),before);assert.equal(h.calls.length,0);
});
