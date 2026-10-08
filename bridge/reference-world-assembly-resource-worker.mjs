import path from 'node:path';
import fs from 'node:fs/promises';
import {parentPort,workerData} from 'node:worker_threads';
import {exactKeys} from '../contracts/world-selection.mjs';
import {REFERENCE_OWNER} from '../contracts/reference-attachments.mjs';
import {prepareReferenceWorldAssemblyDraft,bindReferenceWorldAssemblyDraft,validateJointAssemblyReferenceInput} from './reference-world-assembly-input.mjs';
import {readReferenceWorldAssemblyCandidate,readReferenceWorldAssemblyCandidatePart} from './reference-world-assembly.mjs';
import {JOINT_ASSEMBLY_RESOURCE_LIMITS} from './reference-world-assembly-resources.mjs';

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
  exactKeys(workerData,['dataDir','operation','id','payload'],'private joint resource worker');
  const {operation,id,payload}=workerData;
  if(!['prepare','bind','metadata','part'].includes(operation)||typeof id!=='string'||!REFERENCE_OWNER.test(id))throw Error('Original joint operation/UUID required');
  if(!(payload instanceof Uint8Array)||payload.byteLength<1||payload.byteLength>JOINT_ASSEMBLY_RESOURCE_LIMITS.inputBytes)
    throw Object.assign(Error('Joint input byte quota'),{statusCode:413});
  const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload));
  const dataDir=await physical(workerData.dataDir),directory=path.join(dataDir,'reference-world-assembly-jobs',id);
  let result;
  if(operation==='prepare'||operation==='bind') {
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
    if(operation==='part')result=await readReferenceWorldAssemblyCandidatePart({...input,directory});
    else {
      const original=await readReferenceWorldAssemblyCandidate({...input,directory});
      result={candidate:original.candidate,patchSet:original.patchSet,originalCompleteSetReverified:true,
        additionalModelCalls:0,worldWrites:0,canAuthorizePlacement:false};
    }
  }
  if(Buffer.byteLength(JSON.stringify(result))>JOINT_ASSEMBLY_RESOURCE_LIMITS.outputBytes)
    throw Object.assign(Error('Joint output quota; no partial result'),{statusCode:413});
  parentPort.postMessage({operation,id,ok:true,result});
}catch(error){parentPort.postMessage({operation:workerData?.operation,id:workerData?.id,ok:false,
  statusCode:[400,409,413].includes(error.statusCode)?error.statusCode:409});}
