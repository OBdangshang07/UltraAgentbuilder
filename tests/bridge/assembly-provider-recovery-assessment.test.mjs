import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {hash} from '../../src/generation/compiler.mjs';
import {freezeSceneRuntime} from '../../scripts/scene-runtime-snapshot.mjs';
import {shape} from '../design/fixtures.mjs';
import {recoveryHarness,capacityMessage} from './assembly-provider-recovery-fixtures.mjs';

// Real frozen execution, journal, adapter evidence, compiler/native cells and
// read-only assessor. Only provider transport, answers and image uploads are
// synthetic. These tests are not model quality or game-placement acceptance.
for(const scenario of ['plan','assembly-blueprint','prototype-role','review','format-crossing','package-repair'])
test('frozen terminal assessment preserves '+scenario+' capacity recovery and original failure evidence',async t=>{
  const staged=['assembly-blueprint','prototype-role','review'].includes(scenario);
  let mod,failed=false,badPackage=false,repairCalls=0;
  const h=await recoveryHarness(t,{staged,loadAdapter:async()=>(await mod('bridge/codex-adapter.mjs')).CodexAdapter,
    choose:({index,stage,input,answer})=>{
      if(scenario==='format-crossing')return index===1||index===3?{failure:capacityMessage}:index===2?{text:'{"fixture":'}:{};
      if(scenario==='package-repair'){
        if(stage.stageName==='component'&&!badPackage){
          badPackage=true;answer.components.put=[shape('exterior__bad',[2,1,0],[1,1,1],'frame'),shape('exterior__preserve',[0,1,0],[1,1,1],'frame')];return {answer};
        }
        if(stage.stageName==='correct-component'){
          assert.ok(input.repairBase);repairCalls++;
          if(repairCalls===1||repairCalls===3)return {failure:capacityMessage};
          if(repairCalls===2)return {text:'{"fixture":'};
          assert.equal(answer.format,'ScenePackageRepair');
          answer.edit.components.put=[shape('exterior__bad',[1,1,0],[1,1,1],'frame')];return {answer};
        }
      }else if(!failed&&stage.stageName===scenario){failed=true;return {failure:capacityMessage};}
    }});
  const project=fileURLToPath(new URL('../../',import.meta.url)),snapshot=await freezeSceneRuntime(project,path.join(h.directory,'runtime'));
  mod=file=>import(pathToFileURL(path.join(snapshot.runtime,file)));
  const {runDurableAssembly,assemblyRuntimeIdentity}=await mod('bridge/assembly-durability.mjs'),{compileScene}=await mod('src/design/compiler.mjs');
  h.options.runtimeHash=await assemblyRuntimeIdentity();
  const startedAt=new Date().toISOString(),result=await runDurableAssembly(h.options),compiled=compileScene(result.scene,{navigationPolicy:'review'});
  for(const [name,value] of Object.entries({'manifest.json':compiled.manifest,'scene.json':compiled.scene,'spec.json':compiled.spec,'design-sources.json':compiled.designSources}))
    await fs.writeFile(path.join(h.directory,name),JSON.stringify(value),{flag:'wx'});
  const owners=Buffer.alloc(compiled.sourceOwners.length*2);compiled.sourceOwners.forEach((v,i)=>owners.writeUInt16LE(v,i*2));
  await fs.writeFile(path.join(h.directory,'source-owners.bin'),owners,{flag:'wx'});await fs.writeFile(path.join(h.directory,'cells.bin'),compiled.binary,{flag:'wx'});
  const records=result.records,branch=h.events.findLast(e=>e.branch).branch,visual=result.summary.finalVisualReview;
  const job={id:'synthetic-frozen-recovery',state:'preview-ready',model:h.options.model,effort:h.options.effort,requestHash:h.options.requestHash,
    preflight:h.options.policy,assemblyCallsReserved:records.length,assemblyStages:records,assemblySummary:result.summary,
    assetHash:compiled.manifest.assetHash,recoveryEnabled:true,recovery:{branch},
    // Deliberately record a later observation too. The original failed receipt
    // must come from the journal/audit, not find() on mutable observations.
    generations:[...records.filter(r=>r.responseReceived).map(r=>({stage:r.index,usage:null,diagnostic:null})),
      {stage:records.find(r=>r.invocationOutcome==='completed-empty-capacity').index,diagnostic:{reason:'completed',failureKind:null}}],
    ...(visual?{visualEvidenceBinding:{sourceHash:visual.sourceHash,cellsHash:compiled.manifest.cellsHash,renderedDiagnosticAssetHash:visual.assetHash,
      finalAssetHash:compiled.manifest.assetHash,evidenceHash:visual.evidenceHash,canAuthorizePlacement:false}}:{})};
  const finishedAt=new Date().toISOString(),protocol={type:'synthetic-frozen-capacity-assessment',realModelCalls:0};
  const ledger={protocol,protocolHash:hash(protocol),...snapshot,maximumCalls:26,reservedCalls:records.length,finishedAt,
    results:[{jobId:job.id,state:job.state,assemblyCallsReserved:records.length,assemblyStages:records,assetDirectory:h.directory,startedAt,finishedAt}]};
  await fs.writeFile(path.join(h.directory,'job.json'),JSON.stringify(job),{flag:'wx'});
  const ledgerFile=path.join(h.directory,'ledger.json');await fs.writeFile(ledgerFile,JSON.stringify(ledger),{flag:'wx'});
  const assess=async name=>{
    const child=spawn(process.execPath,[path.join(project,'scripts/scene-assembly-assessment.mjs'),ledgerFile,path.join(h.directory,name+'.json')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});return {code,output};
  };
  const checked=await assess('original-assessment');assert.equal(checked.code,0,checked.output);
  const report=JSON.parse(await fs.readFile(path.join(h.directory,'original-assessment.json')));
  assert.equal(report.final.sourceHash,hash(result.scene));assert.equal(report.final.assetHash,job.assetHash);
  assert.equal(report.additionalModelCalls,0);assert.equal(report.aestheticQualityConfirmed,false);
  const audit=report.providerRecoveryAudit;assert.equal(audit.allReservedCallsClosed,true);
  assert.equal(audit.relationships.length,['format-crossing','package-repair'].includes(scenario)?2:1);
  const failure=report.stages.find(s=>s.invocationOutcome==='completed-empty-capacity');
  assert.equal(failure.state,'failed');assert.equal(failure.diagnostic.failureKind,'model-capacity');assert.equal(failure.rawEvidence.verified,true);
  assert.equal(failure.generationObservations.length,1);assert.equal(failure.generationObservations[0].diagnostic.failureKind,null);
  if(scenario==='package-repair'){
    const repaired=report.stages.findLast(s=>s.phase==='correct-component');assert.equal(repaired.state,'accepted');
    assert.equal(compiled.scene.components.find(c=>c.id==='exterior__preserve').material,'frame');
    assert.equal(audit.formatCorrections.length,1);assert.equal(repairCalls,4);
  }
  const retry=audit.relationships[0].retryIndex,file=path.join(h.directory,branch,'assembly',String(retry),'input.json');
  const original=await fs.readFile(file),input=JSON.parse(original);input.description='Changed original prepared scope';await fs.writeFile(file,JSON.stringify(input));
  const rejected=await assess('tampered-assessment');assert.notEqual(rejected.code,0);assert.match(rejected.output,/canonical\/model input differs/);
  await fs.writeFile(file,original);assert.equal(h.calls.length,report.reservedCalls);
});
