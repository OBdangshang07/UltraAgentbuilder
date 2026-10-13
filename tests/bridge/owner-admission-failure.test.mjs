import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from '../../src/generation/compiler.mjs';
import {ownerCreationFailure,ownerCreationError,publicOwnerCreationFailure} from '../../bridge/world-patch-owner-failure.mjs';
import {assemblyAdmissionFailure,admissionFailureError,publicAssemblyAdmissionFailure,validateAssemblyAdmissionFailure} from '../../bridge/reference-world-assembly-admission-failure.mjs';
import {createReferenceWorldAssemblyJobRegistry} from '../../bridge/reference-world-assembly-job-registry.mjs';
import {jointResourceFixture} from './joint-assembly-resource-fixture.mjs';
import {startBridge} from '../../bridge/server.mjs';
import {NATIVE_RENDERER} from '../../bridge/native-evidence.mjs';

const query={format:'WindowsOwnerQueryFailure',version:1,reason:'timeout',phase:'process',helperStarted:true,
  helperClosed:true,helperExitCode:0,helperExitSignal:null,spawnCode:null,ownershipRecovered:false,canAuthorizePlacement:false};
const binding=()=>({id:randomUUID(),requestHash:'a'.repeat(64),preparationHash:'b'.repeat(64),runtimeHash:'c'.repeat(64),
  claimHash:'d'.repeat(64),directoryHash:'e'.repeat(64),controllerPid:process.pid,occurredAt:Date.now(),phase:'new-owner'});
const load=async file=>JSON.parse(await fs.readFile(file,'utf8'));
async function fixture(t){
  const h=await jointResourceFixture(t),registry=await createReferenceWorldAssemblyJobRegistry({dataDir:h.f.dataDir,resources:h.resources});
  t.after(()=>registry.close());
  const directory=path.join(registry.root,h.f.ownerId),file=path.join(directory,'admission-failure.json');
  const request={format:'ReferenceWorldAssemblyJobRequest',version:2,purpose:'reference-world-assembly',contextId:h.contextId,
    referenceOwnerId:h.f.ownerId,referenceSetHash:h.f.manifest.setHash,generation:structuredClone(h.f.generation),send:structuredClone(h.send)};
  return {...h,registry,directory,file,input:{request,selectedCapability:structuredClone(h.input.selectedCapability)}};
}
function rejectEmptyCheck(t,h){
  const original=fs.readdir;
  t.mock.method(fs,'readdir',async(file,...args)=>file===h.directory?['synthetic-nonempty']:original.call(fs,file,...args));
}

test('owner diagnostics retain only fixed phases/reasons and closed helper facts, not private Error data',()=>{
  for(const phase of ['directory','empty-directory','process-query','self-process','owner-create','owner-capture']){
    const error=Object.assign(Error('synthetic-private-command-and-token'),{code:'synthetic-private',stderr:'synthetic-private'});
    const wrapped=ownerCreationError(error,phase),diagnostic=publicOwnerCreationFailure(wrapped);
    assert.equal(diagnostic.phase,phase);assert.equal(diagnostic.reason,'verification-rejected');
    assert.equal(diagnostic.ownershipRecovered,false);assert.equal(diagnostic.canAuthorizePlacement,false);
    assert.doesNotMatch(JSON.stringify(diagnostic)+wrapped.message,/synthetic-private/);
    assert.equal(ownerCreationError(wrapped,'directory'),wrapped);
  }
  const wrapped=ownerCreationError({code:'WINDOWS_OWNER_QUERY_FAILED',observationDiagnostic:query},'process-query');
  assert.deepEqual(publicOwnerCreationFailure(wrapped).query,query);
  assert.equal(publicOwnerCreationFailure(wrapped).query.helperExitCode,0); // Late code 0 does NOT erase timeout.
  assert.throws(()=>ownerCreationFailure({},'synthetic-private'),/phase/);
  for(const change of [{reason:'synthetic-private'},{phase:'synthetic-private'},{query:{...query,path:'synthetic-private'}},
    {canAuthorizePlacement:true},{ownershipRecovered:true},{extra:'synthetic-private'}])
    assert.equal(publicOwnerCreationFailure({...wrapped,ownerCreationDiagnostic:{...wrapped.ownerCreationDiagnostic,...change}}),null);
});

test('admission failure binds original hashes but never becomes an owner, retry ticket or placement authorization',()=>{
  const value=assemblyAdmissionFailure(ownerCreationError({code:'ENOSPC'},'owner-create'),binding());
  assert.equal(value.ownerFailure.reason,'ENOSPC');assert.deepEqual(publicAssemblyAdmissionFailure(admissionFailureError(value)),value);
  for(const key of ['requestHash','preparationHash','runtimeHash','claimHash','directoryHash'])
    assert.throws(()=>validateAssemblyAdmissionFailure({...value,[key]:'private-value'}));
  for(const key of ['requestCommitted','providerDispatchStarted','ownershipRecovered','allowsNewModelCall','canAuthorizePlacement'])
    assert.throws(()=>validateAssemblyAdmissionFailure({...value,[key]:true}));
  for(const change of [{prompt:'synthetic-private'},{phase:'synthetic-private'},{controllerPid:0},{id:'not-an-id'},
    {id:{toString:()=>value.id}},
    {ownerFailure:{...value.ownerFailure,stderr:'synthetic-private'}}])
    assert.equal(publicAssemblyAdmissionFailure({code:'REFERENCE_ASSEMBLY_ADMISSION_FAILED',admissionDiagnostic:{...value,...change}}),null);
  const rejected=admissionFailureError(assemblyAdmissionFailure(ownerCreationError({code:'WINDOWS_OWNER_QUERY_FAILED',observationDiagnostic:query},'process-query'),binding()));
  assert.equal(rejected.message,rejected.publicMessage);assert.match(rejected.message,/query=timeout; query-phase=process/);
  assert.doesNotMatch(rejected.message,/synthetic-private/);
});

test('original owner creation rejection is durably bound and read-only worker/reopened registries cannot retry it',async t=>{
  const h=await fixture(t);rejectEmptyCheck(t,h);
  let original;await assert.rejects(h.registry.reserve(h.input),error=>{original=publicAssemblyAdmissionFailure(error);return original!==null;});
  assert.equal(original.id,h.f.ownerId);assert.equal(original.requestHash,hash(h.input.request));
  assert.equal(original.preparationHash,h.prepared.preparationHash);assert.equal(original.runtimeHash,h.registry.runtimeHash);
  assert.equal(original.directoryHash,hash(h.directory));assert.equal(original.controllerPid,process.pid);
  assert.equal(original.phase,'new-owner');assert.equal(original.ownerFailure.phase,'empty-directory');
  const saved=await load(h.file);assert.equal(saved.sha256,hash(saved.value));assert.deepEqual(saved.value,original);
  for(const name of ['request.json','_owner.json','original-dispatch.json'])await assert.rejects(fs.stat(path.join(h.directory,name)),{code:'ENOENT'});
  await assert.rejects(fs.stat(path.join(h.registry.root,'_reserve.lock')),{code:'ENOENT'});
  const before=await fs.readFile(h.file),second=await createReferenceWorldAssemblyJobRegistry({dataDir:h.f.dataDir,resources:h.resources});
  t.after(()=>second.close());
  for(const action of [()=>h.registry.get(h.f.ownerId),()=>h.registry.reserve(h.input),()=>second.get(h.f.ownerId),()=>second.reserve(h.input)])
    await assert.rejects(action(),error=>assert.deepEqual(publicAssemblyAdmissionFailure(error),original)===undefined);
  await assert.rejects(second.takeOriginalDispatch(h.f.ownerId),/no adoption/);
  assert.deepEqual(await fs.readFile(h.file),before);assert.equal(h.calls.length,0);
});

test('failure to persist diagnostic does not overwrite a preexisting member, issue an owner or mask original failure',async t=>{
  const h=await fixture(t);rejectEmptyCheck(t,h);
  const open=fs.open;
  t.mock.method(fs,'open',async(file,...args)=>{if(file===h.file)throw Object.assign(Error('synthetic-private-disk-error'),{code:'ENOSPC'});return open.call(fs,file,...args);});
  await assert.rejects(h.registry.reserve(h.input),error=>publicOwnerCreationFailure(error)?.phase==='empty-directory');
  await assert.rejects(fs.stat(h.file),{code:'ENOENT'});await assert.rejects(fs.stat(path.join(h.directory,'request.json')),{code:'ENOENT'});
  assert.equal(h.calls.length,0);
});

test('bind failure is recorded before dispatch without pretending the verified owner or frozen inputs never existed',async t=>{
  const h=await fixture(t),operation=h.resources.operation.bind(h.resources);
  t.mock.method(h.resources,'operation',async(...args)=>{if(args[0]==='bind')throw Object.assign(Error('synthetic-private-bind-error'),{code:'EIO'});return operation(...args);});
  let diagnostic;await assert.rejects(h.registry.reserve(h.input),error=>{diagnostic=publicAssemblyAdmissionFailure(error);return diagnostic!==null;});
  assert.equal(diagnostic.phase,'bind');assert.equal(diagnostic.reason,'EIO');assert.equal(diagnostic.ownerFailure,null);
  assert.equal((await load(path.join(h.directory,'_owner.json'))).value.pid,process.pid);
  await assert.rejects(fs.stat(path.join(h.directory,'request.json')),{code:'ENOENT'});assert.equal(h.calls.length,0);
  assert.doesNotMatch(JSON.stringify(diagnostic),/synthetic-private/);
});

test('an ambiguous partially created request cannot be relabelled as an uncommitted admission failure',async t=>{
  const h=await fixture(t),open=fs.open,requestFile=path.join(h.directory,'request.json');
  t.mock.method(fs,'open',async(file,...args)=>{
    const handle=await open.call(fs,file,...args);
    if(file===requestFile&&args[0]==='wx')handle.writeFile=async()=>{throw Object.assign(Error('synthetic-private-write'),{code:'EIO'});};
    return handle;
  });
  await assert.rejects(h.registry.reserve(h.input),error=>error.code==='EIO');
  assert.equal((await fs.stat(requestFile)).size,0);await assert.rejects(fs.stat(h.file),{code:'ENOENT'});
  await assert.rejects(h.registry.reserve(h.input));assert.equal(h.calls.length,0);
});

test('paired HTTP exposes the same durable admission diagnostic on POST and later GET; never redispatches',async t=>{
  const h=await fixture(t);rejectEmptyCheck(t,h);let modelCalls=0,queries=0;
  const adapter={models:async()=>{queries++;return [{id:h.f.generation.model,supportsImages:true,efforts:['high','max']}];},
    generate:async()=>{modelCalls++;assert.fail('Failed admission must never generate');},close(){}};
  const app=await startBridge({dataDir:h.f.dataDir,adapter,referenceWorldAssemblySending:true,referenceWorldPatchSending:true});t.after(()=>app.close());
  const request=async(route,body)=>{
    const response=await fetch(`http://127.0.0.1:${app.connection.port}${route}`,{method:body?'POST':'GET',
      headers:{Authorization:`Bearer ${app.connection.token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,value:await response.json()};
  };
  assert.equal((await request('/v1/renderers/heartbeat',{renderer:NATIVE_RENDERER,assetOnly:true})).status,200);
  const post=await request('/v1/reference-world-assembly/jobs',h.input.request);assert.equal(post.status,409);
  assert.equal(post.value.diagnostic.format,'ReferenceWorldAssemblyAdmissionFailure');assert.match(post.value.error,/new-owner \/ empty-directory/);
  const before=await fs.readFile(h.file),get=await request('/v1/reference-world-assembly/jobs/'+h.f.ownerId);
  assert.equal(get.status,409);assert.deepEqual(get.value,post.value);
  const second=await request('/v1/reference-world-assembly/jobs',h.input.request);assert.deepEqual(second,post);
  assert.equal(queries,1);assert.equal(modelCalls,0);assert.deepEqual(await fs.readFile(h.file),before);
  assert.doesNotMatch(JSON.stringify(post),/Bearer|synthetic-private|[A-Z]:[\\/]/);
});

test('corrupt or redirected admission failure remains rejected and cannot be repaired by a reader',async t=>{
  const h=await fixture(t);rejectEmptyCheck(t,h);await assert.rejects(h.registry.reserve(h.input));
  const original=await fs.readFile(h.file);await fs.appendFile(h.file,'synthetic-corruption');const corrupt=await fs.readFile(h.file);
  await assert.rejects(h.registry.get(h.f.ownerId));assert.deepEqual(await fs.readFile(h.file),corrupt);
  await fs.writeFile(h.file,original); // Restore ONLY this test-owned synthetic corruption.
  const value=(await load(h.file)).value;value.directoryHash='f'.repeat(64);
  await fs.writeFile(h.file,JSON.stringify({value,sha256:hash(value)}));
  await assert.rejects(h.registry.get(h.f.ownerId));assert.equal(h.calls.length,0);
});
