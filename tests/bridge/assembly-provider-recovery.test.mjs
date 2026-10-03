import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../../src/generation/compiler.mjs';
import {runDurableAssembly,openAssemblyJournal} from '../../bridge/assembly-durability.mjs';
import {runSceneAssembly} from '../../bridge/scene-assembly.mjs';
import {createAssemblyProviderRecovery,isAssemblyProviderRecovery,assemblyCapacityReceiptIdentity} from '../../bridge/assembly-provider-recovery.mjs';
import {decompositionPreludeProgress} from '../../bridge/assembly-decomposition-budget.mjs';
import {CodexAdapter} from '../../bridge/codex-adapter.mjs';
import {recoveryHarness,capacityMessage,recoveryModel,recoveryEffort} from './assembly-provider-recovery-fixtures.mjs';

for(const phase of ['plan','concept-review','component','review'])test('known empty capacity at '+phase+' completes the actual offline workflow in the original budget',async t=>{
  let injected=false;
  const h=await recoveryHarness(t,{choose:({stage})=>{
    if(!injected&&stage.stageName===phase){injected=true;return {failure:capacityMessage};}
  }}),result=await runDurableAssembly(h.options),journal=await h.journal();
  assert.equal(injected,true);assert.equal(h.calls.length,6);assert.equal(journal.length,6);
  assert.equal(h.transport.filter(r=>r.method==='turn/start').length,6);assert.deepEqual(h.waits,[10000]);
  assert.equal(result.summary.reservedCalls,6);assert.equal(result.summary.maximumCalls,26);
  assert.equal(result.summary.finalTextReviewAccepted,true);assert.equal(result.summary.completedPackages.length,2);
  assert.equal(result.summary.providerRecovery.retriesReserved,1);assert.equal(result.summary.providerRecovery.failedCapacityCalls,1);
  const failed=result.records.find(r=>r.invocationOutcome==='completed-empty-capacity'),next=result.records[failed.index];
  assert.equal(failed.state,'failed');assert.equal(next.state,'accepted');assert.equal(next.providerRetryOf,failed.index);
  assert.equal(journal[failed.index-1].state,'error');assert.equal(journal[next.index-1].providerRetry.failedIndex,failed.index);
  assert.equal(journal[next.index-1].providerRetry.budget.canAuthorizeRetry,false);
  const a=h.calls[failed.index-1].input,b=h.calls[next.index-1].input;
  const {providerRetryOf,providerRecovery,...original}=b;assert.deepEqual(original,a);
  const branch=h.events.find(e=>e.branch).branch;
  const canonical=JSON.parse(await fs.readFile(path.join(h.directory,branch,'assembly',String(failed.index),'input.json'),'utf8'));
  assert.equal(providerRecovery.originIndex,failed.index);assert.equal(providerRecovery.originalInputHash,hash(canonical));
  assert.equal(providerRecovery.originalModelInputHash,hash(a));
  assert.equal(result.summary.formatCorrections,0);
});

test('two distinct failing stages share one task-wide limit and wait schedule, not per-component allowances',async t=>{
  const failed=new Set();
  const h=await recoveryHarness(t,{choose:({stage})=>{
    if(['component','review'].includes(stage.stageName)&&!failed.has(stage.stageName)){
      failed.add(stage.stageName);return {failure:capacityMessage};
    }
  }}),result=await runDurableAssembly(h.options),journal=await h.journal();
  assert.equal(h.calls.length,7);assert.equal(result.summary.completedPackages.length,2);
  assert.equal(result.summary.finalTextReviewAccepted,true);assert.equal(result.summary.providerRecovery.retriesReserved,2);
  assert.deepEqual(h.waits,[10000,30000]);assert.deepEqual(journal.filter(r=>r.providerRetry).map(r=>r.providerRetry.ordinal),[1,2]);
  assert.equal(result.summary.formatCorrections,0);
});

for(const phase of ['plan','component','review'])test('closed serialization correction at '+phase+' can recover capacity without rewriting its prepared budget',async t=>{
  let target=0;
  const h=await recoveryHarness(t,{choose:({stage})=>{
    if(stage.stageName!==phase)return;
    target++;if(target===1)return {text:'{"synthetic":'};
    if(target===2)return {failure:capacityMessage};
  }}),result=await runDurableAssembly(h.options),journal=await h.journal();
  assert.equal(result.summary.finalTextReviewAccepted,true);assert.equal(result.summary.formatCorrections,1);
  assert.equal(result.summary.providerRecovery.retriesReserved,1);assert.equal(h.calls.length,7);
  const original=h.calls.find(c=>c.phase===phase),failed=h.calls.find(c=>c.phase===phase&&c.input.formatCorrection),retry=journal.find(r=>r.providerRetry);
  assert.equal(retry.providerRetry.originIndex,failed.index);
  if(phase==='plan'){
    assert.deepEqual(failed.input.callBudget,original.input.callBudget);
    assert.equal(retry.providerRetry.budget.originalBudgetCallIndex,original.index);
  }
  assert.equal(retry.providerRetry.budget.originalCallIndex,failed.index);
  assert.equal(retry.providerRetry.budget.formatCorrectionsUsed,1);
  assert.equal(retry.providerRetry.budget.reserve.formatCorrection,0);
});

test('capacity then malformed JSON then capacity uses two task retries and one distinct serialization correction',async t=>{
  const h=await recoveryHarness(t,{choose:({index})=>index===1||index===3?{failure:capacityMessage}:index===2?{text:'{"synthetic":'}:{}});
  const result=await runDurableAssembly(h.options),journal=await h.journal();
  assert.equal(result.summary.finalTextReviewAccepted,true);assert.equal(h.calls.length,8);
  assert.equal(result.summary.formatCorrections,1);assert.equal(result.summary.providerRecovery.retriesReserved,2);
  assert.deepEqual(h.waits,[10000,30000]);assert.deepEqual(journal.slice(0,4).map(r=>r.state),['error','error','error','response']);
  assert.equal(journal[1].providerRetry.originIndex,1);assert.equal(journal[3].providerRetry.originIndex,3);
  assert.equal(journal[3].providerRetry.budget.originalBudgetCallIndex,1);
  assert.deepEqual(h.calls[3].input.callBudget,h.calls[0].input.callBudget);
  const before=structuredClone(journal);
  await runDurableAssembly({...h.options,invoke:async()=>assert.fail('No new provider call on intertwined replay'),wait:async()=>assert.fail('No new wait')});
  assert.deepEqual(await h.journal(),before);
});

test('three consecutive empty capacity failures retain all three reservations and stop without a fourth dispatch',async t=>{
  const h=await recoveryHarness(t,{choose:()=>({failure:capacityMessage})});
  await assert.rejects(runDurableAssembly(h.options),e=>e.message===capacityMessage);
  const journal=await h.journal();assert.equal(journal.length,3);assert.equal(h.calls.length,3);
  assert.deepEqual(journal.map(r=>r.state),['error','error','error']);assert.deepEqual(h.waits,[10000,30000]);
  const dirs=h.events.filter(e=>e.branch).map(e=>e.branch),branch=path.join(h.directory,dirs[0],'assembly');
  const stopped=JSON.parse(await fs.readFile(path.join(branch,'3/provider-recovery.json'),'utf8'));
  assert.equal(stopped.canContinue,false);assert.equal(stopped.budget.stopReason,'provider-recovery-limit');
  await assert.rejects(runDurableAssembly({...h.options,invoke:async()=>assert.fail('No fourth dispatch')}),e=>e.message===capacityMessage);
  assert.equal((await h.journal()).length,3);
});

test('insufficient tail capacity stops after the original failed call rather than shrinking packages or enlarging the limit',async t=>{
  const h=await recoveryHarness(t,{requestDelta:{assemblyCalls:5},choose:()=>({failure:capacityMessage})});
  await assert.rejects(runDurableAssembly(h.options),e=>e.message===capacityMessage);
  assert.equal(h.calls.length,1);assert.equal((await h.journal()).length,1);assert.deepEqual(h.waits,[]);
  assert.equal(h.options.policy.assembly.maximumCalls,5);
  const event=h.events.find(e=>e.branch),data=JSON.parse(await fs.readFile(path.join(h.directory,event.branch,'assembly/1/provider-recovery.json'),'utf8'));
  assert.equal(data.budget.stopReason,'protected-complete-path-unfunded');assert.equal(data.canContinue,false);
});

test('legacy safe request remains a one-failure stop, despite the new execution controller being present in the runtime',async t=>{
  const h=await recoveryHarness(t,{enabled:false,choose:()=>({failure:capacityMessage})});
  assert.equal(h.options.policy.assembly.providerRetries,0);
  await assert.rejects(runDurableAssembly(h.options),e=>e.message===capacityMessage);
  assert.equal(h.calls.length,1);assert.equal((await h.journal()).length,1);assert.deepEqual(h.waits,[]);
});

test('standalone or forged controllers cannot enable capacity recovery without the durable new-task runner',async t=>{
  const h=await recoveryHarness(t);assert.equal(isAssemblyProviderRecovery({prepare(){},beforeInvocation(){}}),false);
  for(const providerRecovery of [undefined,null,{prepare(){},beforeInvocation(){}}])
    await assert.rejects(runSceneAssembly({...h.options,providerRecovery}),/same durable new-task runner/);
  assert.equal(h.calls.length,0);
  const journal=await openAssemblyJournal(h.options);
  assert.throws(()=>createAssemblyProviderRecovery({...h.options,journal,model:undefined}),/selected model and effort/);
  assert.throws(()=>createAssemblyProviderRecovery({...h.options,journal,runtimeHash:'unknown-runtime'}),/identity/);
});

test('cancelling during the recovery wait retains the original failed receipt and does not reserve or dispatch a retry',async t=>{
  const h=await recoveryHarness(t,{choose:()=>({failure:capacityMessage})});
  const wait=async(ms,value,{signal})=>{assert.equal(ms,10000);h.controller.abort();signal.throwIfAborted();};
  await assert.rejects(runDurableAssembly({...h.options,wait}),e=>e.name==='AbortError');
  assert.equal(h.calls.length,1);assert.equal((await h.journal()).length,1);
  assert.equal(h.events.some(e=>e.state==='provider-capacity-wait'),true);
});

for(const change of [{failure:'Synthetic ordinary provider error'},
  {failure:capacityMessage,text:'{"partial":'},{failure:capacityMessage,text:' '},
  {failure:capacityMessage,commentary:true},{unknown:true}])test('unqualified outcome '+JSON.stringify(change)+' never obtains capacity retry authority',async t=>{
  const h=await recoveryHarness(t,{choose:()=>change});
  await assert.rejects(runDurableAssembly(h.options));assert.equal(h.calls.length,1);
  const journal=await h.journal();assert.equal(journal.length,1);assert.deepEqual(h.waits,[]);
  assert.equal(journal[0].providerRetry,undefined);
  await assert.rejects(runDurableAssembly({...h.options,invoke:async()=>assert.fail('Unknown/ordinary outcome cannot be resent')}));
  assert.equal(h.calls.length,1);assert.equal((await h.journal()).length,1);
});

test('changing private receipt bytes during the wait prevents the next reservation and dispatch',async t=>{
  const h=await recoveryHarness(t,{choose:()=>({failure:capacityMessage})});
  const wait=async()=>{
    const [failed]=await h.journal(),folder=failed.error.diagnostic.responseEvidence.directory;
    await fs.writeFile(path.join(h.directory,folder,'answer-1.txt'),'changed after proof');
  };
  await assert.rejects(runDurableAssembly({...h.options,wait}),/capacity turn has output/);
  assert.equal(h.calls.length,1);assert.equal((await h.journal()).length,1);
});

test('a changed original receipt after the wait is checked again at the durable dispatch boundary',async t=>{
  let injected=false;
  const h=await recoveryHarness(t,{choose:()=>({failure:capacityMessage})});
  const onStage=async records=>{
    if(!injected&&records.at(-1).providerRetryOf===1&&records.at(-1).state==='reserved'){
      injected=true;const [failed]=await h.journal(),folder=failed.error.diagnostic.responseEvidence.directory;
      const file=path.join(h.directory,folder,'receipt.json'),receipt=JSON.parse(await fs.readFile(file,'utf8'));
      receipt.requestHash=hash('changed immediately before retry');await fs.writeFile(file,JSON.stringify(receipt));
    }
  };
  await assert.rejects(runDurableAssembly({...h.options,onStage}),/private receipt differs/);
  assert.equal(injected,true);assert.equal(h.calls.length,1);assert.equal((await h.journal()).length,1);
});

test('saved full recovery replay reads the exact cached retry chain without new waits, reservations or provider calls',async t=>{
  let failed=false;const h=await recoveryHarness(t,{choose:()=>{if(!failed){failed=true;return {failure:capacityMessage};}}});
  const first=await runDurableAssembly(h.options),before=await h.journal();assert.equal(h.calls.length,6);
  const second=await runDurableAssembly({...h.options,invoke:async()=>assert.fail('No new call on completed replay'),
    wait:async()=>assert.fail('Existing retry is not a new fee authorization')});
  assert.equal(hash(first.scene),hash(second.scene));assert.equal(second.summary.reservedCalls,6);
  assert.deepEqual(await h.journal(),before);assert.equal(h.calls.length,6);
  assert.equal(h.events.some(e=>e.state==='provider-capacity-replay'),true);
});

test('receipt persistence followed by local I/O failure replays the recovery without charging or waiting twice',async t=>{
  let failed=false,io=false;const h=await recoveryHarness(t,{choose:()=>{if(!failed){failed=true;return {failure:capacityMessage};}}});
  const result=await runDurableAssembly({...h.options,onStage:async records=>{
    if(!io&&records.at(-1).providerRetryOf===1&&records.at(-1).state==='checking'){
      io=true;throw Object.assign(Error('Synthetic local receipt checkpoint lock'),{code:'EBUSY'});
    }
  }});
  assert.equal(io,true);assert.equal(h.calls.length,6);assert.equal((await h.journal()).length,6);
  assert.deepEqual(h.waits,[10000]);assert.equal(result.summary.finalTextReviewAccepted,true);
});

test('an unknown newly reserved recovery remains pending and is not resent on another durable run',async t=>{
  const h=await recoveryHarness(t,{choose:({index})=>index===1?{failure:capacityMessage}:index===2?{unknown:true}:{}});
  await assert.rejects(runDurableAssembly(h.options),/observer lost/);
  const before=await h.journal();assert.equal(before.length,2);assert.equal(before[1].state,'pending');
  assert.equal(before[1].providerRetry.ordinal,1);assert.equal(h.calls.length,2);
  await assert.rejects(runDurableAssembly({...h.options,invoke:async()=>assert.fail('Pending original recovery cannot be resent'),
    wait:async()=>assert.fail('Pending existing call is read only')}),/provider receipt unknown/);
  assert.deepEqual(await h.journal(),before);assert.equal(h.calls.length,2);
});

for(const status of ['completed','failed','interrupted'])test('pending recovery reads only its exact original closed '+status+' turn before any further work',async t=>{
  const h=await recoveryHarness(t,{choose:({index})=>index===1?{failure:capacityMessage}:index===2?{unknown:true}:{}});
  await assert.rejects(runDurableAssembly(h.options),/observer lost/);
  const pending=(await h.journal())[1],reads=[],original=h.calls[1];
  const reader=new CodexAdapter({observationIntervalMs:5});
  reader.connect=async()=>assert.fail('No writer connection to recover a receipt');
  reader.request=async()=>assert.fail('No new turn, resume, steer or interrupt');
  reader.readStoredTurn=async identity=>{
    reads.push(identity);assert.deepEqual(identity,{threadId:pending.providerBinding.threadId,turnId:pending.providerBinding.turnId});
    return {thread:{id:identity.threadId,ephemeral:false,turns:[{id:identity.turnId,status,startedAt:1,completedAt:2,itemsView:'full',
      ...(status==='failed'?{error:{message:capacityMessage}}:{}),items:[{type:'userMessage',content:[{type:'text',text:original.prompt}]},
        ...(status==='completed'?[{type:'agentMessage',phase:'final_answer',text:JSON.stringify(original.answer)}]:[])]}]}};
  };
  const options={...h.options,recoverInvocation:async(prompt,index,stage,binding)=>{
    assert.equal(index,2);assert.equal(prompt,original.prompt);
    return (await reader.recoverOriginal({binding,prompt,model:recoveryModel,effort:recoveryEffort,cwd:h.directory,
      outputSchema:stage.outputSchema,images:stage.images,signal:h.controller.signal})).spec;
  }};
  if(status==='interrupted'){
    await assert.rejects(runDurableAssembly(options),/interrupted/);assert.equal(h.calls.length,2);
    assert.equal((await h.journal()).length,2);assert.deepEqual(h.waits,[10000]);
  }else{
    const result=await runDurableAssembly(options),journal=await h.journal();
    assert.equal(result.summary.finalTextReviewAccepted,true);assert.equal(h.calls.length,status==='failed'?7:6);
    assert.equal(journal[1].reservedAt,pending.reservedAt);assert.deepEqual(journal[1].providerBinding,pending.providerBinding);
    assert.equal(journal[1].state,status==='failed'?'error':'response');
    assert.deepEqual(h.waits,status==='failed'?[10000,30000]:[10000]);
    assert.equal(result.summary.providerRecovery.retriesReserved,status==='failed'?2:1);
  }
  assert.equal(reads.length,1);assert.equal(h.transport.filter(r=>r.method==='turn/start'&&r.index===2).length,1);
});

test('a rehashed existing recovery marker cannot be rebound to a different ordinal or failed stage',async t=>{
  let failed=false;const h=await recoveryHarness(t,{choose:()=>{if(!failed){failed=true;return {failure:capacityMessage};}}});
  await runDurableAssembly(h.options);const file=path.join(h.directory,'assembly-journal/call-2.json'),original=await fs.readFile(file);
  for(const change of [v=>v.ordinal=2,v=>v.failedIndex=0,v=>v.originIndex=2,v=>v.originalInputHash=hash('changed'),
    v=>v.schemaHash=hash('changed'),v=>v.waitMs=0,v=>v.budget.protectedPackageCeiling=2]){
    const envelope=JSON.parse(original);change(envelope.value.providerRetry);envelope.sha256=hash(envelope.value);
    await fs.writeFile(file,JSON.stringify(envelope));
    await assert.rejects(runDurableAssembly({...h.options,invoke:async()=>assert.fail('Changed marker cannot dispatch'),
      wait:async()=>assert.fail('Changed marker cannot wait')}),/saved recovery relationship changed/);
    await fs.writeFile(file,original);
  }
  assert.equal(h.calls.length,6);
});

test('ordinary journal users cannot supply recovery metadata to bypass the verified capacity dispatcher',async t=>{
  const h=await recoveryHarness(t),journal=await openAssemblyJournal(h.options);
  await assert.rejects(journal.invoke('unverified synthetic retry',1,{stageName:'plan',stageCount:26,images:[],outputSchema:{},providerRetry:{failedIndex:0}},
    async()=>assert.fail('No dispatch')),/verified original capacity authority/);
  assert.equal(journal.reserved,0);
});

test('capacity identity excludes only live ledger counters, not the original receipt or any authority field',()=>{
  const data={kind:'synthetic-read-only-proof',originalReceiptVerified:true,canAuthorizeRetry:false,canAuthorizePlacement:false,
    additionalModelCalls:0,reservedCalls:1,dispatchedCalls:1,journalReceiptHash:hash('original')};
  const proof={...data,proofHash:hash(data)},later={...data,reservedCalls:26,dispatchedCalls:26};
  assert.equal(assemblyCapacityReceiptIdentity(proof),assemblyCapacityReceiptIdentity({...later,proofHash:hash(later)}));
  assert.throws(()=>assemblyCapacityReceiptIdentity({...proof,canAuthorizeRetry:true}));
  assert.throws(()=>assemblyCapacityReceiptIdentity({...proof,journalReceiptHash:hash('changed')}));
});

test('a capacity-looking prelude state alone still cannot permit decomposition progress',()=>{
  const failed={index:1,phase:'reference-analysis',state:'failed',invocationOutcome:'completed-empty-capacity',decompositionStageId:'reference-analysis'},
    accepted={index:2,phase:'reference-analysis',state:'accepted',decompositionStageId:'reference-analysis',providerRetryOf:1};
  assert.throws(()=>decompositionPreludeProgress({referenceAnalysis:{requiredCalls:1}},[failed,accepted]),/accepted durable reference prelude/);
  assert.throws(()=>decompositionPreludeProgress({referenceAnalysis:{requiredCalls:1}},[failed,accepted],()=>undefined));
});

test('staged native workflow retains all candidates, four ordered prototype roles, detail packages and final review after capacity recovery',async t=>{
  let failed=false;const h=await recoveryHarness(t,{staged:true,choose:({stage})=>{
    if(!failed&&stage.stageName==='prototype-role'){failed=true;return {failure:capacityMessage};}
  }}),result=await runDurableAssembly(h.options);
  assert.equal(h.calls.length,17);assert.equal((await h.journal()).length,17);
  assert.equal(result.scene.bounds.height,224);assert.equal(result.summary.completedPackages.length,5);
  assert.equal(result.summary.decomposition.requiredRoleStagesAccepted,4);assert.equal(result.summary.finalTextReviewAccepted,true);
  const repeated=h.calls.filter(c=>c.input.role==='typical-floor-core');assert.equal(repeated.length,2);
  assert.deepEqual(repeated[1].input.prototypeCorrectionBudget,repeated[0].input.prototypeCorrectionBudget);
  assert.deepEqual(repeated[1].input.prototypeState,repeated[0].input.prototypeState);
  assert.equal(result.records.filter(r=>r.phase==='correct-prototype-role').length,0);
  assert.equal(result.summary.providerRecovery.retriesReserved,1);
});

for(const phase of ['concept-candidate','select-concept','assembly-blueprint','concept-review','review'])
test('staged '+phase+' recovers and replays its exact native attachments and complete responsibilities',async t=>{
  let failed=false;const h=await recoveryHarness(t,{staged:true,choose:({stage,input})=>{
    if(!failed&&stage.stageName===phase&&(phase!=='concept-candidate'||input.slot===2)){
      failed=true;return {failure:capacityMessage};
    }
  }}),first=await runDurableAssembly(h.options),journal=await h.journal();
  assert.equal(failed,true);assert.equal(h.calls.length,17);assert.equal(first.summary.completedPackages.length,5);
  assert.equal(first.summary.decomposition.requiredRoleStagesAccepted,4);assert.equal(first.summary.finalTextReviewAccepted,true);
  const retry=journal.find(r=>r.providerRetry),before=h.calls[retry.providerRetry.failedIndex-1],after=h.calls[retry.index-1];
  assert.deepEqual(after.images,before.images);assert.equal(after.images.length>0,['select-concept','concept-review','review'].includes(phase));
  const second=await runDurableAssembly({...h.options,invoke:async()=>assert.fail('No new call on native replay'),wait:async()=>assert.fail('No new wait')});
  assert.equal(hash(second.scene),hash(first.scene));assert.deepEqual(await h.journal(),journal);assert.equal(h.calls.length,17);
});

test('two empty failures of the same staged role preserve its four-role ordering and correction budget',async t=>{
  let failed=0;const h=await recoveryHarness(t,{staged:true,choose:({stage,input})=>{
    if(stage.stageName==='prototype-role'&&input.role==='facade-corner'&&failed++<2)return {failure:capacityMessage};
  }}),result=await runDurableAssembly(h.options),journal=await h.journal();
  assert.equal(h.calls.length,18);assert.equal(result.summary.providerRecovery.retriesReserved,2);
  assert.equal(result.summary.decomposition.requiredRoleStagesAccepted,4);assert.equal(result.summary.completedPackages.length,5);
  const retries=journal.filter(r=>r.providerRetry);assert.equal(retries[1].providerRetry.originIndex,retries[0].providerRetry.originIndex);
  const roleCalls=h.calls.filter(c=>c.input.role==='facade-corner');assert.equal(roleCalls.length,3);
  for(const c of roleCalls.slice(1))assert.deepEqual(c.input.prototypeCorrectionBudget,roleCalls[0].input.prototypeCorrectionBudget);
  assert.equal(result.records.filter(r=>r.phase==='correct-prototype-role').length,0);
});
