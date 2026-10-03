import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {runSceneAssembly} from '../../bridge/scene-assembly.mjs';
import {runDurableAssembly} from '../../bridge/assembly-durability.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {schemaFeedback} from '../../contracts/schema-feedback.mjs';
import {assemblyStageSchema} from '../../contracts/scene-assembly-stage.mjs';
import {prototypePlanSchema,prototypePlanEditSchema,prototypePlanRepairSchema,prototypeProgramHash} from '../../contracts/scene-prototype-plan.mjs';
import {assemblyPlan,planEdit} from '../design/assembly-fixtures.mjs';
import {v4Request,v4Review} from './quality-v4-fixtures.mjs';
import {prototypeRequest as request,prototypeRecipes as recipes,prototypeSeedPlan as seedPlan,setupPrototypes as setup} from './assembly-prototypes-fixtures.mjs';
import {prototypeTransitionRecord} from '../../bridge/assembly-prototypes.mjs';
import {readNativeEvidence} from '../../bridge/native-evidence.mjs';
test('verified prototype opt-in preserves all tier/token budgets and rejects old/nonvisual/patch paths',()=>{
 for(const qualityTier of ['lite','pro','max','ultra']){
  const p=generationPreflight({...request,qualityTier}),old=generationPreflight({...request,qualityTier,assemblyPrototypes:undefined});
  assert.equal(p.maximumCalls,old.maximumCalls);assert.equal(p.maxOutputTokens,null);assert.equal(p.assembly.prototypes.expansionCalls,0);
 }
 for(const delta of [{assemblyPrototypes:true},{assemblyPrototypes:'unchecked'},{assemblyQuality:'v3'},{assemblyDesignReview:'text'},{assemblyRecovery:undefined},{sceneWorkflow:undefined},{baseJobId:'old'}])assert.throws(()=>generationPreflight({...request,...delta}));
 assert.equal(generationPreflight(v4Request).assembly.prototypes,undefined);
});
test('wrapper stage schemas retain nested definitions, budget, identity and frozen repair intent',()=>{
 const plan=seedPlan(),input={priorPlan:plan,planHash:hash(plan),sourceHash:hash(plan.scene),prototypeProgramHash:prototypeProgramHash(plan,recipes(3)),callBudget:{maximumPackages:2}};
 for(const [base,key,inner] of [[prototypePlanSchema,'plan',plan],[prototypePlanEditSchema,'edit',planEdit(plan,plan)],[prototypePlanRepairSchema,'repair',{format:'SceneAssemblyPlanRepair',version:1,planHash:input.planHash,proposal:plan}]]){
  const original=hash(base),schema=assemblyStageSchema(base,input),answer={format:schema.properties.format.enum[0],version:1,[key]:inner,recipes:recipes(3),...(key==='plan'?{}:{programHash:input.prototypeProgramHash})};
  assert.equal(schemaFeedback(answer,schema).valid,true);assert.equal(hash(base),original);assert.ok(schema.$defs.component);
  if(key==='plan')assert.equal(schema.properties.plan.properties.packages.maxItems,2);
  if(key==='edit'){
   assert.deepEqual(schema.properties.edit.properties.sceneEdit.properties.sourceHash.enum,[input.sourceHash]);
   assert.equal(schemaFeedback({...answer,programHash:'0'.repeat(64)},schema).valid,false);
  }
  if(key==='repair')assert.deepEqual(schema.properties.repair.properties.proposal.properties.designIntent.enum,[plan.designIntent]);
 }
});
test('real saved seed -> full expansion precheck -> bound visual acceptance -> packages -> final review uses no additional model stage',async()=>{
 const h=await setup(),result=await runSceneAssembly(h.options);
 assert.equal(h.calls.length,7);assert.equal(result.summary.completedPackages.length,2);
 const concept=h.calls.find(c=>c.phase==='concept-review'),make=h.calls.find(c=>c.phase==='component'),transition=result.summary.prototypeExpansion;
 assert.equal(concept.input.proposal.scene.components.find(c=>c.id==='designSeed').repeat.count,1);
 assert.equal(make.input.previousDraft.components.find(c=>c.id==='designSeed').repeat.count,3);
 assert.equal(result.scene.components.find(c=>c.id==='designSeed').repeat.count,3);
 const binding=concept.input.designEvidence.prototypeExpansion;
 assert.equal(binding.expandedPixelsSupplied,true);assert.equal(binding.seedOnly,false);assert.equal(binding.reviewSubject,'expanded');
 assert.equal(binding.seedSourceHash,concept.input.sourceHash);assert.notEqual(concept.input.designEvidence.sourceHash,concept.input.sourceHash);
 assert.equal(concept.input.designEvidence.sourceHash,binding.expandedSourceHash);assert.equal(concept.input.designEvidence.assetHash,binding.expandedAssetHash);
 assert.equal(transition.seedEvidenceHash,concept.input.designEvidence.evidenceHash);assert.equal(transition.reviewStage,4);assert.equal(transition.additionalModelCalls,0);
 assert.equal(transition.seedVisualAccepted,false);assert.equal(transition.expandedVisualAccepted,true);assert.equal(transition.canAuthorizePlacement,false);assert.equal(transition.finalVisualReviewCurrent,true);
 const stored=JSON.parse(await fs.readFile(path.join(h.directory,'assembly','prototype-transition.json'),'utf8'));
 assert.equal(stored.transitionHash,transition.transitionHash);
 const source=JSON.parse(await fs.readFile(path.join(h.directory,'assembly','3','response.json'),'utf8'));assert.equal(source.format,'ScenePrototypePlan');assert.equal(source.plan.scene.components.at(-1).repeat.count,1);
 const capture=await readNativeEvidence(h.directory,concept.input.designEvidence.requestHash);
 assert.equal(capture.evidence.sourceHash,binding.expandedSourceHash);assert.deepEqual(capture.images,concept.images);
 const candidate=JSON.parse(await fs.readFile(path.join(h.directory,'assembly','3','result.json'),'utf8')).prototype;
 const review=JSON.parse(await fs.readFile(path.join(h.directory,'assembly','4','response.json'),'utf8'));
 const args={plan:source.plan,prototype:candidate,review,reviewStage:4,visual:{evidence:concept.input.designEvidence,images:concept.images},directory:path.join(h.directory,'assembly')};
 for(const change of [v=>v.evidence.sourceHash=binding.seedSourceHash,v=>v.evidence.prototypeExpansion.expandedPixelsSupplied=false,v=>v.evidence.prototypeExpansion.expandedAssetHash='0'.repeat(64),v=>v.images.pop()]){
  const visual=structuredClone(args.visual);change(visual);assert.throws(()=>prototypeTransitionRecord({...args,visual}),/accepted expanded image review/);
 }
});
test('a seed-only capture cannot substitute for the expanded subject and consumes no review invocation',async()=>{
 const h=await setup(),original=h.options.nativeEvidence;
 h.options.nativeEvidence=async o=>{
  const capture=await original(o);
  if(h.calls.at(-1)?.phase==='plan')capture.evidence.sourceHash=hash(seedPlan().scene);
  return capture;
 };
 await assert.rejects(runSceneAssembly(h.options),/Native evidence subject mismatch/);
 assert.equal(h.calls.length,3);assert.equal(h.calls.some(c=>c.phase==='concept-review'),false);
});
test('invalid later expanded instance is corrected within the original plan budget before any seed review',async()=>{
 const h=await setup(({answer,options})=>{if(options.stageName==='plan')answer.recipes[0].step=[100,0,0];}),result=await runSceneAssembly(h.options);
 assert.equal(h.calls.length,8);assert.equal(h.calls[3].phase,'correct-plan');assert.equal(h.calls[4].phase,'concept-review');
 assert.equal(h.calls[3].input.feedback.prototypeExpansion.geometryPassed,false);
 assert.equal(result.summary.prototypeExpansion.reviewStage,5);assert.equal(result.scene.components.find(c=>c.id==='designSeed').repeat.count,3);
});
test('a recipe-only visual revision creates distinct metadata without inventing new seed pixels or being stopped as geometry no-progress',async()=>{
 let reviews=0;
 const h=await setup(({answer,input,options})=>{
  if(options.stageName==='concept-review'){
   reviews++;if(reviews===1)return {...v4Review(input,true),verdict:'revise',issues:[{id:'seed-spacing',criterion:'facade',evidence:'Synthetic recipe study, not visual quality',change:'Test a distinct full-expansion rule'}]};
  }
  if(options.stageName==='revise-design')answer.recipes=recipes(2);
 }),result=await runSceneAssembly(h.options);
 const checks=h.calls.filter(c=>c.phase==='concept-review');assert.equal(checks.length,2);assert.equal(h.calls.length,9);
 assert.equal(checks[0].input.sourceHash,checks[1].input.sourceHash);
 assert.equal(checks[1].input.designEvidence.kind,'native-revision');
 assert.notEqual(checks[0].input.designEvidence.sourceHash,checks[1].input.designEvidence.sourceHash);
 assert.equal(checks[1].input.designEvidence.subjects[0].sourceHash,checks[0].input.designEvidence.sourceHash);
 assert.equal(checks[1].input.revisionMeasurements.afterSourceHash,checks[1].input.designEvidence.sourceHash);
 assert.notEqual(checks[0].input.designEvidence.evidenceHash,checks[1].input.designEvidence.evidenceHash);
 assert.notEqual(checks[0].input.designEvidence.prototypeExpansion.programHash,checks[1].input.designEvidence.prototypeExpansion.programHash);
 assert.equal(result.scene.components.find(c=>c.id==='designSeed').repeat.count,2);
});
test('durable recovery of a saved prototype response does not repeat paid invocation or old captures',async()=>{
 const h=await setup(),identity={requestHash:hash(request),runtimeHash:'prototype-offline-test'},abort=new AbortController();
 await assert.rejects(runDurableAssembly({...h.options,...identity,signal:abort.signal,onStage:async records=>{if(records.at(-1).phase==='concept-review'&&records.at(-1).state==='accepted')abort.abort();}}),/abort/i);
 const captures=h.uploads.length;assert.equal(h.calls.length,4);
 const result=await runDurableAssembly({...h.options,...identity});assert.equal(h.calls.length,7);assert.equal(h.uploads.length,captures+1);
 assert.equal(result.summary.prototypeExpansion.additionalModelCalls,0);
 const completedCaptures=h.uploads.length;await runDurableAssembly({...h.options,...identity});assert.equal(h.calls.length,7);assert.equal(h.uploads.length,completedCaptures);
});
test('a stale program hash is a terminal identity failure, not authorization for an automatic resend',async()=>{
 const h=await setup(({answer,options})=>{if(options.stageName==='plan')answer.recipes[0].step=[100,0,0];if(options.stageName==='correct-plan')answer.programHash='0'.repeat(64);});
 await assert.rejects(runSceneAssembly(h.options),/Stale prototype/);assert.equal(h.calls.length,4);
});
test('contract-invalid inner plans and missing outer plan data are repaired with wrappers, not silently normalized',async()=>{
 for(const missing of [false,true]){
  const h=await setup(({answer,options})=>{if(options.stageName==='plan'){if(missing)delete answer.plan;else answer.plan.packages[0].editableComponents=['missing'];}}),result=await runSceneAssembly(h.options);
  assert.equal(h.calls.length,8);assert.equal(h.calls[3].phase,'repair-plan');assert.equal(result.summary.completedPackages.length,2);
 }
});
test('candidate-local design correction preserves rejected recipes and only adopts the corrected full expansion after a new visual review',async()=>{
 let checks=0;
 const h=await setup(({answer,input,options})=>{
  if(options.stageName==='concept-review'&&++checks===1)return {...v4Review(input,true),verdict:'revise',issues:[{id:'recipe-detail',criterion:'facade',evidence:'Synthetic candidate correction fixture',change:'Exercise recipe-only revision and bounded correction'}]};
  if(options.stageName==='revise-design')answer.recipes[0].step=[100,0,0];
  if(options.stageName==='correct-design')answer.recipes=recipes(2);
 }),result=await runSceneAssembly(h.options);
 const correction=h.calls.find(c=>c.phase==='correct-design');assert.ok(correction.input.repairBase);assert.deepEqual(correction.input.prototypeRecipes[0].step,[100,0,0]);
 assert.equal(result.scene.components.find(c=>c.id==='designSeed').repeat.count,2);assert.equal(h.calls.length,10);
});
