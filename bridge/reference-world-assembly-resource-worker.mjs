import path from 'node:path';
import fs from 'node:fs/promises';
import {parentPort,workerData} from 'node:worker_threads';
import {exactKeys} from '../contracts/world-selection.mjs';
import {REFERENCE_OWNER} from '../contracts/reference-attachments.mjs';
import {prepareReferenceWorldAssemblyDraft,bindReferenceWorldAssemblyDraft,validateJointAssemblyReferenceInput} from './reference-world-assembly-input.mjs';
import {readReferenceWorldAssemblyCandidate} from './reference-world-assembly.mjs';
import {readCohortReferenceWorldAssemblyCandidate,referenceWorldAssemblyCandidatePart} from './reference-world-assembly-candidate.mjs';
import {jointReadCohortKey} from './reference-world-assembly-read-cohort.mjs';
import {JOINT_ASSEMBLY_RESOURCE_LIMITS} from './reference-world-assembly-resources.mjs';
import {readReferenceWorldAssemblyJobRecord} from './reference-world-assembly-job-data.mjs';
import {readReferenceWorldAssemblyJobStatus,listReferenceWorldAssemblyRecords} from './reference-world-assembly-history.mjs';
import {readReferenceWorldAssemblyNative,uploadReferenceWorldAssemblyNative} from './reference-world-assembly-native.mjs';
import {publicAssemblyAdmissionFailure} from './reference-world-assembly-admission-failure.mjs';

const digest=/^[a-f0-9]{64}$/;
async function physical(root) {
  root=path.resolve(root);let ancestor=path.parse(root).root;
  for(const part of path.relative(ancestor,root).split(path.sep).filter(Boolean)) {
    ancestor=path.join(ancestor,part);const stat=await fs.lstat(ancestor);
    if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(ancestor)!==ancestor)throw Error('Private joint directory redirected');
  }
  return root;
}
// No generic worker operation, directory, runtime override, model adapter or
// world writer is accepted. Bind copies ONLY the new independently confirmed
// complete task. A worker stop never grants repair/takeover or redispatch.
try {
  exactKeys(workerData,['dataDir','operation','id','payload','cohort'],'private joint resource worker');
  const {operation,id,payload}=workerData;
  if(!['prepare','bind','metadata','part','job-record','job-status','job-list','native-read','native-upload'].includes(operation)
    ||(operation==='job-list'?id!==null:typeof id!=='string'||!REFERENCE_OWNER.test(id)))throw Error('Original joint operation/UUID required');
  if(!(payload instanceof Uint8Array)||payload.byteLength<1||payload.byteLength>(operation==='native-upload'?JOINT_ASSEMBLY_RESOURCE_LIMITS.nativeUploadBytes:JOINT_ASSEMBLY_RESOURCE_LIMITS.inputBytes))
    throw Object.assign(Error('Joint input byte quota'),{statusCode:413});
  const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload));
  const dataDir=await physical(workerData.dataDir),directory=id===null?null:path.join(dataDir,'reference-world-assembly-jobs',id);
  let result,verification=null;
  if(operation==='job-list') {
    exactKeys(input,[],'original full-task history list');result=await listReferenceWorldAssemblyRecords({dataDir});
  }else if(operation==='job-status') {
    exactKeys(input,['expectedRequestHash'],'original full-task status');result=await readReferenceWorldAssemblyJobStatus({dataDir,id,...input});
  }else if(operation==='native-read'||operation==='native-upload') {
    exactKeys(input,['expectedRequestHash','evidenceId',operation==='native-read'?'member':'upload'],'original full-task native transport');
    result=await (operation==='native-read'?readReferenceWorldAssemblyNative:uploadReferenceWorldAssemblyNative)({dataDir,id,...input});
  }else if(operation==='job-record') {
    exactKeys(input,['expectedRequestHash'],'original full joint reservation read');
    result=await readReferenceWorldAssemblyJobRecord({dataDir,id,expectedRequestHash:input.expectedRequestHash});
  }else if(operation==='prepare'||operation==='bind') {
    exactKeys(input,['contextId','referenceSetHash','generation','selectedCapability',...(operation==='bind'?['send']:[])],'independent joint resource preparation');
    if(input.generation?.key!==id)throw Error('Joint generation key differs from original image owner');
    const options={...input,dataDir,referenceOwnerId:id};
    result=operation==='prepare'?await prepareReferenceWorldAssemblyDraft(options)
      :await bindReferenceWorldAssemblyDraft({...options,directory});
  }else {
    exactKeys(input,['referenceInput','preparationHash','candidateHash',...(operation==='part'?['partIndex']:[])],'original complete joint result identity');
    validateJointAssemblyReferenceInput(input.referenceInput);
    if(input.referenceInput.ownerId!==id||input.referenceInput.preparationHash!==input.preparationHash
      ||!digest.test(input.preparationHash??'')||!digest.test(input.candidateHash??''))throw Error('Original complete joint result pins required');
    await physical(directory);
    const key=jointReadCohortKey(operation,id,payload),cohort=workerData.cohort;
    if(cohort!==null&&cohort?.key!==key)throw Error('Private verified cohort differs from exact original read identity');
    const original=cohort===null
      ?await readReferenceWorldAssemblyCandidate({...input,directory,retainParts:false})
      :await readCohortReferenceWorldAssemblyCandidate({directory,cohort,expectedCandidateHash:input.candidateHash,
        partIndex:operation==='part'?input.partIndex:null});
    // Cold part reads also retain just their selected part during the FULL
    // verifier. All other parts/proofs remain mandatory and byte-checked.
    if(operation==='part')result=referenceWorldAssemblyCandidatePart(original,input.partIndex);
    else result={candidate:original.candidate,patchSet:original.patchSet,originalCompleteSetReverified:true,
      additionalModelCalls:0,worldWrites:0,canAuthorizePlacement:false};
    if(cohort===null)verification={kind:'original-complete-rebuild',key,candidate:original.candidate,patchSet:original.patchSet};
  }
  // The private full-verifier receipt shares the ORIGINAL output allowance;
  // adding owner-memory reuse must not enlarge the worker's IPC message quota.
  const reply={operation,id,ok:true,result,verification};
  if(Buffer.byteLength(JSON.stringify(reply))>JOINT_ASSEMBLY_RESOURCE_LIMITS.outputBytes)
    throw Object.assign(Error('Joint output quota; no partial result'),{statusCode:413});
  parentPort.postMessage(reply);
}catch(error){parentPort.postMessage({operation:workerData?.operation,id:workerData?.id,ok:false,
  statusCode:[400,409,413].includes(error.statusCode)?error.statusCode:409,
  ...(publicAssemblyAdmissionFailure(error)?{admissionDiagnostic:publicAssemblyAdmissionFailure(error)}:{})});}
