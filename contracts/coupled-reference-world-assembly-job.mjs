import {exactKeys} from './world-selection.mjs';
import {REFERENCE_OWNER} from './reference-attachments.mjs';

export const COUPLED_REFERENCE_ASSEMBLY_PURPOSE='coupled-reference-world-assembly';
export function validateCoupledReferenceWorldAssemblyJobRequest(value){
  exactKeys(value,['format','version','purpose','contextId','referenceOwnerId','referenceSetHash','generation','send'],'new coupled full task request');
  if(value.format!=='CoupledReferenceWorldAssemblyJobRequest'||value.version!==1||value.purpose!==COUPLED_REFERENCE_ASSEMBLY_PURPOSE
    ||!REFERENCE_OWNER.test(value.contextId??'')||!REFERENCE_OWNER.test(value.referenceOwnerId??'')||!/^[a-f0-9]{64}$/.test(value.referenceSetHash??'')
    ||!value.generation||typeof value.generation!=='object'||Array.isArray(value.generation)||value.generation.key!==value.referenceOwnerId||value.generation.agent!=='codex')throw Error('Explicit new coupled full task required; no legacy request upgrade');
  exactKeys(value.send,['format','version','purpose','confirmed','preparationHash','maximumCalls'],'new coupled SEND');
  if(value.send.format!=='CoupledReferenceWorldAssemblySend'||value.send.version!==1||value.send.purpose!==value.purpose||value.send.confirmed!==true
    ||!/^[a-f0-9]{64}$/.test(value.send.preparationHash??'')||![8,14,20,26].includes(value.send.maximumCalls))throw Error('Independent new coupled full SEND required');
  if(Buffer.byteLength(JSON.stringify(value))>32768)throw Error('Coupled full request byte quota');return structuredClone(value);
}

export function coupledReferenceAssemblyOriginalRequest(original){
  const p=original.prepared;
  return validateCoupledReferenceWorldAssemblyJobRequest({format:'CoupledReferenceWorldAssemblyJobRequest',version:1,purpose:COUPLED_REFERENCE_ASSEMBLY_PURPOSE,
    contextId:p.contextId,referenceOwnerId:p.jobId,referenceSetHash:p.referenceSetHash,generation:original.reference.preparation.generation,send:original.send});
}
