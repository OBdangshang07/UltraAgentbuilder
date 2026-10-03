import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../../src/generation/compiler.mjs';
import {runSceneAssembly} from '../../bridge/scene-assembly.mjs';
import {setupStaged} from './decomposed-assembly-fixtures.mjs';
import {planEdit} from '../design/assembly-fixtures.mjs';
import {shape} from '../design/fixtures.mjs';
import {designOwnedSourceCoverage} from '../../bridge/assembly-design-allocation.mjs';

function upperWorkBlueprint(answer){
 answer.packages[1].regions[0].size[1]=183;
 const region=answer.packages[1].regions[0];
 answer.sceneEdit.components.put.push(shape('task1__upper',[region.origin[0],201,region.origin[2]],[1,1,1],'frame'));
 answer.packages[1].editableComponents.push('task1__upper');
}

test('owned-source coverage discloses exact uncovered upper cells without making all hosts editable',async()=>{
 const h=await setupStaged(({answer,options})=>{if(options.stageName==='assembly-blueprint')upperWorkBlueprint(answer);return answer;});
 const result=await runSceneAssembly(h.options),review=h.calls.find(c=>c.phase==='concept-review');
 assert.equal(result.summary.completedPackages.length,5);
 for(const subject of ['seed','expanded']){
  const coverage=review.input.designAllocationReceipt[subject].ownedSourceCoverage;
  const row=coverage.sources.find(s=>s.id==='task1__upper');
  assert.deepEqual([row.cells,row.insideWorkspace,row.outsideWorkspace],[1,0,1]);
  assert.deepEqual(row.uncoveredBounds,{min:[14,201,20],maxExclusive:[15,202,21]});
  assert.deepEqual(row.uncoveredSamples,[[14,201,20]]);
  assert.equal(coverage.coverageRequiredForAllOwnedSources,false);assert.equal(coverage.advisoryOnly,true);
  assert.equal(coverage.canAuthorizePlacement,false);const {coverageHash,...data}=coverage;assert.equal(hash(data),coverageHash);
 }
 assert.equal(review.input.proposal.packages[1].regions[0].size[1],183);
 assert.throws(()=>designOwnedSourceCoverage(review.input.proposal,{designSources:{sourceHash:'wrong'},manifest:{}}),/identity mismatch/);
});

test('first purpose-only no-progress proposal gets one budgeted correction of actual regions and completes all packages',async()=>{
 let revised=false;
 const h=await setupStaged(({answer,input,options})=>{
  if(options.stageName==='assembly-blueprint')upperWorkBlueprint(answer);
  if(options.stageName==='concept-review'&&!revised){revised=true;answer.verdict='revise';answer.issues=[{id:'upper-facade-workspace',criterion:'facade',evidence:'Synthetic owned upper source outside deferred workspace',change:'Explicitly allocate task1 upper facade work'}];}
  if(['revise-design','correct-design'].includes(options.stageName)){
   const target=structuredClone(input.priorPlan);target.packages[1].purpose+='; upper facade work allocated';
   if(options.stageName==='correct-design')target.packages[1].regions[0].size[1]=224;
   answer.edit=planEdit(input.priorPlan,target);
  }
  return answer;
 });
 const result=await runSceneAssembly(h.options),root=path.join(h.directory,'assembly');
 assert.equal(h.calls.length,19);assert.equal(result.summary.completedPackages.length,5);assert.equal(result.summary.finalTextReviewAccepted,true);
 const revision=h.calls.find(c=>c.phase==='revise-design'),correction=h.calls.find(c=>c.phase==='correct-design');
 assert.equal(result.records.find(r=>r.index===revision.index).state,'rejected');
 assert.equal(result.records.find(r=>r.index===correction.index).state,'accepted');
 assert.equal(h.calls.filter(c=>c.phase==='correct-design').length,1);
 const progress=correction.input.contractFeedback.designProgress;
 assert.equal(progress.geometryUnchanged,true);assert.equal(progress.checkedWorkspaceChanged,false);
 assert.equal(progress.ownedSourceCoverage.expanded.sources.find(s=>s.id==='task1__upper').outsideWorkspace,1);
 assert.equal(correction.input.repairBase.approved,false);assert.equal(correction.input.callBudget.canStart,true);
 assert.equal(correction.input.planHash,progress.candidatePlanHash);assert.equal(correction.input.sourceHash,progress.candidateSourceHash);
 assert.match(correction.instructions,/purpose prose alone cannot fix/);
 const originalAnswer=JSON.parse(await fs.readFile(path.join(root,String(revision.index),'response.json')));
 assert.equal(originalAnswer.edit.packages.put[0].regions[0].size[1],183);
 const allocation=JSON.parse(await fs.readFile(path.join(root,String(correction.index),'design-allocation.json')));
 assert.equal(allocation.expanded.ownedSourceCoverage.sources.find(s=>s.id==='task1__upper').outsideWorkspace,0);
 assert.equal(h.calls.find(c=>c.phase==='component'&&c.input.task.id==='task1').input.task.regions[0].size[1],224);
 assert.equal(result.records.filter(r=>r.phase==='concept-review').length,2);
});

test('repeated geometry/workspace no-op stops after one correction even if the purpose text changes',async()=>{
 const h=await setupStaged(({answer,input,options})=>{
  if(options.stageName==='concept-review'){answer.verdict='revise';answer.issues=[{id:'workspace',criterion:'facade',evidence:'Synthetic unchanged region',change:'Correct the actual workspace'}];}
  if(['revise-design','correct-design'].includes(options.stageName)){
   const target=structuredClone(input.priorPlan);target.packages[1].purpose+='; claimed '+options.stageName;answer.edit=planEdit(input.priorPlan,target);
  }
  return answer;
 });
 await assert.rejects(runSceneAssembly(h.options),/Architectural correction made no progress/);
 assert.equal(h.calls.length,12);assert.equal(h.calls.filter(c=>c.phase==='correct-design').length,1);
 assert.ok(!h.calls.some(c=>c.phase==='component'||c.phase==='review'));
 const root=path.join(h.directory,'assembly'),progress=[];
 for(const c of h.calls.filter(c=>['revise-design','correct-design'].includes(c.phase))){
  const result=JSON.parse(await fs.readFile(path.join(root,String(c.index),'result.json')));assert.equal(result.accepted,false);progress.push(result.feedback.designProgress);
 }
 assert.notEqual(progress[0].candidatePlanHash,progress[1].candidatePlanHash);
 assert.equal(progress[0].progressStateHash,progress[1].progressStateHash);
});

test('a no-progress proposal cannot borrow mandatory package and review calls for correction',async()=>{
 let roleFailures=0,reviews=0;
 const h=await setupStaged(({answer,input,options})=>{
  if(['prototype-role','correct-prototype-role'].includes(options.stageName)&&input.role==='typical-floor-core'&&roleFailures<4)answer.representatives[0].components.push('foreign'+(++roleFailures));
  if(options.stageName==='concept-review'){
   reviews++;answer.verdict='revise';answer.issues=[{id:'persistent-facade',criterion:'facade',evidence:'Synthetic incomplete facade',change:'Make actual facade progress'}];
   for(const previous of answer.previousIssues)previous.status='unresolved';
  }
  if(options.stageName==='revise-design'){
   const target=structuredClone(input.priorPlan);
   if(reviews<3)target.scene.components.find(c=>c.id==='task0__a').size[1]=1+reviews;
   else target.packages[1].purpose+='; claimed final fix';
   answer.edit=planEdit(input.priorPlan,target);
  }
  return answer;
 });
 await assert.rejects(runSceneAssembly(h.options),/Architectural revision rejected/);
 assert.equal(h.calls.length,19);assert.equal(h.calls.at(-1).phase,'revise-design');assert.equal(h.calls.filter(c=>c.phase==='correct-design').length,0);
 const budget=JSON.parse(await fs.readFile(path.join(h.directory,'assembly','19','design-correction-budget.json')));
 assert.equal(budget.remaining,7);assert.equal(budget.mandatoryCalls,8);assert.equal(budget.stopReason,'staged-required-path-unfunded');
 assert.ok(!h.calls.some(c=>c.phase==='component'||c.phase==='review'));
});

test('review-demanded upper facade allocation can change before freeze, then all five scoped packages complete',async()=>{
 let revised=false;
 const h=await setupStaged(({answer,input,options})=>{
  if(options.stageName==='assembly-blueprint')answer.packages[1].regions[0].size[1]=183;
  if(options.stageName==='concept-review'&&!revised){revised=true;answer.verdict='revise';answer.issues=[{id:'facade-work-coverage',criterion:'facade',evidence:'Synthetic missing upper work allocation',change:'Allocate upper facade work within original bounds'}];}
  if(options.stageName==='revise-design'){
   const target=structuredClone(input.priorPlan);target.packages[1].regions[0].size[1]=224;target.packages[1].purpose+='; upper facade refinement';
   // Intentionally no geometry/material changes: a REAL allocation correction
   // must not be rejected as invisible geometry or force dummy decoration.
   answer.edit=planEdit(input.priorPlan,target);
  }
  return answer;
 });
 const result=await runSceneAssembly(h.options),root=path.join(h.directory,'assembly');
 assert.equal(h.calls.length,18);assert.equal(result.summary.completedPackages.length,5);assert.equal(result.summary.finalTextReviewAccepted,true);
 const revision=h.calls.find(c=>c.phase==='revise-design');assert.equal(revision.input.callBudget.responsibilitiesFrozen,false);
 assert.match(revision.instructions,/STAGED DESIGN ALLOCATION V1/);
 const allocation=JSON.parse(await fs.readFile(path.join(root,String(revision.index),'design-allocation.json')));
 assert.equal(allocation.authority.deltas[0].task,'task1');assert.equal(allocation.seed.sourceHash,revision.input.sourceHash);
 const make=h.calls.find(c=>c.phase==='component'&&c.input.task.id==='task1');assert.equal(make.input.task.regions[0].size[1],224);
 assert.equal(make.input.previousDraft.bounds.height,224);assert.equal(Object.hasOwn(make.input,'designAllocationReceipt'),false);
 const frozen=JSON.parse(await fs.readFile(path.join(root,'design-allocation-freeze.json'))),interfaces=JSON.parse(await fs.readFile(path.join(root,'interfaces.json')));
 assert.equal(frozen.allocationReceiptHash,allocation.receiptHash);assert.equal(interfaces.allocationFreezeHash,frozen.freezeHash);
 assert.equal(frozen.packagesHash,hash(interfaces.packages));assert.equal(frozen.canAuthorizePlacement,false);
});
test('a pre-freeze allocation cannot be used to steal another owner or widen world bounds',async()=>{
 for(const kind of ['owner','bounds','protection']){
  let revised=false;
  const h=await setupStaged(({answer,input,options})=>{
   if(options.stageName==='concept-review'&&!revised){revised=true;answer.verdict='revise';answer.issues=[{id:'seed-proof',criterion:'materials',evidence:'Synthetic bounded revision',change:'Refine the owned seed'}];}
   if(options.stageName==='revise-design'){
    if(kind==='owner')answer.edit.packages.put=[{...structuredClone(input.priorPlan.packages[0]),editableComponents:[...input.priorPlan.packages[0].editableComponents,'task1__a']}];
    if(kind==='bounds')answer.edit.packages.put=[{...structuredClone(input.priorPlan.packages[0]),regions:[{origin:[0,0,0],size:[33,224,32]}]}];
    if(kind==='protection')answer.edit.sceneEdit.reservations.put=[{id:'newGuard',at:{relativeTo:null,anchor:'min',offset:[12,1,20]},size:[1,1,1],allowedComponents:[]}];
   }
   return answer;
  });
  const result=await runSceneAssembly(h.options);
  assert.equal(result.records.find(r=>r.phase==='revise-design').state,'rejected');assert.equal(result.summary.completedPackages.length,5);
  assert.equal(result.summary.finalTextReviewAccepted,true);assert.ok(h.calls.length<=26);
 }
});
