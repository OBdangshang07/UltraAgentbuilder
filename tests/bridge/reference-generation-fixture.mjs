import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from '../../src/generation/compiler.mjs';
import {encodeReferencePixels} from '../../bridge/reference-pixels.mjs';
import {referencePreparationOperation} from '../../bridge/reference-preparation-worker.mjs';
import {assemblyRuntimeIdentity} from '../../bridge/assembly-durability.mjs';
import {bindReferencePreparationToJob} from '../../bridge/reference-generation-binding.mjs';

export const freeConsent=p=>({format:'ReferenceSendConfirmation',version:1,ownerId:p.ownerId,requestHash:p.requestHash,
  setHash:p.referenceSetHash,provider:p.provider,model:p.model,accepted:true});
export const sendConsent=p=>({format:'ReferenceGenerationSend',version:1,action:'send-reference-generation',
  ownerId:p.ownerId,preparationHash:p.preparationHash,requestHash:p.requestHash,generationHash:p.generationHash,
  setHash:p.referenceSetHash,policyHash:hash(p.policy),runtimeHash:p.runtimeHash,provider:p.provider,model:p.model,accepted:true});
export async function referenceFixture(t,{images=2,caption='正面参考',prompt='现代办公楼',version=1,generationOverrides={}}={}){
  const dataDir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'voxel-reference-job-')));
  t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));
  const ownerId=randomUUID(),jobId=randomUUID(),jobDirectory=path.join(dataDir,jobId),runtimeHash=await assemblyRuntimeIdentity();
  await fs.mkdir(jobDirectory);
  const capability={id:'gpt-6.1-sol',supportsImages:true},generation={key:ownerId,prompt,agent:'codex',model:capability.id,
    effort:'max',generationMode:'scene',sceneWorkflow:'components',qualityTier:'lite',assemblyConfirmed:true,
    ...(version===2?{assemblyRecovery:'safe'}:{}),...generationOverrides};
  const request={format:'ReferenceGenerationPreparationRequest',version,generation,
    upload:{format:'UserReferenceUpload',version:1,mode:images>1?'multi-view':'reconstruct',references:Array.from({length:images},(_,i)=>({
      png:encodeReferencePixels(2,1,Buffer.from([i+1,20,30,255,40,50,60,255])).toString('base64'),
      annotation:{purpose:'exterior',view:i?'side':'front',caption:caption+i}}))}};
  const prepare=(options={})=>referencePreparationOperation({dataDir,ownerId,operation:'prepare',runtimeHash,capability,input:Buffer.from(JSON.stringify(request)),...options});
  const preparation=await prepare();
  const confirm=(p=preparation,options={})=>referencePreparationOperation({dataDir,ownerId,operation:'confirm',runtimeHash:p.runtimeHash,capability,
    preparationHash:p.preparationHash,input:Buffer.from(JSON.stringify(freeConsent(p))),...options});
  const bind=(options={})=>bindReferencePreparationToJob({dataDir,jobDirectory,ownerId,preparationHash:preparation.preparationHash,
    generation,runtimeHash,capability,sendConfirmation:sendConsent(preparation),...options});
  return {dataDir,ownerId,jobId,jobDirectory,runtimeHash,capability,generation,request,preparation,prepare,confirm,bind};
}

export function referenceBrief(reference){
  const ids=reference.manifest.references.map(r=>r.id);
  return {format:'ArchitectureReferenceBrief',version:1,referenceBindingHash:reference.binding.bindingHash,
    referenceSetHash:reference.manifest.setHash,generationHash:reference.preparation.generationHash,mode:reference.manifest.mode,
    imageAssessments:ids.map(imageId=>({imageId,status:'readable',reason:'Offline transport fixture, not real visual understanding'})),
    visibleEvidence:[{imageIds:[ids[0]],aspect:'facade',observation:'Synthetic fixture only',confidence:'low'}],
    userRequirements:[{quote:reference.preparation.generation.prompt,interpretation:'Preserve original request'}],
    scaleAssumptions:[{imageId:ids[0],dimension:'height',basis:'unknown',meters:null,rationale:'No verified scale'}],
    unseenRegions:[{region:'rear/interior',limitation:'Unknown; no geometry or circulation certification'}],conflicts:[],
    designTranslation:[{imageIds:[ids[0]],intent:'Translate into the same bounded component workflow',assumptions:'Unseen details remain decisions'}],
    limitations:['Free fixture, not image understanding or architectural quality'],geometryVerified:false,canAuthorizePlacement:false};
}
