import {hash} from '../src/generation/compiler.mjs';
import {validateAssemblyProviderRecoveryPolicy} from '../contracts/assembly-provider-recovery.mjs';
import {assemblyCallBudget} from './assembly-budget.mjs';
import {decompositionBlueprintBudget,decompositionConfiguration} from './assembly-decomposition-budget.mjs';
import {decompositionTailBudget,decompositionRoleCorrectionBudget} from './assembly-decomposed-stages.mjs';
import {PROTOTYPE_ROLES} from '../contracts/scene-decomposition-roles.mjs';
import {stagedDesignCorrectionReserve} from '../contracts/assembly-completion-reserve.mjs';

const check=(ok,label)=>{if(!ok)throw Error('Capacity recovery budget: '+label);};
const integer=(v,min,max,label)=>{check(Number.isSafeInteger(v)&&v>=min&&v<=max,label);return v;};
const countPackages=(v,tier,label)=>integer(v,tier.prototypes?.mode==='staged'?4:2,tier.maxPackages,label);
const ids=(values,label)=>{check(Array.isArray(values)&&values.length<=16&&new Set(values).size===values.length&&
  Array.from(values).every(v=>typeof v==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,11}$/.test(v)),label);return values;};

/** Pure scheduling only. Count the original failed reservation, preserve the
 * SAME allowed output package ceiling/required roles and keep shared geometric,
 * contract-review and unused format-correction capacity. This is not receipt
 * evidence, permission to retry, a new preflight or a substitute for the journal.
 * originalCallIndex and originalFormatCorrectionsUsed describe the original
 * failed stage, NOT the end of a possibly longer replay journal. reservedCalls
 * counts ALL existing reservations; none is refunded. Reconstruct both from
 * saved invocations, never from a new guessed plan or a UI progress counter. */
export function assemblyProviderRecoveryBudget({tier,phase,input,reservedCalls,providerRetriesUsed=0,
  formatCorrectionsUsed=0,originalCallIndex=reservedCalls,originalFormatCorrectionsUsed=formatCorrectionsUsed,
  originalBudgetCallIndex=originalCallIndex,
  packageIds=[],completedPackages=[]}){
  if(!tier?.providerRecovery)return {version:1,enabled:false,canStart:false,
    stopReason:'provider-recovery-disabled',additionalModelCalls:0,canAuthorizeRetry:false,canAuthorizePlacement:false};
  const recovery=validateAssemblyProviderRecoveryPolicy(tier.providerRecovery);
  check(tier.workflow==='components'&&tier.recovery?.mode==='safe'&&tier.providerRetries===recovery.maximumRetries,
    'explicit new Codex component recovery policy required');
  integer(tier.maximumCalls,4,26,'original call limit');integer(tier.maxPackages,2,16,'original package limit');
  integer(tier.maximumComponentCorrections,0,4,'shared geometry reserve');
  integer(tier.maximumFormatCorrections??0,0,1,'format reserve');
  integer(reservedCalls,1,tier.maximumCalls,'failed call is already reserved');
  integer(originalCallIndex,1,reservedCalls,'original failed stage prefix');
  integer(providerRetriesUsed,0,Math.min(recovery.maximumRetries,reservedCalls-1),'provider recovery count');
  integer(formatCorrectionsUsed,0,tier.maximumFormatCorrections??0,'format correction count');
  integer(originalFormatCorrectionsUsed,0,Math.min(formatCorrectionsUsed,originalCallIndex),'original format correction count');
  check(input&&typeof input==='object'&&!Array.isArray(input),'original stage input');
  check(input.refinement===undefined||input.refinement===true,'original refinement marker');
  if(input.tier!==undefined)check(hash(input.tier)===hash(tier),'original input policy changed');
  ids(packageIds,'original package identities');ids(completedPackages,'completed package identities');
  check(completedPackages.every(id=>packageIds.includes(id)),'completed packages exceed original scope');
  check(packageIds.length<=tier.maxPackages,'package identities exceed original ceiling');
  if(input.completedPackages!==undefined)check(hash(input.completedPackages)===hash(completedPackages),
    'original completed package progress changed');
  if(input.formatCorrection!==undefined)check(originalFormatCorrectionsUsed===1,'original format correction reservation missing');
  const staged=tier.prototypes?.mode==='staged',design=!!tier.designReview;
  const designCorrectionReserve=stagedDesignCorrectionReserve(tier);
  integer(originalBudgetCallIndex,1,originalCallIndex,'original prepared budget prefix');
  if(originalBudgetCallIndex!==originalCallIndex)check((!staged||['revise-design','correct-design'].includes(phase))&&input.formatCorrection&&
    Number.isSafeInteger(input.formatCorrection.stage)&&input.formatCorrection.stage>=originalBudgetCallIndex&&
    input.formatCorrection.stage<originalCallIndex,'only a verified plan/design format correction retains an earlier prepared budget');
  if(staged){
    integer(tier.prototypes.candidateCount,1,3,'candidate count');
    integer(tier.prototypes.recoveryReserve,0,26,'original decomposition reserve');
    check(design&&[3,4].includes(tier.quality?.version),'original staged design/review path required');
  }
  const pending=packageIds.filter(id=>!completedPackages.includes(id));
  let requiredAfterCall,protectedPackageCeiling,pendingFirstConstruction,requiredRoleCalls=0,declaredTail,stageId;
  const prefixRecords=Array.from({length:originalCallIndex-1},()=>({}));
  const noConstruction=()=>check(completedPackages.length===0,'first construction cannot precede original planning/review');
  const fullPackageScope=()=>countPackages(packageIds.length,tier,'original package scope count');
  const originalCallBudget=()=>{
    check(input.callBudget&&typeof input.callBudget==='object'&&!Array.isArray(input.callBudget)&&
      input.callBudget.canStart===true&&input.callBudget.remaining===tier.maximumCalls-originalBudgetCallIndex+1,
      'original funded plan/revision call budget required');
    return countPackages(input.callBudget.maximumPackages,tier,'original plan/revision package ceiling');
  };
  const fullTail=prePlanCalls=>{
    // Protect the prospective ORIGINAL plan ceiling, before any provider retry.
    // Do not guess the two-package minimum when no proposal has been returned.
    const prospectiveRecords=Array.from({length:originalCallIndex+prePlanCalls},(_,i)=>
      i<originalFormatCorrectionsUsed?{formatCorrectionOf:i+1}:{});
    const prospective=assemblyCallBudget(tier,prospectiveRecords);
    check(prospective.canStart,'original prospective complete-building path is unfunded');
    protectedPackageCeiling=prospective.maximumPackages;pendingFirstConstruction=protectedPackageCeiling;
    return prePlanCalls+1+protectedPackageCeiling+(design?2:1);
  };
  if(['reference-analysis','correct-reference-analysis'].includes(phase)){
    noConstruction();
    check(tier.referenceAnalysis?.requiredCalls===1&&tier.referenceAnalysis.provider==='codex','original reference prelude policy required');
    stageId='reference-analysis';
    if(staged){
      const original=decompositionBlueprintBudget(decompositionConfiguration(tier));
      check(original.canStart,'original reference decomposition is unfunded');
      protectedPackageCeiling=original.maximumPackages;pendingFirstConstruction=protectedPackageCeiling;
      requiredRoleCalls=4;requiredAfterCall=tier.prototypes.candidateCount+8+protectedPackageCeiling;
    }else requiredAfterCall=fullTail([3,4].includes(tier.quality?.version)?2:0);
    declaredTail=staged?requiredAfterCall:[3,4].includes(tier.quality?.version)?7:design?5:4;
  }else if(['concepts','correct-concepts'].includes(phase)){
    noConstruction();
    check(!staged&&[3,4].includes(tier.quality?.version),'original batched concepts required');
    requiredAfterCall=fullTail(1);
  }else if(['concept-candidate','correct-concept-candidate'].includes(phase)){
    noConstruction();
    check(staged,'original independent concept profile required');
    const candidates=integer(tier.prototypes.candidateCount,1,3,'candidate count');
    const slot=integer(input.slot,1,candidates,'original independent candidate slot');
    check(input.totalCandidates===candidates&&input.candidateId==='concept-'+slot,'candidate identity or count changed');
    stageId=input.candidateId;
    const original=decompositionBlueprintBudget(decompositionConfiguration(tier));
    check(original.canStart,'original candidate decomposition is unfunded');
    protectedPackageCeiling=original.maximumPackages;pendingFirstConstruction=protectedPackageCeiling;
    requiredRoleCalls=4;requiredAfterCall=candidates-slot+8+protectedPackageCeiling;
  }else if(phase==='select-concept'){
    noConstruction();
    check([3,4].includes(tier.quality?.version),'original concept selection required');
    if(staged){
      const original=decompositionBlueprintBudget(decompositionConfiguration(tier));
      check(original.canStart,'original selection decomposition is unfunded');
      protectedPackageCeiling=original.maximumPackages;pendingFirstConstruction=protectedPackageCeiling;
      requiredRoleCalls=4;requiredAfterCall=7+protectedPackageCeiling;stageId='selection';
    }else requiredAfterCall=fullTail(0);
  }else if(['assembly-blueprint','correct-blueprint'].includes(phase)){
    noConstruction();
    check(staged,'original staged blueprint required');
    const original=decompositionBlueprintBudget(decompositionConfiguration(tier),{reservedCalls:originalCallIndex-1,
      completedCandidates:tier.prototypes.candidateCount,selectionAccepted:true,...(tier.referenceAnalysis?{completedPrelude:1}:{})});
    check(original.canStart&&hash(input.callBudget??null)===hash(original),'original blueprint call budget changed');
    protectedPackageCeiling=countPackages(input.callBudget.maximumPackages,tier,'original blueprint package ceiling');
    stageId='blueprint';
    pendingFirstConstruction=protectedPackageCeiling;requiredRoleCalls=4;requiredAfterCall=6+protectedPackageCeiling;
  }else if(['prototype-role','correct-prototype-role'].includes(phase)){
    noConstruction();
    check(staged,'original staged role required');
    const role=integer(input.prototypeCorrectionBudget?.roleIndex,0,3,'original role index');
    protectedPackageCeiling=countPackages(input.prototypeCorrectionBudget.packageCount,tier,'original role package count');
    const state=input.prototypeState;
    check(Array.isArray(state?.completedRoles)&&hash(state.completedRoles)===hash(PROTOTYPE_ROLES.slice(0,role)),
      'original role progress changed');
    check(input.role===PROTOTYPE_ROLES[role]&&Array.isArray(state.roles)&&state.roles.length===4&&
      Array.from(state.roles).every((v,i)=>v?.role===PROTOTYPE_ROLES[i]),'original role identity changed');
    const roleTasks=ids(state.roles.map(v=>v.task),'original role task identities');
    check(input.task?.id===roleTasks[role],'original role task changed');
    if(packageIds.length)check(packageIds.length===protectedPackageCeiling&&roleTasks.every(id=>packageIds.includes(id)),
      'original role package scope changed');
    const expected=decompositionRoleCorrectionBudget(tier,prefixRecords,input.prototypeCorrectionBudget);
    check(expected.canStart&&hash(expected)===hash(input.prototypeCorrectionBudget),'original role corrective budget changed');
    check(phase==='prototype-role'?expected.correction===0:expected.correction>0,'original role correction identity changed');
    stageId=input.role;
    pendingFirstConstruction=protectedPackageCeiling;requiredRoleCalls=3-role;
    requiredAfterCall=requiredRoleCalls+protectedPackageCeiling+2;
  }else if(['plan','correct-plan','repair-plan','revise-design','correct-design'].includes(phase)){
    noConstruction();
    check(!staged||['revise-design','correct-design'].includes(phase),'staged workflow uses blueprint, not legacy planning');
    protectedPackageCeiling=originalCallBudget();
    check(input.callBudget.minimumReviewCalls===(design?2:1),'original plan/revision review path changed');
    pendingFirstConstruction=protectedPackageCeiling;
    requiredAfterCall=protectedPackageCeiling+(design?2:1);
    if(staged&&designCorrectionReserve)check(input.callBudget.reservedHeadroom===(phase==='revise-design'?designCorrectionReserve:0),
      'original staged design-correction reserve changed');
  }else if(['concept-review','correct-concept-review'].includes(phase)){
    noConstruction();check(design,'original unapproved design packages required');
    protectedPackageCeiling=fullPackageScope();pendingFirstConstruction=packageIds.length;
    requiredAfterCall=packageIds.length+1;
  }else if(['component','correct-component'].includes(phase)&&!input.refinement){
    protectedPackageCeiling=fullPackageScope();check(pending.includes(input.task?.id),'original unfinished package required');
    pendingFirstConstruction=pending.length;
    requiredAfterCall=pending.length; // Later packages plus one final review.
  }else if(['refine-component','refine-coordinated'].includes(phase)||phase==='correct-component'&&input.refinement===true){
    protectedPackageCeiling=fullPackageScope();
    check(input.refinement===true&&pending.length===0,'original complete-building refinement required');
    if(phase!=='refine-coordinated')check(packageIds.includes(input.task?.id),'original refinement package changed');
    pendingFirstConstruction=0;requiredAfterCall=1;
  }else if(['review','correct-review'].includes(phase)){
    protectedPackageCeiling=fullPackageScope();
    check(pending.length===0,'every original package must be complete before final review');
    if(input.packages!==undefined)check(Array.isArray(input.packages)&&hash(input.packages.map(v=>v.id))===hash(packageIds),
      'original final review package scope changed');
    pendingFirstConstruction=0;requiredAfterCall=0;
  }else throw Error('Capacity recovery budget: unknown original phase '+phase);
  if(stageId){
    check(input.decompositionStageId===stageId,'original decomposition stage identity changed');
    declaredTail??=requiredAfterCall;
  }
  if(input.decompositionBudget!==undefined||stageId){
    integer(input.decompositionBudget?.requiredAfterCall,0,26,'original declared mandatory tail');
    check(declaredTail!==undefined&&hash(input.decompositionBudget)===hash(decompositionTailBudget(tier,prefixRecords,declaredTail)),
      'original declared mandatory tail changed');
    check(declaredTail<=requiredAfterCall,'original declared mandatory tail cannot be reduced');
  }
  const reserve={componentCorrections:pendingFirstConstruction?tier.maximumComponentCorrections:0,
    reviewCorrection:phase==='correct-review'?0:1,formatCorrection:(tier.maximumFormatCorrections??0)-formatCorrectionsUsed};
  const reservedHeadroom=Object.values(reserve).reduce((a,b)=>a+b,0);
  const protectedRoleHeadroom=input.prototypeCorrectionBudget?.reservedTailCorrections??0;
  integer(protectedRoleHeadroom,0,2+designCorrectionReserve,'original role corrective tail');
  const protectedHeadroom=Math.max(reservedHeadroom,protectedRoleHeadroom);
  const remaining=tier.maximumCalls-reservedCalls,mandatoryCalls=1+requiredAfterCall+protectedHeadroom;
  const canStart=providerRetriesUsed<recovery.maximumRetries&&remaining>=mandatoryCalls;
  return {version:1,enabled:true,phase,maximumCalls:tier.maximumCalls,reservedCalls,remaining,originalCallIndex,
    originalBudgetCallIndex,
    originalFormatCorrectionsUsed,formatCorrectionsUsed,providerRetriesUsed,
    maximumRetries:recovery.maximumRetries,requiredAfterCall,requiredRoleCalls,protectedPackageCeiling,
    pendingFirstConstruction,remainingPackageIds:[...pending],reserve,protectedHeadroom,mandatoryCalls,
    spareCalls:Math.max(0,remaining-mandatoryCalls),canStart,
    stopReason:canStart?null:providerRetriesUsed>=recovery.maximumRetries?'provider-recovery-limit':'protected-complete-path-unfunded',
    originalInputHash:hash(input),originalCallBudgetHash:input.callBudget?hash(input.callBudget):null,
    originalRevisionContextHash:input.designRevisionContext?hash(input.designRevisionContext):null,
    additionalModelCalls:0,canAuthorizeRetry:false,canAuthorizePlacement:false};
}
