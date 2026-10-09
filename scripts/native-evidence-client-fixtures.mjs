import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {floorWorldTower} from '../tests/design/floor-components-fixtures.mjs';
import {generationPreflight} from '../bridge/generation-policy.mjs';
import {inspectCheckpoint} from '../bridge/scene-checkpoints.mjs';
import {createAssemblyCameraBasis} from '../bridge/assembly-camera-evidence.mjs';
import {requestNativeEvidence} from '../bridge/native-evidence.mjs';
import {hash} from '../src/generation/compiler.mjs';

// Synthetic scene, actual producer cameras and exact native request bytes.
// No model, images, game or world writes. Java must not use a hand-reduced
// camera object that silently omits the production framing metadata.
export async function makeNativeEvidenceClientFixtures(parent='mod/build/test-fixtures'){
 const directory=path.resolve(parent,'native-framing-client'),stage=path.join(directory,'stage'),bundleDirectory=path.join(stage,'diagnostic');
 await fs.mkdir(stage,{recursive:true});const scene=floorWorldTower();
 const policy=generationPreflight({agent:'codex',model:'offline',prompt:'Synthetic offline camera contract',generationMode:'scene',sceneWorkflow:'components',
  qualityTier:'ultra',assemblyCalls:26,assemblyQuality:'v4',assemblyDesignReview:'native',assemblyRecovery:'safe',assemblyPrototypes:'staged',assemblyEvidence:'representative-v1',maxRepairs:0});
 await fs.writeFile(path.join(stage,'scene.json'),JSON.stringify(scene));
 const signal=new AbortController().signal,checkpoint=await inspectCheckpoint(scene,policy,bundleDirectory,signal,{});
 assert.equal(checkpoint.geometryPassed,true,checkpoint.error);
 const basis=await createAssemblyCameraBasis({directory,bundleDirectory,scene,assetHash:checkpoint.diagnosticAssetHash,tier:policy.assembly,
  representatives:{'typical-floor-core':[{kind:'typical-floor',components:['officeZone']},{kind:'core-interface',components:['core']}]}});
 assert.equal(basis.selection.status,'selected');assert.equal(basis.views.length,8);
 let request;
 await assert.rejects(requestNativeEvidence({jobDirectory:directory,bundleDirectory,sourceHash:hash(scene),assetHash:checkpoint.diagnosticAssetHash,
  views:basis.views,signal,timeoutMs:0,onWaiting:async state=>{if(state.state==='waiting')request=state.request;}}),/原生视觉证据等待超时/);
 assert.ok(request);assert.ok(request.views.filter(v=>v.framing).length>=3);
 await fs.writeFile(path.join(directory,'request.json'),JSON.stringify(request));
 for(const member of ['manifest.json','cells.bin'])await fs.copyFile(path.join(directory,'native-evidence',request.requestHash,member),path.join(directory,member));
 return {directory,request,basis,modelCalls:0,worldWrites:0};
}

