import assert from 'node:assert/strict';
import {REFERENCE_OWNER} from './reference-attachments.mjs';
import {REFERENCE_DIGEST} from './reference-generation.mjs';

export const REFERENCE_JOB_LIMITS=Object.freeze({inputBytes:8192,submissions:64,lanes:1});
export function validateReferenceGenerationJobRequest(input){
  assert.ok(input&&typeof input==='object'&&!Array.isArray(input),'Explicit reference generation SEND required');
  assert.deepEqual(Object.keys(input).sort(),['format','version','ownerId','preparationHash','sendConfirmation'].sort(),'Unknown reference SEND fields');
  assert.equal(input.format,'ReferenceGenerationJobRequest');assert.equal(input.version,1);
  assert.match(input.ownerId,REFERENCE_OWNER);assert.match(input.preparationHash,REFERENCE_DIGEST);
  // Full confirmation identity is independently checked against original
  // preparation bytes in the bounded worker, never supplied client policy.
  assert.equal(input.sendConfirmation?.format,'ReferenceGenerationSend');
  assert.equal(input.sendConfirmation?.ownerId,input.ownerId);
  assert.equal(input.sendConfirmation?.preparationHash,input.preparationHash);return input;
}
export function referenceGenerationJobCapabilities(enabled=false){
  return {format:'ReferenceGenerationJobCapabilities',version:1,sendingImplemented:enabled,
    preparationVersion:2,provider:'codex',sharedBudget:true,originalReceiptRecoveryOnly:true,
    immutableJobOwnedImages:true,ordinaryJobsAcceptReferences:false,canAuthorizePlacement:false,
    limits:{...REFERENCE_JOB_LIMITS}};
}
