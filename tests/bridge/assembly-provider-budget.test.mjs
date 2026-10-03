import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyProviderRecoveryPolicy,validateAssemblyProviderRecoveryPolicy} from '../../contracts/assembly-provider-recovery.mjs';
import {assemblyProviderRecoveryBudget} from '../../bridge/assembly-provider-budget.mjs';
import {assemblyCallBudget,conceptRevisionBudget} from '../../bridge/assembly-budget.mjs';
import {decompositionBlueprintBudget,decompositionConfiguration} from '../../bridge/assembly-decomposition-budget.mjs';
import {decompositionTailBudget,decompositionRoleCorrectionBudget,decompositionRevisionBudget} from '../../bridge/assembly-decomposed-stages.mjs';
import {PROTOTYPE_ROLES} from '../../contracts/scene-decomposition-roles.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {referenceAssemblyPreflight} from '../../bridge/reference-assembly-policy.mjs';
import {runSceneAssembly} from '../../bridge/scene-assembly.mjs';
import {stagedRequest,setupStaged} from './decomposed-assembly-fixtures.mjs';

// A synthetic future authority snapshot ONLY for mathematical tests. The new
// contract is not wired to production preflight/UI or a provider dispatcher.
const request={agent:'codex',model:'offline',prompt:'离线容量预算测试',generationMode:'scene',sceneWorkflow:'components',
  qualityTier:'ultra',assemblyConfirmed:true,assemblyRecovery:'safe',maxRepairs:0};
const enable=tier=>({...structuredClone(tier),providerRetries:2,providerRecovery:assemblyProviderRecoveryPolicy()});
const tier=(delta={})=>enable(generationPreflight({...request,...delta}).assembly);
const staged=(delta={})=>enable(generationPreflight({...stagedRequest,...delta}).assembly);
const reference=(delta={})=>enable(referenceAssemblyPreflight({...request,...delta}).assembly);
const packages=n=>Array.from({length:n},(_,i)=>'task'+i);
const records=n=>Array.from({length:n},()=>({}));
const calculate=values=>assemblyProviderRecoveryBudget(values);
const future=failure=>1+failure.requiredAfterCall+failure.protectedHeadroom;
const tail=(tier,index,n)=>decompositionTailBudget(tier,records(index-1),n);
const candidate=(t,index=1,slot=1)=>{
  const count=decompositionBlueprintBudget(decompositionConfiguration(t)).maximumPackages;
  return {tier:t,phase:'concept-candidate',reservedCalls:index,input:{tier:t,slot,totalCandidates:t.prototypes.candidateCount,
    candidateId:'concept-'+slot,decompositionStageId:'concept-'+slot,decompositionBudget:tail(t,index,t.prototypes.candidateCount-slot+8+count)}};
};
const blueprint=(t,index=5)=>{
  const callBudget=decompositionBlueprintBudget(decompositionConfiguration(t),{reservedCalls:index-1,
    completedCandidates:t.prototypes.candidateCount,selectionAccepted:true,...(t.referenceAnalysis?{completedPrelude:1}:{})});
  return {tier:t,phase:'assembly-blueprint',reservedCalls:index,input:{tier:t,callBudget,
    decompositionStageId:'blueprint',decompositionBudget:tail(t,index,6+callBudget.maximumPackages)}};
};
const role=(t,index=6,roleIndex=0,correction=0)=>{
  const packageIds=packages(t.maxPackages),roleTasks=packageIds.slice(0,4);
  const prototypeCorrectionBudget=decompositionRoleCorrectionBudget(t,records(index-1),{roleIndex,packageCount:t.maxPackages,correction});
  return {tier:t,phase:correction?'correct-prototype-role':'prototype-role',reservedCalls:index,packageIds,input:{tier:t,
    role:PROTOTYPE_ROLES[roleIndex],task:{id:roleTasks[roleIndex]},prototypeCorrectionBudget,
    prototypeState:{roles:PROTOTYPE_ROLES.map((role,i)=>({role,task:roleTasks[i]})),completedRoles:PROTOTYPE_ROLES.slice(0,roleIndex)},
    decompositionStageId:PROTOTYPE_ROLES[roleIndex],decompositionBudget:tail(t,index,prototypeCorrectionBudget.requiredAfterCall)}};
};
const plan=(t,index=1,phase='plan')=>({tier:t,phase,reservedCalls:index,input:{tier:t,
  callBudget:assemblyCallBudget(t,records(index-1))}});
const component=(t,index=4,done=0)=>{
  const packageIds=packages(t.maxPackages),completedPackages=packageIds.slice(0,done);
  return {tier:t,phase:'component',reservedCalls:index,packageIds,completedPackages,
    input:{tier:t,task:{id:packageIds[done]},completedPackages}};
};
const review=(t,index=15,phase='review')=>{
  const packageIds=packages(t.maxPackages);
  return {tier:t,phase,reservedCalls:index,packageIds,completedPackages:[...packageIds],
    input:{tier:t,packages:packageIds.map(id=>({id}))}};
};

test('recovery contract is exact, isolated and has no budget, model, scope or unknown-outcome expansion',()=>{
  const p=assemblyProviderRecoveryPolicy();
  assert.deepEqual(p,{version:1,mode:'bounded',provider:'codex',maximumRetries:2,waitMs:[10000,30000],
    unknownOutcomeRetries:0,partialOutputRetries:0,increaseCallLimit:false,changeModel:false,refundFailedCalls:false,shrinkRequiredScope:false});
  assert.deepEqual(validateAssemblyProviderRecoveryPolicy(p),p);
  p.waitMs[0]=0;p.maximumRetries=99;assert.deepEqual(assemblyProviderRecoveryPolicy().waitMs,[10000,30000]);
  const result=validateAssemblyProviderRecoveryPolicy(assemblyProviderRecoveryPolicy());result.waitMs[1]=0;
  assert.equal(assemblyProviderRecoveryPolicy().waitMs[1],30000);
  assert.deepEqual(validateAssemblyProviderRecoveryPolicy(Object.assign(Object.create(null),assemblyProviderRecoveryPolicy())),assemblyProviderRecoveryPolicy());
});

test('policy validator refuses every modified/deleted field and additional authority',()=>{
  const source=assemblyProviderRecoveryPolicy();
  for(const key of Object.keys(source)){
    const deleted=structuredClone(source);delete deleted[key];assert.throws(()=>validateAssemblyProviderRecoveryPolicy(deleted));
    for(const value of [null,'automatic',true,999,[],{}]){
      const changed={...source,[key]:value};if(hash(changed)===hash(source))continue;
      assert.throws(()=>validateAssemblyProviderRecoveryPolicy(changed));
    }
  }
  for(const value of [null,[],{...source,refund:true},{...source,waitMs:[10000,30000,0]},Object.create(source)])
    assert.throws(()=>validateAssemblyProviderRecoveryPolicy(value));
});

test('equal-looking policy hashes cannot smuggle array options, accessors, symbols or non-enumerable authority',()=>{
  const cases=[p=>p.waitMs.refund=true,p=>p[Symbol('authority')]=true,p=>Object.defineProperty(p,'hidden',{value:true}),
    p=>Object.defineProperty(p,'maximumRetries',{get(){throw Error('Getter must not run');},enumerable:true}),
    p=>Object.defineProperty(p.waitMs,'0',{get(){throw Error('Getter must not run');},enumerable:true}),
    p=>Object.setPrototypeOf(p.waitMs,[]),p=>p.waitMs=new Array(2),
    p=>Object.defineProperty(p,'provider',{value:'codex',enumerable:false})];
  for(const change of cases){const p=assemblyProviderRecoveryPolicy();change(p);
    assert.throws(()=>validateAssemblyProviderRecoveryPolicy(p),/Unsupported explicit/);}
});

test('existing preflights stay disabled, including safe staged and reference tasks; no legacy policy is upgraded',()=>{
  for(const t of [generationPreflight(request).assembly,generationPreflight(stagedRequest).assembly,
    referenceAssemblyPreflight({...stagedRequest,agent:'codex',model:'offline'}).assembly]){
    const before=structuredClone(t);assert.equal(t.providerRetries,0);assert.equal(t.providerRecovery,undefined);
    const b=calculate({tier:t,phase:'not-a-stage',reservedCalls:0,input:null});
    assert.equal(b.enabled,false);assert.equal(b.canStart,false);assert.equal(b.stopReason,'provider-recovery-disabled');
    assert.equal(b.additionalModelCalls,0);assert.equal(b.canAuthorizeRetry,false);assert.equal(b.canAuthorizePlacement,false);
    assert.deepEqual(t,before);
  }
});

test('pure plan scheduling counts the failed call and returns no invocation or placement authority',()=>{
  const args=plan(tier()),before=structuredClone(args),b=calculate(args);
  assert.equal(b.maximumCalls,26);assert.equal(b.reservedCalls,1);assert.equal(b.remaining,25);
  assert.equal(b.protectedPackageCeiling,16);assert.equal(b.requiredAfterCall,17);
  assert.equal(b.protectedHeadroom,4);assert.equal(b.mandatoryCalls,22);assert.equal(b.canStart,true);
  assert.equal(b.additionalModelCalls,0);assert.equal(b.canAuthorizeRetry,false);assert.equal(b.canAuthorizePlacement,false);
  assert.deepEqual(args,before);b.remainingPackageIds.push('newTask');assert.deepEqual(args,before);
});

for(const phase of ['plan','correct-plan','repair-plan'])test(phase+' preserves the original allowed package ceiling, not a cheaper two-package substitute',()=>{
  const args=plan(tier({assemblyDesignReview:'text'}),2,phase),b=calculate(args);
  assert.equal(b.protectedPackageCeiling,args.input.callBudget.maximumPackages);
  assert.equal(b.requiredAfterCall,b.protectedPackageCeiling+2);
  assert.equal(b.originalCallBudgetHash,hash(args.input.callBudget));
  assert.equal(b.mandatoryCalls,future(b));
});

for(const phase of ['revise-design','correct-design'])test(phase+' binds unchanged original callBudget and revision context',()=>{
  const t=tier({assemblyDesignReview:'text'}),input={tier:t,
    callBudget:conceptRevisionBudget(t,records(4),{round:0,packageCount:5}),
    designRevisionContext:{version:1,budgetOutlook:{remainingCalls:22,maximumPackages:11}}};
  const before=structuredClone(input),b=calculate({tier:t,phase,input,reservedCalls:5});
  assert.equal(b.protectedPackageCeiling,input.callBudget.maximumPackages);
  assert.equal(b.originalCallBudgetHash,hash(input.callBudget));assert.equal(b.originalRevisionContextHash,hash(input.designRevisionContext));
  assert.deepEqual(input,before);
});

for(const phase of ['concepts','correct-concepts'])test(phase+' protects the prospective original plan ceiling and its full design/review path',()=>{
  const t=tier({assemblyDesignReview:'native',assemblyQuality:'v4'}),args={tier:t,phase,input:{tier:t},reservedCalls:1};
  const expected=assemblyCallBudget(t,records(2)).maximumPackages,b=calculate(args);
  assert.equal(b.protectedPackageCeiling,expected);assert.equal(b.requiredAfterCall,1+1+expected+2);
  assert.equal(b.canStart,true);assert.ok(expected>2);
});

test('non-staged selection protects future planning, not just the minimum package count',()=>{
  const t=tier({assemblyDesignReview:'native',assemblyQuality:'v4'}),b=calculate({tier:t,phase:'select-concept',input:{},reservedCalls:2});
  assert.equal(b.protectedPackageCeiling,assemblyCallBudget(t,records(2)).maximumPackages);
  assert.equal(b.requiredAfterCall,1+b.protectedPackageCeiling+2);
});

test('ordinary reference prelude protects all originally permitted plan packages despite its small declared tail',()=>{
  for(const delta of [{},{assemblyDesignReview:'text'},{assemblyDesignReview:'native',assemblyQuality:'v4'}]){
    const t=reference(delta),index=1,quality=[3,4].includes(t.quality?.version),declared=quality?7:t.designReview?5:4;
    const input={decompositionStageId:'reference-analysis',decompositionBudget:tail(t,index,declared)};
    for(const phase of ['reference-analysis','correct-reference-analysis']){
      const b=calculate({tier:t,phase,input,reservedCalls:index});
      assert.equal(b.protectedPackageCeiling,assemblyCallBudget(t,records(index+(quality?2:0))).maximumPackages);
      assert.equal(b.requiredAfterCall,(quality?2:0)+1+b.protectedPackageCeiling+(t.designReview?2:1));
      assert.ok(b.requiredAfterCall>=declared);
    }
  }
});

test('reference/candidate prospective budget accounts for consumed format corrections without null-record crashes',()=>{
  const t=reference({assemblyDesignReview:'native',assemblyQuality:'v4'}),index=2;
  const args={tier:t,phase:'correct-reference-analysis',reservedCalls:index,formatCorrectionsUsed:1,
    input:{decompositionStageId:'reference-analysis',decompositionBudget:tail(t,index,7),formatCorrection:{stage:1}}};
  const prefix=records(index+2);prefix[0].formatCorrectionOf=1;
  const b=calculate(args);assert.equal(b.protectedPackageCeiling,assemblyCallBudget(t,prefix).maximumPackages);
  assert.equal(b.reserve.formatCorrection,0);assert.equal(b.originalFormatCorrectionsUsed,1);
});

test('a longer replay journal consumes real remaining calls but does not rewrite the original prospective plan ceiling',()=>{
  const t=tier({assemblyDesignReview:'native',assemblyQuality:'v4'}),args={tier:t,phase:'concepts',input:{tier:t},reservedCalls:1};
  const original=calculate(args),later=calculate({...args,reservedCalls:4,originalCallIndex:1,originalFormatCorrectionsUsed:0,
    providerRetriesUsed:1,formatCorrectionsUsed:1});
  assert.equal(later.protectedPackageCeiling,original.protectedPackageCeiling);
  assert.equal(later.requiredAfterCall,original.requiredAfterCall);assert.equal(later.remaining,22);
  assert.equal(later.reserve.formatCorrection,0);assert.equal(later.originalInputHash,original.originalInputHash);
  assert.equal(later.originalCallIndex,1);assert.equal(later.reservedCalls,4);
});

for(const phase of ['concept-candidate','correct-concept-candidate'])test(phase+' protects remaining independent candidates, four roles, every package and both reviews',()=>{
  const t=staged();
  for(let slot=1;slot<=3;slot++){
    const args={...candidate(t,slot,slot),phase},b=calculate(args);
    assert.equal(b.protectedPackageCeiling,t.maxPackages);assert.equal(b.requiredRoleCalls,4);
    assert.equal(b.requiredAfterCall,3-slot+8+t.maxPackages);assert.equal(b.canStart,true);
  }
});

test('staged selection retains the original complete-building ceiling without dropping any prototype role',()=>{
  const t=staged(),index=4,input={decompositionStageId:'selection',decompositionBudget:tail(t,index,7+t.maxPackages)};
  const b=calculate({tier:t,phase:'select-concept',input,reservedCalls:index});
  assert.equal(b.requiredRoleCalls,4);assert.equal(b.requiredAfterCall,7+t.maxPackages);assert.equal(b.canStart,true);
});

test('staged reference profile keeps its shared prelude, candidates and all mandatory construction responsibilities',()=>{
  const t=enable(referenceAssemblyPreflight({...stagedRequest,agent:'codex',model:'offline'}).assembly),index=1;
  const b=calculate({tier:t,phase:'reference-analysis',reservedCalls:index,input:{decompositionStageId:'reference-analysis',
    decompositionBudget:tail(t,index,3+8+t.maxPackages)}});
  assert.equal(b.protectedPackageCeiling,t.maxPackages);assert.equal(b.requiredAfterCall,3+8+t.maxPackages);
  assert.equal(b.requiredRoleCalls,4);assert.equal(b.canStart,true);
  assert.equal(calculate(blueprint(t,6)).protectedPackageCeiling,t.maxPackages);
});

for(const phase of ['assembly-blueprint','correct-blueprint'])test(phase+' preserves the exact original decomposition allocation',()=>{
  const args={...blueprint(staged()),phase},b=calculate(args);
  assert.equal(b.protectedPackageCeiling,args.input.callBudget.maximumPackages);
  assert.equal(b.requiredRoleCalls,4);assert.equal(b.requiredAfterCall,b.protectedPackageCeiling+6);
  assert.equal(b.originalCallBudgetHash,hash(args.input.callBudget));assert.equal(b.canStart,true);
});

for(const phase of ['prototype-role','correct-prototype-role'])test(phase+' validates the ordered role progress and retains every later role/package/review',()=>{
  const t=staged();
  for(let index=0;index<4;index++){
    const args=role(t,6+index+(phase==='correct-prototype-role'?1:0),index,phase==='correct-prototype-role'?1:0),b=calculate(args);
    assert.equal(b.requiredRoleCalls,3-index);assert.equal(b.protectedPackageCeiling,t.maxPackages);
    assert.equal(b.requiredAfterCall,3-index+t.maxPackages+2);assert.equal(b.protectedHeadroom,4);
    assert.equal(b.canStart,true);
  }
});

test('staged architectural revisions retain the same frozen responsibility ceiling and final review path',()=>{
  const t=staged(),index=12,input={tier:t,callBudget:decompositionRevisionBudget(t,records(index-1),{round:0,packageCount:t.maxPackages})};
  for(const phase of ['revise-design','correct-design']){
    const b=calculate({tier:t,phase,reservedCalls:index,input});
    assert.equal(b.protectedPackageCeiling,t.maxPackages);assert.equal(b.requiredAfterCall,t.maxPackages+2);
    assert.equal(b.originalCallBudgetHash,hash(input.callBudget));
  }
});

for(const phase of ['concept-review','correct-concept-review'])test(phase+' funds every actual unconstructed package plus the final review',()=>{
  const t=staged(),packageIds=packages(t.maxPackages),b=calculate({tier:t,phase,reservedCalls:10,packageIds,input:{tier:t}});
  assert.equal(b.requiredAfterCall,packageIds.length+1);assert.equal(b.pendingFirstConstruction,packageIds.length);
  assert.equal(b.reserve.componentCorrections,2);assert.equal(b.canStart,true);
});

for(const phase of ['component','correct-component'])test(phase+' retains pending first construction and one shared geometry reserve, not per-package reserves',()=>{
  const t=staged();
  for(let done=0;done<t.maxPackages;done++){
    const args={...component(t,11+done,done),phase},b=calculate(args);
    assert.equal(b.requiredAfterCall,t.maxPackages-done);assert.equal(b.pendingFirstConstruction,t.maxPackages-done);
    assert.equal(b.reserve.componentCorrections,2);assert.equal(b.protectedHeadroom,4);
    assert.deepEqual(b.remainingPackageIds,args.packageIds.slice(done));assert.equal(b.canStart,true);
  }
});

for(const phase of ['refine-component','correct-component','refine-coordinated'])test(phase+' cannot fund an optional edit by consuming its subsequent final review',()=>{
  const args=review(staged(),20),input={tier:args.tier,refinement:true,task:{id:args.packageIds[0]}};
  const b=calculate({...args,phase,input});
  assert.equal(b.requiredAfterCall,1);assert.equal(b.pendingFirstConstruction,0);assert.equal(b.reserve.componentCorrections,0);
  assert.equal(b.protectedHeadroom,2);assert.equal(b.mandatoryCalls,4);assert.equal(b.canStart,true);
  assert.equal(calculate({...args,phase,input,reservedCalls:23}).canStart,false);
});

for(const phase of ['review','correct-review'])test(phase+' requires the full package set and protects the remaining format/contract allowance',()=>{
  const args=review(staged(),24,phase),b=calculate(args);
  assert.equal(b.requiredAfterCall,0);assert.equal(b.protectedHeadroom,phase==='correct-review'?1:2);
  assert.equal(b.canStart,phase==='correct-review');
  assert.equal(calculate({...args,reservedCalls:25,formatCorrectionsUsed:1}).canStart,phase==='correct-review');
});

test('capacity retry limit is task-wide and failed reservations are never refunded',()=>{
  const args=review(staged(),20);
  for(let used=0;used<=2;used++){
    const b=calculate({...args,providerRetriesUsed:used});assert.equal(b.reservedCalls,20);assert.equal(b.remaining,6);
    assert.equal(b.maximumCalls,26);assert.equal(b.canStart,used<2);
    assert.equal(b.stopReason,used===2?'provider-recovery-limit':null);
  }
  assert.throws(()=>calculate({...args,providerRetriesUsed:3}),/provider recovery count/);
});

test('every supported ordinary budget stops at the exact protected complete-path boundary',()=>{
  const t=staged(),cases=[candidate(t),blueprint(t),role(t),component(t,11),review(t,16),
    {...review(t,17),phase:'refine-component',input:{refinement:true,task:{id:'task0'}}},
    {...review(t,20),phase:'correct-review'}];
  for(const args of cases){
    const b=calculate(args),boundary=t.maximumCalls-b.mandatoryCalls;
    assert.ok(boundary>=args.reservedCalls);
    for(let reserved=args.reservedCalls;reserved<=t.maximumCalls;reserved++){
      const result=calculate({...args,reservedCalls:reserved,originalCallIndex:args.reservedCalls});
      assert.equal(result.canStart,reserved<=boundary,args.phase+': '+reserved);
      assert.equal(result.remaining,t.maximumCalls-reserved);assert.equal(result.protectedPackageCeiling,b.protectedPackageCeiling);
      assert.equal(result.requiredAfterCall,b.requiredAfterCall);
      if(result.canStart)assert.ok(reserved+future(result)<=t.maximumCalls);
    }
  }
});

test('small lite/pro budgets may refuse early capacity recovery rather than reducing requested construction scope',()=>{
  for(const id of ['lite','pro','max','ultra']){
    const t=tier({qualityTier:id}),b=calculate(plan(t));
    assert.equal(b.protectedPackageCeiling,t.maxPackages);assert.equal(b.maximumCalls,t.maximumCalls);
    assert.equal(b.canStart,t.maximumCalls-1>=future(b));
    if(!b.canStart)assert.equal(b.stopReason,'protected-complete-path-unfunded');
  }
  const lite=tier({qualityTier:'lite'});assert.equal(calculate(plan(lite)).canStart,false);
  assert.equal(calculate(review(lite,5,'correct-review')).canStart,true);
});

test('invalid counters, stale original prefixes and unconfirmed authority are rejected before any scheduling result',()=>{
  const args=review(staged(),15);
  for(const key of ['reservedCalls','originalCallIndex','providerRetriesUsed','formatCorrectionsUsed','originalFormatCorrectionsUsed'])
    for(const value of [-1,0.5,27,'1',null,NaN,Infinity])assert.throws(()=>calculate({...args,[key]:value}),key+': '+value);
  assert.throws(()=>calculate({...args,reservedCalls:0}));
  assert.throws(()=>calculate({...args,originalCallIndex:16}));
  assert.throws(()=>calculate({...args,formatCorrectionsUsed:0,originalFormatCorrectionsUsed:1}));
  assert.throws(()=>calculate({...args,reservedCalls:1,providerRetriesUsed:1}));
  for(const mutate of [t=>t.providerRetries=0,t=>t.workflow='single',t=>t.recovery.mode='automatic',t=>t.providerRecovery.provider='claude',
    t=>t.maximumCalls=27,t=>t.maxPackages=17,t=>t.maximumComponentCorrections=-1,t=>t.maximumFormatCorrections=2]){
    const t=structuredClone(args.tier);mutate(t);assert.throws(()=>calculate({...args,tier:t,input:{tier:t}}));
  }
  assert.throws(()=>calculate({...args,input:{tier:{...args.tier,maximumCalls:25}}}),/policy changed/);
});

test('unknown phases and inappropriate original stage policies cannot become zero-tail capacity permission',()=>{
  const t=staged();
  for(const phase of ['prototype-review','unknown','cancelled','',null])
    assert.throws(()=>calculate({tier:t,phase,reservedCalls:15,input:{}}),/unknown original phase/);
  assert.throws(()=>calculate(plan(t)),/staged workflow uses blueprint/);
  assert.throws(()=>calculate({...candidate(t),tier:tier(),input:{}}),/independent concept profile/);
  assert.throws(()=>calculate({tier:t,phase:'concepts',reservedCalls:1,input:{}}),/batched concepts/);
  assert.throws(()=>calculate({tier:tier(),phase:'reference-analysis',reservedCalls:1,input:{}}),/reference prelude/);
});

test('malformed or tampered decomposition tails are rejected, including numerically comparable strings',()=>{
  const args=candidate(staged());
  for(const value of [null,{},[],{requiredAfterCall:'15'},{requiredAfterCall:-1},{...args.input.decompositionBudget,requiredAfterCall:0},
    {...args.input.decompositionBudget,remaining:25},{...args.input.decompositionBudget,spareCalls:99},
    {...args.input.decompositionBudget,canAuthorizePlacement:true},{...args.input.decompositionBudget,extra:true}])
    assert.throws(()=>calculate({...args,input:{...args.input,decompositionBudget:value}}));
  for(const stage of [undefined,'concept-2','selection'])
    assert.throws(()=>calculate({...args,input:{...args.input,decompositionStageId:stage}}),/stage identity/);
  for(const change of [v=>v.slot=4,v=>v.slot='1',v=>v.totalCandidates=2,v=>v.candidateId='concept-2']){
    const input=structuredClone(args.input);change(input);assert.throws(()=>calculate({...args,input}));
  }
});

test('role recovery rejects fake progress, reordered/duplicate task identities and weakened corrective headroom',()=>{
  const args=role(staged(),7,1);
  for(const progress of ['x',null,{length:1},['special-crown'],new Array(1),['typical-floor-core','facade-corner']])
    assert.throws(()=>calculate({...args,input:{...args.input,prototypeState:{...args.input.prototypeState,completedRoles:progress}}}),/role progress/);
  for(const change of [v=>v.role='entry-podium',v=>v.task.id='foreign',v=>v.prototypeState.roles.reverse(),
    v=>v.prototypeState.roles[1].task=v.prototypeState.roles[0].task,v=>v.prototypeCorrectionBudget.reservedTailCorrections=0,
    v=>v.prototypeCorrectionBudget.remaining--,v=>v.prototypeCorrectionBudget.correction=1]){
    const input=structuredClone(args.input);change(input);assert.throws(()=>calculate({...args,input}));
  }
  assert.throws(()=>calculate({...args,phase:'correct-prototype-role'}),/correction identity/);
  assert.throws(()=>calculate({...args,completedPackages:['task0']}),/construction cannot precede/);
});

test('blueprint and plan recovery reject changed package ceilings, review count and original call outlook',()=>{
  for(const args of [blueprint(staged()),plan(tier({assemblyDesignReview:'text'}))]){
    for(const change of [v=>delete v.callBudget,v=>v.callBudget.maximumPackages=1,v=>v.callBudget.remaining--,
      v=>v.callBudget.canStart=false,v=>v.callBudget.maximumPackages=17]){
      const input=structuredClone(args.input);change(input);assert.throws(()=>calculate({...args,input}));
    }
  }
  const args=plan(tier({assemblyDesignReview:'text'}));
  assert.throws(()=>calculate({...args,input:{...args.input,callBudget:{...args.input.callBudget,minimumReviewCalls:1}}}),/review path changed/);
});

test('scope bookkeeping cannot hide pending packages or reinterpret an incomplete building as final refinement/review',()=>{
  const args=component(staged(),11,1);
  for(const packageIds of [[],['task0','task0'],['bad-id','task1'],new Array(4),['task0','task1','task2','task3','task4','task5']])
    assert.throws(()=>calculate({...args,packageIds}));
  for(const completedPackages of [['foreign'],['task0','task0'],new Array(1)])
    assert.throws(()=>calculate({...args,completedPackages}));
  assert.throws(()=>calculate({...args,input:{...args.input,completedPackages:[]}}),/progress changed/);
  assert.throws(()=>calculate({...args,input:{...args.input,task:{id:'task0'}}}),/unfinished package/);
  assert.throws(()=>calculate({...args,phase:'review',input:{}}),/every original package/);
  assert.throws(()=>calculate({...args,phase:'refine-component',input:{refinement:true,task:{id:'task1'}}}),/complete-building/);
  assert.throws(()=>calculate({...review(staged(),16),input:{packages:[{id:'task0'}]}}),/scope changed/);
  assert.throws(()=>calculate({...args,input:{...args.input,refinement:'yes'}}),/refinement marker/);
});

test('real offline staged inputs fit the pure scheduler without changing original runtime policy or generating additional calls',async()=>{
  const h=await setupStaged(),result=await runSceneAssembly(h.options),t=enable(h.options.policy.assembly);
  const packageIds=result.summary.completedPackages,completed=[];
  assert.equal(h.calls.length,16);assert.equal(h.options.policy.assembly.providerRetries,0);
  const phases=new Set();
  for(const [i,call] of h.calls.entries()){
    const {input}=structuredClone(call);if(input.tier)input.tier=t;
    const b=calculate({tier:t,phase:call.phase,input,reservedCalls:i+1,
      packageIds:['concept-review','component','review'].includes(call.phase)?packageIds:[],completedPackages:[...completed]});
    assert.equal(b.canStart,true,'Offline stage '+call.phase+' at '+(i+1));
    assert.equal(b.originalInputHash,hash(input));assert.equal(b.additionalModelCalls,0);
    phases.add(call.phase);if(call.phase==='component')completed.push(input.task.id);
  }
  assert.deepEqual([...phases],['concept-candidate','select-concept','assembly-blueprint','prototype-role','concept-review','component','review']);
  assert.equal(h.calls.length,16);assert.equal(result.summary.finalTextReviewAccepted,true);
});

test('exhaustive staged budgets and role/package tails never borrow calls outside the unchanged original ceiling',()=>{
  let allowed=0,stopped=0;
  for(let maximum=22;maximum<=26;maximum++){
    const t=staged({assemblyCalls:maximum});
    for(let done=0;done<t.maxPackages;done++)for(let reserved=1;reserved<=maximum;reserved++)for(let retries=0;retries<=2;retries++){
      if(retries>=reserved)continue;
      const args=component(t,reserved,done),b=calculate({...args,providerRetriesUsed:retries});
      assert.equal(b.protectedPackageCeiling,t.maxPackages);assert.equal(b.requiredAfterCall,t.maxPackages-done);
      assert.equal(b.maximumCalls,maximum);assert.equal(b.reservedCalls,reserved);assert.equal(b.mandatoryCalls,future(b));
      assert.equal(b.canStart,retries<2&&maximum-reserved>=future(b));
      if(b.canStart){allowed++;assert.ok(reserved+future(b)<=maximum);}else stopped++;
    }
  }
  assert.ok(allowed>100&&stopped>100);
});
