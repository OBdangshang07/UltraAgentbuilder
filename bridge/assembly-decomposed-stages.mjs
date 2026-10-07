import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../src/generation/compiler.mjs';
import {conceptSetSchema,validateConceptSet,conceptSelectionSchema,validateConceptSelection,CONCEPT_SET_RULES,CONCEPT_SELECTION_RULES,massingAnchors} from '../contracts/scene-concepts.mjs';
import {assemblyBlueprintStageSchema,applyAssemblyBlueprint,prototypeRoleStageSchema,prototypeRoleRecipeBudget,applyPrototypeRoleEdit,decomposedProgramHash,bindDecomposedPrototypeProgram,DECOMPOSED_BLUEPRINT_RULES,DECOMPOSED_ROLE_RULES} from '../contracts/scene-decomposed-prototypes.mjs';
import {decompositionBlueprintBudget,createDecompositionSchedule,PROTOTYPE_ROLES,decompositionConfiguration,decompositionPreludeProgress} from './assembly-decomposition-budget.mjs';
import {inspectConcept} from './assembly-concepts.mjs';
import {createNativeComparison} from './native-evidence.mjs';
import {inspectAssemblyPrototypes} from './assembly-prototypes.mjs';
import {assemblyCapacity,readAssemblyBaseline} from '../src/design/assembly-scope.mjs';
import {inspectCheckpoint} from './scene-checkpoints.mjs';
import {sourceIdentityGuidance,SOURCE_IDENTITY_RULES} from '../contracts/scene-source-identity-guidance.mjs';
import {prototypeSurfaceGuidance,BLUEPRINT_SURFACE_RULES,ROLE_SURFACE_RULES,BLUEPRINT_FACADE_SURFACE_RULES,ROLE_FACADE_SURFACE_RULES} from '../contracts/scene-prototype-surface-guidance.mjs';
import {stagedDesignAllocationEnabled} from '../contracts/scene-design-allocation.mjs';
import {inspectPrototypeRoleAllocation,PROTOTYPE_ALLOCATION_POLICY,PROTOTYPE_ALLOCATION_RULES} from './assembly-design-allocation.mjs';
import {expandedPrototypeRoutesEnabled,PROTOTYPE_SEED_SCOPE_INSPECTION,EXPANDED_PROTOTYPE_ROUTE_RULES} from '../contracts/assembly-prototype-validation.mjs';
import {stagedDesignCorrectionReserve} from '../contracts/assembly-completion-reserve.mjs';

const write=(directory,name,value)=>fs.writeFile(path.join(directory,name),JSON.stringify(value,null,2),{flag:'wx'});
const failure=error=>({accepted:false,error:error.message,feedback:{geometryPassed:false,canAuthorizePlacement:false,
 contract:error.contract??{valid:false,issues:[{path:'$',code:'decomposed-source',message:error.message}]}}});
export function decompositionTailBudget(tier,records,requiredAfterCall){
 if(!Number.isSafeInteger(requiredAfterCall)||requiredAfterCall<0||!Number.isSafeInteger(tier.maximumCalls)||tier.maximumCalls>26)throw Error('Invalid decomposition mandatory tail');
 const remaining=tier.maximumCalls-records.length;
 if(remaining<1+requiredAfterCall)throw Error('Decomposition call would consume the required complete-task tail');
 return {version:1,remaining,requiredAfterCall,mandatoryCalls:1+requiredAfterCall,spareCalls:remaining-1-requiredAfterCall,canAuthorizePlacement:false};
}
/** New v3 policy only: additional role corrections spend spare calls while
 * preserving every later role/package/review and two corrective tail slots.
 * A frozen v2 policy keeps its original fixed cap; journals are not upgraded. */
export function decompositionRoleCorrectionBudget(tier,records,{roleIndex,packageCount,correction}){
 if(!Number.isSafeInteger(roleIndex)||roleIndex<0||roleIndex>3||!Number.isSafeInteger(packageCount)||packageCount<4||packageCount>16||
  !Number.isSafeInteger(correction)||correction<0||!Number.isSafeInteger(tier.maximumCalls)||tier.maximumCalls>26||
  !Number.isSafeInteger(tier.maximumComponentCorrections)||tier.maximumComponentCorrections<0||records.length>tier.maximumCalls)throw Error('Invalid prototype correction progress');
 const extension=correction>tier.maximumComponentCorrections,p=tier.prototypes;
 const throughReview=[4,5,6].includes(p?.version)&&p.roleCorrections?.version===2&&p.roleCorrections.mode==='tail-funded-through-review'
  &&p.roleCorrections.reservedTailCorrections===2&&tier.recovery?.mode==='safe';
 const extended=throughReview||p?.version===3&&p.roleCorrections?.version===1&&p.roleCorrections.mode==='tail-funded'&&p.roleCorrections.reservedTailCorrections===2&&tier.recovery?.mode==='safe';
 const remaining=tier.maximumCalls-records.length,requiredAfterCall=3-roleIndex+packageCount+2;
 // Legacy v3 preserves its old exact semantics for independent replay. In v4
 // EVERY subsequent primary/correction retains the two design-review slots;
 // a later role's normal correction cannot spend an earlier extension's tail.
 const designCorrectionReserve=stagedDesignCorrectionReserve(tier);
 const reservedTailCorrections=throughReview||extension&&extended?2+designCorrectionReserve:0,mandatoryCalls=1+requiredAfterCall+reservedTailCorrections;
 const authorized=!extension||extended,canStart=authorized&&remaining>=mandatoryCalls;
 return {version:1,roleIndex,packageCount,remaining,requiredAfterCall,mandatoryCalls,reservedTailCorrections,extension,correction,canStart,
  stopReason:canStart?null:!authorized?'prototype-correction-limit':'prototype-required-tail-unfunded',canAuthorizePlacement:false};
}
/** A visual revision must retain every required responsibility and fund another
 * seed review, every first-construction package and the final building review. */
export function decompositionRevisionBudget(tier,records,{round,packageCount,correctionsUsed=0,correcting=false}){
 if(!Number.isSafeInteger(round)||round<0||!Number.isSafeInteger(packageCount)||packageCount<4||
  !Number.isSafeInteger(correctionsUsed)||correctionsUsed<0)throw Error('Invalid staged revision progress');
 // A NEW opted-in visual revision must also fund one rejected-edit correction.
 // Once correcting, the current call spends that reserved slot; it still funds
 // every package, the new concept review and the final complete-building review.
 const reservedHeadroom=correcting?0:stagedDesignCorrectionReserve(tier);
 // Validate an opted-in policy on corrections too, without keeping a spent
 // correction reserved forever or silently adding another mandatory slot.
 if(correcting)stagedDesignCorrectionReserve(tier);
 const remaining=tier.maximumCalls-records.length,mandatoryCalls=packageCount+3+reservedHeadroom;
 const extension=round>=tier.designReview.maximumRevisions;
 const correctionExtension=correcting&&correctionsUsed>=tier.maximumComponentCorrections;
 const authorized=(!extension||tier.designReview.budgetedExtensions===true)&&(!correctionExtension||tier.designReview.budgetedCorrections===true);
 const canStart=authorized&&remaining>=mandatoryCalls,allocation=stagedDesignAllocationEnabled(tier);
 return {version:1,remaining,maximumPackages:packageCount,currentPackageCount:packageCount,mandatoryCalls,
  minimumReviewCalls:2,reservedHeadroom,interfacesFrozen:true,responsibilitiesFrozen:!allocation,...(allocation?{designAllocation:structuredClone(tier.prototypes.designAllocation)}:{}),extension,correctionExtension,
  correctionsUsed,canStart,stopReason:canStart?null:!authorized?'staged-revision-limit':'staged-required-path-unfunded',canAuthorizePlacement:false};
}
const configuration=decompositionConfiguration;
const cameras=scene=>[-35,145,55,235].map((yaw,i)=>({id:'concept-'+i,purpose:'exterior',yaw,pitch:i<2?20:10,
 min:[0,0,0],max:[scene.bounds.width,scene.bounds.height,scene.bounds.length],width:512,height:512}));

/** Independently received small concepts, not a synthetic model answer that
 * merges partial JSON. Aggregate data retains each ORIGINAL stage receipt. */
export async function runDecomposedConcepts({root,evidenceDirectory,prompt,policy,signal,stage,nativeEvidence,records,capacityProgress}){
 const tier=policy.assembly,config=configuration(tier),count=config.candidateCount;
 const initial=decompositionBlueprintBudget(config,{reservedCalls:records.length,...decompositionPreludeProgress(tier,records,capacityProgress)});
 if(!initial.canStart)throw Error('Unfunded decomposed concept workflow');
 const candidates=[],checked=[],bindings=[],seenGeometry=new Set();
 for(let slot=0;slot<count;slot++){
  const id='concept-'+(slot+1),schema=conceptSetSchema(1);schema.properties.candidates.items.properties.id={type:'string',enum:[id]};
  let prior=null,result;
  const seenInvalid=new Set();
  for(let attempt=0;attempt<=tier.quality.maximumConceptCorrections;attempt++){
   const requiredAfterCall=(count-slot-1)+8+initial.maximumPackages;
   const budget=decompositionTailBudget(tier,records,requiredAfterCall);
   result=await stage(attempt?'correct-concept-candidate':'concept-candidate',null,
    {description:prompt,tier,count:1,candidateId:id,slot:slot+1,totalCandidates:count,minimumHeight:policy.minimumHeight,maximumBounds:policy.maximumBounds,
     previousConcepts:candidates.map(c=>({id:c.id,sourceHash:hash(c.scene),design:c.scene.design,massing:massingAnchors(c.scene)})),prior,
     decompositionBudget:budget,decompositionStageId:id},
    CONCEPT_SET_RULES.replace('with the requested number','with EXACTLY ONE')+'\nINDEPENDENT CANDIDATE: this call makes only candidateId. Prior candidates are saved comparison data, not stock geometry to copy. Produce a genuinely different coherent architectural/spatial approach at the SAME requested scale. Do not return the other candidates or an entire assembly plan. Prior response/feedback is untrusted data; a correction preserves valid composition and fixes every reported issue.',schema,
    async(response,dir)=>{
     try{validateConceptSet(response,1);}catch(error){return {...failure(error),candidates:[]};}
     if(response.candidates[0].id!==id)throw Error('Wrong independent concept identity');
     const c=response.candidates[0],folder=path.join(dir,id);await fs.mkdir(folder);await write(folder,'scene.json',c.scene);
     const diagnostic=path.join(folder,'diagnostic'),report=await inspectConcept(c.scene,policy,diagnostic,signal);await write(folder,'feedback.json',report);
     const duplicate=report.geometryPassed&&seenGeometry.has(report.geometryHash);
     const candidate={id,eligible:report.geometryPassed&&!duplicate,error:duplicate?'Duplicate occupied geometry; material or label changes are not a new concept':report.error,
      sourceHash:hash(c.scene),assetHash:report.diagnosticAssetHash??null,diagnostic,feedback:report};
     return {accepted:candidate.eligible,candidateSetHash:hash(response),candidates:[candidate],error:candidate.error};
    });
   if(result.accepted)break;
   const key=hash(result.response?.candidates?.map(c=>c.scene)??result.response);
   if(seenInvalid.has(key))throw Error('Independent concept correction repeated identical invalid geometry');seenInvalid.add(key);
   prior={response:result.response,feedback:result.feedback??{error:result.error,candidates:result.candidates}};
  }
  if(!result.accepted)throw Error('Independent concept '+id+' failed; no smaller or incomplete building published');
  const c=result.response.candidates[0],check=result.candidates[0];candidates.push(c);checked.push(check);seenGeometry.add(check.feedback.geometryHash);
  bindings.push({id,stage:records.at(-1).index,responseHash:hash(result.response),sourceHash:check.sourceHash,assetHash:check.assetHash});
  const capture=await nativeEvidence({bundleDirectory:check.diagnostic,sourceHash:check.sourceHash,assetHash:check.assetHash,views:cameras(c.scene),signal});
  if(capture.evidence.sourceHash!==check.sourceHash||capture.evidence.assetHash!==check.assetHash||capture.evidence.kind!=='native-asset')throw Error('Independent concept capture identity mismatch');
  check.requestHash=capture.evidence.requestHash;
 }
 const aggregate={format:'SceneConceptSet',version:1,candidates};validateConceptSet(aggregate,count);const candidateSetHash=hash(aggregate);
 await write(root,'decomposed-concepts.json',{version:1,aggregate,candidateSetHash,bindings,diagnosticOnly:true,modelResponse:false,canAuthorizePlacement:false});
 const subjects=checked.map(c=>({id:c.id,sourceHash:c.sourceHash,assetHash:c.assetHash,requestHash:c.requestHash}));
 const {evidence,images}=await createNativeComparison(evidenceDirectory,candidateSetHash,subjects);
 const result=await stage('select-concept',null,{description:prompt,tier,candidateSetHash,candidates,excluded:[],designEvidence:evidence,
  decompositionBudget:decompositionTailBudget(tier,records,7+initial.maximumPackages),decompositionStageId:'selection'},
  CONCEPT_SELECTION_RULES,conceptSelectionSchema(subjects.map(s=>s.id)),async response=>({accepted:true,selection:validateConceptSelection(response,candidateSetHash,evidence)}),images);
 const decision={version:1,candidateSetHash,selection:result.selection,selected:candidates.find(c=>c.id===result.selection.selected),eligible:subjects.map(s=>s.id),excluded:[],
  decompositionVersion:1,candidateBindings:bindings,canAuthorizePlacement:false};
 await write(root,'concept-selection.json',decision);return decision;
}

/** Counts and bounds come from the actually SAVED cell/owner bundle. This is
 * not a full-floor/architecture score: image review must evaluate completeness. */
export async function inspectDecomposedRepresentatives(state,directory,feedback){
 if(feedback.sourceHash!==hash(state.plan.scene))throw Error('Prototype representative feedback changed source');
 const actual=await readAssemblyBaseline(directory,feedback.diagnosticAssetHash),sources=actual.designSources,roles=[];
 if(sources.sourceHash!==hash(state.plan.scene))throw Error('Prototype representative provenance changed source');
 for(const role of state.completedRoles){
  const task=state.roles.find(r=>r.role===role).task;
  const representatives=state.representativesByRole[role].map(r=>({kind:r.kind,components:r.components.map(id=>{
   const component=state.plan.scene.components.find(c=>c.id===id),solidCells=sources.surviving[id]??0,clearCells=sources.survivingClear[id]??0;
   const bounds=sources.componentBounds[id];
   if(!component||!bounds?.length||!solidCells&&!clearCells)throw Error('Prototype representative has no surviving real source geometry: '+id);
   return {id,kind:component.kind,solidCells,clearCells,bounds:structuredClone(bounds)};
  })}));
  roles.push({role,task,representatives});
 }
 const data={version:1,sourceHash:hash(state.plan.scene),assetHash:feedback.diagnosticAssetHash,cellsHash:actual.manifest.cellsHash,
  ownersHash:actual.manifest.scene.ownersHash,provenanceHash:actual.manifest.scene.sourcesHash,roles,
  survivingGeometryVerified:true,architecturalCompletenessVerified:false,visualQualityVerified:false,canAuthorizePlacement:false};
 return {...data,witnessHash:hash(data)};
}

/** Shares the caller's one durable stage dispatcher and budget. Never invokes
 * a second provider adapter, adopts invalid output or grants placement rights. */
export async function runDecomposedPrototypeStages({root,prompt,selectedConcept,policy,signal,stage,records,inspect=inspectCheckpoint,capacityProgress}){
 const tier=policy.assembly,config=configuration(tier),selected=selectedConcept.selected;
 const allocationEnabled=stagedDesignAllocationEnabled(tier);
 const expandedRoutes=expandedPrototypeRoutesEnabled(tier);
 let state,checked,stageDirectory,blueprintStage,prior=null;
 for(let attempt=0;attempt<=tier.maximumPlanCorrections;attempt++){
  const callBudget=decompositionBlueprintBudget(config,{reservedCalls:records.length,completedCandidates:config.candidateCount,selectionAccepted:true,...decompositionPreludeProgress(tier,records,capacityProgress)});
  if(!callBudget.canStart)throw Error('Unfunded decomposition blueprint; no complete-task work omitted');
  const result=await stage(attempt?'correct-blueprint':'assembly-blueprint',null,{description:prompt,tier,selectedConcept,sourceHash:hash(selected.scene),callBudget,prior,
   minimumHeight:policy.minimumHeight,maximumBounds:policy.maximumBounds,decompositionBudget:decompositionTailBudget(tier,records,6+callBudget.maximumPackages),decompositionStageId:'blueprint'},
   DECOMPOSED_BLUEPRINT_RULES+'\n'+BLUEPRINT_SURFACE_RULES+'\n'+BLUEPRINT_FACADE_SURFACE_RULES+(allocationEnabled?'\n'+PROTOTYPE_ALLOCATION_RULES:'')+'\nCORRECTION: if prior is supplied, it is a rejected delta. Return a corrected delta against the SAME selected source, preserving already-valid structural work, not a new full scene. Every required task, function and selected massing anchor must remain.',
   assemblyBlueprintStageSchema(selected,tier,callBudget),async(response,dir)=>{
    if(response?.sourceHash!==hash(selected.scene)||response?.sceneEdit?.sourceHash!==hash(selected.scene))throw Error('Stale selected blueprint identity');
    let candidate;try{candidate=applyAssemblyBlueprint(selected,response,{...tier,maxPackages:callBudget.maximumPackages});}catch(error){return failure(error);}
    await write(dir,'decomposition-state.json',candidate);await write(dir,'plan.json',candidate.plan);await write(dir,'changes.json',candidate.changes);await write(dir,'scene.json',candidate.plan.scene);
    const diagnostic=path.join(dir,'diagnostic'),feedback=await inspect(candidate.plan.scene,policy,diagnostic,signal,{});
    if(feedback.sourceHash!==hash(candidate.plan.scene)||feedback.canAuthorizePlacement!==false)throw Error('Blueprint inspection identity mismatch');
    await write(dir,'feedback.json',feedback);
    const capacity=assemblyCapacity(candidate.plan,candidate.plan.scene),accepted=feedback.geometryPassed&&capacity.assembly.feasible;
    return {accepted,state:candidate,plan:candidate.plan,scene:candidate.plan.scene,feedback,diagnostic,error:feedback.error??(!capacity.assembly.feasible?'Blueprint cannot fund required component slots':null)};
   });
  if(result.accepted){state=result.state;checked=result;stageDirectory=result.dir;blueprintStage=records.at(-1).index;break;}
  const fingerprint=hash(result.response);if(prior?.responseHash===fingerprint)throw Error('Blueprint correction repeated the same rejected delta');
  prior={response:result.response,responseHash:fingerprint,feedback:result.feedback};
 }
 if(!state)throw Error('Decomposed blueprint failed; no incomplete building published');
 const schedule=createDecompositionSchedule({...config,packageIds:state.plan.packages.map(p=>p.id)});
 await write(root,'decomposition-schedule.json',schedule);
 const roles=[];
 for(const [roleIndex,role] of PROTOTYPE_ROLES.entries()){
  const task=state.plan.packages.find(p=>p.id===state.roles[roleIndex].task),originalStateHash=hash(state),originalChecked=checked;
  const seen=new Set();let prior=null,accepted=null;
  for(let correction=0;correction<=tier.maximumCalls;correction++){
   const correctionBudget=decompositionRoleCorrectionBudget(tier,records,{roleIndex,packageCount:state.plan.packages.length,correction});
   if(!correctionBudget.canStart)break;
   const budget=decompositionTailBudget(tier,records,correctionBudget.requiredAfterCall);
   const result=await stage(correction?'correct-prototype-role':'prototype-role',task,{description:prompt,tier,role,task,planHash:hash(state.plan),sourceHash:hash(state.plan.scene),
    programHash:decomposedProgramHash(state),previousDraft:state.plan.scene,
    prototypeState:{version:state.version,roles:state.roles,completedRoles:state.completedRoles,recipesByRole:state.recipesByRole,representativesByRole:state.representativesByRole},prior,
    prototypeRecipeBudget:prototypeRoleRecipeBudget(state,role),
    capacity:assemblyCapacity(state.plan,state.plan.scene,[],task),feedback:checked.feedback,decompositionBudget:budget,prototypeCorrectionBudget:correctionBudget,decompositionStageId:role,
    sourceIdentityPolicy:sourceIdentityGuidance(task,prior),prototypeSurfacePolicy:prototypeSurfaceGuidance(state.plan.scene,task),
    ...(allocationEnabled?{prototypeAllocationPolicy:structuredClone(PROTOTYPE_ALLOCATION_POLICY)}:{})},
    DECOMPOSED_ROLE_RULES+'\n'+SOURCE_IDENTITY_RULES+'\n'+ROLE_SURFACE_RULES+'\n'+ROLE_FACADE_SURFACE_RULES+(allocationEnabled?'\n'+PROTOTYPE_ALLOCATION_RULES:'')+(expandedRoutes?'\n'+EXPANDED_PROTOTYPE_ROUTE_RULES:'')+'\nCORRECTION: prior is an unapproved role delta. Fix every reported source/geometry/expansion issue against the SAME original state. No failed seed or partial model text is adopted; preserve valid work within this role and do not modify another role.',
    prototypeRoleStageSchema(state,role),async(response,dir)=>{
     if(response?.planHash!==hash(state.plan)||response?.programHash!==decomposedProgramHash(state)||response?.edit?.sourceHash!==hash(state.plan.scene))throw Error('Stale prototype role identity');
     let candidate;try{candidate=applyPrototypeRoleEdit(state,response,tier);}catch(error){return failure(error);}
     await write(dir,'decomposition-state.json',candidate);await write(dir,'plan.json',candidate.plan);await write(dir,'changes.json',candidate.changes);await write(dir,'scene.json',candidate.plan.scene);
     const recipes=PROTOTYPE_ROLES.flatMap(r=>candidate.recipesByRole[r]??[]);
     const assembly={baselineDirectory:checked.diagnostic,baseAssetHash:checked.feedback.diagnosticAssetHash,task,previousFeedback:checked.feedback,
      ...(expandedRoutes&&recipes.length?{inspection:PROTOTYPE_SEED_SCOPE_INSPECTION}:{})};
     const diagnostic=path.join(dir,'diagnostic'),feedback=await inspect(candidate.plan.scene,policy,diagnostic,signal,assembly);
     if(feedback.sourceHash!==hash(candidate.plan.scene)||feedback.canAuthorizePlacement!==false)throw Error('Prototype role inspection identity mismatch');
     await write(dir,'feedback.json',feedback);
     let report={accepted:feedback.geometryPassed,scene:candidate.plan.scene,feedback,diagnostic,error:feedback.error};
     if(!report.accepted)return {...report,state:candidate,plan:candidate.plan};
     let witness;try{witness=await inspectDecomposedRepresentatives(candidate,diagnostic,feedback);}catch(error){return {...report,...failure(error),state:candidate,plan:candidate.plan};}
     await write(dir,'representative-witness.json',witness);
     if(recipes.length){
      // Compare the NEW full expansion to the prior full expansion, not the
      // seed-only baseline: prior roles' repeated owners remain protected.
      const priorExpanded=checked.prototype??checked;
      report=await inspectAssemblyPrototypes({plan:candidate.plan,recipes,checked:report,directory:dir,policy,signal,
       inspect:(scene,p,folder,s)=>inspect(scene,p,folder,s,{baselineDirectory:priorExpanded.diagnostic,
        baseAssetHash:priorExpanded.feedback.diagnosticAssetHash,task,previousFeedback:priorExpanded.feedback})});
     }
     if(report.accepted&&!assemblyCapacity(candidate.plan,candidate.plan.scene).assembly.feasible)return {...report,...failure(Error('Prototype role consumes required component headroom')),state:candidate};
     if(report.accepted&&allocationEnabled){
      let allocation;
      try{allocation=await inspectPrototypeRoleAllocation({state:candidate,checked:report});}
      catch(error){
       if(!error.designAllocationFeedback)throw error;
       await write(dir,'prototype-allocation.json',{version:1,accepted:false,error:error.message,feedback:error.designAllocationFeedback,canAuthorizePlacement:false});
       return {...report,accepted:false,error:error.message,feedback:{...report.feedback,designAllocation:error.designAllocationFeedback},state:candidate,plan:candidate.plan};
      }
      await write(dir,'prototype-allocation.json',allocation);report={...report,prototypeAllocationReceipt:allocation};
     }
     return {...report,state:candidate,plan:candidate.plan,representativeWitness:witness};
    });
   if(result.accepted){accepted=result;break;}
   const key=hash(result.response);if(seen.has(key))throw Error('Prototype role correction repeated the same rejected delta');seen.add(key);
   prior={response:result.response,feedback:result.feedback,error:result.error,overallAccepted:false,
    interpretation:allocationEnabled?'A passed seed-only report does not approve expansion or witness allocation. prototypeExpansion/designAllocation feedback and this error describe the rejected proposal; correct every failing instance or unsupported witness claim within this same role.':'A passed seed-only report does not approve expansion. prototypeExpansion feedback and this error describe the rejected full-instance proposal; correct every failing instance within this role.'};
  }
  if(!accepted)throw Error('Required prototype role '+role+' failed; original accepted seed preserved');
  if(hash(state)!==originalStateHash||checked!==originalChecked)throw Error('Rejected prototype stage mutated its baseline');
  state=accepted.state;checked=accepted;stageDirectory=accepted.dir;
  roles.push({role,task:task.id,stage:records.at(-1).index,sourceHash:hash(state.plan.scene),witnessHash:accepted.representativeWitness.witnessHash});
 }
 const bound=bindDecomposedPrototypeProgram(state);
 if(!checked.prototype||hash(checked.prototype.program)!==hash(bound.program))throw Error('Complete prototype set lacks the current full-instance inspection');
 const record={version:1,blueprintStage,roles,scheduleHash:schedule.scheduleHash,sourceHash:hash(state.plan.scene),planHash:hash(state.plan),
  programHash:hash(bound.program),representatives:state.representativesByRole,diagnosticOnly:true,canAuthorizePlacement:false};
 await write(root,'decomposed-prototypes.json',{...record,decompositionHash:hash(record)});
 return {plan:state.plan,ordered:state.ordered,scene:state.plan.scene,feedback:checked.feedback,diagnostic:checked.diagnostic,
  prototype:checked.prototype,prototypeRecipes:bound.program.recipes,state,decomposition:record,dir:stageDirectory};
}
