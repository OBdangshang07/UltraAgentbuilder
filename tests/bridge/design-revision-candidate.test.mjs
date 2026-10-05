import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {runSceneAssembly} from '../../bridge/scene-assembly.mjs';
import {runDurableAssembly} from '../../bridge/assembly-durability.mjs';
import {inspectCheckpoint} from '../../bridge/scene-checkpoints.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {unapprovedPrototypeProposal} from '../../src/design/correction-feedback.mjs';
import {setupStaged,stagedRequest} from './decomposed-assembly-fixtures.mjs';
import {planEdit} from '../design/assembly-fixtures.mjs';
import {terminalFixture} from './assembly-terminal-fixture.mjs';

// Synthetic replies/transport PNGs only. Actual compiler and authority checks,
// not real-model reliability, native pixels or architectural-quality evidence.
function serviceRooms(kind){
  return [8,13].map((z,i)=>{
    const common={kind,id:'task4__service'+i,host:'main',allowOverwrite:[],use:'room',
      purpose:'Synthetic service-room correction regression',floorMaterial:'floor',
      boundaries:[{face:i?'north':'south',material:'wall',openings:[]}]};
    return kind==='storeyRoom'?{...common,floors:{source:'main',first:21,count:3},
      offset:[19,z],footprint:[5,2],ceilingInset:0}:
      {...common,at:{relativeTo:'main',anchor:'min',offset:[19,105,z]},
        size:[5,5,2],repeat:{count:3,step:[0,5,0]}};
  });
}
async function setupLayoutRevision(kind,{partial=false}={}){
  let reviewed=false,rejected,original,corrections=0,lastRejected;
  const h=await setupStaged(({answer,input,options})=>{
    if(options.stageName==='concept-review'&&!reviewed){
      reviewed=true;answer.verdict='revise';answer.issues=[{id:'service-layout',
        criterion:'core',evidence:'Synthetic service-room layout test',
        change:'Add explicitly scoped service rooms without changing the core'}];
    }
    if(options.stageName==='revise-design'){
      original=structuredClone(input.priorPlan);
      const target=structuredClone(input.priorPlan);
      target.scene.components.push(...serviceRooms(kind));
      target.packages[4].regions.push({origin:[20,105,9],size:[8,16,12]});
      target.packages[4].editableComponents.push(...serviceRooms(kind).map(c=>c.id));
      answer.edit=planEdit(input.priorPlan,target);
      answer.recipes[0].count=3;
      rejected=structuredClone(answer);
      lastRejected=structuredClone(answer);
    }
    if(options.stageName==='correct-design'){
      corrections++;
      assert.deepEqual(input.unapprovedPrototypeProposal,unapprovedPrototypeProposal(lastRejected));
      assert.ok(input.repairBase,'Layout failure must retain its unapproved candidate');
      assert.equal(input.repairBase.approved,false);
      assert.equal(input.repairBase.canAuthorizePlacement,false);
      assert.equal(input.repairBase.authorityPlanHash,hash(original));
      assert.equal(input.planHash,input.repairBase.candidatePlanHash);
      assert.equal(input.sourceHash,input.repairBase.candidateSourceHash);
      assert.notEqual(input.planHash,hash(original));
      assert.deepEqual(input.prototypeRecipes,rejected.recipes);
      assert.equal(input.contractFeedback.geometryPassed,false);
      assert.equal(input.contractFeedback.canAuthorizePlacement,false);
      assert.equal(input.contractFeedback.contract,undefined);
      const feedback=input.contractFeedback.constructionFeedback;
      assert.equal(feedback.issueCount,partial&&corrections>1?1:2);
      assert.deepEqual(new Set(feedback.issues.map(i=>i.component)),
        new Set(partial&&corrections>1?['task4__service1']:['task4__service0','task4__service1']));
      const target=structuredClone(input.priorPlan);
      for(const c of target.scene.components.filter(c=>c.id.startsWith('task4__service'))){
        if(partial&&corrections===1&&c.id.endsWith('1'))continue;
        if(c.kind==='storeyRoom')c.footprint[1]=3;else c.size[2]=3;
      }
      answer.edit=planEdit(input.priorPlan,target);
      assert.equal(answer.edit.sceneEdit.components.put.length,partial?1:2);
      assert.deepEqual(answer.edit.packages,{put:[],remove:[]});
      answer.recipes=structuredClone(input.prototypeRecipes);
      if(partial&&corrections===1)lastRejected=structuredClone(answer);
    }
    return answer;
  });
  return {...h,getRejected:()=>rejected,getOriginal:()=>original};
}

test('a staged storey-room revision retains both invalid rooms for one small candidate-local correction and a new full review',async()=>{
  const h=await setupLayoutRevision('storeyRoom'),result=await runSceneAssembly(h.options);
  const revision=h.calls.find(c=>c.phase==='revise-design'),correction=h.calls.find(c=>c.phase==='correct-design');
  assert.equal(h.calls.length,19);assert.equal(result.summary.completedPackages.length,5);
  assert.equal(result.summary.finalTextReviewAccepted,true);
  assert.equal(result.records.find(r=>r.index===revision.index).state,'rejected');
  assert.equal(result.records.find(r=>r.index===correction.index).state,'accepted');
  assert.deepEqual(correction.images,[]);
  const next=h.calls.find(c=>c.phase==='concept-review'&&c.index>correction.index);
  assert.ok(next);assert.equal(next.input.previousReview.issues[0].id,'service-layout');
  assert.equal(next.input.designEvidence.kind,'native-revision');
  assert.equal(next.input.proposal.scene.components.find(c=>c.id==='task4__service0').footprint[1],3);
  assert.equal(next.input.prototypeRecipes,undefined);
  assert.equal(result.scene.components.find(c=>c.id==='task0__a').repeat.count,3);
  const folder=path.join(h.directory,'assembly',String(revision.index));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(folder,'response.json'))),h.getRejected());
  const saved=JSON.parse(await fs.readFile(path.join(folder,'plan.json')));
  assert.equal(saved.scene.components.find(c=>c.id==='task4__service0').footprint[1],2);
  assert.equal((await fs.readdir(folder)).includes('design-allocation.json'),false);
  const candidate=JSON.parse(await fs.readFile(path.join(folder,'result.json')));
  assert.equal(candidate.accepted,false);assert.equal(candidate.feedback.canAuthorizePlacement,false);
  const audit=await (await terminalFixture(h,result)).audit('layout-good');
  assert.equal(audit.code,0,audit.output);assert.equal(audit.report.additionalModelCalls,0);
});

test('contract-invalid full wrapper supplies exact feature feedback and failed recipes while the accepted baseline stays separate',async()=>{
 let reviewed=false,failed,accepted;
 const h=await setupStaged(({answer,input,options})=>{
  if(options.stageName==='assembly-blueprint')answer.sceneEdit.featureBindings=[{feature:'Stable required entry',components:['entrance']}];
  if(options.stageName==='concept-review'&&!reviewed){reviewed=true;answer.verdict='revise';
   answer.issues=[{id:'synthetic-rhythm',criterion:'facade',evidence:'Synthetic protocol only',change:'Change explicit geometry'}];}
  if(options.stageName==='revise-design'){
   accepted=structuredClone(input.priorPlan);const target=structuredClone(input.priorPlan);
   target.scene.featureBindings[0].feature='Paraphrased entry';answer.edit=planEdit(input.priorPlan,target);
   answer.recipes[0].count=3;failed=structuredClone(answer);
  }
  if(options.stageName==='correct-design'){
   assert.equal(input.repairBase,undefined);assert.deepEqual(input.priorPlan,accepted);
   assert.deepEqual(input.unapprovedPrototypeProposal,unapprovedPrototypeProposal(failed));
   assert.equal(input.prototypeRecipes[0].count,2);assert.equal(input.unapprovedPrototypeProposal.response.recipes[0].count,3);
   assert.deepEqual(input.contractFeedback.contract.issues.map(i=>[i.path,i.code,i.expected]),[
    ['$.edit.sceneEdit.featureBindings','required-feature-identity','Stable required entry']]);
   assert.match(h.calls.find(c=>c.phase==='revise-design').instructions,/REQUIRED FEATURE IDENTITIES/);
   assert.equal(input.designWorkspaceCapacity.maximumRegionsPerPackage,8);
   // Explicitly propose the changed recipe again. Failure DATA alone has not
   // adopted it; this new response still passes all original compiler gates.
   answer.recipes=structuredClone(input.unapprovedPrototypeProposal.response.recipes);
  }
  return answer;
 });
 const result=await runSceneAssembly(h.options);
 assert.equal(result.records.find(r=>r.phase==='revise-design').state,'rejected');
 assert.equal(result.records.find(r=>r.phase==='correct-design').state,'accepted');
 assert.equal(result.scene.components.find(c=>c.id==='task0__a').repeat.count,3);
 assert.equal(result.scene.featureBindings[0].feature,'Stable required entry');
 assert.equal(result.summary.completedPackages.length,5);assert.equal(result.summary.finalTextReviewAccepted,true);
 const correction=h.calls.find(c=>c.phase==='correct-design');assert.deepEqual(correction.images,[]);
 assert.equal(h.calls.length,19);
 const terminal=await terminalFixture(h,result),audit=await terminal.audit('wrapper-original-good');
 assert.equal(audit.code,0,audit.output);assert.equal(audit.report.additionalModelCalls,0);
 const file=path.join(h.directory,'assembly',String(correction.index),'input.json');
 const original=await fs.readFile(file),input=JSON.parse(original);
 input.unapprovedPrototypeProposal.response.recipes[0].count=4;
 input.unapprovedPrototypeProposal.responseHash=hash(input.unapprovedPrototypeProposal.response);
 await fs.writeFile(file,JSON.stringify(input));
 const bad=await terminal.audit('wrapper-rehashed-bad');assert.notEqual(bad.code,0);
 assert.match(bad.output,/wrapper\/recipes differ/);await fs.writeFile(file,original);
});

test('a staged roomZone revision resumes after its corrected receipt without repeating the rejected edit or correction',async()=>{
  const h=await setupLayoutRevision('roomZone'),abort=new AbortController();
  const identity={requestHash:hash(stagedRequest),runtimeHash:'synthetic-design-layout-correction'};
  await assert.rejects(runDurableAssembly({...h.options,...identity,signal:abort.signal,
    onStage:async records=>{if(records.at(-1).phase==='correct-design'&&records.at(-1).state==='accepted')abort.abort();}}),/abort/i);
  assert.equal(h.calls.length,12);const correction=h.calls.at(-1);
  assert.equal(correction.phase,'correct-design');const uploads=h.uploads.length;
  const result=await runDurableAssembly({...h.options,...identity});
  assert.equal(h.calls.length,19);assert.equal(new Set(h.calls.map(c=>c.index)).size,19);
  assert.equal(h.calls.filter(c=>c.phase==='correct-design').length,1);
  assert.equal(result.summary.completedPackages.length,5);
  assert.equal(result.scene.components.find(c=>c.id==='task4__service1').size[2],3);
  assert.equal(h.uploads.length,uploads+2);
  const captures=h.uploads.length;await runDurableAssembly({...h.options,...identity});
  assert.equal(h.calls.length,19);assert.equal(h.uploads.length,captures);
});

test('selected-massing and allocation authority errors do not acquire a candidate-local geometry correction baseline',async()=>{
  for(const kind of ['massing','owner','protection']){
    let reviewed=false;
    const h=await setupStaged(({answer,input,options})=>{
      if(options.stageName==='concept-review'&&!reviewed){reviewed=true;answer.verdict='revise';
        answer.issues=[{id:'authority-test',criterion:'coherence',evidence:'Synthetic authority rejection',change:'Test rejection boundaries'}];}
      if(options.stageName==='revise-design'){
        const target=structuredClone(input.priorPlan);
        if(kind==='massing')target.scene.components.find(c=>c.id==='main').at.offset[0]++;
        if(kind==='owner')target.packages[0].editableComponents.push('task1__a');
        if(kind==='protection')target.scene.reservations.push({id:'new-protection',at:{relativeTo:null,anchor:'min',offset:[12,1,20]},size:[1,1,1],allowedComponents:[]});
        answer.edit=planEdit(input.priorPlan,target);
      }
      if(options.stageName==='correct-design'){
        assert.equal(input.repairBase,undefined);assert.ok(input.contractFeedback.contract);
        assert.deepEqual(input.priorPlan,h.calls.find(c=>c.phase==='revise-design').input.priorPlan);
      }
      return answer;
    });
    const result=await runSceneAssembly(h.options);
    assert.equal(result.records.find(r=>r.phase==='revise-design').state,'rejected');
    assert.equal(result.summary.completedPackages.length,5);assert.ok(h.calls.length<=26);
  }
});

test('a permissive inspector cannot authorize a revision that failed selected-concept lowering',async()=>{
  const h=await setupLayoutRevision('storeyRoom');
  h.options.inspect=async(scene,...args)=>scene.components.some(c=>c.id==='task4__service0')?
    {sourceHash:hash(scene),canAuthorizePlacement:false,geometryPassed:true,error:null}:inspectCheckpoint(scene,...args);
  await assert.rejects(runSceneAssembly(h.options),/Selected concept lowering and full-scene inspection disagree/);
  assert.equal(h.calls.length,11);
  assert.ok(!h.calls.some(c=>['correct-design','component','review'].includes(c.phase)));
});

test('a second layout rejection retains the cumulative original-authority edit and corrects only the remaining room',async()=>{
  const h=await setupLayoutRevision('storeyRoom',{partial:true}),result=await runSceneAssembly(h.options);
  const corrections=h.calls.filter(c=>c.phase==='correct-design');
  assert.equal(corrections.length,2);assert.equal(h.calls.length,20);
  assert.equal(result.summary.completedPackages.length,5);assert.equal(result.summary.finalTextReviewAccepted,true);
  assert.equal(result.records.find(r=>r.index===corrections[0].index).state,'rejected');
  assert.equal(result.records.find(r=>r.index===corrections[1].index).state,'accepted');
  const first=path.join(h.directory,'assembly',String(corrections[0].index));
  const effective=JSON.parse(await fs.readFile(path.join(first,'effective-edit.json')));
  const saved=JSON.parse(await fs.readFile(path.join(first,'result.json')));
  assert.deepEqual(effective,saved.effectiveEdit);
  assert.equal(effective.planHash,hash(h.getOriginal()));
  assert.equal(corrections[1].input.priorPlan.scene.components.find(c=>c.id==='task4__service0').footprint[1],3);
  assert.equal(corrections[1].input.contractFeedback.constructionFeedback.issues.length,1);
  const audit=await (await terminalFixture(h,result)).audit('two-layout-corrections-good');
  assert.equal(audit.code,0,audit.output);assert.equal(audit.report.reservedCalls,20);
  assert.equal(audit.report.additionalModelCalls,0);assert.equal(h.calls.length,20);
});
