import catalog from '../contracts/quality-tiers.json' with {type:'json'};
import {QUALITY_STRATEGIES} from '../src/design/quality-prototypes.mjs';
import {decompositionBlueprintBudget} from './assembly-decomposition-budget.mjs';
import {DESIGN_ALLOCATION_POLICY} from '../contracts/scene-design-allocation.mjs';
export function qualityTiers(){return structuredClone(catalog.tiers);}
export function assemblyPreflight(input){
  const fields=['qualityTier','assemblyCalls','assemblyConfirmed','assemblyDesignReview','assemblyRecovery','assemblyQuality','assemblyPrototypes'];
  if(input.sceneWorkflow!=='components'){
    if(fields.some(k=>input[k]!==undefined))throw new Error('Quality tier fields require explicit component workflow');return null;
  }
  if(input.generationMode!=='scene'||(input.maxRepairs??0)!==0||['sample','spec','patch','scenePatch','importDirectory','revalidateJobId','baseJobId','baseHash','sceneScope','reviewImages','repairJobId','checkpointCalls','checkpointConfirmed'].some(k=>input[k]!==undefined))throw new Error('Component workflow is a separately confirmed new SceneSpec design');
  const tier=structuredClone(catalog.tiers.find(t=>t.id===input.qualityTier));if(!tier)throw new Error('Select lite, pro, max or ultra explicitly');
  const mode=input.assemblyDesignReview;
  const quality=input.assemblyQuality;
  if(input.assemblyPrototypes!==undefined&&(!['verified','staged'].includes(input.assemblyPrototypes)||quality!=='v4'||mode!=='native'||input.assemblyRecovery!=='safe'))throw new Error('Verified/staged prototypes require explicit new-building quality v4, native review and safe recovery');
  if(input.assemblyPrototypes==='verified')tier.prototypes={version:1,mode:'verified',newBuildingOnly:true,seedVisualGate:true,expandedVisualGate:true,expansionCalls:0};
  if(input.assemblyPrototypes==='staged'){
    if(tier.id!=='ultra')throw new Error('Staged prototype workflow is currently an explicit experimental Ultra profile');
    tier.prototypes={version:5,mode:'staged',candidateCount:3,recoveryReserve:7,newBuildingOnly:true,seedVisualGate:true,expandedVisualGate:true,expansionCalls:0,
      roleCorrections:{version:2,mode:'tail-funded-through-review',reservedTailCorrections:2},designAllocation:structuredClone(DESIGN_ALLOCATION_POLICY)};
  }
  if(quality!==undefined&&!['v2','v3','v4'].includes(quality))throw new Error('Invalid assembly quality version');
  if(quality&&(!mode||input.assemblyRecovery!=='safe'))throw new Error('Quality v2/v3/v4 requires explicit design review and safe recovery');
  if(['v3','v4'].includes(quality)&&mode!=='native')throw new Error('Quality v3/v4 requires native concept comparison');
  if(input.assemblyRecovery!==undefined&&input.assemblyRecovery!=='safe')throw new Error('Invalid assembly recovery mode');
  if(mode!==undefined&&!['text','images','native'].includes(mode))throw new Error('Invalid assembly design-review mode');
  if(mode==='native'&&!['v2','v3','v4'].includes(quality))throw new Error('Native review requires quality v2/v3/v4');
  if(['images','native'].includes(mode)&&input.agent!=='codex')throw new Error('Assembly image review requires an explicitly image-capable Codex model');
  const designReview=mode?{version:input.assemblyRecovery==='safe'?2:1,mode,maximumRevisions:['max','ultra'].includes(tier.id)?2:1,...(input.assemblyRecovery==='safe'?{budgetedExtensions:true,budgetedCorrections:true,candidateCorrections:true}:{})}:null;
  const maximumCalls=input.assemblyCalls??tier.maximumCalls;
  if(!Number.isSafeInteger(maximumCalls)||maximumCalls<(['v3','v4'].includes(quality)?7:designReview?5:4)||maximumCalls>tier.maximumCalls)throw new Error('Invalid component-workflow call budget');
  // NEW v4 schedule: allocate more calls to real correction/review, not more
  // tokens or a higher task limit. A batch may still contain many precise
  // components/modules; no required architectural responsibility is removed.
  if(tier.prototypes?.mode==='staged'){
    if(maximumCalls<22)throw new Error('Staged Ultra cannot fund every required role, package and recovery reserve');
    tier.prototypes.recoveryReserve=Math.min(10,maximumCalls-15);
  }
  const stagedBudget=tier.prototypes?.mode==='staged'?decompositionBlueprintBudget({maximumCalls,candidateCount:3,maximumPackages:tier.maxPackages,recoveryReserve:tier.prototypes.recoveryReserve}):null;
  if(stagedBudget&&!stagedBudget.canStart)throw new Error('Staged Ultra cannot fund every required role, package and recovery reserve');
  if(input.assemblyConfirmed!==undefined&&typeof input.assemblyConfirmed!=='boolean')throw new Error('Component workflow confirmation must be explicit');
  return {...tier,maximumCalls,maxPackages:stagedBudget?stagedBudget.maximumPackages:Math.min(tier.maxPackages,maximumCalls-(['v3','v4'].includes(quality)?5:designReview?3:2)),workflow:'components',providerRetries:0,maximumFormatCorrections:1,visualReview:['images','native'].includes(mode),...(quality?{quality:{version:quality==='v4'?4:quality==='v3'?3:2,prototypeReview:true,coordinatedRefinement:true,newBuildingOnly:true,strategy:structuredClone(QUALITY_STRATEGIES[tier.id]),...(['v3','v4'].includes(quality)?{renderedConcepts:true,maximumConceptCorrections:tier.maximumPlanCorrections}:{}),...(quality==='v4'?{pairedRevisionReview:true,structuredFindings:true}:{})}}:{}),...(designReview?{designReview}:{}),...(input.assemblyRecovery?{recovery:{version:1,mode:'safe',unknownOutcomeRetries:0},componentCorrection:{version:1,budgetedExtensions:true}}:{}),intermediateAssetsPlaceable:false};
}
