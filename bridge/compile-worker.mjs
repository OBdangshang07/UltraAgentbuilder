import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import { compileSpec,hash } from '../src/generation/compiler.mjs';
import {compareCompiled} from '../src/generation/diff.mjs';
import {readNativeBundle} from '../src/generation/bundle.mjs';
import { exportCompiled } from '../src/generation/export.mjs';
import {validateRequestedHeight} from './generation-policy.mjs';
import {compileScene} from '../src/design/compiler.mjs';
import {reviseScene} from '../src/design/revision.mjs';
import {inspectConstruction} from '../src/design/construction-feedback.mjs';

// Only a fresh design's internal ownership/reservation conflicts qualify for an
// analysis view. Schema, bounds, block states and scoped-revision failures do not.
// Keep the failed job failed; never export this last-writer diagnostic geometry.
async function compileFreshScene(source,options){
  try{return compileScene(source,options);}catch(error){
    if(!error.designConflicts||workerData.baseDirectory||workerData.validateOnly)throw error;
    try{
      const view=compileScene(source,{...options,diagnosticOnly:true});
      validateRequestedHeight(view,workerData.policy);
      if(workerData.policy?.worldHeight&&view.manifest.dimensions.height>workerData.policy.worldHeight)throw new Error('Diagnostic exceeds requested world height');
      const directory=path.join(workerData.directory,'diagnostic');
      await fs.mkdir(directory,{recursive:true});
      await fs.writeFile(path.join(directory,'cells.bin'),view.binary);
      await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(view.manifest,null,2));
      error.diagnosticPreview=view.manifest;
    }catch(analysisError){error.diagnosticUnavailable=analysisError.message;}
    throw error;
  }
}

try {
  const options={normalizeGeneratedPassages:workerData.generated===true,navigationPolicy:workerData.validateOnly?'strict':workerData.policy?.navigationPolicy??'review'};
  const revisionBase=workerData.sceneRevision&&workerData.baseDirectory?await readNativeBundle(workerData.baseDirectory):undefined;
  const revision=workerData.sceneRevision?reviseScene(workerData.sceneRevision.baseScene,workerData.spec,workerData.sceneRevision.scope,{...options,baseCompiled:revisionBase}):null;
  const compiled = workerData.importDirectory?await readNativeBundle(workerData.importDirectory):revision?.compiled??(workerData.spec?.format==='SceneSpec'?await compileFreshScene(workerData.spec,options):compileSpec(workerData.spec,options));
  validateRequestedHeight(compiled,workerData.policy);
  if(workerData.policy?.worldHeight&&compiled.manifest.dimensions.height>workerData.policy.worldHeight)throw new Error('生成高度超出请求时的维度总高度；未裁剪或缩放。');
  if(!workerData.validateOnly){
  await fs.mkdir(workerData.directory, { recursive: true });
  const spec=compiled.spec??workerData.spec;if(spec)await fs.writeFile(path.join(workerData.directory, 'spec.json'), JSON.stringify(spec));
  if(compiled.scene)await fs.writeFile(path.join(workerData.directory,'scene.json'),JSON.stringify(compiled.scene));
  if(compiled.designSources)await fs.writeFile(path.join(workerData.directory,'design-sources.json'),JSON.stringify(compiled.designSources,null,2));
  if(compiled.sourceOwners){const bytes=Buffer.alloc(compiled.sourceOwners.length*2);compiled.sourceOwners.forEach((v,i)=>bytes.writeUInt16LE(v,i*2));await fs.writeFile(path.join(workerData.directory,'source-owners.bin'),bytes);}
  if(revision)await fs.writeFile(path.join(workerData.directory,'scene-revision.json'),JSON.stringify(revision.revision,null,2));
  await fs.writeFile(path.join(workerData.directory, 'cells.bin'), compiled.binary);
  await fs.writeFile(path.join(workerData.directory, 'manifest.json'), JSON.stringify(compiled.manifest, null, 2));
  if(workerData.baseDirectory){
    const manifest=JSON.parse(await fs.readFile(path.join(workerData.baseDirectory,'manifest.json'),'utf8')),binary=await fs.readFile(path.join(workerData.baseDirectory,'cells.bin'));
    const {assetHash,...metadata}=manifest;if(hash(metadata)!==assetHash||hash(binary)!==manifest.cellsHash||binary.length!==manifest.dimensions.width*manifest.dimensions.height*manifest.dimensions.length*2)throw new Error('Base revision integrity check failed');
    const cells=new Uint16Array(binary.length/2);for(let i=0;i<cells.length;i++)cells[i]=binary.readUInt16LE(i*2);
    await fs.writeFile(path.join(workerData.directory,'diff.json'),JSON.stringify(compareCompiled({manifest,cells},compiled),null,2));
  }
  await exportCompiled(compiled, workerData.directory);
  }
  parentPort.postMessage({ ok: true, manifest: compiled.manifest });
} catch (error) {
  let constructionFeedback;
  // Feedback is separate from rejected geometry, never an importable asset or
  // authority to alter a completed/scoped revision.
  if(workerData.spec?.format==='SceneSpec'&&!workerData.sceneRevision){
    try{constructionFeedback=inspectConstruction(workerData.spec);}catch{/* Preserve the original failure even if analysis is unavailable. */}
  }
  parentPort.postMessage({ok:false,error:error.message,diagnosticPreview:error.diagnosticPreview,diagnosticUnavailable:error.diagnosticUnavailable,constructionFeedback});
}
