import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {fixtureUpload} from './native-evidence-fixtures.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyPlan} from '../design/assembly-fixtures.mjs';
import {inspectCheckpoint} from '../../bridge/scene-checkpoints.mjs';
import {nativeViewsForScene} from '../../src/design/quality-prototypes.mjs';
import {NATIVE_RENDERER,requestNativeEvidence,acceptNativeEvidence,readNativeEvidence,validateModelImageFiles,validateEvidenceRequest,safeEvidenceFile} from '../../bridge/native-evidence.mjs';

async function subject(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-native-evidence-')),scene=assemblyPlan().scene,bundleDirectory=path.join(root,'diagnostic'),signal=new AbortController().signal;
 const report=await inspectCheckpoint(scene,{navigationPolicy:'review'},bundleDirectory,signal);assert.equal(report.geometryPassed,true,report.error);
 return {root,options:{jobDirectory:root,bundleDirectory,sourceHash:hash(scene),assetHash:report.diagnosticAssetHash,views:nativeViewsForScene(scene,'ultra'),signal,timeoutMs:2000}};
}
test('native evidence persists exact subject/cameras and repeated receipt is immutable; synthetic pixels are only a transport fixture',async()=>{
 const {root,options}=await subject();let uploads=0,request;
 const result=await requestNativeEvidence({...options,onWaiting:async state=>{if(state.state!=='waiting')return;uploads++;request=state.request;await acceptNativeEvidence(root,state.id,fixtureUpload(request));}});
 assert.equal(uploads,1);assert.equal(result.images.length,8);assert.equal(result.evidence.cellsHash,request.cellsHash);assert.equal(result.evidence.worldCaptured,false);assert.equal(result.evidence.canAuthorizePlacement,false);
 assert.deepEqual((await requestNativeEvidence({...options,onWaiting:async s=>assert.equal(s.state,'complete')})).evidence,result.evidence);
 assert.deepEqual(await acceptNativeEvidence(root,request.requestHash,fixtureUpload(request)),result.evidence);
 await validateModelImageFiles(result.images,root);
 await assert.rejects(validateModelImageFiles([...result.images].reverse(),root),/isolated/);
 await assert.rejects(validateModelImageFiles(result.images.slice(0,4),root),/selection/);
 const wrong=fixtureUpload(request);wrong.requestHash='0'.repeat(64);await assert.rejects(acceptNativeEvidence(root,request.requestHash,wrong),/mismatch/);
 const bad=fixtureUpload(request);bad.views[0].faces=0;await assert.rejects(acceptNativeEvidence(root,request.requestHash,bad),/mismatch/);
 const changed=fixtureUpload(request);changed.views[0].faces=2;await assert.rejects(acceptNativeEvidence(root,request.requestHash,changed),/identity conflict/);
 const bytes=await fs.readFile(result.images[0]);bytes[40]^=1;await fs.writeFile(result.images[0],bytes);
 await assert.rejects(readNativeEvidence(root,request.requestHash),/hash mismatch/);
});
test('native evidence rejects stale subject and cancellation/timeout never invents text fallback',async()=>{
 const {root,options}=await subject();
 await assert.rejects(requestNativeEvidence({...options,sourceHash:'0'.repeat(64)}),/subject mismatch/);
 await assert.rejects(requestNativeEvidence({...options,timeoutMs:0}),/等待超时/);
 const abort=new AbortController();let waiting;
 await assert.rejects(requestNativeEvidence({...options,signal:abort.signal,onWaiting:async s=>{waiting=s;abort.abort();}}),/abort/i);
 assert.equal(waiting.state,'waiting');await assert.rejects(fs.stat(path.join(root,'native-evidence',waiting.id,'evidence.json')),/ENOENT/);
});

test('a valid committed native receipt is rechecked after waiting callback before declaring timeout',async()=>{
 const {root,options}=await subject();let uploads=0;
 const result=await requestNativeEvidence({...options,timeoutMs:0,onWaiting:async state=>{
  if(state.state!=='waiting')return;uploads++;await acceptNativeEvidence(root,state.id,fixtureUpload(state.request));
 }});
 assert.equal(uploads,1);assert.equal(result.evidence.assetHash,options.assetHash);
 assert.equal(result.evidence.sourceHash,options.sourceHash);assert.equal(result.evidence.canAuthorizePlacement,false);
 assert.equal(result.images.length,options.views.length);
});

test('rechecking after a callback cannot accept missing evidence or suppress cancellation',async()=>{
 const {root,options}=await subject();let waits=0;
 await assert.rejects(requestNativeEvidence({...options,timeoutMs:0,onWaiting:async state=>{if(state.state==='waiting')waits++;}}),/等待超时/);
 assert.equal(waits,1);
 const controller=new AbortController();
 await assert.rejects(requestNativeEvidence({...options,signal:controller.signal,onWaiting:async state=>{
  if(state.state!=='waiting')return;await acceptNativeEvidence(root,state.id,fixtureUpload(state.request));
  controller.abort(Error('cancel-after-native-commit'));
 }}),/cancel-after-native-commit/);
});
test('camera contracts reject out-of-asset clipping and image path escape/links',async()=>{
 const {root,options}=await subject();let request;
 await assert.rejects(requestNativeEvidence({...options,timeoutMs:0,onWaiting:async s=>request=s.request}),/等待超时/);
 for(const mutate of [r=>r.views[0].min[0]=-1,r=>r.views[0].max[1]=999,r=>r.views[1].id=r.views[0].id,r=>r.views[0].width=4096,r=>r.canAuthorizePlacement=true]){
  const changed=structuredClone(request);mutate(changed);delete changed.requestHash;changed.requestHash=hash(changed);assert.throws(()=>validateEvidenceRequest(changed));
 }
 await assert.rejects(safeEvidenceFile(root,'../private.png',1024),/Unsafe/);
 const alias=path.join(root,'alias');await fs.symlink(path.join(root,'diagnostic'),alias,process.platform==='win32'?'junction':'dir');
 await assert.rejects(safeEvidenceFile(root,'alias/manifest.json',1048576),/link forbidden/);
});
