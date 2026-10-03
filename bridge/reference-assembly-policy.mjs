import {generationPreflight} from './generation-policy.mjs';
import {decompositionBlueprintBudget} from './assembly-decomposition-budget.mjs';

// Explicit preparation v2 only. Never upgrade an old request, policy or
// journal, and never enlarge the user's confirmed call or output-token limit.
export function referenceAssemblyPreflight(generation){
  if(generation.agent!=='codex'||generation.generationMode!=='scene'||generation.sceneWorkflow!=='components'||
    generation.assemblyConfirmed!==true||generation.assemblyRecovery!=='safe')
    throw Error('Reference assembly requires an explicitly confirmed new Codex component task with safe recovery');
  const policy=generationPreflight(generation),tier=policy.assembly;
  const staged=tier.prototypes?.mode==='staged';
  const minimum=staged?15:[3,4].includes(tier.quality?.version)?7:tier.designReview?5:4;
  if(tier.maximumCalls<minimum+1)throw Error('Reference analysis cannot consume the mandatory complete-building path');
  tier.referenceAnalysis={version:1,mode:'job-owned-prelude',requiredCalls:1,maximumCorrections:1,
    provider:'codex',model:generation.model};
  if(staged){
    // Fund the prelude from the declared shared reserve, not by dropping
    // candidates, any of the four roles, packages or final review.
    tier.prototypes.recoveryReserve--;
    const budget=decompositionBlueprintBudget({maximumCalls:tier.maximumCalls,candidateCount:tier.prototypes.candidateCount,
      maximumPackages:tier.maxPackages,recoveryReserve:tier.prototypes.recoveryReserve,preludeCalls:1});
    if(!budget.canStart)throw Error('Unfunded reference decomposition');
    tier.maxPackages=budget.maximumPackages;
  }else{
    tier.maxPackages=Math.min(tier.maxPackages,tier.maximumCalls-(minimum-2)-1);
  }
  policy.warnings.push('参考图分析、格式纠正和建筑制作共用已确认的任务调用上限；未知原调用不重发。识图简报不是建筑质量或世界写入认证。');
  return policy;
}
