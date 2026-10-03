/** Work packages are not detail quotas. Reserve finite recovery capacity BEFORE
 * freezing ownership, without raising the user's call limit or dropping work.
 * This is scheduling data only: it never merges packages or edits geometry. */
export function assemblyCallBudget(tier,records,{phase='plan',attempt=0,round=0,correction=0}={}){
  const remaining=tier.maximumCalls-records.length,design=!!tier.designReview;
  const minimumReviewCalls=design?2:1;
  const mandatoryCalls=phase==='plan'?1+minimumReviewCalls:3;
  const ceiling=Math.min(tier.maxPackages,remaining-mandatoryCalls);
  const wanted=design?{
    planCorrections:phase==='plan'?Math.max(0,tier.maximumPlanCorrections-attempt):0,
    designRevisionPairs:2*Math.max(0,tier.designReview.maximumRevisions-(phase==='plan'?0:round+1)),
    designCorrections:Math.max(0,tier.maximumComponentCorrections-correction),
    componentCorrections:tier.maximumComponentCorrections,
    formatCorrection:Math.max(0,(tier.maximumFormatCorrections??0)-records.filter(r=>r.formatCorrectionOf).length)
  }:{};
  const desiredHeadroom=Object.values(wanted).reduce((a,b)=>a+b,0);
  // Small, explicitly confirmed budgets may only afford the mandatory path.
  // Never make a valid 2-package task impossible by inventing extra authority.
  const reservedHeadroom=Math.min(desiredHeadroom,Math.max(0,remaining-mandatoryCalls-2));
  const maximumPackages=Math.min(tier.maxPackages,remaining-mandatoryCalls-reservedHeadroom);
  return {remaining,maximumPackages,minimumReviewCalls,mandatoryCalls,mandatoryPackageCeiling:ceiling,
    reservedHeadroom,desiredHeadroom,headroomFullyFunded:reservedHeadroom===desiredHeadroom,recoveryReserve:wanted,
    canStart:maximumPackages>=2,interfacesFrozen:false};
}

/** An optional concept extension may spend only genuine spare calls. It must
 * fund the CURRENT package list, another concept review, final review and all
 * remaining correction headroom; it cannot assume future regrouping or success.
 * Legacy confirmed policies keep their original fixed revision ceiling. */
export function conceptRevisionBudget(tier,records,{round,packageCount,correction=0}){
  const budget=assemblyCallBudget(tier,records,{phase:'revise-design',round,correction});
  const extension=round>=tier.designReview.maximumRevisions;
  const authorized=!extension||(tier.designReview.version===2&&tier.designReview.budgetedExtensions===true);
  const funded=Number.isSafeInteger(packageCount)&&packageCount>=2&&budget.headroomFullyFunded&&budget.maximumPackages>=packageCount;
  const canStart=budget.canStart&&authorized&&(!extension||funded);
  const stopReason=canStart?null:!authorized?'concept-revision-limit':!budget.canStart?'concept-call-budget':'concept-recovery-reserve';
  return {...budget,extension,currentPackageCount:packageCount,canStart,stopReason};
}

/** A rejected whole-design edit is still unapproved. Additional geometric
 * corrections must retain the CURRENT package list and all existing reserves,
 * including the next concept review. They never reset the concept round. */
export function designCorrectionBudget(tier,records,{round,packageCount,correctionsUsed}){
  if(!Number.isSafeInteger(correctionsUsed)||correctionsUsed<0)throw new Error('Invalid design correction count');
  const budget=conceptRevisionBudget(tier,records,{round,packageCount,correction:correctionsUsed+1});
  const correctionExtension=correctionsUsed>=tier.maximumComponentCorrections;
  const authorized=!correctionExtension||(tier.recovery?.mode==='safe'&&tier.designReview.version===2&&tier.designReview.budgetedCorrections===true);
  const funded=budget.headroomFullyFunded&&budget.maximumPackages>=packageCount;
  const canStart=budget.canStart&&authorized&&(!correctionExtension||funded);
  return {...budget,correctionsUsed,correctionExtension,canStart,
    stopReason:canStart?null:!authorized?'design-correction-limit':!budget.canStart?budget.stopReason:'design-correction-recovery-reserve'};
}

/** Required-package recovery only. Additional corrections cannot borrow the
 * remaining first-construction calls, final review, or shared recovery reserve.
 * The latter is not a promise of two corrections for EVERY remaining package.
 * A versioned, confirmed policy is required; legacy snapshots stay bounded. */
export function componentCorrectionBudget(tier,records,{correctionsUsed,pendingPackages}){
  if(!Number.isSafeInteger(correctionsUsed)||correctionsUsed<0||!Number.isSafeInteger(pendingPackages)||pendingPackages<0)throw new Error('Invalid component correction budget state');
  const remaining=tier.maximumCalls-records.length,mandatoryCalls=1+pendingPackages+1;
  const extension=correctionsUsed>=tier.maximumComponentCorrections;
  const authorized=!extension||(tier.recovery?.mode==='safe'&&tier.componentCorrection?.version===1&&tier.componentCorrection.budgetedExtensions===true);
  const recoveryReserve={componentCorrections:pendingPackages?tier.maximumComponentCorrections:0,reviewCorrection:1,
    formatCorrection:Math.max(0,(tier.maximumFormatCorrections??0)-records.filter(r=>r.formatCorrectionOf).length)};
  const reservedHeadroom=Object.values(recoveryReserve).reduce((a,b)=>a+b,0);
  const canStart=authorized&&remaining>=mandatoryCalls&&(!extension||remaining>=mandatoryCalls+reservedHeadroom);
  return {remaining,correctionsUsed,pendingPackages,extension,mandatoryCalls,recoveryReserve,reservedHeadroom,canStart,
    stopReason:canStart?null:!authorized?'component-correction-limit':remaining<mandatoryCalls?'component-call-budget':'component-recovery-reserve'};
}

export const CALL_BUDGET_RULES=`CALL BUDGET: callBudget.maximumPackages is a HARD final package-count ceiling, not a suggestion or a geometry/detail quota. It reserves remaining calls for corrections and architectural revisions before ownership freezes. Every required feature, room and detail must still be covered by the package purposes, components and bounded regions. If necessary regroup related work with explicit packages.put/remove edits, reassign its existing components exactly once and update dependencies/interfaces in the SAME unapproved plan. Do not delete required work, shrink the building, grant blanket overwrite authority or pad package counts. No program silently merges packages. After interfaces freeze, packages and permissions cannot be regrouped.`;
