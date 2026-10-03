import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {hash} from '../../src/generation/compiler.mjs';
import {freezeSceneRuntime} from '../../scripts/scene-runtime-snapshot.mjs';
import {inspectQualityStageImages} from '../../scripts/quality-stage-images.mjs';
import {setupPrototypes} from './assembly-prototypes-fixtures.mjs';

test('in-flight image inspection binds full expansion and distinguishes historical BEFORE without new calls or renders',async()=>{
 const fixture=await setupPrototypes(),project=fileURLToPath(new URL('../../',import.meta.url)),directory=fixture.directory;
 const snapshot=await freezeSceneRuntime(project,path.join(directory,'runtimes'));
 const {runSceneAssembly}=await import(pathToFileURL(path.join(snapshot.runtime,'bridge/scene-assembly.mjs')));let records=[];
 fixture.options.onStage=async stages=>{records=stages;};await runSceneAssembly(fixture.options);
 const job={id:'offline-image-inspection',state:'generating',assemblyCallsReserved:records.length,assemblyStages:records,recoveryEnabled:false};
 const protocol={type:'offline-image-inspection',realModelCalls:0},ledger={protocol,protocolHash:hash(protocol),...snapshot,maximumCalls:26,results:[{jobId:job.id,assetDirectory:directory}]};
 const ledgerFile=path.join(directory,'ledger.json'),jobFile=path.join(directory,'job.json');
 await fs.writeFile(ledgerFile,JSON.stringify(ledger),{flag:'wx'});await fs.writeFile(jobFile,JSON.stringify(job),{flag:'wx'});
 const initialCalls=fixture.calls.length;
 const candidates=await inspectQualityStageImages(ledgerFile,2);assert.equal(candidates.kind,'native-comparison');assert.equal(candidates.images.length,6);assert.ok(candidates.images.every(i=>i.role==='concept-candidate'));
 const expanded=await inspectQualityStageImages(ledgerFile,4),prototypeInput=JSON.parse(await fs.readFile(path.join(directory,'assembly/4/input.json')));
 assert.equal(expanded.seedOnly,false);assert.ok(expanded.images.every(i=>i.role==='expanded-prototype'));assert.notEqual(expanded.stageEvidenceHash,expanded.nativeEvidenceHash);
 assert.equal(expanded.sourceHash,prototypeInput.designEvidence.prototypeExpansion.expandedSourceHash);
 assert.equal(prototypeInput.sourceHash,prototypeInput.designEvidence.prototypeExpansion.seedSourceHash);
 assert.notEqual(expanded.sourceHash,prototypeInput.sourceHash);
 for(const img of expanded.images){assert.equal(img.sourceHash,expanded.sourceHash);assert.equal(img.assetHash,prototypeInput.designEvidence.prototypeExpansion.expandedAssetHash);}
 const final=await inspectQualityStageImages(ledgerFile,7);assert.equal(final.kind,'native-revision');assert.deepEqual(final.images.map(i=>i.role),Array.from({length:4},()=>['historical-before','review-subject']).flat());
 for(const report of [candidates,expanded,final]){
  assert.equal(report.savedJobState,'generating');assert.equal(report.additionalModelCalls,0);assert.equal(report.additionalRenders,0);assert.equal(report.terminalTaskAssessment,false);assert.equal(report.canAuthorizePlacement,false);assert.equal(report.liveObservation,false);
 }
 assert.equal(fixture.calls.length,initialCalls);await assert.rejects(inspectQualityStageImages(ledgerFile,3),/no bound native images/);
 await assert.rejects(inspectQualityStageImages(ledgerFile,26),/not reserved/);
 const inputFile=path.join(directory,'assembly/4/input.json'),original=await fs.readFile(inputFile);
 const tamper=async change=>{const input=JSON.parse(original);change(input);await fs.writeFile(inputFile,JSON.stringify(input));await assert.rejects(inspectQualityStageImages(ledgerFile,4));await fs.writeFile(inputFile,original);};
 await tamper(i=>i.designEvidence.views[0].camera.yaw++);
 await tamper(i=>{i.designEvidence.views[0].camera.yaw++;const {evidenceHash,...data}=i.designEvidence;i.designEvidence.evidenceHash=hash(data);});
 await tamper(i=>i.sourceHash='0'.repeat(64));
 const png=expanded.images[0].file,bytes=await fs.readFile(png);await fs.writeFile(png,Buffer.from('invalid'));
 await assert.rejects(inspectQualityStageImages(ledgerFile,4),/hash mismatch/);await fs.writeFile(png,bytes);
 const runtimeFile=path.join(snapshot.runtime,'bridge/native-evidence.mjs'),source=await fs.readFile(runtimeFile);await fs.writeFile(runtimeFile,Buffer.concat([source,Buffer.from('\n// altered')]));
 await assert.rejects(inspectQualityStageImages(ledgerFile,4),/Frozen runtime differs/);await fs.writeFile(runtimeFile,source);
 assert.equal(fixture.calls.length,initialCalls);
});
