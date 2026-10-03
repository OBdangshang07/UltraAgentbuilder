import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {runSceneAssembly} from '../../bridge/scene-assembly.mjs';
import {runDurableAssembly} from '../../bridge/assembly-durability.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyPlan,packageEdit,acceptReview,planEdit} from '../design/assembly-fixtures.mjs';
import {requestNativeEvidence,acceptNativeEvidence,validateModelImageFiles,readNativeComparison} from '../../bridge/native-evidence.mjs';
import {fixtureUpload} from './native-evidence-fixtures.mjs';
import {validateConceptSet,validateConceptSelection,checkSelectedConceptPlan,SelectedConceptLoweringError} from '../../contracts/scene-concepts.mjs';
import {inspectCheckpoint} from '../../bridge/scene-checkpoints.mjs';
import {schemaFeedback} from '../../contracts/schema-feedback.mjs';
import {shape} from '../design/fixtures.mjs';
const request={agent:'codex',model:'offline',prompt:'16×10×16格边界内设计建筑，保留内饰和通路',generationMode:'scene',sceneWorkflow:'components',qualityTier:'ultra',assemblyQuality:'v3',assemblyDesignReview:'native',assemblyRecovery:'safe',assemblyConfirmed:true,maxRepairs:0};
const rules=await fs.readFile(new URL('../../prompts/scene-v1.md',import.meta.url),'utf8');
export function concepts(count){return {format:'SceneConceptSet',version:1,candidates:Array.from({length:count},(_,i)=>{
 const scene=assemblyPlan().scene;scene.constraints={...scene.constraints,interior:false,walkable:false,passages:[]};scene.components[0].size[0]-=i;
 return {id:'candidate-'+i,rationale:'Offline transport/geometry fixture, not architectural quality evidence',scene};
})};}
export function v3Response(input,options){
 const kind=options.outputSchema.properties.format.enum[0];
 if(kind==='SceneConceptSet')return concepts(input.count);
 if(kind==='SceneConceptSelection')return {format:kind,version:1,candidateSetHash:input.candidateSetHash,evidenceHash:input.designEvidence.evidenceHash,selected:input.candidates[0].id,reason:'Fixture only',comparisons:input.designEvidence.subjects.map(s=>({id:s.id,strength:'Test capture exists',weakness:'Fixture is not design validation',views:[input.designEvidence.views.findIndex(v=>v.subjectId===s.id)]}))};
 if(kind==='SceneAssemblyPlan')return assemblyPlan();
 if(kind==='SceneAssemblyPlanEdit')return planEdit(input.priorPlan,input.priorPlan);
 if(kind==='SceneConceptReview')return {format:kind,version:1,planHash:input.planHash,sourceHash:input.sourceHash,evidenceHash:input.designEvidence.evidenceHash,verdict:'accept',summary:'Offline fixture only',issues:[]};
 if(kind==='SceneAssemblyReview')return acceptReview(input);
 return packageEdit(input);
}
async function setup(payload=request){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-quality-v3-')),calls=[],uploads=[];
 return {directory,calls,uploads,options:{directory,prompt:payload.prompt,rules,policy:generationPreflight(payload),signal:new AbortController().signal,onStage:async()=>{},
  nativeEvidence:o=>requestNativeEvidence({...o,jobDirectory:directory,timeoutMs:2000,onWaiting:async s=>{if(s.state==='waiting'){uploads.push(s.id);await acceptNativeEvidence(directory,s.id,fixtureUpload(s.request));}}}),
  invoke:async(prompt,index,options)=>{assert.ok(!calls.some(c=>c.index===index),'Duplicate invocation');const input=JSON.parse(prompt.split('Assembly input (data):\n').at(-1));calls.push({index,phase:options.stageName,input,images:[...options.images],instructions:prompt.split('Assembly input (data):\n')[0]});await validateModelImageFiles(options.images,directory);const answer=v3Response(input,options);const check=schemaFeedback(answer,options.outputSchema);assert.equal(check.valid,true,JSON.stringify(check.issues));return answer;}}};
}
test('v3 requires explicit native mode and reserves candidates in the original budget',()=>{
 const p=generationPreflight(request);assert.equal(p.maximumCalls,26);assert.equal(p.assembly.quality.version,3);assert.equal(p.maxOutputTokens,null);
 for(const extra of [{assemblyCalls:6},{assemblyDesignReview:'text'},{assemblyDesignReview:'images'},{assemblyRecovery:undefined},{agent:'claude'}])assert.throws(()=>generationPreflight({...request,...extra}));
 const lite=generationPreflight({...request,qualityTier:'lite',assemblyCalls:7});assert.equal(lite.assembly.maxPackages,2);
});
test('v3 builds actual diagnostic alternatives and chooses with bound comparison images; all 7 calls stay in one task',async()=>{
 const {directory,calls,uploads,options}=await setup();const result=await runSceneAssembly(options);
 assert.deepEqual(calls.map(c=>c.phase),['concepts','select-concept','plan','concept-review','component','component','review']);assert.equal(uploads.length,5);
 assert.equal(result.summary.qualityVersion,3);assert.equal(result.summary.reservedCalls,7);assert.equal(result.summary.conceptSelection.eligible.length,3);assert.equal(result.summary.visualReviewCurrent,true);
 const input=calls[1].input,e=input.designEvidence;assert.equal(e.views.length,6);assert.equal(e.diagnosticOnly,true);assert.equal(e.canAuthorizePlacement,false);
 assert.deepEqual(e.views.map(v=>v.subjectId),['candidate-0','candidate-0','candidate-1','candidate-1','candidate-2','candidate-2']);
 const selection=v3Response(input,{outputSchema:{properties:{format:{enum:['SceneConceptSelection']}}}});assert.equal(validateConceptSelection(selection,input.candidateSetHash,e).selected,'candidate-0');
 assert.throws(()=>validateConceptSelection({...selection,evidenceHash:'0'.repeat(64)},input.candidateSetHash,e),/identity/);
 const wrong=structuredClone(selection);wrong.comparisons[0].views=[2];assert.throws(()=>validateConceptSelection(wrong,input.candidateSetHash,e),/another concept/);
 const comparison=await readNativeComparison(directory,e.evidenceHash);await assert.rejects(validateModelImageFiles(comparison.images.slice(0,4),directory),/selection/);
 const b=await fs.readFile(comparison.images[0]);b[40]^=1;await fs.writeFile(comparison.images[0],b);await assert.rejects(readNativeComparison(directory,e.evidenceHash),/changed/);
 const manifest=JSON.parse(await fs.readFile(path.join(directory,'assembly/1/candidate-0/diagnostic/manifest.json'),'utf8'));assert.equal(manifest.diagnosticOnly,true);assert.equal(manifest.conceptOnly,true);
});
test('concept schema never relaxes the complete plan and selected massing cannot silently be replaced',()=>{
 const set=concepts(2);assert.equal(validateConceptSet(set,2),set);const bad=structuredClone(set);bad.candidates[1].id=bad.candidates[0].id;assert.throws(()=>validateConceptSet(bad,2),/Duplicate/);
 bad.candidates[1].id='other';bad.candidates[0].scene.constraints.walkable=true;assert.throws(()=>validateConceptSet(bad,2),/contract/);
 checkSelectedConceptPlan(set.candidates[0],assemblyPlan());const plan=assemblyPlan();plan.scene.components[0].size[0]--;assert.throws(()=>checkSelectedConceptPlan(set.candidates[0],plan),/massing anchor/);
});
const invalidPlanRooms=()=>[
 {kind:'storeyRoom',id:'room-a',host:'main',allowOverwrite:[],floors:{source:'main',first:0,count:1},offset:[1,10],footprint:[3,3],ceilingInset:1,use:'room',purpose:'Offline coordinate regression',floorMaterial:'floor',boundaries:[]},
 {kind:'storeyRoom',id:'room-b',host:'main',allowOverwrite:[],floors:{source:'main',first:0,count:1},offset:[10,1],footprint:[3,3],ceilingInset:1,use:'room',purpose:'Offline coordinate regression',floorMaterial:'floor',boundaries:[]},
];
test('candidate lowering errors are distinct from direct and indirect selected-massing changes',()=>{
 const selected=concepts(1).candidates[0],bad=assemblyPlan();bad.scene.components.push(...invalidPlanRooms());
 assert.throws(()=>checkSelectedConceptPlan(selected,bad),e=>e instanceof SelectedConceptLoweringError&&/host interior/.test(e.cause.message));
 const moved=assemblyPlan();moved.scene.components[0].at.offset[0]++;
 assert.throws(()=>checkSelectedConceptPlan(selected,moved),e=>!(e instanceof SelectedConceptLoweringError)&&/massing anchor/.test(e.message));
 const identity=assemblyPlan();identity.scene.seed++;
 assert.throws(()=>checkSelectedConceptPlan(selected,identity),e=>!(e instanceof SelectedConceptLoweringError)&&/identity/.test(e.message));
 const relative=assemblyPlan();relative.scene.components.unshift(shape('anchor',[0,0,0],[1,1,1]));relative.scene.components[1].at.relativeTo='anchor';
 const original={scene:structuredClone(relative.scene)};checkSelectedConceptPlan(original,relative);
 relative.scene.components[0].at.offset[0]++;
 assert.throws(()=>checkSelectedConceptPlan(original,relative),e=>!(e instanceof SelectedConceptLoweringError)&&/indirect anchor/.test(e.message));
});
test('full-plan lowering failures deliver every room coordinate through durable correction without replaying paid stages',async()=>{
 const {options,calls,directory}=await setup(),invoke=options.invoke,abort=new AbortController();let rejected;
 options.invoke=async(p,i,o)=>{
  const r=await invoke(p,i,o);
  if(o.stageName==='plan'){r.scene.components.push(...invalidPlanRooms());rejected=structuredClone(r);}
  if(o.stageName==='correct-plan'){
   const input=calls.at(-1).input;assert.deepEqual(input.priorPlan,rejected);assert.equal(input.planHash,hash(rejected));
   assert.equal(input.feedback.geometryPassed,false);assert.equal(input.feedback.canAuthorizePlacement,false);assert.equal(input.feedback.contract,undefined);
   assert.equal(input.feedback.constructionFeedback.issueCount,2);assert.equal(input.feedback.constructionFeedback.issueFormat,'component-rule-groups');
   assert.deepEqual(new Set(input.feedback.constructionFeedback.issues.map(v=>v.component)),new Set(['room-a','room-b']));
   for(const issue of input.feedback.constructionFeedback.issues){assert.ok(issue.layoutFeedback.roomZoneFeedback.boundingInteriorXZ);assert.ok(issue.layoutFeedback.origin);assert.ok(issue.layoutFeedback.size);}
   const corrected=structuredClone(rejected);corrected.scene.components.find(c=>c.id==='room-a').offset=[2,2];corrected.scene.components.find(c=>c.id==='room-b').offset=[6,6];
   return planEdit(input.priorPlan,corrected);
  }
  return r;
 };
 const identity={requestHash:hash(request),runtimeHash:'v3-plan-lowering-fixture'};
 await assert.rejects(runDurableAssembly({...options,...identity,signal:abort.signal,onStage:async records=>{if(records.at(-1).phase==='correct-plan'&&records.at(-1).state==='accepted')abort.abort();}}),/abort/i);
 assert.equal(calls.length,4);
 const result=await runDurableAssembly({...options,...identity});assert.equal(result.summary.reservedCalls,8);assert.equal(calls.length,8);
 assert.deepEqual(calls.map(c=>c.phase),['concepts','select-concept','plan','correct-plan','concept-review','component','component','review']);
 const branches=(await fs.readdir(directory)).filter(n=>n.startsWith('assembly-run-'));
 for(const branch of branches){
  const stage=path.join(directory,branch,'assembly','3');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(stage,'plan.json'),'utf8')),rejected);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(stage,'response.json'),'utf8')),rejected);
  const f=JSON.parse(await fs.readFile(path.join(stage,'feedback.json'),'utf8'));assert.equal(f.constructionFeedback.issueCount,2);assert.equal(f.geometryPassed,false);
 }
});
test('a permissive inspection cannot turn a selected-concept lowering error into an accepted plan',async()=>{
 const {options,calls}=await setup(),invoke=options.invoke;
 options.invoke=async(p,i,o)=>{const r=await invoke(p,i,o);if(o.stageName==='plan')r.scene.components.push(...invalidPlanRooms());return r;};
 options.inspect=async(scene,...args)=>scene.components.some(c=>c.id==='room-a')?{sourceHash:hash(scene),canAuthorizePlacement:false,geometryPassed:true,error:null}:inspectCheckpoint(scene,...args);
 await assert.rejects(runSceneAssembly(options),/lowering and full-scene inspection disagree/);
 assert.deepEqual(calls.map(c=>c.phase),['concepts','select-concept','plan']);
});
test('duplicate geometry or invalid candidates are excluded, not silently regenerated or counted as distinct',async()=>{
 const {options,calls,uploads}=await setup();const invoke=options.invoke;
 options.invoke=async(p,i,o)=>{const r=await invoke(p,i,o);if(o.stageName==='concepts'){r.candidates[1].scene=structuredClone(r.candidates[0].scene);r.candidates[1].scene.palette[0].material='white';r.candidates[2].scene.components[0].size[0]=100;}return r;};
 const result=await runSceneAssembly(options);assert.equal(calls.length,7);assert.equal(result.summary.conceptSelection.eligible.length,1);assert.equal(result.summary.conceptSelection.excluded.length,2);assert.equal(calls[1].input.designEvidence.views.length,4);assert.equal(uploads.length,3);
});
test('minimum funded v3 task never spends its remaining full-task path correcting an empty candidate set',async()=>{
 const {options,calls}=await setup({...request,qualityTier:'lite',assemblyCalls:7});options.invoke=async(p,i,o)=>{calls.push(i);const r=concepts(1);r.candidates[0].scene.components[0].size[0]=100;return r;};
 await assert.rejects(runSceneAssembly(options),/required complete-task budget/);assert.equal(calls.length,1);
});
test('v3 durable replay keeps original concept comparisons and never dispatches a completed choice again',async()=>{
 const {options,calls,uploads}=await setup(),abort=new AbortController(),identity={requestHash:hash(request),runtimeHash:'v3-fixture-only'};
 await assert.rejects(runDurableAssembly({...options,...identity,signal:abort.signal,onStage:async records=>{if(records.at(-1).phase==='select-concept'&&records.at(-1).state==='accepted')abort.abort();}}),/abort/i);
 assert.equal(calls.length,2);assert.equal(uploads.length,3);
 const result=await runDurableAssembly({...options,...identity});assert.equal(calls.length,7);assert.equal(uploads.length,5);assert.equal(result.summary.reservedCalls,7);
});
test('v3 rejects stale selection identity without issuing a plan or spending extra calls',async()=>{
 const {options,calls}=await setup(),invoke=options.invoke;options.invoke=async(p,i,o)=>{const r=await invoke(p,i,o);if(o.stageName==='select-concept')r.candidateSetHash='0'.repeat(64);return r;};
 await assert.rejects(runSceneAssembly(options),/identity/);assert.deepEqual(calls.map(c=>c.phase),['concepts','select-concept']);
});
test('v3 identical invalid geometry stops after one correction, even with more funded corrections available',async()=>{
 const {options,calls}=await setup(),invoke=options.invoke;options.invoke=async(p,i,o)=>{const r=await invoke(p,i,o);if(['concepts','correct-concepts'].includes(o.stageName))for(const c of r.candidates)c.scene.components[0].size[0]=100;return r;};
 await assert.rejects(runSceneAssembly(options),/No eligible concept/);assert.deepEqual(calls.map(c=>c.phase),['concepts','correct-concepts']);
});
test('candidate and selection prompts do not demand a completed representative interior; full plan still does',async()=>{
 const {options,calls}=await setup();await runSceneAssembly(options);
 const concept=calls.find(c=>c.phase==='concepts').instructions,selection=calls.find(c=>c.phase==='select-concept').instructions,plan=calls.find(c=>c.phase==='plan').instructions;
 assert.match(concept,/CONCEPT STUDY ONLY/);assert.match(concept,/DO NOT construct roomZone\/storeyRoom/);
 for(const p of [concept,selection]){assert.doesNotMatch(p,/Build an actual representative facade unit, typical floor program/);assert.doesNotMatch(p,/A high-rise needs a continuous/);}
 assert.doesNotMatch(selection,/ENGINEERING FEEDBACK/);
 assert.match(plan,/Build an actual representative facade unit, typical floor program/);assert.match(plan,/A high-rise needs a continuous/);assert.match(plan,/Restore constraints.interior=true, walkable=true/);
});
for(const failure of ['world-bounds','host-interior','void-ownership'])test('candidate correction receives bound structured '+failure+' evidence without changing the original scene',async()=>{
 const {options,calls,directory}=await setup(),invoke=options.invoke;let rejected;
 options.invoke=async(p,i,o)=>{
  const r=await invoke(p,i,o);
  if(o.stageName==='concepts'){
   for(const c of r.candidates){
    if(failure==='void-ownership'){
     c.scene.components.push({id:'protected-empty',kind:'void',at:{relativeTo:null,anchor:'min',offset:[4,1,4]},repeat:{count:1,step:[0,0,0]},allowOverwrite:['main'],size:[2,2,2]},shape('bridge',[4,1,4],[1,1,1],'frame'));
    }else c.scene.components.push({kind:'storeyRoom',id:'premature-office',host:'main',allowOverwrite:[],floors:{source:'main',first:0,count:1},offset:failure==='world-bounds'?[1,12]:[1,10],footprint:failure==='world-bounds'?[3,8]:[3,3],ceilingInset:1,use:'room',purpose:'Coordinate regression, not a design template',floorMaterial:'floor',boundaries:[]});
   }rejected=structuredClone(r);
  }
  if(o.stageName==='correct-concepts'){
   const {prior}=calls.at(-1).input;assert.deepEqual(prior.response,rejected);
   for(const c of prior.feedback.candidates){
    const f=c.feedback;assert.equal(f.sourceHash,hash(rejected.candidates.find(v=>v.id===c.id).scene));assert.equal(f.canAuthorizePlacement,false);assert.equal(f.geometryPassed,false);assert.equal(f.constructionFeedback.issueFormat,'component-rule-groups');
    if(failure==='void-ownership')assert.ok(f.designConflicts);
    else {assert.ok(f.layoutFeedback.origin);assert.ok(f.layoutFeedback.size);if(failure==='host-interior')assert.ok(f.layoutFeedback.roomZoneFeedback.boundingInteriorXZ);}
   }
   assert.match(calls.at(-1).instructions,/HOST INTERIOR/);
  }
  return r;
 };
 const result=await runSceneAssembly(options);assert.equal(result.summary.reservedCalls,8);
 for(const c of rejected.candidates){const saved=JSON.parse(await fs.readFile(path.join(directory,'assembly/1',c.id,'scene.json'),'utf8'));assert.deepEqual(saved,c.scene);}
});
test('v3 accepts a progressing third candidate set within the unchanged total budget',async()=>{
 const {options,calls}=await setup(),invoke=options.invoke;let proposals=0;
 options.invoke=async(p,i,o)=>{const r=await invoke(p,i,o);if(['concepts','correct-concepts'].includes(o.stageName)&&++proposals<3)for(const c of r.candidates)c.scene.components[0].size[0]=100+proposals;return r;};
 const result=await runSceneAssembly(options);assert.equal(result.summary.reservedCalls,9);assert.equal(calls.filter(c=>c.phase==='correct-concepts').length,2);
});
test('v3 changing invalid proposals still stop at the tier correction bound',async()=>{
 const {options,calls}=await setup(),invoke=options.invoke;
 options.invoke=async(p,i,o)=>{const r=await invoke(p,i,o);if(['concepts','correct-concepts'].includes(o.stageName))for(const c of r.candidates)c.scene.components[0].size[0]=100+i;return r;};
 await assert.rejects(runSceneAssembly(options),/bounded concept corrections exhausted/);assert.equal(calls.length,5);
});
test('v3 extra corrections cannot spend calls reserved for the complete task path',async()=>{
 const {options,calls}=await setup({...request,assemblyCalls:8}),invoke=options.invoke;
 options.invoke=async(p,i,o)=>{const r=await invoke(p,i,o);if(['concepts','correct-concepts'].includes(o.stageName))for(const c of r.candidates)c.scene.components[0].size[0]=100+i;return r;};
 await assert.rejects(runSceneAssembly(options),/required complete-task budget/);assert.equal(calls.length,2);
});
test('v3 cancellation during native capture never dispatches the image selection',async()=>{
 const {options,calls}=await setup(),abort=new AbortController();options.signal=abort.signal;options.nativeEvidence=async()=>{abort.abort();throw Error('Cancelled capture fixture');};
 await assert.rejects(runSceneAssembly(options),/Cancelled/);assert.equal(calls.length,1);
});

const revisionIssue={criterion:'facade',evidence:'Offline repeated facade concern',change:'Coordinate the actual facade; fixture tests transport, not design quality'};
test('v3 revisions see the exact reviewed pixels and persistent concerns, without leaking them to construction',async()=>{
 const {options,calls,directory}=await setup(),invoke=options.invoke;let reviews=0,revisions=0;
 options.invoke=async(p,i,o)=>{
  const r=await invoke(p,i,o),input=calls.at(-1).input;
  if(o.stageName==='concept-review'&&++reviews<=2)return {...r,verdict:'revise',issues:[revisionIssue]};
  if(o.stageName==='revise-design'){
   revisions++;const previous=calls.at(-2);
   assert.equal(previous.phase,'concept-review');assert.deepEqual(o.images,previous.images);assert.equal(o.images.length,8);
   for(const [n,file] of o.images.entries())assert.equal(hash(await fs.readFile(file)),input.designEvidence.views[n].sha256);
   assert.equal(input.designRevisionContext.baselineSourceHash,input.sourceHash);
   assert.equal(input.designRevisionContext.activeConcerns[0].consecutiveRounds,revisions);
   assert.equal(input.designRevisionContext.reviewTrail.length,revisions);
   assert.match(calls.at(-1).instructions,/VISUAL DESIGN REVISION/);
   assert.doesNotMatch(calls.at(-1).instructions,/TEXT REVISION|no image attached to this edit call/);
   const next=structuredClone(input.priorPlan);next.scene.palette[0].material=revisions===1?'quartz':'polished_andesite';return planEdit(input.priorPlan,next);
  }
  if(o.stageName==='component')assert.equal(o.images.length,0);
  return r;
 };
 const result=await runSceneAssembly(options);
 assert.equal(result.summary.reservedCalls,11);assert.equal(result.summary.completedPackages.length,2);
 assert.equal(result.summary.visualReviewAccepted,true);assert.equal(result.summary.aestheticQualityVerified,false);
 const saved=JSON.parse(await fs.readFile(path.join(directory,'assembly/5/input.json'),'utf8'));
 assert.equal(saved.designRevisionContext.baselineEvidenceHash,calls[4].input.designEvidence.evidenceHash);
});
for(const failure of ['schema','candidate'])test('v3 '+failure+' correction never presents accepted-baseline images as rejected-candidate pixels',async()=>{
 const {options,calls}=await setup(),invoke=options.invoke;let reviews=0;
 options.invoke=async(p,i,o)=>{
  const r=await invoke(p,i,o),input=calls.at(-1).input;
  if(o.stageName==='concept-review'&&++reviews===1)return {...r,verdict:'revise',issues:[revisionIssue]};
  if(o.stageName==='revise-design'){
   assert.equal(o.images.length,8);
   const next=structuredClone(input.priorPlan);next.scene.palette[0].material='quartz';
   if(failure==='schema')return {...planEdit(input.priorPlan,next),extraInvalidField:true};
   const detail=shape('revised-detail',[6,2,6],[1,1,1],'frame');detail.allowOverwrite=['nonexistent-owner'];next.scene.components.push(detail);
   return planEdit(input.priorPlan,next);
  }
  if(o.stageName==='correct-design'){
   assert.equal(o.images.length,0);assert.ok(input.contractFeedback);
   assert.equal(input.designRevisionContext.baselineSourceHash,input.designEvidence.sourceHash);
   assert.doesNotMatch(calls.at(-1).instructions,/VISUAL DESIGN REVISION|attached images show|NATIVE ASSET EVIDENCE/);
   const next=structuredClone(input.priorPlan);
   if(failure==='candidate'){
    assert.ok(input.repairBase);assert.notEqual(input.sourceHash,input.designEvidence.sourceHash);
    assert.equal(next.scene.palette[0].material,'quartz');next.scene.components.find(c=>c.id==='revised-detail').allowOverwrite=[];
   }else {assert.equal(input.repairBase,undefined);next.scene.palette[0].material='quartz';}
   return planEdit(input.priorPlan,next);
  }
  return r;
 };
 const result=await runSceneAssembly(options);assert.equal(result.summary.reservedCalls,10);
 assert.deepEqual(calls.map(c=>c.phase),['concepts','select-concept','plan','concept-review','revise-design','correct-design','concept-review','component','component','review']);
});
test('v3 image revision replay reuses its receipt and identical image fingerprints after local interruption',async()=>{
 const {options,calls}=await setup(),invoke=options.invoke,abort=new AbortController();
 options.invoke=async(p,i,o)=>{
  const r=await invoke(p,i,o),input=calls.at(-1).input;
  if(i===4)return {...r,verdict:'revise',issues:[revisionIssue]};
  if(o.stageName==='revise-design'){const next=structuredClone(input.priorPlan);next.scene.palette[0].material='quartz';return planEdit(input.priorPlan,next);}
  return r;
 };
 const identity={requestHash:hash(request),runtimeHash:'offline-v3-image-revision'};
 await assert.rejects(runDurableAssembly({...options,...identity,signal:abort.signal,onStage:async records=>{if(records.at(-1).phase==='revise-design'&&records.at(-1).state==='accepted')abort.abort();}}),/abort/i);
 assert.equal(calls.length,5);assert.equal(calls[4].images.length,8);
 const result=await runDurableAssembly({...options,...identity});
 assert.equal(calls.length,9);assert.equal(result.summary.reservedCalls,9);
 assert.equal(calls.filter(c=>c.phase==='revise-design').length,1);
});
test('changed revision pixels fail before invocation, without a provider retry or package freeze',async()=>{
 const {options,calls,directory}=await setup(),invoke=options.invoke;let records;
 options.invoke=async(p,i,o)=>{const r=await invoke(p,i,o);return o.stageName==='concept-review'?{...r,verdict:'revise',issues:[revisionIssue]}:r;};
 options.onStage=async r=>{
  records=r;
  if(r.at(-1).phase==='revise-design'&&r.at(-1).state==='reserved'){
   const file=calls.at(-1).images[0],bytes=await fs.readFile(file);bytes[40]^=1;await fs.writeFile(file,bytes);
  }
 };
 await assert.rejects(runSceneAssembly(options),/Review image changed before invocation/);
 assert.equal(calls.length,4);assert.equal(records.at(-1).invocationOutcome,'not-started');
 await assert.rejects(fs.stat(path.join(directory,'assembly/interfaces.json')),/ENOENT/);
});
