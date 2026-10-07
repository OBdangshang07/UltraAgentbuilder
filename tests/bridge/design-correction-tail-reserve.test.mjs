import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {assemblyCompletionReservePolicy,stagedDesignCorrectionReserve} from '../../contracts/assembly-completion-reserve.mjs';
import {decompositionRoleCorrectionBudget,decompositionRevisionBudget} from '../../bridge/assembly-decomposed-stages.mjs';
import {assemblyProviderRecoveryBudget} from '../../bridge/assembly-provider-budget.mjs';
import {runDurableAssembly} from '../../bridge/assembly-durability.mjs';
import {runSceneAssembly} from '../../bridge/scene-assembly.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {PROTOTYPE_ROLES} from '../../contracts/scene-decomposition-roles.mjs';
import {stagedRequest,setupStaged} from './decomposed-assembly-fixtures.mjs';
import {planEdit} from '../design/assembly-fixtures.mjs';
import {terminalFixture} from './assembly-terminal-fixture.mjs';
import {CompletedResponseFormatError,parseModelJson} from '../../bridge/model-json.mjs';
import {completedFormatError} from '../fixtures/completed-format-error.mjs';

const request={...stagedRequest,assemblyCompletionReserve:'design-correction-v1'};
const tier=(extra={})=>generationPreflight({...request,...extra}).assembly;
const records=n=>Array.from({length:n},()=>({}));
test('new request explicitly opts in without altering legacy policy or allocating extra calls/packages',()=>{
 const old=generationPreflight(stagedRequest).assembly,newPolicy=tier();
 assert.equal(old.completionReserve,undefined);assert.equal(stagedDesignCorrectionReserve(old),0);
 assert.deepEqual(newPolicy,{...old,completionReserve:assemblyCompletionReservePolicy()});
 assert.equal(newPolicy.maximumCalls,26);assert.equal(newPolicy.maxPackages,5);
 assert.equal(stagedDesignCorrectionReserve(newPolicy),1);
 assert.equal(stagedDesignCorrectionReserve(tier({assemblyPrototypeValidation:'expanded-routes-v1'})),1);
 for(const change of [{assemblyCompletionReserve:true},{assemblyCompletionReserve:'automatic'},
  {assemblyPrototypes:'verified'},{qualityTier:'max'},{assemblyRecovery:undefined},{assemblyQuality:'v3'},
  {sceneWorkflow:undefined},{generationMode:'single'}])assert.throws(()=>generationPreflight({...request,...change}));
});
test('policy clones cannot add authority, getters or an altered correction count',()=>{
 const original=tier(),before=hash(original),p=assemblyCompletionReservePolicy();p.designCorrections=99;
 assert.equal(assemblyCompletionReservePolicy().designCorrections,1);
 for(const change of [
  t=>t.completionReserve.designCorrections=0,t=>t.completionReserve.increaseCallLimit=true,
  t=>t.completionReserve.canAuthorizePlacement=true,t=>t.completionReserve.extra=true,
  t=>delete t.completionReserve.newTaskOnly,t=>t.completionReserve=Object.create(t.completionReserve),
  t=>t.completionReserve[Symbol('force')]=true,t=>Object.defineProperty(t.completionReserve,'hidden',{value:true}),
  t=>Object.defineProperty(t.completionReserve,'designCorrections',{get(){assert.fail('Getter must not run');},enumerable:true}),
  t=>t.prototypes.roleCorrections.reservedTailCorrections=0,t=>t.prototypes.version=3
 ]){const t=structuredClone(original);change(t);assert.throws(()=>stagedDesignCorrectionReserve(t),/Invalid staged completion reserve/);}
 assert.equal(hash(original),before);
});
test('all initial and corrective role calls retain one design correction plus the old edit/re-review pair',()=>{
 for(let maximum=22;maximum<=26;maximum++){
  const t=tier({assemblyCalls:maximum});
  for(let roleIndex=0;roleIndex<4;roleIndex++)for(let used=0;used<=maximum;used++)for(const correction of [0,1,2,5]){
   const before=hash(t),b=decompositionRoleCorrectionBudget(t,records(used),{roleIndex,packageCount:t.maxPackages,correction});
   assert.equal(b.reservedTailCorrections,3);assert.equal(b.mandatoryCalls,1+3-roleIndex+t.maxPackages+2+3);
   assert.equal(b.canStart,maximum-used>=b.mandatoryCalls);assert.equal(b.canAuthorizePlacement,false);assert.equal(hash(t),before);
  }
 }
});
test('initial design edits cannot enter the old seven-left/eight-needed dead end; a correction spends the reserved slot',()=>{
 const t=tier(),old=generationPreflight(stagedRequest).assembly;
 assert.equal(decompositionRevisionBudget(old,records(18),{round:0,packageCount:5}).canStart,true);
 const late=decompositionRevisionBudget(t,records(18),{round:0,packageCount:5});
 assert.equal(late.remaining,8);assert.equal(late.mandatoryCalls,9);assert.equal(late.reservedHeadroom,1);
 assert.equal(late.canStart,false);assert.equal(late.stopReason,'staged-required-path-unfunded');
 const initial=decompositionRevisionBudget(t,records(17),{round:0,packageCount:5});
 assert.equal(initial.canStart,true);assert.equal(initial.mandatoryCalls,9);
 const repair=decompositionRevisionBudget(t,records(18),{round:0,packageCount:5,correcting:true});
 assert.equal(repair.canStart,true);assert.equal(repair.reservedHeadroom,0);assert.equal(repair.mandatoryCalls,8);
 assert.equal(decompositionRevisionBudget(t,records(19),{round:0,packageCount:5,correcting:true}).canStart,false);
});
test('capacity recovery recognizes the exact new role reserve and never lowers it in a saved original input',()=>{
 const t=tier({assemblyProviderRecovery:'bounded',effort:'max'}),roleIndex=1,index=8;
 const b=decompositionRoleCorrectionBudget(t,records(index-1),{roleIndex,packageCount:5,correction:1});
 const input={tier:t,role:PROTOTYPE_ROLES[roleIndex],task:{id:'task1'},prototypeCorrectionBudget:b,
  prototypeState:{roles:PROTOTYPE_ROLES.map((role,i)=>({role,task:'task'+i})),completedRoles:PROTOTYPE_ROLES.slice(0,roleIndex)},
  decompositionStageId:PROTOTYPE_ROLES[roleIndex],
  decompositionBudget:{version:1,remaining:26-index+1,requiredAfterCall:b.requiredAfterCall,mandatoryCalls:1+b.requiredAfterCall,
   spareCalls:26-index-b.requiredAfterCall,canAuthorizePlacement:false}};
 const args={tier:t,phase:'correct-prototype-role',input,reservedCalls:index,packageIds:['task0','task1','task2','task3','task4']};
 const result=assemblyProviderRecoveryBudget(args);assert.equal(result.canStart,true);assert.equal(result.protectedHeadroom,4);
 assert.equal(result.originalInputHash,hash(input));assert.equal(result.canAuthorizeRetry,false);
 const changed=structuredClone(input);changed.prototypeCorrectionBudget.reservedTailCorrections=2;
 assert.throws(()=>assemblyProviderRecoveryBudget({...args,input:changed}),/corrective budget changed/);
 for(const phase of ['revise-design','correct-design']){
  const callBudget=decompositionRevisionBudget(t,records(11),{round:0,packageCount:5,correcting:phase==='correct-design'});
  const values={tier:t,phase,reservedCalls:12,input:{tier:t,callBudget}};
  assert.equal(assemblyProviderRecoveryBudget(values).canStart,true);
  const stale=structuredClone(values);stale.input.callBudget.reservedHeadroom=phase==='correct-design'?1:0;
  assert.throws(()=>assemblyProviderRecoveryBudget(stale),/design-correction reserve changed/);
 }
});

async function completeFixture(priorFailures=7){
 const failures=new Map(),targets=new Map(PROTOTYPE_ROLES.map((role,i)=>[role,i===0?priorFailures-3:1]));let reviewed=false,rejected;
 const h=await setupStaged(({answer,input,options})=>{
  if(['prototype-role','correct-prototype-role'].includes(options.stageName)){
   const count=failures.get(input.role)??0;
   if(count<targets.get(input.role)){failures.set(input.role,count+1);answer.representatives[0].components.push('foreign'+(count+1));}
  }
  if(options.stageName==='concept-review'&&!reviewed){reviewed=true;answer.verdict='revise';answer.issues=[{
   id:'service-layout',criterion:'core',evidence:'Synthetic budgeted room-layout revision',change:'Add explicitly scoped service-room geometry'}];}
  if(options.stageName==='revise-design'){
   const target=structuredClone(input.priorPlan),room={kind:'storeyRoom',id:'task4__services',host:'main',allowOverwrite:[],
    floors:{source:'main',first:21,count:3},offset:[19,8],footprint:[5,2],ceilingInset:0,use:'room',
    purpose:'Synthetic invalid two-sided partition',floorMaterial:'floor',
    boundaries:['north','south'].map(face=>({face,material:'wall',openings:[]}))};
   target.scene.components.push(room);target.packages[4].regions.push({origin:[20,105,9],size:[8,16,8]});
   target.packages[4].editableComponents.push(room.id);answer.edit=planEdit(input.priorPlan,target);answer.recipes[0].count=3;
   rejected=structuredClone(answer);
  }
  if(options.stageName==='correct-design'){
   assert.equal(input.repairBase.approved,false);assert.equal(input.callBudget.reservedHeadroom,0);
   const target=structuredClone(input.priorPlan);target.scene.components.find(c=>c.id==='task4__services').footprint[1]=3;
   answer.edit=planEdit(input.priorPlan,target);answer.recipes=structuredClone(input.prototypeRecipes);
   assert.equal(answer.edit.sceneEdit.components.put.length,1);assert.deepEqual(answer.edit.packages,{put:[],remove:[]});
  }
  return answer;
 },request);
 return {...h,failures,targets,getRejected:()=>rejected};
}
test('seven prior rejections and a rejected design edit resume to all five packages plus final review within the SAME 26 calls',async()=>{
 const h=await completeFixture(),abort=new AbortController();let branch;
 const identity={requestHash:hash(request),runtimeHash:'synthetic-tail-reserve-v1',onRecovery:async r=>{if(r.branch)branch=r.branch;}};
 await assert.rejects(runDurableAssembly({...h.options,...identity,signal:abort.signal,onStage:async rows=>{
  if(rows.at(-1).phase==='correct-design'&&rows.at(-1).state==='accepted')abort.abort();
 }}),/abort/i);
 assert.equal(h.calls.length,19);assert.deepEqual([...h.failures],[...h.targets]);
 assert.deepEqual(h.calls.slice(16,19).map(c=>c.phase),['concept-review','revise-design','correct-design']);
 const result=await runDurableAssembly({...h.options,...identity});
 assert.equal(h.calls.length,26);assert.equal(new Set(h.calls.map(c=>c.index)).size,26);
 assert.equal(result.records.filter(r=>r.state==='rejected').length,8);
 assert.equal(result.summary.completedPackages.length,5);assert.equal(result.summary.finalTextReviewAccepted,true);
 assert.equal(result.summary.decomposition.requiredRoleStagesAccepted,4);assert.equal(result.scene.bounds.height,224);
 assert.equal(result.scene.components.find(c=>c.id==='task4__services').footprint[1],3);
 assert.equal(h.calls[19].phase,'concept-review');assert.equal(h.calls.at(-1).phase,'review');
 const original=JSON.parse(await fs.readFile(path.join(h.directory,branch,'assembly/18/response.json')));assert.deepEqual(original,h.getRejected());
 assert.equal(original.edit.sceneEdit.components.put.find(c=>c.id==='task4__services').footprint[1],2);
 const captures=h.uploads.length;await runDurableAssembly({...h.options,...identity});assert.equal(h.calls.length,26);assert.equal(h.uploads.length,captures);
});
test('independent terminal audit verifies the original 26-call compiled workflow, not a substituted successful response',async()=>{
 const h=await completeFixture(),result=await runSceneAssembly(h.options);
 assert.equal(h.calls.length,26);assert.equal(result.summary.completedPackages.length,5);assert.equal(result.summary.finalTextReviewAccepted,true);
 const audit=await (await terminalFixture(h,result)).audit('new-reserved-tail-good');assert.equal(audit.code,0,audit.output);
 assert.equal(audit.report.additionalModelCalls,0);
});
for(const priorFailures of [6,7])test(`design serialization with ${priorFailures} prior rejections cannot borrow the reserved geometric correction`,async()=>{
 const h=await completeFixture(priorFailures),invoke=h.options.invoke;let actual=0,failed=false;
 const options={...h.options,invoke:async(p,i,o)=>{
  actual++;
  if(o.stageName==='revise-design'&&!failed){failed=true;throw await completedFormatError(h.directory,CompletedResponseFormatError,parseModelJson,undefined,'codex');}
  return invoke(p,i,o);
 }};
 if(priorFailures===6){
  const result=await runSceneAssembly(options);assert.equal(actual,26);assert.equal(result.records.length,26);
  assert.equal(result.summary.formatCorrections,1);assert.equal(result.summary.completedPackages.length,5);assert.equal(result.summary.finalTextReviewAccepted,true);
  assert.equal(result.records.find(r=>r.formatCorrectionOf).formatCorrectionOf,17);
  assert.equal(h.calls.find(c=>c.index===18).input.callBudget.reservedHeadroom,1);
  assert.equal(h.calls.find(c=>c.phase==='correct-design').input.callBudget.reservedHeadroom,0);
 }else{
  await assert.rejects(runSceneAssembly(options),CompletedResponseFormatError);assert.equal(actual,18);
  assert.equal(h.calls.length,17);assert.ok(!h.calls.some(c=>['correct-design','component','review'].includes(c.phase)));
 }
});
test('an additional unapproved role cannot consume the protected new tail, bypass work or raise the limit',async()=>{
 const targets=new Map(PROTOTYPE_ROLES.map((role,i)=>[role,i===0?5:1])),failures=new Map();
 const h=await setupStaged(({answer,input,options})=>{
  if(['prototype-role','correct-prototype-role'].includes(options.stageName)){
   const n=failures.get(input.role)??0;if(n<targets.get(input.role)){failures.set(input.role,n+1);answer.representatives[0].components.push('foreign'+(n+1));}
  }return answer;
 },request);
 await assert.rejects(runSceneAssembly(h.options),/role.*failed|prototype.*failed/i);
 assert.equal(h.options.policy.maximumCalls,26);assert.ok(h.calls.length<26);
 assert.ok(!h.calls.some(c=>['revise-design','component','review'].includes(c.phase)));
 assert.equal((await fs.readdir(h.directory)).includes('final'),false);
});
