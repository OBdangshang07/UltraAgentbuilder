import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../../src/generation/compiler.mjs';
import {preparePrototypeSeeds,expandPrototypeSeeds} from '../../src/design/prototype-expansion.mjs';
import {assemblyBlueprintSchema,assemblyBlueprintStageSchema,applyAssemblyBlueprint,applyPrototypeRoleEdit,prototypeRoleStageSchema,decomposedProgramHash,bindDecomposedPrototypeProgram} from '../../contracts/scene-decomposed-prototypes.mjs';
import {decompositionBlueprintBudget} from '../../bridge/assembly-decomposition-budget.mjs';
import {schemaFeedback} from '../../contracts/schema-feedback.mjs';
import {PROTOTYPE_ROLES} from '../../contracts/scene-decomposition-roles.mjs';
import {assemblyPlan,planEdit} from './assembly-fixtures.mjs';
import {shape} from './fixtures.mjs';

// Tiny source shapes test PROTOCOL ONLY, not complete prototype architecture,
// native image review or design-quality evidence. Production must inspect cells.
const tier={maxPackages:8};
const kinds=[['typical-floor','core-interface'],['facade-row','corner'],['entry-lobby','street-interface'],['special-floor','crown']];
function fixture(){
 const plan=assemblyPlan(true),scene=structuredClone(plan.scene);
 scene.components=scene.components.filter(c=>c.kind==='mass');scene.components[0].levels=[];
 scene.constraints={interior:false,walkable:false,passages:[]};
 const selected={id:'fixture',rationale:'Offline protocol probe',scene};
 plan.packages=Array.from({length:8},(_,i)=>({id:'task'+i,name:'Protocol task '+i,purpose:'Synthetic delta/authority fixture, not architecture',
  dependsOn:i?['task'+(i-1)]:[],regions:[{origin:[12+(i%4)*2,0,20+Math.floor(i/4)*3],size:[2,224,2]}],editableComponents:[],interfaces:[0]}));
 const response={format:'SceneAssemblyBlueprint',version:1,sourceHash:hash(scene),designIntent:plan.designIntent,
  sceneEdit:planEdit({...plan,scene},plan).sceneEdit,packages:plan.packages,prototypes:PROTOTYPE_ROLES.map((role,i)=>({role,task:'task'+i}))};
 return {selected,response,state:applyAssemblyBlueprint(selected,response,tier)};
}
function roleReply(state){
 const n=state.completedRoles.length,role=PROTOTYPE_ROLES[n],task='task'+n,x=12+n*2;
 const parts=[shape(task+'__a',[x,1,20],[1,1,1],'frame'),shape(task+'__b',[x,1,21],[1,1,1],'frame')];
 const edit={format:'SceneDraftEdit',version:1,sourceHash:hash(state.plan.scene),components:{put:parts,remove:[]},modules:{put:[],remove:[]},
  palette:{put:[],remove:[]},reservations:{put:[],remove:[]},design:null,featureBindings:null,constraints:null};
 return {format:'ScenePrototypeRoleEdit',version:1,role,task,planHash:hash(state.plan),programHash:decomposedProgramHash(state),edit,
  recipes:n<2?[{component:parts[0].id,mode:'repeat',count:2,step:[0,5,0]}]:[],
  representatives:kinds[n].map((kind,i)=>({kind,components:[parts[i].id]}))};
}

test('blueprint is a selected-hash delta, restores functional intent and creates no completed prototypes',()=>{
 const {selected,response,state}=fixture(),saved=hash(selected);
 assert.equal(schemaFeedback(response,assemblyBlueprintSchema).valid,true);
 assert.equal(state.plan.scene.bounds.height,224);assert.equal(state.plan.scene.constraints.interior,true);assert.equal(state.plan.scene.constraints.walkable,true);
 assert.equal(state.plan.packages.length,8);assert.deepEqual(state.completedRoles,[]);assert.equal(state.diagnosticOnly,true);assert.equal(state.canAuthorizePlacement,false);
 assert.equal(hash(selected),saved);assert.ok(!Object.hasOwn(response,'scene'));
 assert.throws(()=>bindDecomposedPrototypeProgram(state),/incomplete/);
});
test('model-facing blueprint binds hashes, funded package ceiling and explicit functional restoration',()=>{
 const {selected,response}=fixture(),budget=decompositionBlueprintBudget({maximumCalls:26});
 const schema=assemblyBlueprintStageSchema(selected,{maxPackages:16},budget);
 assert.equal(schema.properties.packages.maxItems,8);assert.equal(assemblyBlueprintSchema.properties.packages.maxItems,16);
 assert.equal(schemaFeedback(response,schema).valid,true);
 for(const change of [r=>r.sourceHash='0'.repeat(64),r=>r.sceneEdit.sourceHash='0'.repeat(64),r=>r.sceneEdit.constraints=null,
  r=>r.sceneEdit.constraints.interior=false,r=>r.sceneEdit.constraints.passages=[]]){
  const invalid=structuredClone(response);change(invalid);assert.equal(schemaFeedback(invalid,schema).valid,false);
 }
 assert.throws(()=>assemblyBlueprintStageSchema(selected,tier,{...budget,canStart:false}),/Unfunded/);
});
test('four distinct ordered role deltas accumulate recipes without rewriting other roles or the source',()=>{
 let {state}=fixture();const initial=hash(state),base=state;
 for(let i=0;i<4;i++){
  const before=hash(state),reply=roleReply(state),schema=prototypeRoleStageSchema(state,PROTOTYPE_ROLES[i]);
  assert.equal(schemaFeedback(reply,schema).valid,true);
  const next=applyPrototypeRoleEdit(state,reply,tier);assert.equal(hash(state),before);
  assert.equal(next.completedRoles.length,i+1);assert.equal(next.requiresGeometryInspection,true);assert.equal(next.requiresExpandedInspection,true);assert.equal(next.canAuthorizePlacement,false);
  assert.deepEqual(next.plan.packages[i].editableComponents,['task'+i+'__a','task'+i+'__b']);
  assert.deepEqual(next.plan.packages[i].regions,state.plan.packages[i].regions);
  for(let p=0;p<8;p++)if(p!==i)assert.deepEqual(next.plan.packages[p],state.plan.packages[p]);
  for(let p=0;p<i;p++)assert.deepEqual(next.recipesByRole[PROTOTYPE_ROLES[p]],state.recipesByRole[PROTOTYPE_ROLES[p]]);
  state=next;
 }
 assert.equal(hash(base),initial);const result=bindDecomposedPrototypeProgram(state);
 assert.equal(result.program.recipes.length,2);assert.equal(result.program.seedSourceHash,hash(state.plan.scene));assert.equal(result.canAuthorizePlacement,false);
 const seed=preparePrototypeSeeds(result.plan.scene,result.program);
 const expanded=expandPrototypeSeeds({scene:result.plan.scene,program:result.program,...seed});
 assert.equal(expanded.scene.bounds.height,224);assert.equal(expanded.evidence.expansions.length,2);
 assert.equal(expanded.evidence.visualQualityVerified,false);assert.equal(expanded.evidence.canAuthorizePlacement,false);
 assert.throws(()=>applyPrototypeRoleEdit(state,roleReply(base),tier),/already proposed/);
});
test('blueprint rejects stale source, omitted functions, changed massing and invalid role mappings',()=>{
 for(const mutate of [r=>r.sourceHash='0'.repeat(64),r=>r.sceneEdit.sourceHash='0'.repeat(64),r=>r.sceneEdit.constraints.interior=false,
  r=>r.prototypes[1].task=r.prototypes[0].task,r=>r.prototypes.reverse(),r=>r.prototypes[0].task='missing',r=>r.sceneEdit.components.put[0].size[1]=223]){
  const {selected,response}=fixture();const saved=hash(selected);mutate(response);assert.throws(()=>applyAssemblyBlueprint(selected,response,tier));assert.equal(hash(selected),saved);
 }
 const {selected,response}=fixture();assert.throws(()=>applyAssemblyBlueprint(selected,response,{maxPackages:7}),/list/);
});
test('hash/schema/role violations and cross-role edits never become a baseline',()=>{
 for(const mutate of [r=>r.planHash='0'.repeat(64),r=>r.programHash='0'.repeat(64),r=>r.edit.sourceHash='0'.repeat(64),
  r=>r.role='facade-corner',r=>r.task='task1',r=>r.edit.components.put[0].id='task1__steal',
  r=>r.edit.design={},r=>r.edit.constraints={},r=>r.edit.reservations.remove=['anything'],r=>r.recipes[0].component='main']){
  const {state}=fixture(),before=hash(state),reply=roleReply(state);mutate(reply);assert.throws(()=>applyPrototypeRoleEdit(state,reply,tier));assert.equal(hash(state),before);
 }
 let {state}=fixture();state=applyPrototypeRoleEdit(state,roleReply(state),tier);const before=hash(state),reply=roleReply(state);
 reply.edit.components.put.push({...state.plan.scene.components.find(c=>c.id==='task0__a'),material:'wall'});
 assert.throws(()=>applyPrototypeRoleEdit(state,reply,tier));assert.equal(hash(state),before);
});
test('missing, duplicate, unchanged and foreign representatives cannot be counted as a completed role',()=>{
 for(const mutate of [r=>r.representatives.pop(),r=>r.representatives[1].kind=r.representatives[0].kind,
  r=>r.representatives[0].components=['main'],r=>r.representatives[0].components=['task0__missing'],
  r=>r.representatives[0].components.push(r.representatives[0].components[0]),r=>r.edit.components.put=[]]){
  const {state}=fixture(),reply=roleReply(state);mutate(reply);assert.throws(()=>applyPrototypeRoleEdit(state,reply,tier));assert.equal(state.completedRoles.length,0);
 }
});
test('model-facing representative and recipe source selectors exclude contextual cross-package geometry',()=>{
 const {state}=fixture(),reply=roleReply(state),schema=prototypeRoleStageSchema(state,'typical-floor-core');
 assert.equal(schemaFeedback(reply,schema).valid,true);
 reply.representatives[0].components.push('main');assert.equal(schemaFeedback(reply,schema).valid,false);
 reply.representatives[0].components.pop();reply.recipes[0].component='main';assert.equal(schemaFeedback(reply,schema).valid,false);
 assert.match(schema.properties.representatives.description,/Context|context/);
});
test('representative feedback reports both lists and exact foreign missing and duplicate IDs, even with valid changed sources',()=>{
 const {state}=fixture(),before=hash(state),reply=roleReply(state);
 reply.representatives[0].components.push('main','absent','task0__a');reply.representatives[1].components.push('main');
 assert.throws(()=>applyPrototypeRoleEdit(state,reply,tier),error=>{
  const issues=error.contract.issues;
  assert.deepEqual(issues.filter(i=>i.code==='representative-foreign-source').map(i=>[i.path,i.ids]),[
   ['$.representatives[0]',['main','absent']],['$.representatives[1]',['main']]]);
  assert.deepEqual(issues.find(i=>i.code==='representative-missing-source').ids,['absent']);
  assert.deepEqual(issues.find(i=>i.code==='representative-duplicate-source').ids,['task0__a']);
  assert.ok(!issues.some(i=>i.code==='representative-no-changed-source'));return true;
 });
 assert.equal(hash(state),before);assert.deepEqual(state.completedRoles,[]);
});
test('duplicate prototype delta IDs identify the source and every repeated position without guessing replacements',()=>{
 const {state}=fixture(),reply=roleReply(state),before=hash(state);
 reply.edit.components.put[1].id=reply.edit.components.put[0].id;reply.edit.components.put.push(structuredClone(reply.edit.components.put[0]));
 assert.throws(()=>applyPrototypeRoleEdit(state,reply,tier),error=>{
  assert.deepEqual(error.contract.issues.map(i=>[i.code,i.id,i.path,i.firstIndex]),[
   ['draft-duplicate-replacement','task0__a','$.edit.components.put[1].id',0],
   ['draft-duplicate-replacement','task0__a','$.edit.components.put[2].id',0]]);return true;
 });assert.equal(hash(state),before);assert.equal(reply.edit.components.put[1].id,'task0__a');
});
test('duplicate/invalid recipes and already-repeated seeds are rejected without losing previous role recipes',()=>{
 for(const mutate of [r=>r.recipes.push(structuredClone(r.recipes[0])),r=>r.recipes[0].step=[0,0,0],r=>r.recipes[0].count=1,
  r=>r.edit.components.put[0].repeat={count:2,step:[0,5,0]}]){
  const {state}=fixture(),reply=roleReply(state),before=hash(state);mutate(reply);assert.throws(()=>applyPrototypeRoleEdit(state,reply,tier));assert.equal(hash(state),before);
 }
});
test('contract success does not accept out-of-range expansion: native geometry gate remains required',()=>{
 let {state}=fixture();const reply=roleReply(state);reply.recipes[0].step=[0,223,0];
 state=applyPrototypeRoleEdit(state,reply,tier);
 for(let n=1;n<4;n++)state=applyPrototypeRoleEdit(state,roleReply(state),tier);
 const result=bindDecomposedPrototypeProgram(state);assert.equal(result.requiresExpandedInspection,true);
 const seed=preparePrototypeSeeds(result.plan.scene,result.program);
 assert.throws(()=>expandPrototypeSeeds({scene:result.plan.scene,program:result.program,...seed}),/outside/);
 assert.equal(result.canAuthorizePlacement,false);
});
