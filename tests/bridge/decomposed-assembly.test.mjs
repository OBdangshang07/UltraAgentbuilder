import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../../src/generation/compiler.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {runSceneAssembly} from '../../bridge/scene-assembly.mjs';
import {runDurableAssembly} from '../../bridge/assembly-durability.mjs';
import {CompletedResponseFormatError,parseModelJson} from '../../bridge/model-json.mjs';
import {completedFormatError} from '../fixtures/completed-format-error.mjs';
import {readNativeBundle} from '../../src/generation/bundle.mjs';
import {decompositionTailBudget,decompositionRevisionBudget,decompositionRoleCorrectionBudget} from '../../bridge/assembly-decomposed-stages.mjs';
import {stagedRequest,setupLegacyStaged as setupStaged} from './decomposed-assembly-fixtures.mjs';

test('explicit staged Ultra preflight freezes new semantics and preserves old verified policy',()=>{
 const staged=generationPreflight(stagedRequest);assert.equal(staged.maximumCalls,26);assert.equal(staged.maxOutputTokens,null);
 assert.equal(staged.assembly.prototypes.mode,'staged');assert.equal(staged.assembly.prototypes.version,5);
 assert.equal(staged.assembly.prototypes.candidateCount,3);assert.equal(staged.assembly.prototypes.recoveryReserve,10);
 assert.equal(staged.assembly.maxPackages,5);
 assert.equal(generationPreflight({...stagedRequest,assemblyPrototypes:'verified'}).assembly.prototypes.version,1);
 assert.equal(generationPreflight({...stagedRequest,assemblyCalls:22}).maximumCalls,22);
 assert.equal(generationPreflight({...stagedRequest,assemblyCalls:22}).assembly.maxPackages,4);
 assert.equal(generationPreflight({...stagedRequest,assemblyPrototypes:'verified'}).assembly.maxPackages,16);
 for(const delta of [{assemblyCalls:21},{qualityTier:'max'},{assemblyQuality:'v3'},{assemblyRecovery:undefined},{assemblyDesignReview:'text'},{baseJobId:'old'}])assert.throws(()=>generationPreflight({...stagedRequest,...delta}));
 assert.throws(()=>decompositionTailBudget(staged.assembly,Array(25).fill({}),1),/required complete-task tail/);
});
test('v3 role correction extensions fund every remaining primary and two tail corrections without upgrading v2',()=>{
 const current=generationPreflight(stagedRequest).assembly;
 const tier={...current,prototypes:{...current.prototypes,version:3,roleCorrections:{version:1,mode:'tail-funded',reservedTailCorrections:2}}};
 for(let roleIndex=0;roleIndex<4;roleIndex++)for(let used=0;used<=26;used++){
  const records=Array(used).fill({}),extended=decompositionRoleCorrectionBudget(tier,records,{roleIndex,packageCount:8,correction:3});
  assert.equal(extended.canStart,26-used>=1+(3-roleIndex)+8+2+2);assert.equal(extended.reservedTailCorrections,2);assert.equal(extended.canAuthorizePlacement,false);
  const base=decompositionRoleCorrectionBudget(tier,records,{roleIndex,packageCount:8,correction:2});assert.equal(base.canStart,26-used>=1+(3-roleIndex)+8+2);
  const legacy=decompositionRoleCorrectionBudget({...tier,prototypes:{...tier.prototypes,version:2}},records,{roleIndex,packageCount:8,correction:3});assert.equal(legacy.canStart,false);assert.equal(legacy.stopReason,'prototype-correction-limit');
 }
});
test('four distinct representative failures can be corrected beyond the old cap and complete all roles and eight packages',async()=>{
 let rejected=0;
 const h=await setupStaged(({answer,input,options})=>{
  if(['prototype-role','correct-prototype-role'].includes(options.stageName)&&input.role==='typical-floor-core'&&rejected<4)answer.representatives[0].components.push('foreign'+(++rejected));
  return answer;
 });
 const result=await runSceneAssembly(h.options);assert.equal(h.calls.length,23);assert.equal(result.summary.completedPackages.length,8);assert.equal(result.summary.finalTextReviewAccepted,true);
 const corrected=h.calls.filter(c=>c.phase==='correct-prototype-role');assert.equal(corrected.length,4);
 assert.equal(corrected[2].input.prototypeCorrectionBudget.extension,true);assert.equal(corrected[2].input.prototypeCorrectionBudget.reservedTailCorrections,2);
 for(const c of corrected){const issues=c.input.prior.feedback.contract.issues;assert.ok(issues.some(i=>i.code==='representative-foreign-source'));assert.ok(issues.some(i=>i.ids?.some(id=>id.startsWith('foreign'))));}
 assert.equal(result.records.filter(r=>r.state==='rejected').length,4);assert.equal(result.summary.decomposition.requiredRoleStagesAccepted,4);
});
test('persistent distinct role failures stop before consuming protected tail and never dispatch later roles',async()=>{
 let count=0;const h=await setupStaged(({answer,input,options})=>{
  if(['prototype-role','correct-prototype-role'].includes(options.stageName)&&input.role==='typical-floor-core')answer.representatives[0].components.push('foreign'+(++count));
  return answer;
 });
 await assert.rejects(runSceneAssembly(h.options),/Required prototype role/);assert.equal(h.calls.length,11);assert.equal(count,6);
 assert.equal(h.calls.at(-1).input.prototypeCorrectionBudget.reservedTailCorrections,2);assert.equal(26-h.calls.length,13+2);
 assert.ok(h.calls.filter(c=>['prototype-role','correct-prototype-role'].includes(c.phase)).every(c=>c.input.role==='typical-floor-core'));
});
test('a complete format-error correction within an extended role refreshes tail funding and cannot borrow its protected slots',async()=>{
 for(const failures of [4,5]){
  let rejected=0,actual=0,formatFailed=false;
  const h=await setupStaged(({answer,input,options})=>{
   if(['prototype-role','correct-prototype-role'].includes(options.stageName)&&input.role==='typical-floor-core'&&rejected<failures)answer.representatives[0].components.push('foreign'+(++rejected));
   return answer;
  });const invoke=h.options.invoke;
  const options={...h.options,invoke:async(p,i,o)=>{
   actual++;if(i===6+failures&&!formatFailed){formatFailed=true;throw await completedFormatError(h.directory,CompletedResponseFormatError,parseModelJson,undefined,'codex');}return invoke(p,i,o);
  }};
  if(failures===4){
   const result=await runSceneAssembly(options);assert.equal(actual,24);assert.equal(result.summary.completedPackages.length,8);assert.equal(result.summary.finalTextReviewAccepted,true);
   const corrected=h.calls.find(c=>c.index===11);assert.equal(corrected.input.prototypeCorrectionBudget.remaining,16);assert.equal(corrected.input.prototypeCorrectionBudget.reservedTailCorrections,2);assert.equal(corrected.input.formatCorrection.stage,10);
  }else{
   await assert.rejects(runSceneAssembly(options),CompletedResponseFormatError);assert.equal(actual,11);assert.ok(h.calls.every(c=>c.index<=10));
  }
 }
});
test('staged orchestration constructs independent concepts, four bounded seeds, all instances, eight packages and current final review',async()=>{
 const h=await setupStaged(),result=await runSceneAssembly(h.options);
 assert.equal(result.records.length,19);assert.equal(h.calls.length,19);assert.equal(result.scene.bounds.height,224);
 assert.deepEqual(result.records.map(r=>r.phase),['concept-candidate','concept-candidate','concept-candidate','select-concept','assembly-blueprint',
  'prototype-role','prototype-role','prototype-role','prototype-role','concept-review',...Array(8).fill('component'),'review']);
 assert.equal(result.summary.completedPackages.length,8);assert.equal(result.summary.finalTextReviewAccepted,true);assert.equal(result.summary.visualReviewCurrent,true);
 assert.equal(result.summary.decomposition.requiredRoleStagesAccepted,4);assert.equal(result.summary.decomposition.canAuthorizePlacement,false);
 assert.equal(result.summary.prototypeExpansion.seedVisualAccepted,false);assert.equal(result.summary.prototypeExpansion.expandedVisualAccepted,true);assert.equal(result.summary.prototypeExpansion.additionalModelCalls,0);
 for(const call of h.calls.slice(0,3)){
  assert.equal(call.input.count,1);assert.equal(call.images.length,0);assert.ok(!call.instructions.includes('Return SceneAssemblyPlan:'));
 }
 for(const call of h.calls.slice(5,9)){
  assert.equal(Object.hasOwn(call.input.prototypeState,'plan'),false);
  assert.equal(call.input.reservationAuthority.sourceHash,call.input.sourceHash);
  assert.equal(call.input.reservationAuthority.taskHash,hash(call.input.task));
  assert.equal(call.input.reservationAuthority.reservationsPutRemoveAllowed,false);
  assert.match(call.instructions,/namespace DOES NOT add an ID/);
  assert.equal(call.input.sourceIdentityPolicy.prefix,call.input.task.id+'__');
  assert.equal(call.input.sourceIdentityPolicy.maximumNewSuffixLength+call.input.sourceIdentityPolicy.prefix.length,32);
  assert.equal(call.input.sourceIdentityPolicy.automaticRenaming,false);
  assert.equal(call.input.sourceIdentityPolicy.canAuthorizePlacement,false);
  assert.match(call.instructions,/32 characters TOTAL/);
 }
 const blueprintCall=h.calls.find(c=>c.phase==='assembly-blueprint');
 assert.match(blueprintCall.instructions,/COMPLETE organized typical office floor/);
 assert.match(blueprintCall.instructions,/allowedComponents entries must be actual existing source IDs/);
 const root=path.join(h.directory,'assembly'),blueprint=JSON.parse(await fs.readFile(path.join(root,'5/decomposition-state.json')));
 assert.deepEqual(blueprint.completedRoles,[]);
 for(let stage=6;stage<=9;stage++){
  const dir=path.join(root,String(stage)),witness=JSON.parse(await fs.readFile(path.join(dir,'representative-witness.json')));
  assert.equal(witness.roles.length,stage-5);assert.equal(witness.survivingGeometryVerified,true);assert.equal(witness.architecturalCompletenessVerified,false);
  assert.equal(witness.canAuthorizePlacement,false);
  await assert.rejects(readNativeBundle(path.join(dir,'diagnostic')),/Diagnostic/);
  const expanded=JSON.parse(await fs.readFile(path.join(dir,'prototype/feedback.json')));assert.equal(expanded.geometryPassed,true);
  assert.equal(expanded.packageCheck.scopeVerified,true);
 }
 const aggregate=JSON.parse(await fs.readFile(path.join(root,'decomposed-concepts.json')));assert.equal(aggregate.modelResponse,false);assert.equal(aggregate.bindings.length,3);
 for(const [i,b] of aggregate.bindings.entries())assert.equal(b.responseHash,hash(JSON.parse(await fs.readFile(path.join(root,String(i+1),'response.json')))));
});
test('each responsible role corrects its own expanded-floor failure before later role/model calls',async()=>{
 let rejected=false;
 const h=await setupStaged(({answer,input,options})=>{
  if(options.stageName==='prototype-role'&&input.role==='typical-floor-core'&&!rejected){rejected=true;answer.recipes[0].step=[0,4,0];}
  return answer;
 });
 const result=await runSceneAssembly(h.options);assert.equal(h.calls.length,20);
 assert.deepEqual(result.records.slice(5,8).map(r=>[r.phase,r.state]),[['prototype-role','rejected'],['correct-prototype-role','accepted'],['prototype-role','accepted']]);
 assert.equal(result.summary.completedPackages.length,8);assert.equal(result.summary.finalTextReviewAccepted,true);
 const corrected=h.calls[6];assert.equal(corrected.input.role,'typical-floor-core');assert.match(corrected.input.prior.error,/Prototype expansion/);assert.equal(corrected.input.prior.overallAccepted,false);
 assert.equal(corrected.input.sourceHash,h.calls[5].input.sourceHash);assert.equal(result.scene.bounds.height,224);
});
test('fully covered representative geometry is rejected using saved owners, not its label or source ID',async()=>{
 const h=await setupStaged(({answer,input,options})=>{
  if(options.stageName==='prototype-role'&&input.role==='typical-floor-core'){
   answer.edit.components.put[1].at=structuredClone(answer.edit.components.put[0].at);
   answer.edit.components.put[1].allowOverwrite=[answer.edit.components.put[0].id];
  }
  return answer;
 });
 const result=await runSceneAssembly(h.options);assert.equal(result.records[5].state,'rejected');
 assert.match(result.records[5].error,/no surviving real source geometry/);
 assert.equal(result.records[6].phase,'correct-prototype-role');assert.equal(result.summary.finalTextReviewAccepted,true);
});
test('seven real compiler/scope rejections consume all seven spare calls and still complete the full 26-call task',async()=>{
 const h=await setupStaged(({answer,input,options})=>{
  const phase=options.stageName;
  if(phase==='concept-candidate')answer.candidates[0].scene.components[0].size[1]=225;
  if(phase==='assembly-blueprint')answer.packages[0].editableComponents=['missing'];
  if(phase==='prototype-role'&&input.role==='typical-floor-core')answer.recipes[0].step=[0,4,0];
  if(phase==='prototype-role'&&input.role==='facade-corner')answer.edit.components.put[0].at.offset[0]=25;
  if(phase==='component'&&input.task.id==='task0')answer.components.put[0].at.offset[0]=10;
  return answer;
 });
 const result=await runSceneAssembly(h.options);assert.equal(h.calls.length,26);assert.equal(result.records.filter(r=>r.state==='rejected').length,7);
 assert.equal(result.records.at(-1).phase,'review');assert.equal(result.records.at(-1).state,'accepted');
 assert.equal(result.summary.completedPackages.length,8);assert.equal(result.summary.finalTextReviewAccepted,true);assert.equal(result.scene.bounds.height,224);
});
test('mandatory tail survives every visual revision budget without regrouping eight responsibilities',()=>{
 const tier=generationPreflight(stagedRequest).assembly;
 for(let used=0;used<=26;used++){
  const b=decompositionRevisionBudget(tier,Array(used).fill({}),{round:0,packageCount:8});
  assert.equal(b.canStart,26-used>=11);assert.equal(b.maximumPackages,8);assert.equal(b.responsibilitiesFrozen,false);
 }
});
test('seed review can revise and re-review the full checked prototype set before all eight packages',async()=>{
 let revised=false;
 const h=await setupStaged(({answer,options})=>{
  if(options.stageName==='concept-review'&&!revised){revised=true;answer.verdict='revise';answer.issues=[{id:'seed-proof',criterion:'materials',evidence:'Synthetic staged revision target',change:'Refine the existing owned seed material'}];}
  return answer;
 });
 const result=await runSceneAssembly(h.options);assert.equal(h.calls.length,21);
 assert.equal(result.summary.completedPackages.length,8);assert.equal(result.summary.prototypeExpansion.expandedVisualAccepted,true);
 assert.equal(result.summary.finalTextReviewAccepted,true);assert.deepEqual(result.records.slice(9,12).map(r=>r.phase),['concept-review','revise-design','concept-review']);
 const revision=h.calls.find(c=>c.phase==='revise-design');assert.equal(revision.input.callBudget.maximumPackages,8);assert.equal(revision.input.callBudget.responsibilitiesFrozen,true);
});
test('whole-building revise funds a scoped edit AND another current review within the same 26 calls',async()=>{
 let revised=false;
 const h=await setupStaged(({answer,options})=>{
  if(options.stageName==='review'&&!revised){revised=true;answer.verdict='revise';answer.task='task0';answer.issues=[{id:'final-proof',task:'task0',criterion:'materials',evidence:'Synthetic scoped final refinement',change:'Refine the owned detail material'}];}
  return answer;
 });
 const result=await runSceneAssembly(h.options);assert.equal(h.calls.length,21);
 assert.deepEqual(result.records.slice(-3).map(r=>r.phase),['review','refine-coordinated','review']);
 assert.equal(result.summary.finalTextReviewAccepted,true);assert.equal(result.summary.finalVisualReview.sourceHash,hash(result.scene));
});
test('durable replay after blueprint and middle/final prototype receipts sends no completed call twice',async()=>{
 for(const checkpoint of [5,7,9]){
  const h=await setupStaged();let interrupted=false;
  const options={...h.options,requestHash:hash(stagedRequest),runtimeHash:'staged-offline-test-v1'};
  await assert.rejects(runDurableAssembly({...options,onStage:async records=>{
   if(!interrupted&&records.at(-1).index===checkpoint&&records.at(-1).state==='checking'){interrupted=true;throw Error('Staged receipt checkpoint loss');}
  }}),/checkpoint loss/);
  assert.equal(h.calls.length,checkpoint);
  const result=await runDurableAssembly(options);assert.equal(h.calls.length,19);assert.equal(result.summary.reservedCalls,19);assert.equal(result.summary.finalTextReviewAccepted,true);
  await runDurableAssembly(options);assert.equal(h.calls.length,19);
 }
});
test('unknown provider outcome is reserved once and never replaced on restart',async()=>{
 const h=await setupStaged(),invoke=h.options.invoke;let actualCalls=0;
 const options={...h.options,requestHash:hash(stagedRequest),runtimeHash:'staged-offline-test-v1',invoke:async(p,i,o)=>{
  actualCalls++;if(i===6)throw Error('Staged unknown provider outcome');return invoke(p,i,o);
 }};
 await assert.rejects(runDurableAssembly(options),/unknown provider outcome/);assert.equal(actualCalls,6);
 await assert.rejects(runDurableAssembly(options),/unknown provider outcome/);assert.equal(actualCalls,6);
 const ledger=JSON.parse(await fs.readFile(path.join(h.directory,'assembly-journal/call-6.json')));assert.equal(ledger.value.state,'error');
});
test('completed invalid JSON receives one budgeted correction with refreshed blueprint/role tail and durable replay',async()=>{
 for(const checkpoint of [5,6]){
  const h=await setupStaged(),invoke=h.options.invoke;let actualCalls=0,failed=false;
  const options={...h.options,requestHash:hash(stagedRequest),runtimeHash:'staged-format-test-v1',invoke:async(p,i,o)=>{
   actualCalls++;
   if(i===checkpoint&&!failed){failed=true;throw await completedFormatError(h.directory,CompletedResponseFormatError,parseModelJson,undefined,'codex');}
   return invoke(p,i,o);
  }};
  const result=await runDurableAssembly(options);assert.equal(result.records.length,20);assert.equal(actualCalls,20);
  assert.equal(result.records[checkpoint-1].invocationOutcome,'completed-invalid-json');assert.equal(result.records[checkpoint].formatCorrectionOf,checkpoint);
  const corrected=h.calls.find(c=>c.index===checkpoint+1);assert.equal(corrected.input.decompositionBudget.remaining,26-checkpoint);
  if(checkpoint===5)assert.equal(corrected.input.callBudget.reservedCalls,checkpoint);
  await runDurableAssembly(options);assert.equal(actualCalls,20);assert.equal(result.summary.finalTextReviewAccepted,true);
 }
});
test('cancellation after a saved role receipt reserves that call and sends no later work',async()=>{
 const h=await setupStaged(),controller=new AbortController();let records=[];
 await assert.rejects(runSceneAssembly({...h.options,signal:controller.signal,onStage:async current=>{
  records=current;if(current.at(-1).index===6&&current.at(-1).state==='checking')controller.abort(Error('Staged cancellation fixture'));
 }}),/cancellation fixture/);
 assert.equal(h.calls.length,6);assert.equal(records.at(-1).state,'cancelled');assert.equal(records.at(-1).invocationOutcome,'response-received');
 await assert.rejects(fs.access(path.join(h.directory,'assembly/prototype-transition.json')));await assert.rejects(fs.access(path.join(h.directory,'assembly/summary.json')));
});

test('model-facing correction receives exact duplicate indices and naming budget without local renaming',async()=>{
 let rejected=false;
 const h=await setupStaged(({answer,input,options})=>{
  if(options.stageName==='prototype-role'&&input.role==='typical-floor-core'&&!rejected){
   rejected=true;const copy=structuredClone(answer.edit.components.put[0]);copy.at.offset[1]++;
   answer.edit.components.put.push(copy);
  }
  return answer;
 });
 const result=await runSceneAssembly(h.options);
 assert.equal(result.records.length,20);assert.equal(result.records[5].state,'rejected');
 const corrected=h.calls.find(c=>c.phase==='correct-prototype-role');assert.ok(corrected);
 assert.deepEqual(corrected.input.sourceIdentityPolicy.collisions,[{collection:'components',key:'id',id:'task0__a',
  firstIndex:0,repeatedIndices:[2],currentLength:8,charsRemaining:24}]);
 assert.equal(corrected.input.sourceIdentityPolicy.maximumNewSuffixLength,25);
 assert.equal(corrected.input.sourceIdentityPolicy.automaticRenaming,false);
 assert.equal(corrected.input.sourceIdentityPolicy.authorityExpanded,false);
 assert.match(corrected.instructions,/repair ALL related references/);
 const saved=JSON.parse(await fs.readFile(path.join(h.directory,'assembly/6/response.json')));
 assert.equal(saved.edit.components.put[0].id,saved.edit.components.put[2].id);
 assert.equal(result.summary.decomposition.requiredRoleStagesAccepted,4);
 assert.equal(result.summary.decomposition.canAuthorizePlacement,false);
});

test('actual staged dispatcher supplies floor responsibility instructions and source-bound surface disclosure',async()=>{
 const h=await setupStaged();const result=await runSceneAssembly(h.options);
 const blueprint=h.calls.find(c=>c.phase==='assembly-blueprint');assert.match(blueprint.instructions,/INTERIOR SURFACE RESPONSIBILITIES BEFORE FREEZE/);
 const roles=h.calls.filter(c=>c.phase==='prototype-role');assert.equal(roles.length,4);
 for(const call of roles){
  assert.match(call.instructions,/READ prototypeSurfacePolicy BEFORE CONSTRUCTING ROOMS/);
  const data=call.input.prototypeSurfacePolicy;assert.equal(data.sourceHash,call.input.sourceHash);assert.equal(data.task,call.input.task.id);
  assert.equal(data.sourceDeclarationsOnly,true);assert.equal(data.actualOwnersMustBeInspected,true);
  assert.equal(data.automaticOwnershipTransfer,false);assert.equal(data.authorityExpanded,false);assert.equal(data.canAuthorizePlacement,false);
  assert.ok(data.surfaceSources.some(v=>v.id==='main'&&!v.taskOwnsSource));
 }
 assert.equal(h.calls.length,19);assert.equal(result.summary.finalTextReviewAccepted,true);
});
