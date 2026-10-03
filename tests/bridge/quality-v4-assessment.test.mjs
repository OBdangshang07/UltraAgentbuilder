import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {freezeSceneRuntime} from '../../scripts/scene-runtime-snapshot.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {setupV4} from './quality-v4-fixtures.mjs';

test('v4 terminal auditor verifies both image sources and complete-version rollback; tampered facts, prior decisions and summary fail',async()=>{
  const {directory,options,calls}=await setupV4(),project=fileURLToPath(new URL('../../',import.meta.url));
  const snapshot=await freezeSceneRuntime(project,path.join(directory,'runtime')),mod=file=>import(pathToFileURL(path.join(snapshot.runtime,file)));
  const {runSceneAssembly}=await mod('bridge/scene-assembly.mjs'),{compileScene}=await mod('src/design/compiler.mjs');
  const invoke=options.invoke;let records=[],reviews=0;
  options.onStage=async current=>{records=current;};
  options.invoke=async(p,i,o)=>{
    const answer=await invoke(p,i,o);
    if(o.stageName==='review'){
      reviews++;answer.verdict='revise';answer.task='exterior';answer.issues=[{id:'facade-rhythm',task:'exterior',criterion:'facade',evidence:'Offline fixture concern',change:'Refine bounded detail'}];
      if(reviews>1){answer.previousIssues[0].status='unresolved';answer.comparison.verdict='regressed';answer.comparison.losses=answer.comparison.gains;answer.comparison.gains=[];}
    }
    return answer;
  };
  const startedAt=new Date().toISOString(),result=await runSceneAssembly(options),compiled=compileScene(result.scene,{navigationPolicy:'review'});
  assert.equal(result.summary.stopReason,'candidate-regressed-previous-preserved');assert.equal(calls.length,9);
  const files={'manifest.json':compiled.manifest,'scene.json':compiled.scene,'spec.json':compiled.spec,'design-sources.json':compiled.designSources};
  for(const [name,data] of Object.entries(files))await fs.writeFile(path.join(directory,name),JSON.stringify(data),{flag:'wx'});
  const owners=Buffer.alloc(compiled.sourceOwners.length*2);compiled.sourceOwners.forEach((v,i)=>owners.writeUInt16LE(v,i*2));
  await fs.writeFile(path.join(directory,'source-owners.bin'),owners,{flag:'wx'});await fs.writeFile(path.join(directory,'cells.bin'),compiled.binary,{flag:'wx'});
  const visual=result.summary.finalVisualReview,job={id:'offline-v4-audit',state:'preview-ready',model:'offline',assemblyCallsReserved:records.length,assemblyStages:records,assemblySummary:result.summary,assetHash:compiled.manifest.assetHash,
    generations:records.filter(r=>r.responseReceived).map(r=>({stage:r.index,usage:null,diagnostic:null})),recoveryEnabled:false,
    visualEvidenceBinding:{sourceHash:visual.sourceHash,cellsHash:compiled.manifest.cellsHash,renderedDiagnosticAssetHash:visual.assetHash,finalAssetHash:compiled.manifest.assetHash,evidenceHash:visual.evidenceHash,canAuthorizePlacement:false}};
  const protocol={type:'offline-v4-final-audit',realModelCalls:0},ledger={protocol,protocolHash:hash(protocol),...snapshot,maximumCalls:26,reservedCalls:records.length,finishedAt:new Date().toISOString(),results:[{jobId:job.id,state:job.state,assemblyCallsReserved:records.length,assemblyStages:records,assetDirectory:directory,startedAt,finishedAt:new Date().toISOString()}]};
  const jobFile=path.join(directory,'job.json'),ledgerFile=path.join(directory,'ledger.json');await fs.writeFile(jobFile,JSON.stringify(job),{flag:'wx'});await fs.writeFile(ledgerFile,JSON.stringify(ledger),{flag:'wx'});
  const audit=async name=>{
    const child=spawn(process.execPath,[path.join(project,'scripts/scene-assembly-assessment.mjs'),ledgerFile,path.join(directory,name+'.json')],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});return {code,output};
  };
  const good=await audit('good');assert.equal(good.code,0,good.output);
  const report=JSON.parse(await fs.readFile(path.join(directory,'good.json'),'utf8'));assert.equal(report.final.sourceHash,hash(result.scene));assert.equal(report.additionalModelCalls,0);assert.equal(report.aestheticQualityConfirmed,false);
  const tamper=async(file,name,change,expected)=>{
    const original=await fs.readFile(file,'utf8'),value=JSON.parse(original);change(value);await fs.writeFile(file,JSON.stringify(value));
    const bad=await audit(name);assert.notEqual(bad.code,0);assert.match(bad.output,expected);await fs.writeFile(file,original);
  };
  await tamper(path.join(directory,'assembly/7/input.json'),'wrong-facts',v=>v.revisionMeasurements.changedComponents[0].change='removed',/revision facts differ/);
  await tamper(path.join(directory,'assembly/9/input.json'),'wrong-prior',v=>v.previousReview.summary+=' altered',/previous review differs/);
  await tamper(path.join(directory,'assembly/9/quality-selection.json'),'unfinished-fallback',v=>v.selectedReviewStage=4,/cannot restore/);
  await tamper(jobFile,'false-acceptance',v=>v.assemblySummary.finalTextReviewAccepted=true,/quality summary differs/);
  assert.equal(calls.length,9);
});
