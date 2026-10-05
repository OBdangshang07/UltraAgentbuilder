import {hash} from '../src/generation/compiler.mjs';
import {sceneDraftEditSchema,applySceneDraftEdit} from './scene-draft-edit.schema.mjs';
import {assemblyPlanSchema,validateAssemblyPlan,applyPackageEdit} from './scene-assembly.schema.mjs';
import {checkSelectedConceptPlan} from './scene-concepts.mjs';
import {prototypeExpansionSchema,validatePrototypeExpansion,prototypeDataError,PROTOTYPE_EXPANSION_RULES} from './scene-prototype-expansion.mjs';
import {assemblyStageSchema} from './scene-assembly-stage.mjs';
import {schemaFeedback} from './schema-feedback.mjs';
import {PROTOTYPE_ROLES} from './scene-decomposition-roles.mjs';

const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const digest={type:'string',pattern:'^[a-f0-9]{64}$'},id={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,31}$'};
const taskId=assemblyPlanSchema.properties.packages.items.properties.id;
const choice=values=>({type:'string',enum:values});
const array=(items,maxItems,minItems=0)=>({type:'array',items,minItems,maxItems});
const nestedEdit=structuredClone(sceneDraftEditSchema);delete nestedEdit.$defs;
const REPRESENTATIVES=Object.freeze({
 'typical-floor-core':['typical-floor','core-interface'],
 'facade-corner':['facade-row','corner'],
 'entry-podium':['entry-lobby','street-interface'],
 'special-crown':['special-floor','crown']
});
export const assemblyBlueprintSchema=object({format:choice(['SceneAssemblyBlueprint']),version:{type:'integer',enum:[1]},
 sourceHash:digest,designIntent:structuredClone(assemblyPlanSchema.properties.designIntent),sceneEdit:nestedEdit,
 packages:array(structuredClone(assemblyPlanSchema.properties.packages.items),16,4),
 prototypes:array(object({role:choice(PROTOTYPE_ROLES),task:structuredClone(taskId)}),4,4)});
assemblyBlueprintSchema.$defs=structuredClone(sceneDraftEditSchema.$defs);
export const prototypeRoleEditSchema=object({format:choice(['ScenePrototypeRoleEdit']),version:{type:'integer',enum:[1]},
 role:choice(PROTOTYPE_ROLES),task:structuredClone(taskId),planHash:digest,programHash:digest,edit:structuredClone(nestedEdit),
 recipes:array(structuredClone(prototypeExpansionSchema.properties.recipes.items),64),
 representatives:array(object({kind:choice(Object.values(REPRESENTATIVES).flat()),components:array(id,64,1)}),2,2)});
prototypeRoleEditSchema.$defs=structuredClone(sceneDraftEditSchema.$defs);
const check=(value,schema)=>{
 if(Buffer.byteLength(JSON.stringify(value)??'')>1200000)throw Error('Decomposition source quota exceeded');
 const contract=schemaFeedback(value,schema);if(!contract.valid){const error=prototypeDataError('Decomposition contract',contract.issues);error.contract=contract;throw error;}
};
function checkDeltaIdentities(edit,prefix){
 const issues=[];
 for(const field of ['components','modules','palette','reservations']){
  const key=field==='palette'?'role':'id',seen=new Map(),removed=new Map();
  for(const [index,id] of edit[field].remove.entries()){
   if(removed.has(id))issues.push({path:prefix+'.'+field+'.remove['+index+']',code:'draft-duplicate-removal',id,firstIndex:removed.get(id),message:'Each removal ID appears once'});
   else removed.set(id,index);
  }
  for(const [index,value] of edit[field].put.entries()){
   const id=value[key],path=prefix+'.'+field+'.put['+index+'].'+key;
   if(seen.has(id))issues.push({path,code:'draft-duplicate-replacement',id,firstIndex:seen.get(id),message:'Use distinct real source IDs; one ID cannot define several objects. No automatic renaming is performed'});
   else seen.set(id,index);
   if(removed.has(id))issues.push({path,code:'draft-put-remove-overlap',id,removeIndex:removed.get(id),message:'The same source cannot be replaced and removed'});
  }
 }
 if(issues.length)throw prototypeDataError('Ambiguous decomposition delta identities',issues);
}
export const decomposedProgramHash=state=>hash({version:1,sourceHash:hash(state.plan.scene),roles:state.roles,recipesByRole:state.recipesByRole});

export function prototypeRoleRecipeBudget(state,role){
 if(!PROTOTYPE_ROLES.includes(role))throw Error('Unknown prototype recipe budget role');
 const maximumRecipes=prototypeExpansionSchema.properties.recipes.maxItems;
 const retainedByRole=PROTOTYPE_ROLES.filter(r=>r!==role).map(r=>({role:r,count:(state.recipesByRole[r]??[]).length}));
 const retainedRecipes=retainedByRole.reduce((n,r)=>n+r.count,0);
 if(!Number.isSafeInteger(retainedRecipes)||retainedRecipes>maximumRecipes)throw Error('Retained prototype recipes exceed aggregate quota');
 return {version:1,maximumRecipes,retainedRecipes,retainedByRole,maximumRoleRecipes:maximumRecipes-retainedRecipes,
  otherRolesUnchanged:true,automaticRecipeRemoval:false,canAuthorizePlacement:false};
}

export function assemblyBlueprintStageSchema(selected,tier,callBudget){
 if(callBudget?.version!==(tier.referenceAnalysis?2:1)||
  tier.referenceAnalysis&&(callBudget.preludeCalls!==1||callBudget.completedPrelude!==1)||
  !callBudget.canStart||!Number.isSafeInteger(callBudget.maximumPackages)||
  callBudget.maximumPackages<4||callBudget.maximumPackages>tier.maxPackages)throw Error('Unfunded decomposition blueprint schema');
 const schema=structuredClone(assemblyBlueprintSchema),sourceHash=hash(selected.scene);
 schema.properties.sourceHash={type:'string',enum:[sourceHash]};
 schema.properties.sceneEdit.properties.sourceHash={type:'string',enum:[sourceHash]};
 schema.properties.packages.maxItems=callBudget.maximumPackages;
 // Concept false flags must be restored explicitly, not copied or normalized
 // locally. All original functional fields remain in the required object.
 const constraints=structuredClone(assemblyPlanSchema.properties.scene.properties.constraints);
 for(const field of ['interior','walkable'])constraints.properties[field]={type:'boolean',enum:[true]};
 constraints.properties.passages.minItems=1;
 schema.properties.sceneEdit.properties.constraints=constraints;
 return schema;
}

/** This creates an UNAPPROVED structural plan from a bound delta. It neither
 * invents stock geometry nor marks the four promised prototypes as made. */
export function applyAssemblyBlueprint(selected,response,tier){
 check(response,assemblyBlueprintSchema);
 if(response.sourceHash!==hash(selected.scene)||response.sceneEdit.sourceHash!==response.sourceHash)throw Error('Stale selected concept blueprint');
 checkDeltaIdentities(response.sceneEdit,'$.sceneEdit');
 const applied=applySceneDraftEdit(selected.scene,response.sceneEdit);
 const plan={format:'SceneAssemblyPlan',version:1,designIntent:response.designIntent,scene:applied.scene,packages:structuredClone(response.packages)};
 const ordered=validateAssemblyPlan(plan,tier);checkSelectedConceptPlan(selected,plan);
 const roles=structuredClone(response.prototypes),tasks=new Set();
 for(const [i,role] of roles.entries()){
  if(role.role!==PROTOTYPE_ROLES[i]||tasks.has(role.task)||!plan.packages.some(p=>p.id===role.task))throw Error('Prototype responsibilities require four ordered, distinct existing packages');
  tasks.add(role.task);
 }
 return {version:1,selected:structuredClone(selected),plan,ordered,roles,recipesByRole:{},representativesByRole:{},
  completedRoles:[],changes:applied.changes,diagnosticOnly:true,requiresGeometryInspection:true,canAuthorizePlacement:false};
}

export function prototypeRoleStageSchema(state,role){
 const authority=state.roles.find(r=>r.role===role),task=state.plan.packages.find(p=>p.id===authority?.task);
 if(!task||role!==PROTOTYPE_ROLES[state.completedRoles.length])throw Error('Prototype role is not the next required responsibility');
 const schema=structuredClone(prototypeRoleEditSchema);
 const recipeBudget=prototypeRoleRecipeBudget(state,role);
 schema.properties.recipes.maxItems=recipeBudget.maximumRoleRecipes;
 schema.properties.recipes.description='ONLY this role\'s replacement list. Aggregate maximum '+recipeBudget.maximumRecipes+'; '+recipeBudget.retainedRecipes+' recipes retained from other roles, leaving at most '+recipeBudget.maximumRoleRecipes+' for this role. Other roles are unchanged. No automatic removal or quota increase.';
 for(const [field,value] of [['role',role],['task',task.id],['planHash',hash(state.plan)],['programHash',decomposedProgramHash(state)]])schema.properties[field]={type:'string',enum:[value]};
 const edit=assemblyStageSchema(sceneDraftEditSchema,{sourceHash:hash(state.plan.scene),previousDraft:state.plan.scene,task});
 schema.$defs=edit.$defs;delete edit.$defs;schema.properties.edit=edit;
 schema.properties.representatives.items.properties.kind=choice(REPRESENTATIVES[role]);
 const prefix=task.id+'__',ownedIds=state.plan.scene.components.filter(c=>task.editableComponents.includes(c.id)||c.id.startsWith(prefix)).map(c=>c.id);
 const namespaced={type:'string',pattern:'^'+prefix+'[A-Za-z0-9_-]{1,'+(32-prefix.length)+'}$'};
 const selector=ownedIds.length?{anyOf:[{type:'string',enum:ownedIds},namespaced]}:namespaced;
 schema.properties.representatives.items.properties.components.items=structuredClone(selector);
 schema.properties.representatives.description='Exactly both required study kinds. ALL listed source IDs must exist after edit and be owned by THIS task; each study needs at least one actually changed owned source. Nearby hosts, walls, stairs and other package sources may be context but MUST NOT be listed. New IDs must use '+prefix+' and be created in edit.';
 for(const variant of schema.properties.recipes.items.anyOf)variant.properties.component=structuredClone(selector);
 return schema;
}

/** Scope validation is NOT a geometric/visual acceptance. The caller must
 * inspect all seed/expanded cells and owners BEFORE adopting this candidate. */
export function applyPrototypeRoleEdit(state,response,tier){
 const role=PROTOTYPE_ROLES[state.completedRoles.length];
 if(!role)throw Error('All prototype roles already proposed');
 const runtimeSchema=prototypeRoleStageSchema(state,role);
 // Guidance narrows decoding to owned IDs. Runtime separately reports every
 // offending source instead of reducing scope violations to a schema slogan.
 runtimeSchema.properties.representatives=structuredClone(prototypeRoleEditSchema.properties.representatives);
 const recipeLimit=runtimeSchema.properties.recipes.maxItems;
 runtimeSchema.properties.recipes=structuredClone(prototypeRoleEditSchema.properties.recipes);
 runtimeSchema.properties.recipes.maxItems=recipeLimit;
 check(response,runtimeSchema);
 checkDeltaIdentities(response.edit,'$.edit');
 const authority=state.roles.find(r=>r.role===role),task=state.plan.packages.find(p=>p.id===authority.task);
 const applied=applyPackageEdit(state.plan.scene,response.edit,task);
 const changed=new Set([...applied.changes.components.added,...applied.changes.components.changed]);
 // Editing a module can refine an existing instance without changing its JSON.
 const modules=new Set([...applied.changes.modules.added,...applied.changes.modules.changed]);
 for(const c of applied.scene.components)if(c.kind==='module'&&modules.has(c.module))changed.add(c.id);
 const owned=id=>task.editableComponents.includes(id)||id.startsWith(task.id+'__');
 const kinds=new Set(),components=new Set(applied.scene.components.map(c=>c.id)),issues=[];
 for(const [index,representative] of response.representatives.entries()){
  const path='$.representatives['+index+']',issue=(code,ids,message)=>issues.push({path,code,kind:representative.kind,ids,task:task.id,message});
  if(!REPRESENTATIVES[role].includes(representative.kind))issue('representative-kind',[], 'This role requires '+REPRESENTATIVES[role].join(' and '));
  if(kinds.has(representative.kind))issue('representative-duplicate-kind',[], 'Each required study kind must appear once');
  const seen=new Set(),duplicates=[];for(const id of representative.components){if(seen.has(id))duplicates.push(id);seen.add(id);}
  if(duplicates.length)issue('representative-duplicate-source',duplicates,'List each source ID only once');
  const foreign=representative.components.filter(id=>!owned(id)),missing=representative.components.filter(id=>!components.has(id));
  if(foreign.length)issue('representative-foreign-source',foreign,'Context is not ownership; remove these cross-package references from the witness, without editing or deleting their geometry');
  if(missing.length)issue('representative-missing-source',missing,'Source IDs must exist in the resulting scene');
  if(!representative.components.some(id=>owned(id)&&components.has(id)&&changed.has(id)))issue('representative-no-changed-source',representative.components,'Each study must include actual changed owned construction, including a changed module instance where applicable');
  kinds.add(representative.kind);
 }
 for(const kind of REPRESENTATIVES[role])if(!kinds.has(kind))issues.push({path:'$.representatives',code:'representative-missing-kind',kind,task:task.id,message:'Missing required prototype representative'});
 for(const [index,recipe] of response.recipes.entries()){
  if(!owned(recipe.component))issues.push({path:'$.recipes['+index+'].component',code:'recipe-foreign-source',ids:[recipe.component],task:task.id,message:'Prototype recipe crosses role authority'});
  if(!components.has(recipe.component))issues.push({path:'$.recipes['+index+'].component',code:'recipe-missing-source',ids:[recipe.component],task:task.id,message:'Prototype recipe source does not exist'});
 }
 if(issues.length)throw prototypeDataError('Invalid prototype representative or recipe authority',issues);
 const next=structuredClone(state);next.plan.scene=applied.scene;
 // A newly created namespaced seed is already authorized by this task. Record
 // that exact source ownership before validating it as a NEW baseline; never
 // acquire another package's component or expand any region/interface.
 const nextTask=next.plan.packages.find(p=>p.id===task.id),removed=new Set(applied.changes.components.removed);
 nextTask.editableComponents=nextTask.editableComponents.filter(id=>!removed.has(id));
 for(const id of applied.changes.components.added)nextTask.editableComponents.push(id);
 next.ordered=validateAssemblyPlan(next.plan,tier);checkSelectedConceptPlan(next.selected,next.plan);
 next.recipesByRole[role]=structuredClone(response.recipes);next.representativesByRole[role]=structuredClone(response.representatives);
 const recipes=PROTOTYPE_ROLES.flatMap(role=>next.recipesByRole[role]??[]);
 if(recipes.length)validatePrototypeExpansion(next.plan.scene,{format:'ScenePrototypeExpansion',version:1,seedSourceHash:hash(next.plan.scene),recipes});
 next.completedRoles.push(role);next.changes={...applied.changes,prototypeOwnership:{task:task.id,
  added:[...applied.changes.components.added],removed:[...removed],regionsChanged:false,interfacesChanged:false}};
 next.diagnosticOnly=true;next.requiresGeometryInspection=true;next.requiresExpandedInspection=true;next.canAuthorizePlacement=false;
 return next;
}

export function bindDecomposedPrototypeProgram(state){
 if(state.completedRoles.length!==4||PROTOTYPE_ROLES.some((role,i)=>state.completedRoles[i]!==role))throw Error('Cannot review an incomplete prototype set');
 const program={format:'ScenePrototypeExpansion',version:1,seedSourceHash:hash(state.plan.scene),recipes:PROTOTYPE_ROLES.flatMap(role=>state.recipesByRole[role]??[])};
 validatePrototypeExpansion(state.plan.scene,program);
 return {plan:structuredClone(state.plan),program,programHash:hash(program),representatives:structuredClone(state.representativesByRole),
  diagnosticOnly:true,requiresGeometryInspection:true,requiresExpandedInspection:true,canAuthorizePlacement:false};
}

export function checkDecomposedResponsibilities(before,after,representatives){
 if(before.packages.length!==after.packages.length)throw Error('Staged review cannot omit or regroup required construction packages');
 const previousOwners=new Map(before.packages.flatMap(p=>p.editableComponents.map(id=>[id,p.id])));
 for(const [i,p] of before.packages.entries()){
  const q=after.packages[i],{editableComponents:oldIds,...oldAuthority}=p,{editableComponents:newIds,...newAuthority}=q;
  if(hash(oldAuthority)!==hash(newAuthority))throw Error('Staged review changed a frozen package responsibility, region or interface');
  for(const id of oldIds)if(after.scene.components.some(c=>c.id===id)&&!newIds.includes(id))throw Error('Staged review dropped existing component ownership');
  for(const id of newIds)if(!oldIds.includes(id)&&(!id.startsWith(p.id+'__')||previousOwners.has(id)))throw Error('Staged review acquired another component owner');
 }
 const ids=new Set(after.scene.components.map(c=>c.id));
 for(const r of Object.values(representatives).flat())if(r.components.some(id=>!ids.has(id)))throw Error('Staged review removed a required representative source');
 return true;
}

export const DECOMPOSED_BLUEPRINT_RULES=`Return SceneAssemblyBlueprint, NOT an entire SceneSpec or a prototype wrapper. Bind sourceHash and sceneEdit.sourceHash to the selected actual concept. Return only the structural delta: preserve scene identity, bounds and resolved massing anchors, establish real floor schedules, a continuous realistically proportioned core, stairs, enclosed lift shafts, entry and passage interfaces. Restore required interior/walkable=true and actual passage probes. Package interfaces are ZERO-BASED ARRAY POSITIONS in the resulting scene.constraints.passages after sceneEdit, NEVER floor Y heights, block coordinates, component IDs or one-based passage numbers. With N passages every interface is an integer 0..N-1; if passages change, update every affected package reference in the SAME blueprint. Preserve meaningful passage geometry, not extra padding probes to make an incorrect number fit. Do not finish detailed furnishings or every elevation in this response. packages cover ALL deferred construction and refinement within callBudget.maximumPackages; no padded packages or omitted functions. prototypes lists four ordered roles: typical-floor-core, facade-corner, entry-podium, special-crown, each assigned a DISTINCT existing package task. Give those tasks exact source ownership and world regions for seed AND every future expanded instance. The typical-floor-core task must actually be able to build a COMPLETE organized typical office floor and its core interface, not just a core/corridor strip while all office zones are owned by other packages. Allocate the prototype's full seed-floor workspace and its expanded instances to that task; assign other packages different non-overlapping responsibilities. Reservation allowlists are FROZEN in every later package/prototype stage: a purpose saying that a task owns a reservation is not permission to amend it. Establish concrete task-owned permitted SOURCE IDs now for later core-front/door/service refinement, optionally through an owned reusable module whose component ID is already allowed. allowedComponents entries must be actual existing source IDs, not future names or a namespace wildcard. Do not leave later tasks dependent on adding unauthorized namespaced solids inside a frozen core reservation. Avoid unnecessary solid-fill reservations across furnishable office zones; retain the real shaft/route/negative-space protections. No automatic permission expansion occurs. The blueprint is diagnostic planning, never a claim of finished prototype geometry or world authority.`;
export const DECOMPOSED_ROLE_RULES=`Return ScenePrototypeRoleEdit for this one role/task, with exact planHash, programHash and edit.sourceHash. Only this package's source components, namespace and declared regions may change; never copy a complete building, re-plan frozen interfaces or edit another role. Construct BOTH required representative studies with actual geometry and source IDs: typical-floor-core means a complete organized typical office floor AND realistic core/floor access, facade-corner means a meaningful facade row AND designed corner, entry-podium means a real entry/lobby AND street/base interface, special-crown means an exceptional floor AND coherent crown. A desk or named box alone is not a complete study. representatives records source references for later cell/owner inspection; names are NOT proof. EVERY listed representative ID must exist after edit AND be task-owned (editableComponents or task.id+'__' namespace). Nearby structural hosts, core walls, stairs and other packages are CONTEXT, never representative sources unless this task owns them. Do not list all related components; list only this task's actual study construction. Each kind appears exactly once, with no duplicate IDs, and each list includes at least one changed owned source. recipes is ONLY this role's explicit seed expansion list (may be empty for nonrepeated features), never replacement of other roles' recipes. ${PROTOTYPE_EXPANSION_RULES} All four roles and ALL expanded instances are checked before image review; no clipping, scale reduction, stock template, world permission or additional call budget.`;
