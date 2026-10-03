import assert from 'node:assert/strict';
import {hash} from '../src/generation/compiler.mjs';
import {validateReferencePreparation} from '../contracts/reference-preparation.mjs';
import {readReferenceSet} from './reference-attachments.mjs';
import {safeEvidenceFile} from './native-evidence.mjs';

// Pure read helpers are separate from the worker entrypoint. Importing a
// top-level-await worker during its own operation would deadlock module loading.
export const referencePreparationRequestHash=({version,generation,referenceSetHash,policy,runtimeHash})=>
  hash(version===1?{version:1,generation,referenceSetHash}:{version:2,generation,referenceSetHash,policyHash:hash(policy),runtimeHash});
export async function readReferencePreparation(root,ownerId,preparationHash){
  assert.match(preparationHash,/^[a-f0-9]{64}$/);const prefix=`preparations/${preparationHash}`;
  const recordBytes=await safeEvidenceFile(root,prefix+'/preparation.json',131072);
  const saved=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(recordBytes));
  const {preparationHash:actual,...content}=saved;
  assert.deepEqual(Object.keys(content).sort(),['format','version','ownerId','provider','model','generation','generationHash','requestHash',
    'referenceSetHash','references','referenceMode','policy','runtimeHash','referenceAnalysisUsesTaskBudget','generationSubmitted',
    'callsReserved','sendingImplemented','canAuthorizePlacement'].sort(),'Unknown reference preparation fields');
  assert.equal(actual,preparationHash);assert.equal(hash(content),actual);
  assert.equal(content.format,'ReferenceGenerationPreparation');assert.ok([1,2].includes(content.version));assert.equal(content.ownerId,ownerId);
  assert.equal(content.generation.key,ownerId);assert.equal(content.provider,'codex');assert.equal(content.model,content.generation.model);
  assert.equal(content.generationSubmitted,false);assert.equal(content.callsReserved,0);assert.equal(content.sendingImplemented,false);assert.equal(content.canAuthorizePlacement,false);
  assert.match(content.runtimeHash,/^[a-f0-9]{64}$/);assert.equal(content.referenceAnalysisUsesTaskBudget,true);
  assert.equal(content.generationHash,hash(content.generation));
  assert.equal(content.requestHash,referencePreparationRequestHash(content));
  const references=await readReferenceSet(root,content.referenceSetHash);
  assert.equal(content.referenceMode,references.manifest.mode);
  assert.equal(hash(content.references),hash(references.manifest.references));
  const policy=validateReferencePreparation(ownerId,{format:'ReferenceGenerationPreparationRequest',version:content.version,generation:content.generation,
    upload:{format:'UserReferenceUpload',version:1,mode:references.manifest.mode,references:references.manifest.references.map(r=>({png:'',annotation:r.annotation}))}});
  assert.equal(hash(policy),hash(content.policy));return {preparation:saved,references,recordBytes};
}
