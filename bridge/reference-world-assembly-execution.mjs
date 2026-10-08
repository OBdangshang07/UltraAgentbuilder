import path from 'node:path';
import {hash} from '../src/generation/compiler.mjs';
import {exactKeys} from '../contracts/world-selection.mjs';
import {referenceWorldAssemblyOriginalController,takeReferenceWorldAssemblyOriginalDispatch} from './reference-world-assembly-job-registry.mjs';
import {readReferenceWorldAssemblyJobRecord,readJointAssemblyJobEnvelope} from './reference-world-assembly-job-data.mjs';
import {jointInvocationDirectory,writeJointInvocationEnvelope} from './reference-world-patch-invocation-data.mjs';

// Only a REAL live registry can issue this opaque process-local capability.
// JSON, a retained dispatch claim, PID/clock facts and a copied packet cannot.
// This grants no new budget, model, scope, image set, retry or world authority.
const executions=new WeakMap(),startFile='original-execution-start.json';
const failure=message=>Error(message+'; original complete joint evidence retained');
export async function reserveReferenceWorldAssemblyExecution(registry,id) {
  const controller=referenceWorldAssemblyOriginalController(registry,id);
  const packet=await takeReferenceWorldAssemblyOriginalDispatch(registry,id);
  referenceWorldAssemblyOriginalController(registry,id);
  if(path.join(controller.root,id)!==packet.directory||controller.runtimeHash!==packet.prepared.runtimeHash)
    throw failure('Original execution source/controller changed');
  const execution=Object.freeze({purpose:'original-reference-world-assembly-execution'});
  executions.set(execution,{registry,id,packet,claimed:false,active:false,start:null});
  return {execution,packet};
}
function live(execution) {
  const entry=executions.get(execution);
  if(!entry)throw failure('Exact live original execution capability required; no serialized adoption');
  referenceWorldAssemblyOriginalController(entry.registry,entry.id);
  entry.signal?.throwIfAborted();return entry;
}
async function original(entry,directory,prepared) {
  const packet=entry.packet;
  if(directory!==packet.directory||hash(prepared)!==hash(packet.prepared))throw failure('Original execution input/scope/policy changed');
  const saved=await readReferenceWorldAssemblyJobRecord({dataDir:path.dirname(path.dirname(directory)),id:entry.id,expectedRequestHash:packet.requestHash});
  if(!saved||saved.value.ownerReferenceHash!==packet.ownerReferenceHash||hash(saved.dispatchClaim)!==packet.dispatchClaimHash
    ||hash(saved.value.prepared)!==hash(prepared))throw failure('Original execution record/claim changed');
  return saved;
}
export async function beginReferenceWorldAssemblyExecution({execution,directory,prepared,signal}) {
  const entry=live(execution);
  if(entry.claimed||!(signal instanceof AbortSignal))throw failure('Original execution is one-use and requires its controller signal');
  entry.claimed=true;entry.signal=signal; // Consume BEFORE awaiting; uncertain begins are never repeated.
  try{await original(entry,directory,prepared);live(execution);entry.active=true;}
  catch(error){executions.delete(execution);throw error;}
}
async function pending(entry,prepared,index) {
  if(!Number.isSafeInteger(index)||index<1||index>prepared.maximumCalls)throw failure('Original full-task call order/budget required');
  const root=path.join(entry.packet.directory,'assembly-journal');await jointInvocationDirectory(root);
  const identity=await readJointAssemblyJobEnvelope(path.join(root,'identity.json'),4096);
  if(hash(identity)!==hash({version:1,requestHash:prepared.preparationHash,policyHash:prepared.policyHash,
    runtimeHash:prepared.runtimeHash,maximumCalls:prepared.maximumCalls}))throw failure('Original shared full-budget ledger changed');
  const call=await readJointAssemblyJobEnvelope(path.join(root,`call-${index}.json`),2*1024**2);
  const dispatched=await readJointAssemblyJobEnvelope(path.join(root,'dispatched.json'),4096);
  if(call.index!==index||call.state!=='pending'||!(/^[a-f0-9]{64}$/).test(call.fingerprint??'')||dispatched.count!==index)
    throw failure('Exact pending original call must be reserved before execution');
  return call;
}
export async function checkReferenceWorldAssemblyExecution({execution,directory,prepared,freshCall,index}) {
  const entry=live(execution);
  if(!entry.active||typeof freshCall!=='boolean')throw failure('Original execution is not active');
  await original(entry,directory,prepared);live(execution);
  if(!freshCall) {
    if(entry.start!==null&&hash(await readJointAssemblyJobEnvelope(path.join(directory,startFile),4096))!==entry.start.hash)
      throw failure('Original task-start evidence changed after final call');
    live(execution);return;
  }
  const call=await pending(entry,prepared,index);live(execution);
  if(entry.start===null) {
    if(index!==1||prepared.recordExpiresAt<=Date.now())throw failure('Capture expired before ORIGINAL first call; no task start');
    const value={format:'ReferenceWorldAssemblyOriginalExecutionStart',version:1,purpose:'reference-world-assembly',id:entry.id,
      requestHash:entry.packet.requestHash,preparationHash:prepared.preparationHash,dispatchClaimHash:entry.packet.dispatchClaimHash,
      ownerReferenceHash:entry.packet.ownerReferenceHash,runtimeHash:prepared.runtimeHash,maximumCalls:prepared.maximumCalls,
      firstCallIndex:1,firstCallFingerprint:call.fingerprint,createdAt:Date.now(),captureExpiresAt:prepared.recordExpiresAt,
      lifetime:'original-started-task-full-budget',canAuthorizePlacement:false};
    if(value.createdAt<entry.packet.dispatchClaim.createdAt||value.createdAt>=prepared.recordExpiresAt)
      throw failure('Original execution cannot extend an expired start authorization');
    live(execution);
    await writeJointInvocationEnvelope(path.join(directory,startFile),value);
    entry.start={value,hash:hash(value)};
  }
  const value=await readJointAssemblyJobEnvelope(path.join(directory,startFile),4096);
  exactKeys(value,Object.keys(entry.start.value),'original full-task execution start');
  if(hash(value)!==entry.start.hash)throw failure('Original task-start evidence changed; no lifetime adoption');
  live(execution);
  // All subsequent calls still reserve the SAME original bounded ledger,
  // recheck original scope/runtime/model/pixels and require the live controller.
  // Expiration is for START, not a hidden wall-clock cutoff during that task.
}
export function finishReferenceWorldAssemblyExecution(execution) {
  const entry=executions.get(execution);if(entry)entry.active=false;executions.delete(execution);
}

/** Completed ORIGINAL start evidence only. Reading does not issue a token,
 * acquire ownership, refresh expiry, reserve a call or grant world authority. */
export async function readReferenceWorldAssemblyExecutionStart({directory,prepared}) {
  let value;
  try{value=await readJointAssemblyJobEnvelope(path.join(directory,startFile),4096);}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
  exactKeys(value,['format','version','purpose','id','requestHash','preparationHash','dispatchClaimHash','ownerReferenceHash',
    'runtimeHash','maximumCalls','firstCallIndex','firstCallFingerprint','createdAt','captureExpiresAt','lifetime','canAuthorizePlacement'],'original task-start receipt');
  const saved=await readReferenceWorldAssemblyJobRecord({dataDir:path.dirname(path.dirname(directory)),id:prepared.jobId});
  const root=path.join(directory,'assembly-journal');await jointInvocationDirectory(root);
  const first=await readJointAssemblyJobEnvelope(path.join(root,'call-1.json'),2*1024**2);
  if(!saved||saved.directory!==directory||hash(saved.value.prepared)!==hash(prepared)||!saved.dispatchClaim
    ||value.format!=='ReferenceWorldAssemblyOriginalExecutionStart'||value.version!==1||value.purpose!=='reference-world-assembly'
    ||value.id!==prepared.jobId||value.requestHash!==saved.value.requestHash||value.preparationHash!==prepared.preparationHash
    ||value.dispatchClaimHash!==hash(saved.dispatchClaim)||value.ownerReferenceHash!==saved.value.ownerReferenceHash
    ||value.runtimeHash!==prepared.runtimeHash||value.maximumCalls!==prepared.maximumCalls||value.firstCallIndex!==1
    ||first.index!==1||value.firstCallFingerprint!==first.fingerprint||!(/^[a-f0-9]{64}$/).test(value.firstCallFingerprint??'')
    ||!Number.isSafeInteger(value.createdAt)||value.createdAt<saved.dispatchClaim.createdAt||value.createdAt>=prepared.recordExpiresAt
    ||value.createdAt>Date.now()||value.captureExpiresAt!==prepared.recordExpiresAt
    ||value.lifetime!=='original-started-task-full-budget'||value.canAuthorizePlacement!==false)
    throw failure('Original completed task-start/owner/full-budget evidence changed');
  return value;
}
