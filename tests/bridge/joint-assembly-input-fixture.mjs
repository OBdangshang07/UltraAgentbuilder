import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encodeReferencePixels} from '../../bridge/reference-pixels.mjs';
import {referencePreparationOperation} from '../../bridge/reference-preparation-worker.mjs';
import {assemblyRuntimeIdentity} from '../../bridge/assembly-durability.mjs';

// PURE pixel draft: no ordinary generation preparation, confirm or SEND.
export async function jointPixelFixture(t,{images=2,generationOverrides={}}={}) {
  const dataDir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'voxel-joint-pixels-')));
  t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));
  const ownerId=randomUUID(),jobId=ownerId,jobDirectory=path.join(dataDir,jobId);
  await fs.mkdir(jobDirectory);
  const generation={key:ownerId,prompt:'现代办公楼',agent:'codex',model:'gpt-6.1-sol',effort:'max',
    generationMode:'scene',sceneWorkflow:'components',qualityTier:'lite',assemblyConfirmed:true,assemblyRecovery:'safe',...generationOverrides};
  const upload={format:'UserReferenceUpload',version:1,mode:images>1?'multi-view':'reconstruct',references:Array.from({length:images},(_,i)=>({
    png:encodeReferencePixels(2,1,Buffer.from([i+1,20,30,255,40,50,60,255])).toString('base64'),
    annotation:{purpose:'exterior',view:i?'side':'front',caption:'Synthetic original joint pixels '+i}}))};
  const manifest=await referencePreparationOperation({dataDir,ownerId,operation:'pixel-prepare',
    input:Buffer.from(JSON.stringify({format:'ReferencePixelPreparationRequest',version:1,upload}))});
  return {dataDir,ownerId,jobId,jobDirectory,generation,manifest,runtimeHash:await assemblyRuntimeIdentity()};
}
