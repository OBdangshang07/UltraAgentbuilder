import assert from 'node:assert/strict';
import {REFERENCE_OWNER} from './reference-attachments.mjs';
import {hash} from '../src/generation/compiler.mjs';

export const REFERENCE_DIGEST=/^[a-f0-9]{64}$/;
function exact(value,keys){
  assert.ok(value&&typeof value==='object'&&!Array.isArray(value),'Reference identity object required');
  assert.deepEqual(Object.keys(value).sort(),[...keys].sort(),'Unknown or missing reference identity fields');
}
// This is deliberately NOT the free ReferenceSendConfirmation used to
// inspect/confirm a preparation. SEND binds the full immutable preparation.
export function validateReferenceGenerationSend(value,preparation){
  const content={format:'ReferenceGenerationSend',version:1,action:'send-reference-generation',
    ownerId:preparation.ownerId,preparationHash:preparation.preparationHash,requestHash:preparation.requestHash,
    generationHash:preparation.generationHash,setHash:preparation.referenceSetHash,
    policyHash:hash(preparation.policy),runtimeHash:preparation.runtimeHash,
    provider:preparation.provider,model:preparation.model,accepted:true};
  exact(value,Object.keys(content));assert.deepEqual(value,content,'Reference SEND no longer matches the exact preparation');
  return value;
}
export function validateJobReferenceInput(value){
  exact(value,['format','version','ownerId','bindingHash']);
  assert.equal(value.format,'JobReferenceInput');assert.equal(value.version,1);
  assert.match(value.ownerId,REFERENCE_OWNER);assert.match(value.bindingHash,REFERENCE_DIGEST);return value;
}
