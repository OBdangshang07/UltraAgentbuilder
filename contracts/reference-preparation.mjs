import {REFERENCE_OWNER, referenceUpload} from './reference-attachments.mjs';
import {generationPreflight} from '../bridge/generation-policy.mjs';
import {referenceAssemblyPreflight} from '../bridge/reference-assembly-policy.mjs';
import {referenceArchiveCapabilities} from './reference-archive.mjs';

export const REFERENCE_PREPARATION_LIMITS = Object.freeze({inputBytes:33554432+65536,drafts:64,setsPerDraft:4,preparationsPerDraft:8,lanes:1});
export const REFERENCE_REQUEST_FIELDS = Object.freeze(['referenceUpload','referenceSet','referenceInput','referenceImages','referenceConfirmation','referencePreparationHash','userImages']);
// Pure pixels have no model, task, budget or confirmation fields. Ordinary
// generation preparation and joint task consent remain separate protocols.
export function validateReferencePixelPreparation(ownerId,input){
  if(!REFERENCE_OWNER.test(ownerId)||!input||input.format!=='ReferencePixelPreparationRequest'||input.version!==1
    ||Object.keys(input).sort().join(',')!=='format,upload,version')throw Error('Exact pixel-only preparation required');
  referenceUpload(input.upload);return input;
}
export function referencePixelPreparationCapabilities(){
  return {format:'ReferencePixelPreparationCapabilities',version:1,pixelPreparationImplemented:true,
    modelDiscovery:false,modelCalls:0,worldWrites:0,generationAuthorityTransferred:false,
    canAuthorizePlacement:false,limits:{inputBytes:REFERENCE_PREPARATION_LIMITS.inputBytes,maximumImages:4,lanes:1}};
}
// Separate from SEND and archive restore. This reads exact active preparation
// bytes for a NEW local editor draft; historical confirmation is never reused.
export function referenceImageRestoreCapabilities(){
  return {format:'ReferenceImageRestoreCapabilities',version:1,readOnly:true,exactOriginalRecordBytes:true,
    newEditorOwnerRequired:true,generationAuthorityTransferred:false,additionalModelCalls:0,worldWrites:0,
    canAuthorizePlacement:false,limits:{recordBytes:131072,maximumImages:4,imageBytes:12582912,setBytes:25165824,setPixels:12582912}};
}
const generationFields=['key','prompt','agent','model','effort','generationMode','sceneWorkflow','qualityTier','assemblyCalls','assemblyConfirmed','assemblyDesignReview','assemblyRecovery','assemblyQuality','assemblyPrototypes','assemblyProviderRecovery','assemblyEvidence','assemblyCompletionReserve','maxRepairs','navigationPolicy','worldHeight'];
export function validateReferencePreparation(ownerId,input){
  if(!REFERENCE_OWNER.test(ownerId)||!input||input.format!=='ReferenceGenerationPreparationRequest'||![1,2].includes(input.version)
      ||Object.keys(input).some(k=>!['format','version','generation','upload'].includes(k)))throw Error('Invalid reference preparation request');
  const generation=input.generation;
  if(input.version===1&&generation&&Object.hasOwn(generation,'assemblyProviderRecovery'))
    throw Error('Bounded provider recovery requires reference preparation v2; legacy preparation cannot gain new authority');
  if(input.version===1&&generation&&Object.hasOwn(generation,'assemblyEvidence'))
    throw Error('Representative camera evidence requires reference preparation v2; legacy preparation is unchanged');
  if(input.version===1&&generation&&Object.hasOwn(generation,'assemblyCompletionReserve'))
    throw Error('Design-correction reserve requires reference preparation v2; legacy preparation is unchanged');
  if(!generation||typeof generation!=='object'||Array.isArray(generation)||Object.keys(generation).some(k=>!generationFields.includes(k))
      ||generation.key!==ownerId||generation.agent!=='codex'||generation.generationMode!=='scene'||generation.sceneWorkflow!=='components'
      ||typeof generation.model!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(generation.model)
      ||generation.effort!==undefined&&(!['none','minimal','low','medium','high','xhigh','max','ultra'].includes(generation.effort)))
    throw Error('Reference preparation requires one exact new component-design request and explicitly selected Codex model');
  referenceUpload(input.upload);
  return input.version===2?referenceAssemblyPreflight(generation):generationPreflight(generation);
}

export function referencePreparationCapabilities(){
  return {format:'ReferencePreparationCapabilities',version:1,preparationImplemented:true,sendingImplemented:false,
    preparationVersions:[1,2],sharedBudgetPreparationVersion:2,
    normalization:'client-png-jpeg-to-canonical-rgba-png',maximumImages:4,provider:'codex',
    modelRequiresAdvertisedImages:true,referenceAnalysisUsesTaskBudget:true,generationSubmitted:false,
    canAuthorizePlacement:false,limits:{...REFERENCE_PREPARATION_LIMITS},archival:referenceArchiveCapabilities()};
}
