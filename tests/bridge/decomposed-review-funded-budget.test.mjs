import test from 'node:test';
import assert from 'node:assert/strict';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {decompositionRoleCorrectionBudget, decompositionRevisionBudget} from '../../bridge/assembly-decomposed-stages.mjs';
import {runSceneAssembly} from '../../bridge/scene-assembly.mjs';
import {stagedRequest, setupStaged} from './decomposed-assembly-fixtures.mjs';
import {PROTOTYPE_ROLES} from '../../contracts/scene-decomposition-roles.mjs';

test('new v4 batches adapt to the same confirmed ceiling and reserve review through ALL role attempts',()=>{
 for(let maximum=22;maximum<=26;maximum++){
  const tier=generationPreflight({...stagedRequest,assemblyCalls:maximum}).assembly;
  assert.equal(tier.prototypes.version,5);assert.equal(tier.maximumCalls,maximum);
  assert.equal(tier.maxPackages,maximum===26?5:4);
  for(let roleIndex=0;roleIndex<4;roleIndex++)for(let used=0;used<=maximum;used++)for(const correction of [0,1,2,5]){
   const b=decompositionRoleCorrectionBudget(tier,Array(used).fill({}),{roleIndex,packageCount:tier.maxPackages,correction});
   assert.equal(b.reservedTailCorrections,2);
   assert.equal(b.canStart,maximum-used>=1+(3-roleIndex)+tier.maxPackages+2+2);
   assert.equal(b.canAuthorizePlacement,false);
  }
 }
});
test('a later ordinary correction cannot consume the two slots retained by earlier extensions',()=>{
 const tier=generationPreflight(stagedRequest).assembly;
 const last=decompositionRoleCorrectionBudget(tier,Array(16).fill({}),{roleIndex:3,packageCount:7,correction:1});
 assert.equal(last.canStart,false);assert.equal(last.reservedTailCorrections,2);
 const legacy={...tier,prototypes:{...tier.prototypes,version:3,roleCorrections:{version:1,mode:'tail-funded',reservedTailCorrections:2}}};
 assert.equal(decompositionRoleCorrectionBudget(legacy,Array(16).fill({}),{roleIndex:3,packageCount:7,correction:1}).canStart,true);
});
test('new full task completes five batches and a current final review without an artificial early stop',async()=>{
 const h=await setupStaged(),result=await runSceneAssembly(h.options);
 assert.equal(h.calls.length,16);assert.equal(result.summary.completedPackages.length,5);
 assert.equal(result.summary.decomposition.requiredRoleStagesAccepted,4);assert.equal(result.summary.finalTextReviewAccepted,true);
 assert.equal(result.scene.bounds.height,224);
});
test('eight synthetic distinct role rejections PLUS a demanded concept revision complete within 26, with all responsibilities retained',async()=>{
 const failures=new Map(),targets=new Map(PROTOTYPE_ROLES.map((role,index)=>[role,index===0?5:1]));let revised=false;
 const h=await setupStaged(({answer,input,options})=>{
  if(['prototype-role','correct-prototype-role'].includes(options.stageName)){
   const count=failures.get(input.role)??0;
   assert.ok(targets.has(input.role));
   if(count<targets.get(input.role)){failures.set(input.role,count+1);answer.representatives[0].components.push('foreign'+(count+1));}
  }
  if(options.stageName==='concept-review'&&!revised){revised=true;answer.verdict='revise';answer.issues=[{
   id:'seed-proof',criterion:'materials',evidence:'Synthetic revision required after eight engineering rejections',change:'Refine the existing owned seed material'}];}
  return answer;
 });
 const result=await runSceneAssembly(h.options);
 assert.deepEqual([...failures], [...targets]);
 assert.equal(h.calls.length,26);assert.equal(result.records.filter(r=>r.state==='rejected').length,8);
 assert.deepEqual(result.records.slice(17,20).map(r=>r.phase),['concept-review','revise-design','concept-review']);
 assert.equal(result.summary.completedPackages.length,5);assert.equal(result.summary.finalTextReviewAccepted,true);
 assert.equal(result.summary.decomposition.requiredRoleStagesAccepted,4);assert.equal(result.scene.bounds.height,224);
 const revision=h.calls.find(c=>c.phase==='revise-design');assert.equal(revision.input.callBudget.remaining,8);
 assert.equal(revision.input.callBudget.mandatoryCalls,8);assert.equal(revision.input.callBudget.responsibilitiesFrozen,false);
 assert.equal(decompositionRevisionBudget(h.options.policy.assembly,Array(18).fill({}),{round:0,packageCount:5}).canStart,true);
 // This checks scheduling and real compilation, not the original paid model's
 // design or a promise that any arbitrary future generation must succeed.
});
