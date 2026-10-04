import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../../src/generation/compiler.mjs';
import {readAssemblyBaseline} from '../../src/design/assembly-scope.mjs';
import {runSceneAssembly} from '../../bridge/scene-assembly.mjs';
import {designAllocationCoverage,inspectPrototypeRoleAllocation} from '../../bridge/assembly-design-allocation.mjs';
import {setupStaged} from './decomposed-assembly-fixtures.mjs';
import {shape} from '../design/fixtures.mjs';

// Synthetic unchanged structural context extending beyond a role workspace.
// The role's real changes fit; claiming the WHOLE host as a witness does not.
function contextBlueprint(answer){
 const task=answer.packages[2];
 answer.sceneEdit.components.put.push(shape('entryContext',[16,4,23],[2,1,2],'frame'));
 task.editableComponents.push('entryContext');
}
function contextWitness(answer){answer.representatives[1].components.push('entryContext');}
const json=async file=>JSON.parse(await fs.readFile(file,'utf8'));

test('an uncovered unchanged entry witness is corrected in its role, before crown/review and within the full-task budget',async()=>{
 const h=await setupStaged(({answer,input,options})=>{
  if(options.stageName==='assembly-blueprint')contextBlueprint(answer);
  if(options.stageName==='prototype-role'&&input.role==='entry-podium')contextWitness(answer);
  return answer;
 });
 const result=await runSceneAssembly(h.options),root=path.join(h.directory,'assembly');
 assert.equal(h.calls.length,17);assert.equal(result.summary.completedPackages.length,5);
 assert.equal(result.summary.finalTextReviewAccepted,true);assert.equal(result.scene.bounds.height,224);
 const original=h.calls.find(c=>c.phase==='prototype-role'&&c.input.role==='entry-podium');
 const correction=h.calls.find(c=>c.phase==='correct-prototype-role'&&c.input.role==='entry-podium');
 assert.ok(correction);assert.equal(correction.index,original.index+1);
 assert.equal(result.records.find(r=>r.index===original.index).state,'rejected');
 assert.equal(result.records.find(r=>r.index===correction.index).state,'accepted');
 assert.equal(h.calls.find(c=>c.input.role==='special-crown').index,correction.index+1);
 assert.equal(correction.input.sourceHash,original.input.sourceHash);
 assert.equal(correction.input.planHash,original.input.planHash);
 assert.deepEqual(correction.input.task,original.input.task);
 assert.equal(correction.input.prior.overallAccepted,false);
 const feedback=correction.input.prior.feedback.designAllocation;
 assert.equal(feedback.subject,'seed');assert.equal(feedback.geometryChangedByCheck,false);
 assert.equal(feedback.worldAuthorityChanged,false);assert.equal(feedback.canAuthorizePlacement,false);
 assert.equal(feedback.sourceHash,hash((await json(path.join(root,String(original.index),'plan.json'))).scene));
 const row=feedback.uncoveredSources.find(s=>s.id==='entryContext');
 assert.equal(row.task,'task2');assert.equal(row.outsideWorkspace,4);
 assert.deepEqual(row.uncoveredBounds,{min:[16,4,23],maxExclusive:[18,5,25]});
 assert.deepEqual(row.uncoveredSamples,[[16,4,23],[17,4,23],[16,4,24],[17,4,24]]);
 assert.deepEqual(row.regions,original.input.task.regions);
 assert.match(correction.instructions,/unchanged parts/);assert.match(correction.instructions,/do not enlarge/);
 const rejected=await json(path.join(root,String(original.index),'prototype-allocation.json'));
 assert.equal(rejected.accepted,false);assert.equal(rejected.feedback.feedbackHash,feedback.feedbackHash);
 const accepted=await json(path.join(root,String(correction.index),'prototype-allocation.json'));
 assert.equal(accepted.accepted,true);assert.equal(accepted.seed.allRequiredSourceCellsCovered,true);
 assert.equal(accepted.expanded.allRequiredSourceCellsCovered,true);
 assert.equal(accepted.architecturalQualityVerified,false);
 const {receiptHash,...data}=accepted;assert.equal(receiptHash,hash(data));
 // Correction drops only the unsupported claim, not the original geometry,
 // its exclusive owner, any package, protected space or the requested height.
 const plan=await json(path.join(root,String(correction.index),'plan.json'));
 const prior=await json(path.join(root,String(original.index-1),'plan.json'));
 assert.deepEqual(plan.scene.components.find(c=>c.id==='entryContext'),prior.scene.components.find(c=>c.id==='entryContext'));
 assert.deepEqual(plan.scene.reservations,prior.scene.reservations);
 assert.deepEqual(plan.packages.map(p=>p.regions),prior.packages.map(p=>p.regions));
 assert.equal(plan.packages[2].editableComponents.includes('entryContext'),true);
 assert.equal(result.scene.components.some(c=>c.id==='entryContext'),true);
});

test('coverage returns actual uncovered owner cells, not an estimated AABB or automatic workspace expansion',async()=>{
 const h=await setupStaged(({answer,options})=>{if(options.stageName==='assembly-blueprint')contextBlueprint(answer);return answer;});
 await runSceneAssembly(h.options);const root=path.join(h.directory,'assembly','8');
 const state=await json(path.join(root,'decomposition-state.json')),feedback=await json(path.join(root,'feedback.json'));
 const compiled=await readAssemblyBaseline(path.join(root,'diagnostic'),feedback.diagnosticAssetHash);
 const representatives=structuredClone(state.representativesByRole);representatives['entry-podium'][1].components.push('entryContext');
 const planHash=hash(state.plan),cellsHash=hash(compiled.cells),ownersHash=hash(compiled.sourceOwners);
 assert.throws(()=>designAllocationCoverage(state.plan,compiled,state.roles,representatives,Object.values(state.recipesByRole).flat()),error=>{
  assert.match(error.message,/task2\/entryContext at \[16,4,23\]/);
  assert.equal(error.designAllocationFeedback.outsideWorkspaceCells,4);
  assert.equal(error.designAllocationFeedback.assetHash,compiled.manifest.assetHash);
  assert.equal(error.designAllocationFeedback.ownersHash,compiled.manifest.scene.ownersHash);
  assert.equal(error.designAllocationFeedback.packagesHash,hash(state.plan.packages));
  const {feedbackHash,...data}=error.designAllocationFeedback;assert.equal(feedbackHash,hash(data));return true;
 });
 assert.equal(hash(state.plan),planHash);assert.equal(hash(compiled.cells),cellsHash);assert.equal(hash(compiled.sourceOwners),ownersHash);
});

test('a repeated invalid witness is not adopted or escalated into later roles and does not spend the mandatory tail',async()=>{
 const h=await setupStaged(({answer,input,options})=>{
  if(options.stageName==='assembly-blueprint')contextBlueprint(answer);
  if(['prototype-role','correct-prototype-role'].includes(options.stageName)&&input.role==='entry-podium')contextWitness(answer);
  return answer;
 });
 await assert.rejects(runSceneAssembly(h.options),/Prototype role correction repeated the same rejected delta/);
 assert.equal(h.calls.length,9);assert.equal(h.calls.at(-1).phase,'correct-prototype-role');
 assert.ok(h.calls.every(c=>!['concept-review','component','review'].includes(c.phase)&&c.input.role!=='special-crown'));
 for(const call of h.calls.filter(c=>c.input.role==='entry-podium')){
  const report=await json(path.join(h.directory,'assembly',String(call.index),'result.json'));
  assert.equal(report.accepted,false);assert.equal(report.feedback.geometryPassed,true);
  assert.equal(report.feedback.designAllocation.outsideWorkspaceCells,4);
 }
 assert.ok(h.calls.at(-1).input.prototypeCorrectionBudget.remaining>=h.calls.at(-1).input.prototypeCorrectionBudget.mandatoryCalls);
});

test('a fitting seed cannot hide an uncovered expanded owner and storage identity failures are not repair feedback',async()=>{
 const h=await setupStaged();await runSceneAssembly(h.options);
 const root=path.join(h.directory,'assembly','6'),state=await json(path.join(root,'decomposition-state.json'));
 const seedFeedback=await json(path.join(root,'feedback.json'));
 const prototype={plan:await json(path.join(root,'prototype','plan.json')),program:await json(path.join(root,'prototype','program.json')),
  diagnostic:path.join(root,'prototype','diagnostic'),feedback:await json(path.join(root,'prototype','feedback.json'))};
 // Explicit hypothetical package data, NOT a changed saved/model baseline.
 // Seed owns Y1, repeated instance owns Y6; count both from original bundles.
 state.plan.packages[0].regions[0].size[1]=2;prototype.plan.packages=structuredClone(state.plan.packages);
 const checked={diagnostic:path.join(root,'diagnostic'),feedback:seedFeedback,prototype};
 const stateHash=hash(state);
 await assert.rejects(inspectPrototypeRoleAllocation({state,checked}),error=>{
  const f=error.designAllocationFeedback;assert.equal(f.subject,'expanded');assert.equal(f.outsideWorkspaceCells,1);
  assert.equal(f.uncoveredSources[0].id,'task0__a');assert.deepEqual(f.uncoveredSources[0].uncoveredSamples,[[12,6,20]]);
  assert.equal(f.assetHash,prototype.feedback.diagnosticAssetHash);assert.equal(f.sourceHash,hash(prototype.plan.scene));return true;
 });
 assert.equal(hash(state),stateHash);
 await assert.rejects(inspectPrototypeRoleAllocation({state,checked:{...checked,feedback:{...seedFeedback,diagnosticAssetHash:'0'.repeat(64)}}}),error=>{
  assert.equal(error.designAllocationFeedback,undefined);return true;
 });
});

test('legacy staged policy retains its original checks and cannot silently acquire the new allocation stage',async()=>{
 const h=await setupStaged(({answer,input,options})=>{
  if(options.stageName==='assembly-blueprint')contextBlueprint(answer);
  if(options.stageName==='prototype-role'&&input.role==='entry-podium')contextWitness(answer);
  return answer;
 },undefined,{legacyV4:true});
 const result=await runSceneAssembly(h.options);assert.equal(h.calls.length,16);
 assert.equal(result.summary.completedPackages.length,5);
 const role=h.calls.find(c=>c.input.role==='entry-podium');
 assert.equal(Object.hasOwn(role.input,'prototypeAllocationPolicy'),false);
 await assert.rejects(fs.access(path.join(h.directory,'assembly',String(role.index),'prototype-allocation.json')),{code:'ENOENT'});
});
