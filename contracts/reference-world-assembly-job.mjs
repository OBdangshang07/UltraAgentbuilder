import {exactKeys} from './world-selection.mjs';
import {REFERENCE_OWNER} from './reference-attachments.mjs';

export const REFERENCE_WORLD_ASSEMBLY_JOB_LIMITS=Object.freeze({records:8,requestBytes:32768,recordBytes:131072,dispatchBytes:4096});
const uuid=value=>typeof value==='string'&&REFERENCE_OWNER.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

/** Independent FULL task, not a legacy one-call joint SEND, ordinary image
 * job, caller path, capability, runtime override or world-write permission. */
export function validateReferenceWorldAssemblyJobRequest(value) {
  exactKeys(value,['format','version','purpose','contextId','referenceOwnerId','referenceSetHash','generation','send'],'complete joint job request');
  if(value.format!=='ReferenceWorldAssemblyJobRequest'||value.version!==2||value.purpose!=='reference-world-assembly'
    ||!uuid(value.contextId)||!uuid(value.referenceOwnerId)||!digest(value.referenceSetHash)
    ||!value.generation||typeof value.generation!=='object'||Array.isArray(value.generation)
    ||value.generation.key!==value.referenceOwnerId||value.generation.agent!=='codex')throw Error('Exact original complete joint request required');
  exactKeys(value.send,['format','version','purpose','confirmed','preparationHash','maximumCalls'],'complete joint job SEND');
  if(value.send.format!=='ReferenceWorldAssemblySend'||value.send.version!==2||value.send.purpose!==value.purpose
    ||value.send.confirmed!==true||!digest(value.send.preparationHash)||![8,14,20,26].includes(value.send.maximumCalls))
    throw Error('New exact FULL shared-budget joint SEND required');
  if(Buffer.byteLength(JSON.stringify(value))>REFERENCE_WORLD_ASSEMBLY_JOB_LIMITS.requestBytes)throw Error('Complete joint request byte quota');
  // Full generation, policy, pixels, model/effort and C/W/P validation still
  // comes from the SAME original preparation builder in the bounded worker.
  return structuredClone(value);
}
