import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../src/generation/compiler.mjs';
import {validateConceptSet,checkSelectedConceptPlan} from '../contracts/scene-concepts.mjs';
import {applyAssemblyBlueprint,applyPrototypeRoleEdit,bindDecomposedPrototypeProgram} from '../contracts/scene-decomposed-prototypes.mjs';
import {checkStagedDesignAllocation,stagedDesignAllocationEnabled} from '../contracts/scene-design-allocation.mjs';
import {inspectDesignAllocation,designAllocationFreeze,inspectPrototypeRoleAllocation,PROTOTYPE_ALLOCATION_POLICY} from './assembly-design-allocation.mjs';
import {decompositionBlueprintBudget,createDecompositionSchedule,PROTOTYPE_ROLES,decompositionConfiguration} from './assembly-decomposition-budget.mjs';
import {inspectDecomposedRepresentatives,decompositionTailBudget,decompositionRoleCorrectionBudget} from './assembly-decomposed-stages.mjs';
import {readAssemblyPrototypeCandidate} from './assembly-prototypes.mjs';
import {readAssemblyBaseline,checkPackageGeometry,checkPackageCellScope} from '../src/design/assembly-scope.mjs';
import {expandedPrototypeRoutesEnabled} from '../contracts/assembly-prototype-validation.mjs';
import {isAssemblyProviderRecoveryAudit} from './assembly-provider-recovery-audit.mjs';

const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const optional=async file=>{try{return await read(file);}catch(error){if(error.code!=='ENOENT')throw error;return null;}};
/** READ ONLY terminal reconstruction. No provider, render, compile, repair,
 * normalization, world load/write or substitution of a saved baseline. */
export function createDecomposedAudit(assemblyRoot,{providerRecoveryAudit=null}={}){
 if(providerRecoveryAudit&&!isAssemblyProviderRecoveryAudit(providerRecoveryAudit))throw Error('Decomposed audit requires opaque verified recovery proof');
 let state=null,previousDiagnostic=null,previousFeedback=null,previousExpanded=null,blueprintStage=null,schedule=null,revisedPlan=null;
 let tier=null,allocationReceipt=null,allocatedPrototype=null;
 const roles=[];
 return {
  cameraResponsibilities(){
   if(!state||state.completedRoles.length!==4)throw Error('Representative camera audit requires all saved staged responsibilities');
   return structuredClone(state.representativesByRole);
  },
  async comparison(input,studies,stage){
   const saved=await read(path.join(assemblyRoot,'decomposed-concepts.json')),value=saved.aggregate;
   validateConceptSet(value,input.tier.prototypes.candidateCount);
   if(saved.modelResponse!==false||saved.canAuthorizePlacement!==false||saved.candidateSetHash!==hash(value)||saved.candidateSetHash!==input.candidateSetHash||
    saved.bindings.length!==value.candidates.length||new Set(saved.bindings.map(b=>b.stage)).size!==saved.bindings.length)throw Error('Decomposed aggregate identity mismatch');
   const candidates=[];
   for(const [i,binding] of saved.bindings.entries()){
    const study=studies.find(s=>s.stage===binding.stage),response=await read(path.join(assemblyRoot,String(binding.stage),'response.json'));
    if(binding.stage>=stage.index||!study?.accepted||study.candidates.length!==1||response.candidates.length!==1||binding.responseHash!==hash(response)||
     hash(response.candidates[0])!==hash(value.candidates[i])||binding.sourceHash!==hash(value.candidates[i].scene)||binding.id!==value.candidates[i].id||
     binding.assetHash!==study.candidates[0].assetHash||!study.candidates[0].eligible)throw Error('Decomposed candidate binding differs from independently received source');
    candidates.push(study.candidates[0]);
   }
   if(new Set(candidates.map(c=>c.geometryHash)).size!==candidates.length)throw Error('Decomposed candidates duplicate occupied geometry');
   return {candidateSetHash:saved.candidateSetHash,candidates};
  },
  async reconstruct({stage,input,response,scene,feedback}){
   if(input.tier.providerRecovery&&(!providerRecoveryAudit||!providerRecoveryAudit.inputVerified(stage,input)))
    throw Error('Decomposed stage lacks its original verified recovery input');
   const preparedIndex=providerRecoveryAudit?.preparedStageIndex(stage)??stage.index;
   if(tier&&hash(tier)!==hash(input.tier))throw Error('Decomposed stage changed its original policy');
   const dir=path.join(assemblyRoot,String(stage.index));let candidate,requiredAfterCall;
   const config=decompositionConfiguration(input.tier);
   if(['assembly-blueprint','correct-blueprint'].includes(stage.phase)){
    const budget=decompositionBlueprintBudget(config,{reservedCalls:preparedIndex-1,completedCandidates:config.candidateCount,selectionAccepted:true,
      ...(config.preludeCalls?{completedPrelude:1}:{})});
    if(hash(input.callBudget)!==hash(budget)||input.decompositionStageId!=='blueprint')throw Error('Decomposed blueprint call budget mismatch');
    requiredAfterCall=6+budget.maximumPackages;
    candidate=applyAssemblyBlueprint(input.selectedConcept.selected,response,{...input.tier,maxPackages:budget.maximumPackages});
   }else{
    if(!state||input.decompositionStageId!==PROTOTYPE_ROLES[state.completedRoles.length])throw Error('Decomposed role order differs from accepted baseline');
    if(stagedDesignAllocationEnabled(input.tier)&&hash(input.prototypeAllocationPolicy)!==hash(PROTOTYPE_ALLOCATION_POLICY))throw Error('Decomposed role allocation policy mismatch');
    const task=state.plan.packages.find(p=>p.id===state.roles[state.completedRoles.length].task);
    requiredAfterCall=(3-state.completedRoles.length)+state.plan.packages.length+2;
    if(hash(task)!==hash(input.task)||hash(state.plan.scene)!==hash(input.previousDraft))throw Error('Decomposed role changed its authority baseline');
    if([3,4,5,6].includes(input.tier.prototypes.version)){
     let primaryAttempts=0;
     for(let index=1;index<preparedIndex;index++){
      const previous=providerRecoveryAudit?providerRecoveryAudit.inputAt(index):await read(path.join(assemblyRoot,String(index),'input.json'));
      if(previous.decompositionStageId===input.decompositionStageId&&!previous.formatCorrection&&
        !(providerRecoveryAudit?.isProviderRetryIndex(index)))primaryAttempts++;
     }
     if((stage.formatCorrectionOf??null)!==(input.formatCorrection?.stage??null))throw Error('Decomposed role format correction identity mismatch');
     const correction=primaryAttempts-(input.formatCorrection?1:0);
     const expected=decompositionRoleCorrectionBudget(input.tier,Array(preparedIndex-1).fill(null),{
      roleIndex:state.completedRoles.length,packageCount:state.plan.packages.length,correction});
     if(!expected.canStart||hash(expected)!==hash(input.prototypeCorrectionBudget))throw Error('Decomposed role correction protected-tail budget mismatch');
    }
    candidate=applyPrototypeRoleEdit(state,response,input.tier);
   }
   const expectedBudget=decompositionTailBudget(input.tier,Array(preparedIndex-1).fill(null),requiredAfterCall);
   if(hash(expectedBudget)!==hash(input.decompositionBudget))throw Error('Decomposed mandatory tail budget mismatch');
   if(hash(candidate)!==hash(await read(path.join(dir,'decomposition-state.json')))||hash(candidate.plan)!==hash(await read(path.join(dir,'plan.json')))||
    hash(candidate.plan.scene)!==hash(scene)||feedback.sourceHash!==hash(scene))throw Error('Decomposed delta/state/source mismatch');
   if(stage.state==='rejected'&&stagedDesignAllocationEnabled(input.tier)&&['prototype-role','correct-prototype-role'].includes(stage.phase)){
    const result=await read(path.join(dir,'result.json')),saved=await optional(path.join(dir,'prototype-allocation.json'));
    if(saved||result.feedback?.designAllocation){
     if(!saved||saved.accepted!==false||saved.canAuthorizePlacement!==false||result.accepted!==false)throw Error('Rejected prototype allocation receipt is missing or inconsistent');
     const recipes=PROTOTYPE_ROLES.flatMap(role=>candidate.recipesByRole[role]??[]);
     const prototype=recipes.length?await readAssemblyPrototypeCandidate({directory:path.join(dir,'prototype'),plan:candidate.plan,recipes,seedFeedback:feedback}):null;
     const diagnostic=path.join(dir,'diagnostic'),seed=await readAssemblyBaseline(diagnostic,feedback.diagnosticAssetHash);
     const base=await readAssemblyBaseline(previousDiagnostic,previousFeedback.diagnosticAssetHash);
     const checked=expandedPrototypeRoutesEnabled(input.tier)&&recipes.length?checkPackageCellScope(base,seed,input.task):checkPackageGeometry(base,seed,input.task,previousFeedback,feedback);
     if(feedback.geometryPassed!==true||hash(checked)!==hash(feedback.packageCheck))throw Error('Decomposed seed scope differs from saved authority');
     if(prototype){
      const prior=previousExpanded??{diagnostic:previousDiagnostic,feedback:previousFeedback};
      const expandedBase=await readAssemblyBaseline(prior.diagnostic,prior.feedback.diagnosticAssetHash),expanded=await readAssemblyBaseline(prototype.diagnostic,prototype.feedback.diagnosticAssetHash);
      if(hash(checkPackageGeometry(expandedBase,expanded,input.task,prior.feedback,prototype.feedback))!==hash(prototype.feedback.packageCheck)||
       hash(prototype)!==hash(result.prototype))throw Error('Decomposed expanded scope/proposal mismatch');
     }
     let actualError;
     try{await inspectPrototypeRoleAllocation({state:candidate,checked:{diagnostic,feedback,prototype}});}
     catch(error){if(!error.designAllocationFeedback)throw error;actualError=error;}
     if(!actualError||stage.error!==actualError.message||saved.error!==actualError.message||result.error!==actualError.message||
      hash(saved.feedback)!==hash(actualError.designAllocationFeedback)||hash(result.feedback.designAllocation)!==hash(actualError.designAllocationFeedback))throw Error('Rejected prototype allocation differs from actual saved cells');
    }
   }
   return candidate;
  },
  async commit({stage,input,candidate,feedback}){
   if(tier&&hash(tier)!==hash(input.tier))throw Error('Decomposed stage changed its original policy');
   tier=input.tier;
   const dir=path.join(assemblyRoot,String(stage.index)),diagnostic=path.join(dir,'diagnostic');let prototype=null,recipes=[];
   if(['assembly-blueprint','correct-blueprint'].includes(stage.phase)){
    state=candidate;blueprintStage=stage.index;
    schedule=createDecompositionSchedule({...decompositionConfiguration(input.tier),packageIds:candidate.plan.packages.map(p=>p.id)});
    if(hash(schedule)!==hash(await read(path.join(assemblyRoot,'decomposition-schedule.json'))))throw Error('Decomposed required schedule differs from blueprint');
   }else{
    const witness=await inspectDecomposedRepresentatives(candidate,diagnostic,feedback);
    if(hash(witness)!==hash(await read(path.join(dir,'representative-witness.json'))))throw Error('Decomposed representative witness differs from saved cells/owners');
    const seed=await readAssemblyBaseline(diagnostic,feedback.diagnosticAssetHash),base=await readAssemblyBaseline(previousDiagnostic,previousFeedback.diagnosticAssetHash);
    recipes=PROTOTYPE_ROLES.flatMap(role=>candidate.recipesByRole[role]??[]);
    const checked=expandedPrototypeRoutesEnabled(input.tier)&&recipes.length?checkPackageCellScope(base,seed,input.task):checkPackageGeometry(base,seed,input.task,previousFeedback,feedback);
    if(hash(checked)!==hash(feedback.packageCheck))throw Error('Decomposed seed scope differs from saved authority');
    if(recipes.length){
     prototype=await readAssemblyPrototypeCandidate({directory:path.join(dir,'prototype'),plan:candidate.plan,recipes,seedFeedback:feedback});
     const prior=previousExpanded??{diagnostic:previousDiagnostic,feedback:previousFeedback};
     const expandedBase=await readAssemblyBaseline(prior.diagnostic,prior.feedback.diagnosticAssetHash),expanded=await readAssemblyBaseline(prototype.diagnostic,prototype.feedback.diagnosticAssetHash);
     const expandedCheck=checkPackageGeometry(expandedBase,expanded,input.task,prior.feedback,prototype.feedback);
     if(hash(expandedCheck)!==hash(prototype.feedback.packageCheck)||hash(prototype)!==hash((await read(path.join(dir,'result.json'))).prototype))throw Error('Decomposed expanded scope/proposal mismatch');
    }
    if(stagedDesignAllocationEnabled(input.tier)){
     const actual=await inspectPrototypeRoleAllocation({state:candidate,checked:{diagnostic,feedback,prototype}});
     if(hash(actual)!==hash(await read(path.join(dir,'prototype-allocation.json')))||
      hash(actual)!==hash((await read(path.join(dir,'result.json'))).prototypeAllocationReceipt))throw Error('Accepted prototype allocation differs from actual saved cells');
    }
    roles.push({role:input.role,task:input.task.id,stage:stage.index,sourceHash:hash(candidate.plan.scene),witnessHash:witness.witnessHash});
    state=candidate;previousExpanded=prototype;
   }
   previousDiagnostic=diagnostic;previousFeedback=feedback;return {prototype,recipes};
  },
  async verifyAllocationInput(input,plan,prototype){
   if(!tier||hash(input.tier)!==hash(tier))throw Error('Design allocation input changed its original staged policy');
   if(!stagedDesignAllocationEnabled(input.tier))return;
   if(!allocationReceipt){
    allocationReceipt=await inspectDesignAllocation({before:plan,plan,prototype,feedback:previousFeedback,diagnostic:previousDiagnostic,
     roles:state.roles,representatives:state.representativesByRole,tier:input.tier});
    allocatedPrototype=prototype;
    if(hash(allocationReceipt)!==hash(await read(path.join(assemblyRoot,'initial-design-allocation.json'))))throw Error('Initial design allocation differs from original saved cells');
   }
   if(hash(input.designAllocationReceipt)!==hash(allocationReceipt))throw Error('Model input design allocation differs from the accepted unapproved proposal');
  },
  async verifyRejectedAllocation(plan,dir,feedback,input,prototype,result){
   if(hash(input.tier)!==hash(tier))throw Error('Rejected design allocation changed its original staged policy');
   const response=await read(path.join(dir,'response.json'));
   const checked=await readAssemblyPrototypeCandidate({directory:path.join(dir,'prototype'),plan,
    recipes:response.recipes,seedFeedback:feedback});
   if(hash(checked)!==hash(prototype)||hash(result.prototypeRecipes)!==hash(response.recipes))
    throw Error('Rejected design prototype differs from original response and saved expansion');
   const before=revisedPlan??state.plan;let actualError;
   try{await inspectDesignAllocation({before,plan,prototype,feedback,diagnostic:path.join(dir,'diagnostic'),
    roles:state.roles,representatives:state.representativesByRole,tier:input.tier});}
   catch(error){if(!error.designAllocationFeedback)throw error;actualError=error;}
   if(!actualError)throw Error('Rejected design allocation has no actual uncovered owner cells');
   const saved=await read(path.join(dir,'design-allocation.json'));
   const expected={version:1,accepted:false,error:actualError.message,feedback:actualError.designAllocationFeedback};
   const expectedFeedback={...feedback,error:actualError.message,designAllocation:actualError.designAllocationFeedback};
   if(result.accepted!==false||result.error!==actualError.message||hash(saved)!==hash(expected)||
    hash(result.feedback)!==hash(expectedFeedback))throw Error('Rejected design allocation differs from actual saved cells');
  },
  async verifyRevision(plan,dir,feedback,input,prototype){
   if(hash(input.tier)!==hash(tier))throw Error('Design allocation revision changed its original staged policy');
   const before=revisedPlan??state.plan;
   checkStagedDesignAllocation(before,plan,state.representativesByRole,input.tier);
   checkSelectedConceptPlan(state.selected,plan);
   const witness=await inspectDecomposedRepresentatives({...state,plan},path.join(dir,'diagnostic'),feedback);
   if(hash(witness)!==hash(await read(path.join(dir,'representative-witness.json'))))throw Error('Revised decomposed representatives differ from actual saved geometry');
   if(stagedDesignAllocationEnabled(input.tier)){
    const actual=await inspectDesignAllocation({before,plan,prototype,feedback,diagnostic:path.join(dir,'diagnostic'),
     roles:state.roles,representatives:state.representativesByRole,tier:input.tier});
    if(hash(actual)!==hash(await read(path.join(dir,'design-allocation.json'))))throw Error('Revised design allocation differs from original authority or actual expanded cells');
    allocationReceipt=actual;allocatedPrototype=prototype;
   }
   revisedPlan=plan;
  },
  async final(summary,sourceHash){
   if(!state||roles.length!==4)throw Error('Final decomposed building lacks all required role receipts');
   const bound=bindDecomposedPrototypeProgram(state),record={version:1,blueprintStage,roles,scheduleHash:schedule.scheduleHash,
    sourceHash:hash(state.plan.scene),planHash:hash(state.plan),programHash:hash(bound.program),representatives:state.representativesByRole,
    diagnosticOnly:true,canAuthorizePlacement:false};
   const saved=await read(path.join(assemblyRoot,'decomposed-prototypes.json'));
   if(hash({...record,decompositionHash:hash(record)})!==hash(saved))throw Error('Decomposed aggregate role/prototype receipt mismatch');
   const expected={...record,independentConceptCalls:3,requiredRoleStagesAccepted:4,finalSourceHash:sourceHash,initialSeedOnly:true,
    architecturalCompletenessVerified:false,qualityGuaranteed:false,canAuthorizePlacement:false};
   if(hash(summary.decomposition)!==hash(expected))throw Error('Final decomposition summary differs from original role receipts');
   if(stagedDesignAllocationEnabled(tier)){
    const transition=await read(path.join(assemblyRoot,'prototype-transition.json')),review=await read(path.join(assemblyRoot,String(transition.reviewStage),'response.json'));
    const frozen=designAllocationFreeze(allocationReceipt,{plan:allocatedPrototype.plan,review,transition});
    if(hash(frozen)!==hash(await read(path.join(assemblyRoot,'design-allocation-freeze.json'))))throw Error('Manufacturing allocation freeze differs from accepted review');
    const interfaces=await read(path.join(assemblyRoot,'interfaces.json'));
    if(interfaces.allocationFreezeHash!==frozen.freezeHash||interfaces.planHash!==frozen.frozenPlanHash||hash(interfaces.packages)!==frozen.packagesHash||
     interfaces.sourceHash!==hash(allocatedPrototype.plan.scene)||hash(interfaces.constraints)!==hash(allocatedPrototype.plan.scene.constraints)||
     interfaces.interfacesFrozen!==true||interfaces.canAuthorizePlacement!==false)throw Error('Manufacturing packages differ from exact design allocation freeze');
   }
  }
 };
}
