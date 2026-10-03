import test from 'node:test';
import assert from 'node:assert/strict';
import {assemblyStageSchema} from '../../contracts/scene-assembly-stage.mjs';
import {assemblyPlanSchema,assemblyPlanRepairSchema,assemblyReviewSchema} from '../../contracts/scene-assembly.schema.mjs';
import {sceneSchema} from '../../contracts/scene-spec.schema.mjs';
import {sceneDraftEditSchema} from '../../contracts/scene-draft-edit.schema.mjs';
import {schemaFeedback} from '../../contracts/schema-feedback.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyPlan,packageEdit,acceptReview} from './assembly-fixtures.mjs';
import {floorAssemblyPlan} from './floor-components-fixtures.mjs';

test('model-facing stage schema binds source and package IDs without changing canonical contracts',()=>{
  const p=assemblyPlan(),source=hash(sceneDraftEditSchema),input={task:p.packages[0],previousDraft:p.scene,sourceHash:hash(p.scene)};
  const schema=assemblyStageSchema(sceneDraftEditSchema,input),good=packageEdit(input);
  assert.equal(schemaFeedback(good,schema).valid,true);assert.equal(hash(sceneDraftEditSchema),source);
  for(const change of [e=>e.sourceHash='0'.repeat(64),e=>e.components.put[0].id='other__part',e=>e.components.remove=['main'],e=>e.constraints=p.scene.constraints]){
    const edit=structuredClone(good);change(edit);assert.equal(schemaFeedback(edit,schema).valid,false);
  }
  p.packages[0].editableComponents=['main'];
  const owned=assemblyStageSchema(sceneDraftEditSchema,input),replace=structuredClone(good);replace.components.put=[p.scene.components[0]];
  assert.equal(schemaFeedback(replace,owned).valid,true);
});

test('model-facing plan and review schemas expose only the remaining budget and actual review tasks',()=>{
  const p=assemblyPlan(),plan=assemblyStageSchema(assemblyPlanSchema,{callBudget:{maximumPackages:2}});
  assert.equal(plan.properties.packages.maxItems,2);assert.equal(assemblyPlanSchema.properties.packages.maxItems,16);
  const input={sourceHash:hash(p.scene),packages:p.packages},review=assemblyStageSchema(assemblyReviewSchema,input);
  assert.equal(schemaFeedback(acceptReview(input),review).valid,true);
  assert.equal(schemaFeedback({...acceptReview(input),task:'not_in_plan'},review).valid,false);
});
test('foreign floor consumers prevent model-facing deletion of their authoritative schedule',()=>{
 const p=floorAssemblyPlan(),task={...p.packages[0],editableComponents:['main']};
 const input={task,previousDraft:p.scene,sourceHash:hash(p.scene)},schema=assemblyStageSchema(sceneDraftEditSchema,input),edit=packageEdit(input);
 edit.components={put:[],remove:['main']};assert.equal(schemaFeedback(edit,schema).valid,false);
});
test('every component union chooses its kind before branch-specific coordinates or host fields',()=>{
  for(const schema of [sceneSchema,assemblyPlanSchema,assemblyPlanRepairSchema,sceneDraftEditSchema]){
    const kinds=[];
    for(const variant of schema.$defs.component.anyOf){
      assert.equal(Object.keys(variant.properties)[0],'kind');assert.equal(variant.required[0],'kind');
      assert.equal(variant.properties.kind.enum.length,1);kinds.push(variant.properties.kind.enum[0]);
    }
    assert.equal(new Set(kinds).size,19);assert.ok(kinds.includes('mass')&&kinds.includes('stairs')&&kinds.includes('storeyRoom'));
  }
});
test('model-facing full plans enforce already-required functions and passage probes without weakening canonical validation',()=>{
  for(const base of [assemblyPlanSchema,assemblyPlanRepairSchema]){
    const input={callBudget:{maximumPackages:16},planHash:'a'.repeat(64)},p=assemblyPlan(),response=base===assemblyPlanSchema?p:{format:'SceneAssemblyPlanRepair',version:1,planHash:input.planHash,proposal:p};
    const original=hash(base),schema=assemblyStageSchema(base,input);
    assert.equal(schemaFeedback(response,schema).valid,true);assert.equal(hash(base),original);
    for(const modify of [c=>c.interior=false,c=>c.walkable=false,c=>c.passages=[]]){
      const bad=structuredClone(response);modify((bad.proposal??bad).scene.constraints);
      assert.equal(schemaFeedback(bad,schema).valid,false);
    }
  }
});
test('proposal repair exposes exact immutable intent and identity, but does not freeze malformed fields',()=>{
 const source=assemblyPlan(),original=hash(assemblyPlanRepairSchema);source.packages[0].editableComponents=['missing'];
 const proposal=assemblyPlan(),input={priorPlan:source,planHash:hash(source),callBudget:{maximumPackages:16}},schema=assemblyStageSchema(assemblyPlanRepairSchema,input);
 const answer={format:'SceneAssemblyPlanRepair',version:1,planHash:input.planHash,proposal};
 assert.equal(schemaFeedback(answer,schema).valid,true);assert.equal(hash(assemblyPlanRepairSchema),original);
 assert.deepEqual(schema.properties.proposal.properties.scene.properties.design.enum,[source.scene.design]);
 for(const modify of [p=>p.designIntent+=' changed',p=>p.scene.design.features.push('forbidden feature'),p=>p.scene.design.concept+=' paraphrased',p=>p.scene.seed++,p=>p.scene.bounds.height++]){
   const bad=structuredClone(answer);modify(bad.proposal);assert.equal(schemaFeedback(bad,schema).valid,false);
 }
 source.scene.design=42;
 const malformed=assemblyStageSchema(assemblyPlanRepairSchema,{...input,planHash:hash(source)});
 assert.equal(malformed.properties.proposal.properties.scene.properties.design.enum,undefined);
 assert.equal(schemaFeedback({...answer,planHash:hash(source)},malformed).valid,true);
});
