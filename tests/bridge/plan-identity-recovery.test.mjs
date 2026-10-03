import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runDurableAssembly} from '../../bridge/assembly-durability.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {inspectAssemblyPlan,applyAssemblyPlanRepair,applyAssemblyPlanEdit} from '../../contracts/scene-assembly.schema.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyPlan,packageEdit,acceptReview,planEdit} from '../design/assembly-fixtures.mjs';
import {instanceStudy,at} from '../design/fixtures.mjs';

const rules=await fs.readFile(new URL('../../prompts/scene-v1.md',import.meta.url),'utf8');
const request={key:'identity-offline',agent:'codex',model:'offline',prompt:'16×10×16格工程测试',generationMode:'scene',sceneWorkflow:'components',qualityTier:'ultra',assemblyDesignReview:'text',assemblyRecovery:'safe',assemblyConfirmed:true,maxRepairs:0};
function fixture(field){
  const plan=assemblyPlan();
  if(field==='modules')plan.scene.modules=[instanceStudy().modules[0]];
  if(field==='reservations')plan.scene.reservations=[{id:'space',at:at([14,0,14]),size:[1,1,1],allowedComponents:[]}];
  const bad=structuredClone(plan);bad.scene[field].push(structuredClone(bad.scene[field][0]));
  return {plan,bad};
}
function following(input,options){
  if(options.stageName==='concept-review')return {format:'SceneConceptReview',version:1,planHash:input.planHash,sourceHash:input.sourceHash,evidenceHash:input.designEvidence.evidenceHash,verdict:'accept',summary:'Offline test only',issues:[]};
  return options.stageName==='review'?acceptReview(input):packageEdit(input);
}

for(const field of ['components','modules','palette','reservations'])test(`duplicate ${field} uses bounded proposal repair, then every package and final review`,async()=>{
  const {plan,bad}=fixture(field),originalHash=hash(bad),policy=generationPreflight(request);
  const check=inspectAssemblyPlan(bad,policy.assembly);
  assert.equal(check.contract.valid,false);assert.equal(check.canAuthorizePlacement,false);
  const issue=check.contract.issues[0];assert.equal(issue.code,'duplicate-source-id');assert.equal(issue.field,field);
  assert.match(issue.firstPath,new RegExp('scene\\.'+field+'\\[0\\]'));
  assert.throws(()=>applyAssemblyPlanEdit(bad,planEdit(bad,plan),policy.assembly),/Duplicate/);
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-identity-'));let calls=0;
  const result=await runDurableAssembly({directory,requestHash:hash(request),runtimeHash:'offline',policy,prompt:request.prompt,rules,signal:new AbortController().signal,onStage:async()=>{},invoke:async(p,i,o)=>{
    calls++;const input=JSON.parse(p.split('Assembly input (data):\n').at(-1));
    if(i===1)return structuredClone(bad);
    if(i===2){assert.equal(o.stageName,'repair-plan');assert.equal(o.outputSchema.properties.format.enum[0],'SceneAssemblyPlanRepair');assert.equal(hash(input.priorPlan),originalHash);assert.equal(input.feedback.contract.issues[0].code,'duplicate-source-id');return {format:'SceneAssemblyPlanRepair',version:1,planHash:input.planHash,proposal:plan};}
    return following(input,o);
  }});
  assert.equal(calls,6);assert.equal(result.summary.reservedCalls,6);assert.equal(result.summary.completedPackages.length,2);assert.equal(result.summary.finalTextReviewAccepted,true);
  assert.deepEqual(result.records.map(r=>r.phase),['plan','repair-plan','concept-review','component','component','review']);
  assert.equal(hash(bad),originalHash);assert.equal(result.scene.components.filter(c=>c.id==='main').length,1);
});

test('identity repair preserves fixed fields, rejects ambiguous replacements and cannot replace a valid plan',()=>{
  const {plan,bad}=fixture('components'),policy=generationPreflight(request).assembly;
  const repair=proposal=>({format:'SceneAssemblyPlanRepair',version:1,planHash:hash(bad),proposal});
  for(const field of ['id','seed','bounds','design']){
    const changed=structuredClone(plan);
    if(field==='id')changed.scene.id='other';else if(field==='seed')changed.scene.seed++;else if(field==='bounds')changed.scene.bounds.height++;else changed.scene.design.concept='Changed';
    assert.throws(()=>applyAssemblyPlanRepair(bad,repair(changed),policy),/changed fixed/);
  }
  assert.throws(()=>applyAssemblyPlanRepair(bad,repair(bad),policy),/Duplicate/);
  assert.throws(()=>applyAssemblyPlanRepair(plan,{...repair(plan),planHash:hash(plan)},policy),/valid plan requires/);
  assert.throws(()=>applyAssemblyPlanRepair(bad,{...repair(plan),planHash:'0'.repeat(64)},policy),/hash/);
  const conflicting=structuredClone(bad);conflicting.scene.components[1].material='frame';
  assert.equal(inspectAssemblyPlan(conflicting,policy).contract.issues[0].code,'duplicate-source-id');
});

test('saved identity repair receipt recovers without a second call or source deduplication',async()=>{
  const {plan,bad}=fixture('components'),directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-identity-crash-'));let calls=0,interrupted=false;
  const options={directory,requestHash:hash(request),runtimeHash:'offline',policy:generationPreflight(request),prompt:request.prompt,rules,signal:new AbortController().signal,onStage:async()=>{},invoke:async(p,i,o)=>{
    calls++;const input=JSON.parse(p.split('Assembly input (data):\n').at(-1));
    if(i===1)return bad;
    if(i===2)return {format:'SceneAssemblyPlanRepair',version:1,planHash:input.planHash,proposal:plan};
    return following(input,o);
  }};
  await assert.rejects(runDurableAssembly({...options,onStage:async records=>{if(!interrupted&&records.at(-1).index===2&&records.at(-1).state==='checking'){interrupted=true;throw new Error('Saved identity repair interruption');}}}),/Saved identity repair/);
  assert.equal(calls,2);
  const result=await runDurableAssembly(options);assert.equal(calls,6);assert.equal(result.summary.finalTextReviewAccepted,true);
  await runDurableAssembly(options);assert.equal(calls,6);assert.equal(bad.scene.components.length,2);
});

test('saved intent-changing repair replays as rejected, then corrects without repeating the completed call',async()=>{
 const {plan,bad}=fixture('components'),directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-identity-intent-crash-'));let calls=0,interrupted=false;
 const originalHash=hash(bad),options={directory,requestHash:hash(request),runtimeHash:'offline',policy:generationPreflight(request),prompt:request.prompt,rules,signal:new AbortController().signal,onStage:async()=>{},invoke:async(p,i,o)=>{
  calls++;const input=JSON.parse(p.split('Assembly input (data):\n').at(-1));
  if(i===1)return bad;
  if(i===2){const proposal=structuredClone(plan);proposal.scene.design.features[0]+=' paraphrased';return {format:'SceneAssemblyPlanRepair',version:1,planHash:input.planHash,proposal};}
  if(i===3){assert.equal(hash(input.priorPlan),originalHash);assert.equal(input.feedback.contract.issues[0].code,'frozen-plan-intent');return {format:'SceneAssemblyPlanRepair',version:1,planHash:input.planHash,proposal:plan};}
  return following(input,o);
 }};
 await assert.rejects(runDurableAssembly({...options,onStage:async records=>{if(!interrupted&&records.at(-1).index===2&&records.at(-1).state==='checking'){interrupted=true;throw new Error('Saved intent repair interruption');}}}),/Saved intent repair/);
 assert.equal(calls,2);
 const result=await runDurableAssembly(options);assert.equal(calls,7);assert.equal(result.records[1].state,'rejected');assert.equal(result.summary.finalTextReviewAccepted,true);
 assert.deepEqual(result.scene.design,plan.scene.design);assert.equal(hash(bad),originalHash);
 await runDurableAssembly(options);assert.equal(calls,7);
});
