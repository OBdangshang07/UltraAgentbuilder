import {sceneSchema,validateScene} from './scene-spec.schema.mjs';
import {applySceneDraftEdit,sceneDraftEditSchema,DraftCandidateError} from './scene-draft-edit.schema.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {schemaFeedback} from './schema-feedback.mjs';
const obj=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const str=maxLength=>({type:'string',maxLength,minLength:1});
const id={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_]{0,11}$'};
const arr=(items,maxItems,minItems=0)=>({type:'array',items,maxItems,minItems});
const vec=min=>arr({type:'integer',minimum:min,maximum:384},3,3);
const scene=structuredClone(sceneSchema);delete scene.$defs;
export const assemblyPlanSchema=obj({format:{type:'string',enum:['SceneAssemblyPlan']},version:{type:'integer',enum:[1]},
  designIntent:str(2400),scene,
  packages:arr(obj({id,name:str(80),purpose:str(1200),dependsOn:arr(id,16),regions:arr(obj({origin:vec(0),size:vec(1)}),8,1),editableComponents:arr({type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,31}$'},256),interfaces:arr({type:'integer',minimum:0,maximum:255},256)}),16,2)});
assemblyPlanSchema.$defs=structuredClone(sceneSchema.$defs);
assemblyPlanSchema.properties.packages.items.properties.interfaces.description='Zero-based positions in the resulting scene.constraints.passages array, not floor Y heights, coordinates, or one-based numbers. Update references in the same edit if passages change.';
const draftEdit=structuredClone(sceneDraftEditSchema);delete draftEdit.$defs;
export const assemblyPlanEditSchema=obj({format:{type:'string',enum:['SceneAssemblyPlanEdit']},version:{type:'integer',enum:[1]},
  planHash:{type:'string',pattern:'^[a-f0-9]{64}$'},sceneEdit:draftEdit,
  packages:obj({put:arr(structuredClone(assemblyPlanSchema.properties.packages.items),16),remove:arr(id,16)})});
assemblyPlanEditSchema.$defs=structuredClone(sceneSchema.$defs);
// Only an UNAPPROVED, contract-invalid proposal can use this replacement.
// Accepted sources and ordinary geometry repairs continue to use hashed deltas.
const proposal=structuredClone(assemblyPlanSchema);delete proposal.$defs;
export const assemblyPlanRepairSchema=obj({format:{type:'string',enum:['SceneAssemblyPlanRepair']},version:{type:'integer',enum:[1]},planHash:{type:'string',pattern:'^[a-f0-9]{64}$'},proposal});
assemblyPlanRepairSchema.$defs=structuredClone(sceneSchema.$defs);

export function inspectAssemblyPlan(plan,policy){
  const contract=schemaFeedback(plan,assemblyPlanSchema);
  if(contract.valid){const issues=sceneIdentityIssues(plan.scene);if(issues.length){contract.valid=false;contract.issues.push(...issues);}}
  if(contract.valid){const ownership=planOwnershipIssues(plan);if(ownership.issues.length){contract.valid=false;contract.issues.push(...ownership.issues);contract.truncated=ownership.truncated;}}
  if(contract.valid)try{validateAssemblyPlan(plan,policy);}catch(error){contract.valid=false;contract.issues.push({path:'$',code:'plan-relations',message:error.message});}
  return {version:1,planHash:hash(plan),contract,geometryPassed:false,canAuthorizePlacement:false,error:contract.valid?null:'Assembly contract: '+contract.issues.map(i=>i.path+': '+i.code+(i.field?' '+i.field:'')+(i.message?' '+i.message:'')).join('; ').slice(0,3000)};
}
export function applyAssemblyPlanRepair(source,edit,policy){
  only(edit,Object.keys(assemblyPlanRepairSchema.properties));
  if(edit.format!=='SceneAssemblyPlanRepair'||edit.version!==1||edit.planHash!==hash(source))throw new Error('Stale/invalid assembly repair hash');
  if(inspectAssemblyPlan(source,policy).contract.valid)throw new Error('A valid plan requires a scoped plan edit, not a replacement');
  const next=structuredClone(edit.proposal),ordered=validateAssemblyPlan(next,policy);
  // Preserve every well-formed identity/intent field from the rejected source.
  // Malformed fields have no valid identity to freeze; user scale/functions are
  // still checked by the exact original policy and final geometry validation.
  for(const field of ['id','seed','bounds']){
    const schema={...sceneSchema.properties[field],$defs:sceneSchema.$defs};
    if(source?.scene&&Object.hasOwn(source.scene,field)&&schemaFeedback(source.scene[field],schema).valid&&hash(source.scene[field])!==hash(next.scene[field]))throw new Error('Plan repair changed fixed '+field);
  }
  for(const [field,before,after,schema] of [
    ['designIntent',source?.designIntent,next.designIntent,assemblyPlanSchema.properties.designIntent],
    ['scene.design',source?.scene?.design,next.scene.design,{...sceneSchema.properties.design,$defs:sceneSchema.$defs}]
  ])if(schemaFeedback(before,schema).valid&&hash(before)!==hash(after))throw new PlanRepairIntentError(field,before,after);
  return {plan:next,ordered,changes:{basePlanHash:hash(source),planHash:hash(next),unapprovedContractRepair:true,interfacesFrozen:false}};
}
// Reject the completed answer, not the entire task, when it paraphrases frozen
// intent. No field is normalized/copied into the answer and no candidate is
// adopted. The caller may use its existing bounded correction allowance only.
export class PlanRepairIntentError extends Error{
  constructor(field,expected,actual){
    super(field==='designIntent'?'Plan repair changed original design intent':'Plan repair changed fixed design');
    this.name='PlanRepairIntentError';
    this.contract={valid:false,issues:[{path:'$.proposal.'+field,code:'frozen-plan-intent',field,expected:structuredClone(expected),actual:structuredClone(actual),message:'Restore this exact original field, including feature wording and order. It is read-only during contract repair.'}],checksComplete:true,truncated:false};
  }
}
export const assemblyReviewSchema=obj({format:{type:'string',enum:['SceneAssemblyReview']},version:{type:'integer',enum:[1]},sourceHash:{type:'string',pattern:'^[a-f0-9]{64}$'},
  verdict:{type:'string',enum:['accept','revise']},task:{type:['string','null']},summary:str(1200),issues:arr(obj({task:id,criterion:{type:'string',enum:['composition','facade','interior','circulation','interfaces','materials']},evidence:str(1200),change:str(1200)}),16)});
const only=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(v,k)))throw new Error('Assembly unexpected/missing fields');};
const text=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error('Invalid assembly text');};
const list=(v,max,min=0)=>{if(!Array.isArray(v)||v.length<min||v.length>max)throw new Error('Invalid assembly list');};
const unique=v=>{if(new Set(v).size!==v.length)throw new Error('Duplicate assembly reference');};
// A hashed put/remove edit cannot disambiguate repeated IDs, including identical
// objects. Classify these as an invalid UNAPPROVED plan before geometry so the
// existing bounded whole-proposal repair can run. Never silently deduplicate.
function sceneIdentityIssues(scene){
  const issues=[];
  for(const field of ['components','modules','palette','reservations']){
    const key=field==='palette'?'role':'id',seen=new Map();
    for(const [index,item] of scene[field].entries()){
      const value=item[key];
      if(seen.has(value))issues.push({path:`$.scene.${field}[${index}].${key}`,code:'duplicate-source-id',field,value,firstPath:`$.scene.${field}[${seen.get(value)}].${key}`,message:`Duplicate ${field} ${key}: ${value}; ID-based edits cannot select an occurrence. Correct the unapproved proposal with unique identities and consistent references.`});
      else seen.set(value,index);
    }
  }
  return issues;
}
function planOwnershipIssues(plan){
  const components=new Set(plan.scene.components.map(c=>c.id)),owners=new Map(),issues=[];let truncated=false;
  const add=issue=>{if(issues.length<128)issues.push(issue);else truncated=true;};
  for(const [packageIndex,p] of plan.packages.entries())for(const [index,component] of p.editableComponents.entries()){
    const path=`$.packages[${packageIndex}].editableComponents[${index}]`;
    if(!components.has(component)){add({path,code:'unknown-component-owner',package:p.id,component,message:`Package ${p.id} references missing scene.components ID ${component}; use an actual source component, not a generated child or future ID.`});continue;}
    if(owners.has(component)){const first=owners.get(component);add({path,code:'shared-component-owner',package:p.id,component,firstPackage:first.package,firstPath:first.path,message:`Component ${component} already belongs to package ${first.package}; mutable ownership must be exclusive.`});}
    else owners.set(component,{package:p.id,path});
  }
  return {issues,truncated};
}
export class AssemblyCandidateError extends Error{
  constructor(error,plan){super(error.message);this.name='AssemblyCandidateError';this.plan=plan;}
}
export class PackageCandidateError extends Error{
  constructor(message){super(message);this.name='PackageCandidateError';}
}
export function validateAssemblyPlan(plan,policy){
  if(Buffer.byteLength(JSON.stringify(plan))>1200000)throw new Error('Assembly plan byte quota exceeded');
  only(plan,Object.keys(assemblyPlanSchema.properties));if(plan.format!=='SceneAssemblyPlan'||plan.version!==1)throw new Error('Invalid assembly plan');text(plan.designIntent,2400);validateScene(plan.scene);
  const identityIssues=sceneIdentityIssues(plan.scene);if(identityIssues.length)throw new Error(identityIssues.map(i=>i.message).join('; '));
  if(!plan.scene.constraints.interior||!plan.scene.constraints.walkable||!plan.scene.constraints.passages.length)throw new Error('Assembly must preserve interior/walkable and interface probes');
  list(plan.packages,policy.maxPackages,2);const ids=new Set(),owners=new Map(),components=new Set(plan.scene.components.map(c=>c.id));
  for(const p of plan.packages){
    only(p,Object.keys(assemblyPlanSchema.properties.packages.items.properties));
    if(typeof p.id!=='string'||!new RegExp(id.pattern).test(p.id)||ids.has(p.id)||plan.packages.some(q=>q!==p&&q.id?.startsWith(p.id+'__')))throw new Error('Invalid/ambiguous package ID');ids.add(p.id);text(p.name,80);text(p.purpose,1200);
    list(p.dependsOn,16);unique(p.dependsOn);list(p.regions,8,1);list(p.editableComponents,256);unique(p.editableComponents);list(p.interfaces,256);unique(p.interfaces);
    for(const r of p.regions){only(r,['origin','size']);if(![r.origin,r.size].every(v=>Array.isArray(v)&&v.length===3)||r.origin.some((v,i)=>!Number.isSafeInteger(v)||v<0||!Number.isSafeInteger(r.size[i])||r.size[i]<1||v+r.size[i]>[plan.scene.bounds.width,plan.scene.bounds.height,plan.scene.bounds.length][i]))throw new Error('Package region outside scene');}
    for(const c of p.editableComponents){if(!components.has(c))throw new Error(`Unknown mutable component owner: package ${p.id} references missing component ${c}`);if(owners.has(c))throw new Error(`Shared mutable component owner: component ${c} belongs to both ${owners.get(c)} and ${p.id}`);owners.set(c,p.id);}
    const unknown=p.interfaces.filter(i=>!Number.isSafeInteger(i)||i<0||i>=plan.scene.constraints.passages.length);
    if(unknown.length)throw new Error('Unknown package interface probe: '+p.id+' references ['+unknown+']; scene has '+plan.scene.constraints.passages.length+' passages (zero-based indices). Update affected package interfaces in the same plan edit.');
  }
  for(const c of plan.scene.components)if(plan.packages.some(p=>c.id.startsWith(p.id+'__')&&!p.editableComponents.includes(c.id)))throw new Error('Initial package namespace must be explicitly owned');
  const ordered=[],visiting=new Set(),done=new Set(),byId=new Map(plan.packages.map(p=>[p.id,p]));
  function visit(p){if(done.has(p.id))return;if(visiting.has(p.id))throw new Error('Cyclic package dependency');visiting.add(p.id);for(const id of p.dependsOn){if(!byId.has(id)||id===p.id)throw new Error('Unknown/self package dependency');visit(byId.get(id));}visiting.delete(p.id);done.add(p.id);ordered.push(p);}
  plan.packages.forEach(visit);return ordered;
}
/** Only for the still-unapproved skeleton. Accepted package stages never call
 * this function: their interfaces remain frozen by applyPackageEdit. */
export function applyAssemblyPlanEdit(source,edit,policy,{designReview=false}={}){
  if(Buffer.byteLength(JSON.stringify(edit))>1200000)throw new Error('Assembly plan edit byte quota exceeded');
  only(edit,Object.keys(assemblyPlanEditSchema.properties));
  if(edit.format!=='SceneAssemblyPlanEdit'||edit.version!==1||edit.planHash!==hash(source))throw new Error('Stale/invalid assembly plan hash');
  validateAssemblyPlan(source,policy);
  if(!designReview&&edit.sceneEdit?.design!==null)throw new Error('Plan correction cannot replace original design intent');
  let applied;
  try{applied=applySceneDraftEdit(source.scene,edit.sceneEdit);}catch(error){
    // A structurally valid delta can exceed a collection quota only AFTER
    // merging. Preserve that unapproved candidate for bounded plan repair;
    // stale hashes, ambiguous operations and intent violations remain terminal.
    if(!(error instanceof DraftCandidateError))throw error;
    applied={scene:error.scene,changes:error.changes};
  }
  const next=structuredClone(source);
  next.scene=applied.scene;
  only(edit.packages,['put','remove']);list(edit.packages.put,16);list(edit.packages.remove,16);unique(edit.packages.remove);
  const old=new Map(source.packages.map(p=>[p.id,p])),put=new Map();
  for(const key of edit.packages.remove)if(!old.has(key))throw new Error('Unknown package removal');
  for(const p of edit.packages.put){
    if(!p||typeof p.id!=='string'||!new RegExp(id.pattern).test(p.id)||put.has(p.id)||edit.packages.remove.includes(p.id))throw new Error('Ambiguous package replacement');
    put.set(p.id,structuredClone(p));
  }
  next.packages=next.packages.filter(p=>!edit.packages.remove.includes(p.id)).map(p=>put.get(p.id)??p);
  for(const [id,p] of put)if(!old.has(id))next.packages.push(p);
  let ordered;try{ordered=validateAssemblyPlan(next,policy);}catch(error){throw new AssemblyCandidateError(error,next);}
  return {plan:next,ordered,changes:{scene:applied.changes,
    constraints:hash(source.scene.constraints)===hash(next.scene.constraints)?null:{before:source.scene.constraints,after:next.scene.constraints},
    featureBindingsChanged:hash(source.scene.featureBindings)!==hash(next.scene.featureBindings),
    packages:{added:[...put.keys()].filter(id=>!old.has(id)),changed:[...put.keys()].filter(id=>old.has(id)&&hash(old.get(id))!==hash(put.get(id))),removed:[...edit.packages.remove]},
    basePlanHash:hash(source),planHash:hash(next),interfacesFrozen:false}};
}
export function applyPackageEdit(source,edit,task){
  let result,candidateError;
  try{result=applySceneDraftEdit(source,edit);}catch(error){if(!(error instanceof DraftCandidateError))throw error;candidateError=error;result={scene:error.scene,changes:error.changes};}
  const prefix=task.id+'__',owned=id=>task.editableComponents.includes(id)||id.startsWith(prefix);
  if(['design','featureBindings','constraints'].some(k=>edit[k]!==null)||edit.reservations.put.length||edit.reservations.remove.length||edit.palette.remove.length)throw new PackageCandidateError('Package cannot change global design, interfaces, reservations or palette roles');
  for(const p of edit.palette.put)if(!p.role.startsWith(prefix)||source.palette.some(v=>v.role===p.role))throw new PackageCandidateError('Package can only add its namespaced palette roles');
  const existing=new Set(source.components.map(c=>c.id));
  for(const id of [...edit.components.put.map(c=>c.id),...edit.components.remove])if(existing.has(id)?!owned(id):!id.startsWith(prefix))throw new PackageCandidateError('Component edit outside package ownership');
  for(const id of [...edit.modules.put.map(m=>m.id),...edit.modules.remove]){
    const previous=source.modules.some(m=>m.id===id);
    if(!previous&&!id.startsWith(prefix))throw new PackageCandidateError('New module outside package namespace');
    const consumers=[...source.components,...result.scene.components].filter(c=>c.kind==='module'&&c.module===id);
    if(consumers.some(c=>!owned(c.id))||previous&&!consumers.length&&!id.startsWith(prefix))throw new PackageCandidateError('Shared module edit crosses package consumers');
  }
  // Unauthorized data is never adopted. The orchestrator may request a new
  // answer for the SAME package within its already-confirmed correction budget;
  // this does not grant the rejected candidate's requested authority.
  if(candidateError)throw candidateError;
  return result;
}
export function validateAssemblyReview(review,source,plan){
  only(review,Object.keys(assemblyReviewSchema.properties));
  if(review.format!=='SceneAssemblyReview'||review.version!==1||review.sourceHash!==hash(source)||!['accept','revise'].includes(review.verdict))throw new Error('Stale/invalid assembly review');
  text(review.summary,1200);list(review.issues,16);const tasks=new Set(plan.packages.map(p=>p.id));
  for(const issue of review.issues){only(issue,['task','criterion','evidence','change']);if(!tasks.has(issue.task)||!assemblyReviewSchema.properties.issues.items.properties.criterion.enum.includes(issue.criterion))throw new Error('Review references unknown task/criterion');text(issue.evidence,1200);text(issue.change,1200);}
  if(review.verdict==='accept'?(review.task!==null||review.issues.length):(!tasks.has(review.task)||!review.issues.some(i=>i.task===review.task)))throw new Error('Review decision lacks a consistent scoped action');return review;
}
