import {parentPort,workerData} from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import {assessSceneCheckpoint} from '../src/design/checkpoint.mjs';
import {readAssemblyBaseline,checkPackageGeometry,checkPackageCellScope} from '../src/design/assembly-scope.mjs';
import {packageSpatialFeedback} from '../src/design/package-spatial-feedback.mjs';
import {expandedPrototypeRoutesEnabled,PROTOTYPE_SEED_SCOPE_INSPECTION} from '../contracts/assembly-prototype-validation.mjs';

try{
  const {report,compiled}=assessSceneCheckpoint(workerData.scene,workerData.policy);
  if(workerData.assembly?.baselineDirectory&&compiled){
    const a=workerData.assembly;
    if(a.inspection!==undefined&&(a.inspection!==PROTOTYPE_SEED_SCOPE_INSPECTION||!expandedPrototypeRoutesEnabled(workerData.policy.assembly)))throw Error('Unauthorized prototype seed inspection');
    const base=await readAssemblyBaseline(a.baselineDirectory,a.baseAssetHash);
    try{if(report.geometryPassed)report.packageCheck=a.inspection===PROTOTYPE_SEED_SCOPE_INSPECTION
      ?checkPackageCellScope(base,compiled,a.task):checkPackageGeometry(base,compiled,a.task,a.previousFeedback,report);}
    catch(error){report.geometryPassed=false;report.error=error.message;if(error.packageScopeFeedback)report.packageScopeFeedback=error.packageScopeFeedback;if(error.packageNavigationFeedback)report.packageNavigationFeedback=error.packageNavigationFeedback;}
    if(!report.geometryPassed){const evidence=packageSpatialFeedback(base,compiled,a.task,report);if(evidence)report.packageSpatialFeedback=evidence;}
  }
  if(compiled){
    // Not a source bundle. diagnosticOnly also prevents use through any native
    // importer, even if somebody copies these files out of the stage directory.
    await fs.mkdir(workerData.directory,{recursive:true});
    await fs.writeFile(path.join(workerData.directory,'manifest.json'),JSON.stringify(compiled.manifest,null,2),{flag:'wx'});
    await fs.writeFile(path.join(workerData.directory,'cells.bin'),compiled.binary,{flag:'wx'});
    if(workerData.assembly){
      await fs.writeFile(path.join(workerData.directory,'design-sources.json'),JSON.stringify(compiled.designSources),{flag:'wx'});
      const owners=Buffer.alloc(compiled.sourceOwners.length*2);compiled.sourceOwners.forEach((v,i)=>owners.writeUInt16LE(v,i*2));
      await fs.writeFile(path.join(workerData.directory,'source-owners.bin'),owners,{flag:'wx'});
    }
  }
  parentPort.postMessage({ok:true,report});
}catch(error){parentPort.postMessage({ok:false,error:error.message});}
