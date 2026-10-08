import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {exactKeys} from '../contracts/world-selection.mjs';
import {REFERENCE_OWNER} from '../contracts/reference-attachments.mjs';
import {validateReferenceWorldAssemblyJobRequest,REFERENCE_WORLD_ASSEMBLY_JOB_LIMITS} from '../contracts/reference-world-assembly-job.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {ReferenceWorldAssemblyResources} from './reference-world-assembly-resources.mjs';
import {assemblyRuntimeIdentity} from './assembly-durability.mjs';
import {verifyReferenceWorldAssemblySend} from './reference-world-assembly.mjs';
import {createWorldPatchOwnerReference} from './world-patch-owner-observation.mjs';
import {jointInvocationDirectory,writeJointInvocationEnvelope} from './reference-world-patch-invocation-data.mjs';
import {jointAssemblyJobRoot,readJointAssemblyJobEnvelope,REFERENCE_ASSEMBLY_DISPATCH_FILE,validateReferenceWorldAssemblyDispatchClaim} from './reference-world-assembly-job-data.mjs';

const raw=value=>Buffer.from(JSON.stringify(value));
const failure=(message,statusCode=409)=>Object.assign(Error(message+'; original complete joint evidence retained'),{statusCode});
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};

/** Independent consume-once FULL task ownership. No adapter or world API.
 * Durable request commits last. Reopened/duplicate readers never obtain the
 * original live owner's one-use runner ticket from persisted JSON or PID. */
export async function createReferenceWorldAssemblyJobRegistry(options) {
  exactKeys(options,['dataDir','resources'],'private full joint job registry');
  const dataDir=path.resolve(options.dataDir),resources=options.resources;
  if(!(resources instanceof ReferenceWorldAssemblyResources)||resources.root!==path.join(dataDir,'reference-world-assembly-jobs')||resources.dataDir!==dataDir)
    throw failure('Exact private full joint resource lane required',400);
  const root=await jointAssemblyJobRoot(dataDir,{create:true});
  const runtimeHash=await assemblyRuntimeIdentity(),pending=new Map(),owned=new Map(),known=new Map(),readers=new Map(),handoffs=new Map();let closed=false;
  const checkpoint=signal=>{if(closed||signal?.aborted)throw failure('Original full joint controller closed/cancelled',503);};
  const current=async signal=>{checkpoint(signal);if(await assemblyRuntimeIdentity()!==runtimeHash)throw failure('Original full joint runtime changed');checkpoint(signal);};
  const resourceInput=(request,selectedCapability)=>({contextId:request.contextId,referenceSetHash:request.referenceSetHash,generation:request.generation,selectedCapability});
  async function metadata(id,signal) {
    if(typeof id!=='string'||!REFERENCE_OWNER.test(id))throw failure('Exact original full-task UUID required',400);
    checkpoint(signal);const old=readers.get(id);if(old)return old.promise;
    const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    const item={controller,promise:null};item.promise=resources.operation('job-record',id,raw({expectedRequestHash:known.get(id)??null}),{signal:controller.signal});readers.set(id,item);
    try{return await item.promise;}finally{signal?.removeEventListener('abort',abort);if(readers.get(id)===item)readers.delete(id);}
  }
  function publicReservation(saved) {
    const value=saved.value,p=value.prepared;
    return freeze({format:'ReferenceWorldAssemblyJobReservationStatus',version:2,purpose:'reference-world-assembly',id:value.id,
      requestHash:value.requestHash,preparationHash:p.preparationHash,runtimeHash:value.runtimeHash,contextId:p.contextId,
      referenceSetHash:p.referenceSetHash,snapshotHash:p.snapshotHash,selectionHash:p.selectionHash,
      recipient:{agent:p.selected.agent,model:p.selected.model,effort:p.selected.effort},tier:p.tier,maximumCalls:p.maximumCalls,
      reservationState:value.state,sendConsumed:true,callsReservedAtReservation:0,modelSentAtReservation:false,
      originalRunnerTicketConsumed:saved.dispatchClaim!==null,providerOutcome:'not-assessed-by-reservation-reader',
      reservationInspectionOnly:true,automaticRetries:0,allowsNewModelCall:false,
      serverBaselineVerified:false,canAuthorizePlacement:false,worldWrites:0});
  }
  const same=(saved,request,selectedCapability)=>{
    if(saved.value.requestHash!==hash(request)||hash(saved.value.prepared.selected.capability)!==hash(selectedCapability))
      throw failure('Existing complete joint request or selected advertisement differs');
    return publicReservation(saved);
  };
  async function get(id){const saved=await metadata(id);return saved?publicReservation(saved):null;}
  async function names() {
    await jointInvocationDirectory(root);const entries=[];
    for await(const entry of await fs.opendir(root)) {
      if(entry.name==='_reserve.lock')continue;
      if(!REFERENCE_OWNER.test(entry.name)||!entry.isDirectory()||entry.isSymbolicLink())throw failure('Unknown full joint history entry; nothing evicted');
      entries.push(entry.name);if(entries.length>REFERENCE_WORLD_ASSEMBLY_JOB_LIMITS.records)throw failure('Full joint history quota; nothing evicted',429);
    }
    return entries.sort();
  }
  async function list(){checkpoint();const result=[];for(const id of await names()){const value=await get(id);if(!value)throw failure('Original full joint history disappeared');result.push(value);}return freeze(result);}
  async function reserveOriginal(request,selectedCapability,signal) {
    checkpoint(signal);const id=request.referenceOwnerId,existing=await metadata(id,signal);if(existing)return same(existing,request,selectedCapability);
    await current(signal);
    const input=resourceInput(request,selectedCapability),prepared=await resources.operation('prepare',id,raw(input),{signal});
    verifyReferenceWorldAssemblySend(request.send,prepared);if(prepared.runtimeHash!==runtimeHash)throw failure('Original full task prepared for another runtime');
    if(prepared.recordExpiresAt<=Date.now())throw failure('Original full task capture expired before ownership');
    checkpoint(signal);
    const file=path.join(root,'_reserve.lock'),claim={format:'ReferenceWorldAssemblyReservationClaim',version:2,
      id:randomUUID(),jobId:id,requestHash:hash(request),runtimeHash,pid:process.pid};
    try{await writeJointInvocationEnvelope(file,claim);}catch(error){
      if(error.code!=='EEXIST')throw error;const old=await metadata(id,signal);if(old)return same(old,request,selectedCapability);
      throw failure('Full joint reservation in progress/unknown; no takeover');
    }
    const verifyClaim=async()=>{await jointInvocationDirectory(root);if(hash(await readJointAssemblyJobEnvelope(file,4096))!==hash(claim))throw failure('Original full joint reservation claim changed');};
    try {
      checkpoint(signal);await verifyClaim();const old=await metadata(id,signal);if(old)return same(old,request,selectedCapability);
      const entries=await names();for(const other of entries)await metadata(other,signal);
      if(entries.length>=REFERENCE_WORLD_ASSEMBLY_JOB_LIMITS.records)throw failure('Full joint history quota; nothing evicted',429);
      const fresh=await resources.operation('prepare',id,raw(input),{signal});
      if(hash(fresh)!==hash(prepared))throw failure('Original full joint source changed before claim');
      await current(signal);await verifyClaim();
      const directory=path.join(root,id);await fs.mkdir(directory,{mode:0o700});await jointInvocationDirectory(directory);
      const owner=await createWorldPatchOwnerReference({directory});checkpoint(signal);
      const bound=await resources.operation('bind',id,raw({...input,send:request.send}),{signal});
      if(hash(bound.prepared)!==hash(prepared))throw failure('Original full task changed while freezing');
      await current(signal);await verifyClaim();
      if(prepared.recordExpiresAt<=Date.now())throw failure('Original full task capture expired during ownership');
      const value={format:'ReferenceWorldAssemblyJobReservation',version:2,purpose:'reference-world-assembly',id,request,
        requestHash:hash(request),prepared,referenceInput:bound.referenceInput,ownerReference:owner.reference,
        ownerReferenceHash:owner.referenceHash,runtimeHash,createdAt:Date.now(),maximumCalls:prepared.maximumCalls,
        state:'send-consumed-not-dispatched',modelSentAtReservation:false,callsReservedAtReservation:0,canAuthorizePlacement:false};
      if(raw({value,sha256:hash(value)}).length>REFERENCE_WORLD_ASSEMBLY_JOB_LIMITS.recordBytes)throw failure('Full joint record byte quota',413);
      await writeJointInvocationEnvelope(path.join(directory,'request.json'),value); // commit LAST
      known.set(id,value.requestHash);owned.set(id,{ownerReferenceHash:value.ownerReferenceHash,consumed:false});
      const saved=await metadata(id,signal);checkpoint(signal);return publicReservation(saved);
    }finally{await verifyClaim();await fs.unlink(file);}
  }
  async function reserve(value) {
    exactKeys(value,['request','selectedCapability'],'original full joint reservation');const request=validateReferenceWorldAssemblyJobRequest(value.request),id=request.referenceOwnerId;
    const selectedCapability=structuredClone(value.selectedCapability);
    checkpoint();const running=pending.get(id);
    if(running){await running.promise;const saved=await metadata(id);if(!saved)throw failure('Original full joint reservation missing');return same(saved,request,selectedCapability);}
    if(pending.size)throw failure('Original full joint reservation lane busy',429);
    const controller=new AbortController(),item={controller,promise:null};pending.set(id,item);
    item.promise=reserveOriginal(request,selectedCapability,controller.signal);
    try{return await item.promise;}finally{if(pending.get(id)===item)pending.delete(id);}
  }
  async function takeOriginalDispatch(id) {
    checkpoint();const ownership=owned.get(id);
    if(!ownership||ownership.consumed)throw failure('Exact live original one-use full-task owner required; no adoption or repeat');
    // Consume the in-memory capability BEFORE awaiting. A failed/uncertain
    // local handoff stays consumed, even if its durable ticket is incomplete.
    ownership.consumed=true;const controller=new AbortController(),item={controller,promise:null};handoffs.set(id,item);
    item.promise=(async()=>{
    const signal=controller.signal,saved=await metadata(id,signal);await current(signal);
    if(!saved||saved.value.ownerReferenceHash!==ownership.ownerReferenceHash||saved.dispatchClaim)throw failure('Original full-task dispatch already consumed or changed');
    const value=saved.value,prepared=value.prepared;
    if(prepared.recordExpiresAt<=Date.now())throw failure('Original full-task capture expired; no dispatch');
    const expected=['_owner.json','request.json','reference-input','reference-world-assembly-v2'].sort(),entries=[];
    for await(const entry of await fs.opendir(saved.directory)) {
      if(!expected.includes(entry.name))throw failure('Unknown original full-task state; no dispatch or takeover');
      entries.push(entry.name);
    }
    if(hash(entries.sort())!==hash(expected))throw failure('Incomplete original full-task state; no dispatch or takeover');
    const claim={format:'ReferenceWorldAssemblyOriginalDispatchClaim',version:2,purpose:'reference-world-assembly',id,ticketId:randomUUID(),
      requestHash:value.requestHash,preparationHash:prepared.preparationHash,runtimeHash,ownerReferenceHash:value.ownerReferenceHash,
      createdAt:Date.now(),maximumCalls:value.maximumCalls,originalOwnerOnly:true,callsReservedAtClaim:0,canAuthorizePlacement:false};
    validateReferenceWorldAssemblyDispatchClaim(claim,value);
    checkpoint(signal);
    await writeJointInvocationEnvelope(path.join(saved.directory,REFERENCE_ASSEMBLY_DISPATCH_FILE),claim);
    const checked=await metadata(id,signal);await current(signal);
    if(hash(checked?.dispatchClaim)!==hash(claim))throw failure('Exact original full-task runner ticket changed');
    return freeze({directory:saved.directory,request:value.request,referenceInput:value.referenceInput,prepared,
      requestHash:value.requestHash,ownerReferenceHash:value.ownerReferenceHash,dispatchClaim:claim,dispatchClaimHash:hash(claim),
      originalLiveOwnerVerified:true,originalOneUseHandoff:true,providerCallReserved:false,canAuthorizePlacement:false});
    })();
    try{return await item.promise;}finally{if(handoffs.get(id)===item)handoffs.delete(id);}
  }
  async function cancel(id) {
    checkpoint();if(typeof id!=='string'||!REFERENCE_OWNER.test(id))throw failure('Exact original full-task UUID required',400);
    const work=[pending.get(id),readers.get(id),handoffs.get(id)].filter(Boolean);
    for(const item of work)item.controller.abort();
    if(owned.has(id))owned.get(id).consumed=true;
    await Promise.allSettled(work.map(item=>item.promise));
    // Cancellation retires ONLY local ownership. A later runner's provider
    // outcome is neither inferred nor reset by this reservation-only reader.
    if(owned.has(id))owned.get(id).consumed=true;
    return freeze({id,localOperationsStopped:work.length,originalRunnerTicketMayExist:true,
      providerOutcome:'not-assessed-by-reservation-reader',allowsNewModelCall:false,canAuthorizePlacement:false});
  }
  return {root,runtimeHash,reserve,get,list,takeOriginalDispatch,cancel,busy:()=>pending.size>0||readers.size>0||handoffs.size>0,
    async close(){closed=true;for(const item of pending.values())item.controller.abort();for(const item of readers.values())item.controller.abort();
      for(const item of handoffs.values())item.controller.abort();
      await Promise.allSettled([...pending.values(),...readers.values(),...handoffs.values()].map(i=>i.promise));owned.clear();known.clear();}};
}
