import test from 'node:test';
import assert from 'node:assert/strict';
import {assemblyCallBudget,conceptRevisionBudget} from '../../bridge/assembly-budget.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {assemblyStageSchema} from '../../contracts/scene-assembly-stage.mjs';
import {assemblyPlanSchema,assemblyPlanEditSchema} from '../../contracts/scene-assembly.schema.mjs';
const tier=(maximumCalls=26)=>generationPreflight({agent:'codex',model:'offline',prompt:'离线预算测试',generationMode:'scene',sceneWorkflow:'components',qualityTier:'ultra',assemblyCalls:maximumCalls,assemblyDesignReview:'text',assemblyConfirmed:true,maxRepairs:0}).assembly;

test('Ultra reserves concrete recovery headroom before the model selects its package count',()=>{
  const policy=tier(),before=structuredClone(policy),b=assemblyCallBudget(policy,[]);
  assert.equal(b.maximumPackages,10);assert.equal(b.reservedHeadroom,13);
  assert.equal(b.maximumPackages+b.mandatoryCalls+b.reservedHeadroom,26);
  assert.equal(b.headroomFullyFunded,true);assert.deepEqual(policy,before);
  assert.equal(assemblyCallBudget(tier(23),[]).maximumPackages,7);
  const schema=assemblyStageSchema(assemblyPlanSchema,{callBudget:b});
  assert.equal(schema.properties.packages.maxItems,10);assert.equal(assemblyPlanSchema.properties.packages.maxItems,16);
});

test('used plan corrections release their reserve, not the recorded call or user limit',()=>{
  for(let n=0;n<=4;n++){
    const records=Array.from({length:n},()=>({phase:n?'correct-plan':'plan'}));
    const b=assemblyCallBudget(tier(),records,{attempt:n});
    assert.equal(b.maximumPackages,10);assert.equal(b.remaining,26-n);
    assert.equal(b.recoveryReserve.planCorrections,4-n);assert.equal(b.interfacesFrozen,false);
  }
});

test('real 5-call/16-package dead end permits an explicit pre-freeze regroup revision',()=>{
  const records=Array.from({length:5},()=>({state:'accepted'}));
  assert.ok(records.length+16+3>23); // Previous scheduler stopped here.
  const b=assemblyCallBudget(tier(23),records,{phase:'revise-design',round:0});
  assert.equal(b.canStart,true);assert.equal(b.maximumPackages,8);
  assert.equal(b.remaining,18);assert.equal(b.reservedHeadroom,7);
  const edit=assemblyStageSchema(assemblyPlanEditSchema,{sourceHash:'a'.repeat(64),planHash:'b'.repeat(64),callBudget:b});
  assert.equal(edit.properties.packages.properties.put.maxItems,8);
  assert.equal(assemblyPlanEditSchema.properties.packages.properties.put.maxItems,16);
});

test('tight budget does not create an impossible schema, extra calls or fictitious funded headroom',()=>{
  const p=tier(5),b=assemblyCallBudget(p,[]);
  assert.equal(b.maximumPackages,2);assert.equal(b.headroomFullyFunded,false);assert.equal(b.reservedHeadroom,0);
  const stopped=assemblyCallBudget(p,[{},{}],{phase:'revise-design'});
  assert.equal(stopped.canStart,false);assert.equal(stopped.maximumPackages,0);
  const records=[{formatCorrectionOf:1}];
  assert.equal(assemblyCallBudget(tier(),records,{attempt:1}).recoveryReserve.formatCorrection,0);
});

test('legacy non-design-first scheduling and geometry quotas remain unchanged',()=>{
  const p=tier();delete p.designReview;
  const b=assemblyCallBudget(p,[]);assert.equal(b.maximumPackages,16);assert.equal(b.reservedHeadroom,0);
  assert.equal(b.minimumReviewCalls,1);assert.equal(b.mandatoryCalls,2);
});

test('concept extensions use spare total calls without borrowing current packages or recovery reserves',()=>{
  const p=tier();Object.assign(p.designReview,{version:2,budgetedExtensions:true});
  const records=Array.from({length:7},()=>({state:'accepted'}));
  const b=conceptRevisionBudget(p,records,{round:2,packageCount:8});
  assert.equal(b.extension,true);assert.equal(b.canStart,true);assert.equal(b.remaining,19);
  assert.equal(b.reservedHeadroom,5);assert.equal(b.maximumPackages,11);
  assert.equal(conceptRevisionBudget(p,Array(11).fill({}),{round:3,packageCount:8}).stopReason,'concept-recovery-reserve');
  const afterCorrection=conceptRevisionBudget(p,Array(8).fill({}),{round:2,packageCount:8,correction:1});
  assert.equal(afterCorrection.canStart,true);assert.equal(afterCorrection.maximumPackages,b.maximumPackages);
  const legacy=conceptRevisionBudget(tier(),records,{round:2,packageCount:8});
  assert.equal(legacy.canStart,false);assert.equal(legacy.stopReason,'concept-revision-limit');
  assert.equal(conceptRevisionBudget(p,Array(24).fill({}),{round:9,packageCount:2}).canStart,false);
  assert.equal(p.maximumCalls,26);
});
