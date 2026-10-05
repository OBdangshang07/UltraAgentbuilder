import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {hash} from '../../src/generation/compiler.mjs';
import {freezeSceneRuntime} from '../../scripts/scene-runtime-snapshot.mjs';
import {shape} from '../design/fixtures.mjs';
import {planEdit} from '../design/assembly-fixtures.mjs';
import {unapprovedPrototypeProposal} from '../../src/design/correction-feedback.mjs';
import {recoveryHarness,capacityMessage} from './assembly-provider-recovery-fixtures.mjs';

// Real frozen execution, journal, adapter evidence, compiler/native cells and
// read-only assessor. Only provider transport, answers and image uploads are
// synthetic. These tests are not model quality or game-placement acceptance.
for(const scenario of ['plan','assembly-blueprint','prototype-role','review','format-crossing','package-repair','design-contract','design-candidate-crossing'])
test('frozen terminal assessment preserves '+scenario+' capacity recovery and original failure evidence',async t=>{
  const design=scenario.startsWith('design-');
  const staged=design||['assembly-blueprint','prototype-role','review'].includes(scenario);
  let mod,failed=false,badPackage=false,repairCalls=0,reviewed=false,failedWrapper;
  const h=await recoveryHarness(t,{staged,loadAdapter:async()=>(await mod('bridge/codex-adapter.mjs')).CodexAdapter,
    choose:({index,stage,input,answer})=>{
      if(design){
        if(stage.stageName==='assembly-blueprint')answer.sceneEdit.featureBindings=[{feature:'Stable required entry',components:['entrance']}];
        if(stage.stageName==='concept-review'&&!reviewed){reviewed=true;answer.verdict='revise';
          answer.issues=[{id:'synthetic-recovery',criterion:'facade',evidence:'Synthetic protocol only',change:'Change actual geometry'}];}
        if(stage.stageName==='revise-design'){
          const target=structuredClone(input.priorPlan);
          if(scenario==='design-contract')target.scene.featureBindings[0].feature='Paraphrased entry';
          else target.scene.components.find(c=>c.id==='task0__a').at.offset[1]=224;
          answer.edit=planEdit(input.priorPlan,target);answer.recipes[0].count=3;failedWrapper=structuredClone(answer);
        }
        if(stage.stageName==='correct-design'){
          repairCalls++;
          assert.deepEqual(input.unapprovedPrototypeProposal,unapprovedPrototypeProposal(failedWrapper));
          if(scenario==='design-contract'){
            assert.equal(input.repairBase,undefined);assert.equal(input.prototypeRecipes[0].count,2);
            assert.equal(input.contractFeedback.contract.issues[0].expected,'Stable required entry');
          }else{
            assert.equal(input.repairBase.approved,false);assert.equal(input.prototypeRecipes[0].count,3);
            if(repairCalls===1||repairCalls===3)return {failure:capacityMessage};
            if(repairCalls===2)return {text:'{"fixture":'};
            const target=structuredClone(input.priorPlan);
            target.scene.components.find(c=>c.id==='task0__a').at.offset[1]=2;
            answer.edit=planEdit(input.priorPlan,target);
          }
          answer.recipes=structuredClone(failedWrapper.recipes);
        }
        return {answer};
      }
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
  const capacityFailure=records.find(r=>r.invocationOutcome==='completed-empty-capacity');
  const job={id:'synthetic-frozen-recovery',state:'preview-ready',model:h.options.model,effort:h.options.effort,requestHash:h.options.requestHash,
    preflight:h.options.policy,assemblyCallsReserved:records.length,assemblyStages:records,assemblySummary:result.summary,
    assetHash:compiled.manifest.assetHash,recoveryEnabled:true,recovery:{branch},
    // Deliberately record a later observation too. The original failed receipt
    // must come from the journal/audit, not find() on mutable observations.
    generations:[...records.filter(r=>r.responseReceived).map(r=>({stage:r.index,usage:null,diagnostic:null})),
      ...(capacityFailure?[{stage:capacityFailure.index,diagnostic:{reason:'completed',failureKind:null}}]:[])],
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
  assert.equal(audit.relationships.length,scenario==='design-contract'?0:['format-crossing','package-repair','design-candidate-crossing'].includes(scenario)?2:1);
  const failure=report.stages.find(s=>s.invocationOutcome==='completed-empty-capacity');
  if(failure){
    assert.equal(failure.state,'failed');assert.equal(failure.diagnostic.failureKind,'model-capacity');assert.equal(failure.rawEvidence.verified,true);
    assert.equal(failure.generationObservations.length,1);assert.equal(failure.generationObservations[0].diagnostic.failureKind,null);
  }
  if(scenario==='package-repair'){
    const repaired=report.stages.findLast(s=>s.phase==='correct-component');assert.equal(repaired.state,'accepted');
    assert.equal(compiled.scene.components.find(c=>c.id==='exterior__preserve').material,'frame');
    assert.equal(audit.formatCorrections.length,1);assert.equal(repairCalls,4);
  }
  if(design){
    assert.equal(result.summary.completedPackages.length,5);assert.equal(result.summary.finalTextReviewAccepted,true);
    assert.equal(compiled.scene.components.find(c=>c.id==='task0__a').repeat.count,3);
    assert.equal(compiled.scene.featureBindings[0].feature,'Stable required entry');
    assert.equal(audit.formatCorrections.length,scenario==='design-contract'?0:1);
    if(scenario==='design-candidate-crossing')assert.equal(repairCalls,4);
  }
  const retry=audit.relationships[0]?.retryIndex??records.find(r=>r.phase==='correct-design').index;
  const file=path.join(h.directory,branch,'assembly',String(retry),'input.json');
  const original=await fs.readFile(file),input=JSON.parse(original);input.description='Changed original prepared scope';await fs.writeFile(file,JSON.stringify(input));
  const rejected=await assess('tampered-assessment');assert.notEqual(rejected.code,0);assert.match(rejected.output,/canonical\/model input differs/);
  await fs.writeFile(file,original);assert.equal(h.calls.length,report.reservedCalls);
  if(design){
    const value=JSON.parse(original);value.unapprovedPrototypeProposal.response.recipes[0].count=4;
    value.unapprovedPrototypeProposal.responseHash=hash(value.unapprovedPrototypeProposal.response);
    const modelFile=path.join(path.dirname(file),'model-input.json'),modelOriginal=await fs.readFile(modelFile);
    const {assemblyCorrectionInput}=await mod('src/design/correction-feedback.mjs');
    await fs.writeFile(file,JSON.stringify(value));await fs.writeFile(modelFile,JSON.stringify(assemblyCorrectionInput(value)));
    const tampered=await assess('rehashed-rejected-wrapper');assert.notEqual(tampered.code,0);
    assert.match(tampered.output,/wrapper\/recipes differ/);
    await fs.writeFile(file,original);await fs.writeFile(modelFile,modelOriginal);
    const role=records.find(r=>r.phase==='prototype-role'),roleFile=path.join(h.directory,branch,'assembly',String(role.index),'input.json');
    const roleModel=path.join(path.dirname(roleFile),'model-input.json'),roleOriginal=await fs.readFile(roleFile),roleModelOriginal=await fs.readFile(roleModel);
    const roleInput=JSON.parse(roleOriginal);roleInput.prototypeRecipeBudget.maximumRoleRecipes++;
    await fs.writeFile(roleFile,JSON.stringify(roleInput));await fs.writeFile(roleModel,JSON.stringify(assemblyCorrectionInput(roleInput)));
    const badBudget=await assess('tampered-role-budget');assert.notEqual(badBudget.code,0);assert.match(badBudget.output,/aggregate recipe budget changed/);
    await fs.writeFile(roleFile,roleOriginal);await fs.writeFile(roleModel,roleModelOriginal);
  }
});
