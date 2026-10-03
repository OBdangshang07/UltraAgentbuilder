import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyPlan} from '../design/assembly-fixtures.mjs';
import {inspectCheckpoint} from '../../bridge/scene-checkpoints.mjs';
import {nativeViewsForScene} from '../../src/design/quality-prototypes.mjs';
import {requestNativeEvidence,acceptNativeEvidence,createNativeRevisionComparison,readNativeRevisionComparison,validateModelImageFiles} from '../../bridge/native-evidence.mjs';
import {fixtureUpload} from './native-evidence-fixtures.mjs';

async function pair(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-native-revision-')),before=assemblyPlan().scene,after=structuredClone(before),signal=new AbortController().signal;
  after.components[0].material='frame';
  const cameras=nativeViewsForScene(before,'ultra');
  const capture=async(scene,name,views=cameras)=>{
    const bundleDirectory=path.join(root,name),report=await inspectCheckpoint(scene,{navigationPolicy:'review'},bundleDirectory,signal);assert.equal(report.geometryPassed,true,report.error);
    return requestNativeEvidence({jobDirectory:root,bundleDirectory,sourceHash:hash(scene),assetHash:report.diagnosticAssetHash,views,signal,timeoutMs:2000,onWaiting:async s=>{if(s.state==='waiting')await acceptNativeEvidence(root,s.id,fixtureUpload(s.request));}});
  };
  return {root,before,after,capture,a:await capture(before,'before'),b:await capture(after,'after')};
}
test('revision compares four camera-matched pairs, binds both sources and prefers architectural coverage over redundant exteriors',async()=>{
  const {root,a,b}=await pair(),result=await createNativeRevisionComparison(root,a.evidence.requestHash,b.evidence.requestHash);
  assert.equal(result.images.length,8);assert.equal(result.evidence.sourceHash,b.evidence.sourceHash);assert.equal(result.evidence.subjects[0].sourceHash,a.evidence.sourceHash);
  assert.deepEqual(result.evidence.pairs.map(p=>p.purpose),['exterior','facade-detail','entry','typical-floor']);
  assert.deepEqual(result.evidence.views.map(v=>v.subjectId),['before','after','before','after','before','after','before','after']);
  assert.equal(result.evidence.canAuthorizePlacement,false);assert.equal(result.evidence.aestheticQualityVerified,false);
  await validateModelImageFiles(result.images,root);
  assert.deepEqual((await createNativeRevisionComparison(root,a.evidence.requestHash,b.evidence.requestHash)).evidence,result.evidence);
  await assert.rejects(validateModelImageFiles(result.images.slice(0,4),root),/selection/);
  await assert.rejects(validateModelImageFiles([result.images[0],...result.images.slice(1).reverse()],root),/selection/);
  const bytes=await fs.readFile(result.images[3]);bytes[40]^=1;await fs.writeFile(result.images[3],bytes);
  await assert.rejects(readNativeRevisionComparison(root,result.evidence.evidenceHash),/changed/);
});
test('changed camera crops cannot be called a same-view revision even with valid source receipts',async()=>{
  const {root,a,after,capture}=await pair(),cameras=nativeViewsForScene(after,'ultra');cameras[0].yaw+=5;
  const changed=await capture(after,'changed-camera',cameras);
  await assert.rejects(createNativeRevisionComparison(root,a.evidence.requestHash,changed.evidence.requestHash,[cameras[0].id,cameras[1].id]),/cameras differ/);
  await assert.rejects(createNativeRevisionComparison(root,a.evidence.requestHash,changed.evidence.requestHash,['entry','entry']),/distinct/);
});
