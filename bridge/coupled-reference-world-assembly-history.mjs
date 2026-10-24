import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../src/generation/compiler.mjs';
import {WORLD_ASSEMBLY_LIMITS} from '../contracts/world-assembly-limits.mjs';
import {COUPLED_REFERENCE_WORLD_ASSEMBLY_JOB_LIMITS} from '../contracts/coupled-reference-world-assembly-job.mjs';
import {REFERENCE_OWNER} from '../contracts/reference-attachments.mjs';
import {exactKeys} from '../contracts/world-selection.mjs';
import {readCoupledReferenceWorldAssemblyJobRecord,coupledAssemblyJobRoot,jointAssemblyJobBytes,readJointAssemblyJobEnvelope} from './coupled-reference-world-assembly-job-data.mjs';
import {jointInvocationDirectory} from './reference-world-patch-invocation-data.mjs';
import {COUPLED_REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY} from './coupled-reference-world-assembly-candidate.mjs';
import {readCoupledReferenceWorldAssemblyCandidate} from './coupled-reference-world-assembly.mjs';

// ORIGINAL history only. Never acquire a registry/execution capability, call
// an adapter, refresh consent, rerender or compile a replacement asset.
export function coupledReferenceWorldAssemblyReservationView(saved) {
  const v=saved.value,p=v.prepared;
  return {format:'CoupledReferenceWorldAssemblyRetainedJob',version:1,purpose:'coupled-reference-world-assembly',id:v.id,
    requestHash:v.requestHash,preparationHash:p.preparationHash,runtimeHash:p.runtimeHash,
    recipient:{agent:p.selected.agent,model:p.selected.model,effort:p.selected.effort},tier:p.tier,
    maximumCalls:p.maximumCalls,originalDispatchRetained:saved.dispatchClaim!==null,
    reservationInspectionOnly:true,automaticRetries:0,allowsNewModelCall:false,
    serverBaselineVerified:false,canAuthorizePlacement:false,worldWrites:0};
}
export async function listCoupledReferenceWorldAssemblyRecords({dataDir}) {
  let root;try{root=await coupledAssemblyJobRoot(dataDir);}catch(error){if(error.code==='ENOENT')return [];throw error;}
  const ids=[];
  for await(const entry of await fs.opendir(root)) {
    if(entry.name==='_reserve.lock')continue;
    if(!REFERENCE_OWNER.test(entry.name)||!entry.isDirectory()||entry.isSymbolicLink())throw Error('Unknown original full-task history; nothing adopted or evicted');
    ids.push(entry.name);if(ids.length>COUPLED_REFERENCE_WORLD_ASSEMBLY_JOB_LIMITS.records)throw Error('Original full-task history quota; nothing evicted');
  }
  const records=[];
  for(const id of ids.sort()){
    const status=await readCoupledReferenceWorldAssemblyJobStatus({dataDir,id});
    if(!status)throw Error('Original full-task history disappeared');
    records.push(status);
  }
  return records;
}
export async function readCoupledReferenceWorldAssemblyJobStatus({dataDir,id,expectedRequestHash=null}) {
  const saved=await readCoupledReferenceWorldAssemblyJobRecord({dataDir,id,expectedRequestHash});if(!saved)return null;
  const {directory,value:v}=saved,p=v.prepared;
  let reservedCalls=0,pendingCalls=0,responseCalls=0,failedCalls=0,lastState=null;
  const journal=path.join(directory,'assembly-journal');let journalExists=true;
  try{await jointInvocationDirectory(journal);}catch(error){if(error.code==='ENOENT')journalExists=false;else throw error;}
  if(journalExists) {
    const identity=await readJointAssemblyJobEnvelope(path.join(journal,'identity.json'),4096);
    if(hash(identity)!==hash({version:1,requestHash:p.preparationHash,policyHash:p.policyHash,runtimeHash:p.runtimeHash,maximumCalls:p.maximumCalls}))
      throw Error('Original history ledger identity changed');
    const names=[];
    for await(const entry of await fs.opendir(journal))if(/^call-\d+\.json$/.test(entry.name)) {
      names.push(entry.name);if(names.length>p.maximumCalls)throw Error('Original history call quota');
    }
    names.sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
    for(const [i,name]of names.entries()) {
      if(name!==`call-${i+1}.json`)throw Error('Original history call order changed');
      const call=await readJointAssemblyJobEnvelope(path.join(journal,name),2*1024**2);
      if(call.index!==i+1||!['pending','response','error'].includes(call.state)||!/^[a-f0-9]{64}$/.test(call.fingerprint??''))throw Error('Original history call changed');
      reservedCalls++;lastState=call.state;
      if(call.state==='pending')pendingCalls++;else if(call.state==='response')responseCalls++;else failedCalls++;
    }
    let dispatched=0;
    try{const count=await readJointAssemblyJobEnvelope(path.join(journal,'dispatched.json'),4096);exactKeys(count,['count'],'original dispatched count');dispatched=count.count;}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if(!Number.isSafeInteger(dispatched)||dispatched<0||dispatched>reservedCalls||reservedCalls>dispatched+1
      ||reservedCalls>dispatched&&lastState!=='pending'||pendingCalls>1||pendingCalls&&lastState!=='pending'
      ||reservedCalls&&!saved.dispatchClaim)throw Error('Original history dispatch count changed');
  }
  let candidate=null,state=saved.dispatchClaim?'dispatch-consumed-needs-original-inspection':'send-consumed-not-dispatched';
  if(reservedCalls)state=pendingCalls?'unknown-needs-original-inspection':failedCalls?'failed-needs-original-inspection':'responses-retained-needs-original-inspection';
  const root=path.join(directory,COUPLED_REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY);
  let exists=true;try{await jointInvocationDirectory(root);}catch(error){if(error.code==='ENOENT')exists=false;else throw error;}
  if(exists) {
    const pointer=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await jointAssemblyJobBytes(path.join(root,'candidate.json'),WORLD_ASSEMBLY_LIMITS.metadataBytes)));
    const result=await readCoupledReferenceWorldAssemblyCandidate({directory,referenceInput:v.referenceInput,preparationHash:p.preparationHash,candidateHash:pointer.candidateHash});
    candidate={candidateHash:result.candidate.candidateHash,patchSetHash:result.candidate.patchSetHash,
      partCount:result.candidate.partCount,operationCount:result.candidate.operationCount,partIsApplyScope:false,canAuthorizePlacement:false};
    state='preview-ready';
  }
  return {...coupledReferenceWorldAssemblyReservationView(saved),state,reservedCalls,pendingCalls,responseCalls,failedCalls,candidate,
    originalHistoryOnly:true,originalLiveExecutionOnly:false,canResume:false,providerReceiptsIndependentlyAudited:false};
}
