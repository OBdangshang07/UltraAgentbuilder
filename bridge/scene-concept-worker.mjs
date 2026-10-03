import {parentPort,workerData} from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import {compileScene} from '../src/design/compiler.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {dimensions,checkRequestedSize} from '../src/design/checkpoint.mjs';
import {inspectConstruction} from '../src/design/construction-feedback.mjs';

const {scene,policy,directory}=workerData;
const report={version:2,sourceHash:hash(scene),geometryPassed:false,canAuthorizePlacement:false,error:null};
try{
  if(![3,4].includes(policy.assembly?.quality?.version)||scene.constraints.interior!==false||scene.constraints.walkable!==false||scene.constraints.passages.length)throw new Error('Concept-only inspection requires explicit v3/v4 and diagnostic intent');
  report.constructionFeedback=inspectConstruction(scene);
  const compiled=compileScene(scene,{navigationPolicy:'review'}),occupied=dimensions(compiled);
  checkRequestedSize(compiled,policy,occupied);
  // Ignore material names/order when checking for colour-only duplicates. KEEP
  // versus CLEAR still matter for construction, but do not make a new silhouette.
  const mask=Buffer.from(Uint8Array.from(compiled.cells,c=>c>=2?1:0));
  const {assetHash,...metadata}=compiled.manifest;
  const marked={...metadata,diagnosticOnly:true,conceptOnly:true};
  const manifest={...marked,assetHash:hash(marked)};
  await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest),{flag:'wx'});
  await fs.writeFile(path.join(directory,'cells.bin'),compiled.binary,{flag:'wx'});
  parentPort.postMessage({ok:true,report:{...report,geometryPassed:true,diagnosticAssetHash:manifest.assetHash,geometryHash:hash({dimensions:manifest.dimensions,mask:hash(mask)}),...occupied}});
}catch(error){
  // Compiler-owned, bounded evidence only. Never forward stack traces, arbitrary
  // exception properties or an automatic geometry/permission repair.
  for(const key of ['layoutFeedback','roomZoneFeedback','designConflicts'])if(error[key])report[key]=structuredClone(error[key]);
  parentPort.postMessage({ok:true,report:{...report,error:error.message}});
}
