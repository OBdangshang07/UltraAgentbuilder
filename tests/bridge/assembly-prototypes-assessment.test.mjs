import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {freezeSceneRuntime} from '../../scripts/scene-runtime-snapshot.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {setupPrototypes} from './assembly-prototypes-fixtures.mjs';

test('independent terminal audit reconstructs seed recipes/assets, zero-call transition and the final full building; altered evidence fails',async()=>{
 const {directory,options,calls}=await setupPrototypes(),project=fileURLToPath(new URL('../../',import.meta.url));
 const snapshot=await freezeSceneRuntime(project,path.join(directory,'runtime')),mod=file=>import(pathToFileURL(path.join(snapshot.runtime,file)));
 const {runSceneAssembly}=await mod('bridge/scene-assembly.mjs'),{compileScene}=await mod('src/design/compiler.mjs');let records=[];
 options.onStage=async current=>{records=current;};
 const startedAt=new Date().toISOString(),result=await runSceneAssembly(options),compiled=compileScene(result.scene,{navigationPolicy:'review'});
 for(const [name,value] of Object.entries({'manifest.json':compiled.manifest,'scene.json':compiled.scene,'spec.json':compiled.spec,'design-sources.json':compiled.designSources}))await fs.writeFile(path.join(directory,name),JSON.stringify(value),{flag:'wx'});
 const owners=Buffer.alloc(compiled.sourceOwners.length*2);compiled.sourceOwners.forEach((v,i)=>owners.writeUInt16LE(v,i*2));await fs.writeFile(path.join(directory,'source-owners.bin'),owners,{flag:'wx'});await fs.writeFile(path.join(directory,'cells.bin'),compiled.binary,{flag:'wx'});
 const visual=result.summary.finalVisualReview,job={id:'offline-prototype-audit',state:'preview-ready',model:'offline',assemblyCallsReserved:records.length,assemblyStages:records,assemblySummary:result.summary,assetHash:compiled.manifest.assetHash,
  generations:records.filter(r=>r.responseReceived).map(r=>({stage:r.index,usage:null,diagnostic:null})),recoveryEnabled:false,
  visualEvidenceBinding:{sourceHash:visual.sourceHash,cellsHash:compiled.manifest.cellsHash,renderedDiagnosticAssetHash:visual.assetHash,finalAssetHash:compiled.manifest.assetHash,evidenceHash:visual.evidenceHash,canAuthorizePlacement:false}};
 const protocol={type:'offline-prototype-audit',realModelCalls:0},finishedAt=new Date().toISOString(),ledger={protocol,protocolHash:hash(protocol),...snapshot,maximumCalls:26,reservedCalls:records.length,finishedAt,results:[{jobId:job.id,state:job.state,assemblyCallsReserved:records.length,assemblyStages:records,assetDirectory:directory,startedAt,finishedAt}]};
 const jobFile=path.join(directory,'job.json'),ledgerFile=path.join(directory,'ledger.json');await fs.writeFile(jobFile,JSON.stringify(job),{flag:'wx'});await fs.writeFile(ledgerFile,JSON.stringify(ledger),{flag:'wx'});
 const audit=async name=>{
  const child=spawn(process.execPath,[path.join(project,'scripts/scene-assembly-assessment.mjs'),ledgerFile,path.join(directory,name+'.json')],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});return {code,output};
 };
 const good=await audit('good');assert.equal(good.code,0,good.output);
 const report=JSON.parse(await fs.readFile(path.join(directory,'good.json'),'utf8'));assert.equal(report.final.sourceHash,hash(result.scene));assert.equal(report.additionalModelCalls,0);assert.equal(report.aestheticQualityConfirmed,false);
 const tamper=async(relative,name,change,expected)=>{
  const file=path.join(directory,relative),original=await fs.readFile(file,'utf8'),value=JSON.parse(original);change(value);await fs.writeFile(file,JSON.stringify(value));
  const bad=await audit(name);assert.notEqual(bad.code,0);assert.match(bad.output,expected);await fs.writeFile(file,original);
 };
 await tamper('assembly/3/response.json','raw-recipes',v=>v.recipes[0].count=2,/prototype program differs/);
 await tamper('assembly/3/prototype/seed-witness.json','fake-seed',v=>v.seeds[0].solidCells++,/seed witness differs/);
 await tamper('assembly/3/prototype/expansion-witness.json','fake-full-proof',v=>v.expansions[0].verifiedRepetitions++,/expansion witness differs/);
 await tamper('assembly/prototype-transition.json','false-world-authority',v=>v.canAuthorizePlacement=true,/transition differs/);
 await tamper('assembly/4/input.json','wrong-review-recipe',v=>v.designEvidence.prototypeExpansion.programHash='0'.repeat(64),/Native model input evidence mismatch/);
 await tamper('job.json','fake-seed-review',v=>v.assemblySummary.prototypeExpansion.seedVisualAccepted=true,/prototype summary differs/);
 const nativeFile=calls.find(c=>c.phase==='concept-review').images[0],originalPixels=await fs.readFile(nativeFile),corruptPixels=Buffer.from(originalPixels);corruptPixels[corruptPixels.length-1]^=1;
 await fs.writeFile(nativeFile,corruptPixels);
 const corrupt=await audit('changed-expanded-pixels');assert.notEqual(corrupt.code,0);assert.match(corrupt.output,/Native image hash mismatch/);
 await fs.writeFile(nativeFile,originalPixels);
 assert.equal(calls.length,7);
});
