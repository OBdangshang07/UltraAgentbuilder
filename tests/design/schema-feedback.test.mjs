import test from 'node:test';import assert from 'node:assert/strict';
import {schemaFeedback} from '../../contracts/schema-feedback.mjs';
import {assemblyPlan,planEdit} from './assembly-fixtures.mjs';
import {assemblyPlanSchema,assemblyPlanRepairSchema,applyAssemblyPlanRepair,inspectAssemblyPlan,applyAssemblyPlanEdit} from '../../contracts/scene-assembly.schema.mjs';
import {qualityTiers} from '../../bridge/quality-tiers.mjs';import {hash} from '../../src/generation/compiler.mjs';
const tier=qualityTiers()[3];
test('schema feedback aggregates all fields without modifying or accepting malformed data',()=>{
 const p=assemblyPlan();p.scene.components[0].extra=true;p.scene.components[0].other=1;delete p.scene.components[0].size;p.packages[1].name=42;const before=hash(p);
 const r=schemaFeedback(p,assemblyPlanSchema);assert.equal(r.valid,false);assert.equal(r.issues.length,4);assert.equal(hash(p),before);assert.ok(r.issues.some(i=>i.field==='size'));
 assert.equal(schemaFeedback(assemblyPlan(),assemblyPlanSchema).valid,true);
 for(const p of [null,undefined,[],{format:'SceneAssemblyPlan'}])assert.equal(schemaFeedback(p,assemblyPlanSchema).valid,false);
 assert.equal(schemaFeedback(assemblyPlan(),assemblyPlanSchema,{maxChecks:2}).checksComplete,false);
 const limited=schemaFeedback(p,assemblyPlanSchema,{maxIssues:1});assert.equal(limited.truncated,true);assert.equal(limited.issues.length,1);
});
test('invalid unapproved source can be repaired, without weakening valid-source edits or identity',()=>{
 const p=assemblyPlan();p.scene.components[0].unknown=true;const before=hash(p),next=structuredClone(p);delete next.scene.components[0].unknown;
 const e={format:'SceneAssemblyPlanRepair',version:1,planHash:before,proposal:next};
 assert.equal(schemaFeedback(e,assemblyPlanRepairSchema).valid,true);assert.equal(inspectAssemblyPlan(p,tier).contract.valid,false);
 assert.deepEqual(applyAssemblyPlanRepair(p,e,tier).plan,next);assert.equal(hash(p),before);
 assert.throws(()=>applyAssemblyPlanEdit(p,planEdit(p,next),tier),/unknown field/);
 for(const mutate of [e=>e.planHash='0'.repeat(64),e=>e.proposal.scene.bounds.height++,e=>e.proposal.scene.seed++,e=>e.proposal.scene.id='another-plan',e=>e.proposal.designIntent='different',e=>e.proposal.scene.design={...next.scene.design,concept:'different'},e=>e.proposal.scene.constraints.walkable=false]){const c=structuredClone(e);mutate(c);assert.throws(()=>applyAssemblyPlanRepair(p,c,tier));}
 assert.throws(()=>applyAssemblyPlanRepair(next,{...e,planHash:hash(next)},tier),/valid plan/);
});
test('JSON enum diagnostics compare object contents and array order without coercion',()=>{
 const schema={type:'object',properties:{label:{type:'string'},features:{type:'array',items:{type:'string'}}},required:['label','features'],enum:[{label:'fixed',features:['a','b']}]};
 assert.equal(schemaFeedback({features:['a','b'],label:'fixed'},schema).valid,true);
 for(const value of [{label:'fixed',features:['b','a']},{label:'rewritten',features:['a','b']}])assert.equal(schemaFeedback(value,schema).valid,false);
 assert.equal(schemaFeedback('1',{type:'string',enum:[1]}).valid,false);
});
test('owner feedback names every unknown component and both owners without changing the source',()=>{
 const p=assemblyPlan();p.packages[0].editableComponents=['missing_a','main'];p.packages[1].editableComponents=['missing_b','main'];const before=hash(p);
 const check=inspectAssemblyPlan(p,tier);assert.equal(check.contract.valid,false);assert.equal(check.contract.truncated,false);assert.equal(check.canAuthorizePlacement,false);assert.equal(hash(p),before);
 assert.deepEqual(check.contract.issues.map(i=>i.code),['unknown-component-owner','unknown-component-owner','shared-component-owner']);
 assert.deepEqual(check.contract.issues.map(i=>i.component),['missing_a','missing_b','main']);
 assert.equal(check.contract.issues[0].path,'$.packages[0].editableComponents[0]');
 assert.equal(check.contract.issues[2].firstPackage,'exterior');assert.equal(check.contract.issues[2].package,'interior');
 const large=assemblyPlan();large.packages[0].editableComponents=Array.from({length:200},(_,i)=>'missing'+i);
 const bounded=inspectAssemblyPlan(large,tier);assert.equal(bounded.contract.issues.length,128);assert.equal(bounded.contract.truncated,true);assert.equal(bounded.contract.valid,false);
});
