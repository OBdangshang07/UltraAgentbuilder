import test from 'node:test';import assert from 'node:assert/strict';
import {validateAssemblyPlan,applyAssemblyPlanEdit,assemblyPlanEditSchema,applyPackageEdit,validateAssemblyReview,assemblyPlanSchema} from '../../contracts/scene-assembly.schema.mjs';
import {qualityTiers} from '../../bridge/quality-tiers.mjs';
import {assemblyPlan,packageEdit,acceptReview,planEdit} from './assembly-fixtures.mjs';
import {instanceStudy,shape} from './fixtures.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {assessSceneCheckpoint} from '../../src/design/checkpoint.mjs';
import {checkPackageGeometry,readAssemblyBaseline} from '../../src/design/assembly-scope.mjs';
import {inspectCheckpoint} from '../../bridge/scene-checkpoints.mjs';
import {floorAssemblyPlan,storeyRoom} from './floor-components-fixtures.mjs';
test('all four tiers share functional scale, adaptive task DAG and existing geometry schema',()=>{
 for(const tier of qualityTiers()){const p=assemblyPlan(true),before=hash(p);assert.deepEqual(validateAssemblyPlan(p,tier).map(t=>t.id),['exterior','interior']);assert.equal(hash(p),before);assert.equal(p.scene.bounds.height,224);}
 assert.ok(assemblyPlanSchema.$defs.component);assert.equal(assemblyPlanSchema.properties.scene.properties.format.enum[0],'SceneSpec');
});

test('unapproved plan correction binds both hashes and revalidates proposed passage indices',()=>{
 const p=assemblyPlan(),before=hash(p),next=structuredClone(p);
 next.scene.constraints.passages.push({origin:[5,1,4],size:[1,2,1]});next.packages[1].interfaces=[1];
 const e=planEdit(p,next),r=applyAssemblyPlanEdit(p,e,qualityTiers()[0]);
 assert.equal(hash(p),before);assert.deepEqual(r.plan,next);assert.equal(r.changes.interfacesFrozen,false);
 assert.equal(r.changes.constraints.before.passages.length,1);assert.equal(r.changes.constraints.after.passages.length,2);
 assert.deepEqual(r.changes.packages.changed,['interior']);assert.ok(assemblyPlanEditSchema.$defs.component);
 const broken=structuredClone(next);broken.scene.constraints.passages.pop();
 assert.throws(()=>applyAssemblyPlanEdit(p,planEdit(p,broken),qualityTiers()[0]),error=>{
  assert.match(error.message,/interior/);assert.match(error.message,/1/);assert.match(error.message,/passage/i);return true;
 });
 const downstream=packageEdit({task:r.plan.packages[1],previousDraft:r.plan.scene});downstream.constraints=structuredClone(p.scene.constraints);
 assert.throws(()=>applyPackageEdit(r.plan.scene,downstream,r.plan.packages[1]),/global/);
});

test('plan edit rejects identity/size changes, stale intent and invalid ownership/DAG without mutating its source',()=>{
 const p=assemblyPlan(),before=hash(p),policy=qualityTiers()[0];
 const mutations=[e=>e.planHash='0'.repeat(64),e=>e.sceneEdit.sourceHash='0'.repeat(64),
   ...['id','seed','bounds'].map(k=>e=>e.sceneEdit[k]=p.scene[k]),
   e=>e.sceneEdit.design=structuredClone(p.scene.design),e=>e.designIntent='discard functions',
   e=>e.sceneEdit.constraints={...p.scene.constraints,interior:false},e=>e.sceneEdit.constraints={...p.scene.constraints,walkable:false},
   e=>e.sceneEdit.constraints={...p.scene.constraints,passages:[]},
   e=>e.packages.put=[{...p.packages[1],interfaces:[255]}],e=>e.packages.put=[{...p.packages[0],dependsOn:['interior']}],
   e=>e.packages.put=p.packages.map(t=>({...t,editableComponents:['main']})),
   e=>e.packages.put=[p.packages[0],p.packages[0]],e=>e.packages.remove=['missing']];
 for(const mutate of mutations){const e=planEdit(p,p);mutate(e);assert.throws(()=>applyAssemblyPlanEdit(p,e,policy));assert.equal(hash(p),before);}
});
test('plan rejects ambiguous ownership, unknown interfaces, cycles, unsafe regions and quota breaches',()=>{
 const changes=[p=>p.packages[0].dependsOn=['interior'],p=>p.packages[1].dependsOn=['absent'],p=>p.packages[1].interfaces=[255],p=>p.packages[0].regions[0].origin=[400,0,0],p=>{p.packages[0].editableComponents=['main'];p.packages[1].editableComponents=['main'];},p=>p.packages[0].editableComponents=['absent'],p=>p.packages[1].id='exterior__a',p=>p.packages[0].arbitraryCode='no',p=>p.scene.constraints.interior=false];
 for(const change of changes){const p=assemblyPlan();change(p);assert.throws(()=>validateAssemblyPlan(p,qualityTiers()[0]));}
 assert.throws(()=>validateAssemblyPlan(assemblyPlan(),{maxPackages:1}),/list/);
});
test('package edits cannot mutate global intent, foreign components or global material roles',()=>{
 const p=assemblyPlan(),input={task:p.packages[0],previousDraft:p.scene},edit=()=>packageEdit(input);
 const out=applyPackageEdit(p.scene,edit(),input.task);assert.equal(out.scene.components.at(-1).id,'exterior__detail');assert.equal(p.scene.components.length,1);
 for(const change of [e=>e.design={...p.scene.design},e=>e.constraints=structuredClone(p.scene.constraints),e=>e.components.put[0].id='interior__foreign',e=>e.components.remove=['main'],e=>e.palette.put=[{role:'wall',material:'red'}],e=>e.sourceHash='0'.repeat(64)]){const e=edit();change(e);assert.throws(()=>applyPackageEdit(p.scene,e,input.task));}
});
test('shared modules remain frozen unless every consumer belongs to the selected package',()=>{
 const p=assemblyPlan(),i=instanceStudy();p.scene.modules=i.modules;p.scene.components.push(...i.components);const task=p.packages[0],e=packageEdit({task,previousDraft:p.scene});
 task.editableComponents=['desks'];e.modules.put=[structuredClone(i.modules[0])];e.modules.put[0].nodes[0].material='wall';assert.throws(()=>applyPackageEdit(p.scene,e,task),/Shared module/);
 task.editableComponents.push('otherDesks');assert.doesNotThrow(()=>applyPackageEdit(p.scene,e,task));
});
test('review binds exact source and concrete existing package with actionable evidence',()=>{
 const p=assemblyPlan(),r=acceptReview({sourceHash:hash(p.scene)});assert.equal(validateAssemblyReview(r,p.scene,p),r);
 for(const change of [v=>v.sourceHash='0'.repeat(64),v=>v.task='exterior',v=>v.verdict='revise',v=>v.seenImages=true]){const q=structuredClone(r);change(q);assert.throws(()=>validateAssemblyReview(q,p.scene,p));}
});
test('geometry scope blocks foreign solid edits and same-material ownership takeover despite allowOverwrite',()=>{
 const p=assemblyPlan(),before=assessSceneCheckpoint(p.scene),task={...p.packages[0],regions:[{origin:[0,0,0],size:[16,10,16]}]};
 for(const material of ['wall','frame']){
  const next=structuredClone(p.scene),part=shape('exterior__steal',[2,1,2],[1,1,1],material);part.allowOverwrite=['main'];next.components.push(part);const after=assessSceneCheckpoint(next);
  assert.equal(after.report.geometryPassed,true,after.report.error);assert.throws(()=>checkPackageGeometry(before.compiled,after.compiled,task,before.report,after.report),/protected component main/);
 }
});
for(const kind of ['entry','passage'])test(`ordinary room air is furnishable but a previously checked ${kind} must not regress`,()=>{
 const p=assemblyPlan();p.scene.constraints.passages.push({origin:[6,1,4],size:[1,2,1]});
 const before=assessSceneCheckpoint(p.scene),task={...p.packages[1],regions:[{origin:[3,1,3],size:[10,3,10]}]},next=structuredClone(p.scene);
 next.components.push(shape('interior__obstruction',kind==='entry'?[4,1,4]:[6,1,4],[1,2,1],'frame'));const after=assessSceneCheckpoint(next);
 assert.equal(after.report.geometryPassed,true,after.report.error);assert.throws(()=>checkPackageGeometry(before.compiled,after.compiled,task,before.report,after.report),error=>{
  assert.match(error.message,/regressed/);const e=error.packageNavigationFeedback;
  assert.equal(e.kind,kind);assert.equal(e.acceptedSourceHash,hash(p.scene));assert.equal(e.candidateSourceHash,hash(next));
  assert.deepEqual(e.previous,kind==='entry'?before.report.navigationFeedback.entry:before.report.navigationFeedback.passages[1]);
  assert.deepEqual(e.current,kind==='entry'?after.report.navigationFeedback.entry:after.report.navigationFeedback.passages[1]);
  if(kind==='passage')assert.equal(e.index,1);
  assert.equal(e.scopeExpanded,false);assert.equal(e.canAuthorizePlacement,false);return true;
 });
});
test('floor-linked room helpers cannot repaint another package slab or modify its schedule',()=>{
 const p=floorAssemblyPlan(),task={...p.packages[1],regions:[{origin:[0,0,0],size:[32,224,32]}]},before=assessSceneCheckpoint(p.scene);
 const edit=packageEdit({task,previousDraft:p.scene});
 edit.components.put=[storeyRoom('interior__room','main',{offset:[23,16],footprint:[3,5],floors:{source:'main',first:0,count:44}})];
 const applied=applyPackageEdit(p.scene,edit,task),after=assessSceneCheckpoint(applied.scene);
 assert.equal(after.report.geometryPassed,true,after.report.error);
 assert.throws(()=>checkPackageGeometry(before.compiled,after.compiled,task,before.report,after.report),/protected component main/);
 const floorSource=structuredClone(p.scene.components.find(c=>c.id==='main'));floorSource.levels[0]++;
 edit.components.put=[floorSource];assert.throws(()=>applyPackageEdit(p.scene,edit,task),/outside package ownership/);
});
test('previously established local stair evidence cannot be replaced by incomplete checks',()=>{
 const p=assemblyPlan(),before=assessSceneCheckpoint(p.scene),after=assessSceneCheckpoint(applyPackageEdit(p.scene,packageEdit({task:p.packages[0],previousDraft:p.scene}),p.packages[0]).scene);
 const previous=structuredClone(before.report),feedback=structuredClone(after.report);
 previous.navigationFeedback.stairs={groups:[{component:'core',checkedLowerFloors:[0,4,8],unverifiedFloors:[]}]};feedback.navigationFeedback.stairs={groups:[{component:'core',checkedLowerFloors:[0,4],unverifiedFloors:[]}]};
 assert.throws(()=>checkPackageGeometry(before.compiled,after.compiled,p.packages[0],previous,feedback),error=>{
  assert.match(error.message,/regressed local stair/);const e=error.packageNavigationFeedback;
  assert.equal(e.kind,'stair');assert.equal(e.component,'core');assert.equal(e.floor,8);assert.deepEqual(e.previous,previous.navigationFeedback.stairs.groups[0]);
  assert.deepEqual(e.current,feedback.navigationFeedback.stairs.groups[0]);assert.equal(e.geometryChanged,false);return true;
 });
});
test('saved assembly baseline detects tampered geometry rather than recompiling replacement evidence',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'assembly-baseline-')),p=assemblyPlan();
 const report=await inspectCheckpoint(p.scene,{},dir,new AbortController().signal,{});assert.equal(report.geometryPassed,true,report.error);
 assert.ok(await readAssemblyBaseline(dir,report.diagnosticAssetHash));
 const binary=await fs.readFile(path.join(dir,'cells.bin'));binary[0]^=1;await fs.writeFile(path.join(dir,'cells.bin'),binary);
 await assert.rejects(readAssemblyBaseline(dir,report.diagnosticAssetHash),/geometry\/provenance mismatch/);
});
