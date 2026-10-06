import {hash} from '../src/generation/compiler.mjs';
import {validateAssemblyPlan,assemblyPlanSchema} from './scene-assembly.schema.mjs';
import {checkDecomposedResponsibilities} from './scene-decomposed-prototypes.mjs';
import {expandedPrototypeRoutesEnabled} from './assembly-prototype-validation.mjs';

export const DESIGN_ALLOCATION_POLICY=Object.freeze({version:1,mode:'pre-freeze-purpose-regions'});
export const DESIGN_FEATURE_IDENTITY_RULES='REQUIRED FEATURE IDENTITIES: copy every prior scene.featureBindings[].feature string verbatim. These strings are stable required-feature keys, not prose labels to improve or paraphrase. Keep each original key even when you deliberately update its implementation components. New descriptive wording belongs in the design brief, not a replacement identity. required-feature-identity feedback gives exact missing keys and the edited field path. Do not delete a required feature, weaken its implementation or invent a substitute merely to satisfy the key check; full geometry, allocation and visual review remain required. No automatic renaming or acceptance occurs.';

export function designWorkspaceCapacity(plan){
 const maximumRegions=assemblyPlanSchema.properties.packages.items.properties.regions.maxItems;
 return {version:1,phase:'unapproved-design',maximumRegionsPerPackage:maximumRegions,
  packages:plan.packages.map(p=>({id:p.id,regionCount:p.regions.length,unusedRegionSlots:maximumRegions-p.regions.length})),
  interpretation:'This is read-only schema capacity, not a region proposal. At zero spare slots, adding workspace requires an explicit bounded merge/replacement in packages.put: every old region must fit wholly inside one resulting region, and the resulting list still cannot exceed maximumRegionsPerPackage. Compare only the specific deferred owned sources and all their actual instances named by the critique. Do not claim expansion in purpose prose, erase old work, transfer owners, cover the whole building indiscriminately or change protections/dependencies/interfaces. The model must supply actual coordinates; the compiler will not allocate, clip or merge them automatically.',
  automaticRegionExpansion:false,componentOwnershipTransferred:false,canAuthorizePlacement:false};
}
export function stagedDesignAllocationEnabled(tier){
 const p=tier.prototypes;
 if(p?.version===6)expandedPrototypeRoutesEnabled(tier);
 if(p?.mode!=='staged')return false;
 if(![5,6].includes(p.version)){if(p.designAllocation!==undefined)throw Error('Legacy staged policy cannot acquire design allocation authority');return false;}
 if(hash(p.designAllocation??null)!==hash(DESIGN_ALLOCATION_POLICY))throw Error('Invalid staged design allocation policy');
 return true;
}
const contains=(outer,inner)=>inner.origin.every((v,a)=>v>=outer.origin[a]&&v+inner.size[a]<=outer.origin[a]+outer.size[a]);

export class DesignAllocationFeatureError extends Error{
 constructor(missing){
  super('Design allocation removed a required design feature: '+missing.map(b=>b.feature).join('; '));
  this.name='DesignAllocationFeatureError';
  this.contract={valid:false,checksComplete:true,truncated:false,issues:missing.map(b=>({
   path:'$.sceneEdit.featureBindings',code:'required-feature-identity',feature:b.feature,expected:b.feature,
   message:'Retain this exact previous feature key, not a paraphrase. Its implementation component bindings may be deliberately updated, but the required identity must survive. No automatic renaming or geometry approval is performed.'
  }))};
 }
}

/** Explicitly limited to a NEW, unapproved design. Manufacturing/local edits
 * still use the original frozen task and cell-level ownership checks. */
export function checkStagedDesignAllocation(before,after,representatives,tier){
 if(!stagedDesignAllocationEnabled(tier)){
  checkDecomposedResponsibilities(before,after,representatives);return null;
 }
 validateAssemblyPlan(before,tier);validateAssemblyPlan(after,tier);
 if(before.designIntent!==after.designIntent||['id','seed','bounds'].some(k=>hash(before.scene[k])!==hash(after.scene[k])))throw Error('Design allocation changed fixed identity, scale or intent');
 if(hash(before.scene.reservations)!==hash(after.scene.reservations))throw Error('Design allocation cannot change existing space protections');
 if(before.scene.constraints.passages.length!==after.scene.constraints.passages.length)throw Error('Design allocation cannot omit or regroup required passage interfaces');
 const missingFeatures=before.scene.featureBindings.filter(b=>!after.scene.featureBindings.some(q=>q.feature===b.feature));
 if(missingFeatures.length)throw new DesignAllocationFeatureError(missingFeatures);
 for(const c of before.scene.components)if(['mass','profileMass','stairs','void','roomZone','storeyRoom'].includes(c.kind)&&
  !after.scene.components.some(q=>q.id===c.id&&q.kind===c.kind&&(!['roomZone','storeyRoom'].includes(c.kind)||q.use===c.use)))throw Error('Design allocation removed a structural, core, space or circulation source: '+c.id);
 if(before.packages.length!==after.packages.length)throw Error('Design allocation cannot omit or regroup required construction packages');
 const oldOwners=new Map(before.packages.flatMap(p=>p.editableComponents.map(id=>[id,p.id]))),deltas=[];
 for(const [i,p] of before.packages.entries()){
  const q=after.packages[i];
  if(p.id!==q.id||hash(p.dependsOn)!==hash(q.dependsOn)||hash(p.interfaces)!==hash(q.interfaces))throw Error('Design allocation changed a package identity, dependency or interface responsibility');
  // Add/merge workspace, but do not silently remove previously allocated work.
  // Source ownership and protected spaces remain independent of region overlap.
  const missing=p.regions.find(r=>!q.regions.some(s=>contains(s,r)));
  if(missing)throw Error('Design allocation removed existing package workspace: '+p.id+' '+JSON.stringify(missing));
  for(const id of p.editableComponents)if(after.scene.components.some(c=>c.id===id)&&!q.editableComponents.includes(id))throw Error('Design allocation dropped existing component ownership: '+p.id+'/'+id);
  for(const id of q.editableComponents)if(!p.editableComponents.includes(id)&&(!id.startsWith(p.id+'__')||oldOwners.has(id)))throw Error('Design allocation acquired another component owner: '+p.id+'/'+id);
  const fields=['name','purpose','regions'].filter(k=>hash(p[k])!==hash(q[k]));
  if(fields.length)deltas.push({task:p.id,fields,before:Object.fromEntries(fields.map(k=>[k,structuredClone(p[k])])),after:Object.fromEntries(fields.map(k=>[k,structuredClone(q[k])]))});
 }
 const ids=new Set(after.scene.components.map(c=>c.id));
 for(const r of Object.values(representatives).flat())if(r.components.some(id=>!ids.has(id)))throw Error('Design allocation removed a required representative source');
 const data={version:1,policy:structuredClone(DESIGN_ALLOCATION_POLICY),phase:'unapproved-design',basePlanHash:hash(before),candidatePlanHash:hash(after),
  deltas,packageCount:after.packages.length,componentOwnershipTransferred:false,dependenciesChanged:false,interfaceResponsibilitiesChanged:false,
  spaceProtectionsChanged:false,worldAuthorityChanged:false,canAuthorizePlacement:false};
 return {...data,allocationHash:hash(data)};
}

export const STAGED_DESIGN_ALLOCATION_RULES=`STAGED DESIGN ALLOCATION V1: this is still an UNAPPROVED whole-building design, not local refinement or world placement. Return explicit package put objects if the critique requires changing a package name/purpose or ADDING/MERGING its world-coordinate workspace for genuinely required deferred work (including rear elevations and upper instances). Every old region must fit wholly in one resulting region; retain all original work. Keep the SAME package count/order/IDs, dependency lists, passage-interface responsibilities and exclusive existing component owners. New owned components must use their own package namespace. Do not acquire another package's source, remove prototype witnesses, drop required features/interior/core functions, shrink height, modify existing reservations or grant blanket overwrite permission. ALL required prototype sources and expanded instances must fit the resulting allocation before another image review. Purpose text is only a future obligation, not completed geometry; the reviewer must still check that the allocation supports it. ownedSourceCoverage reports actual surviving cells INSIDE/OUTSIDE the current workspace, separately for seed and expanded sources. Structural hosts may intentionally have immutable portions outside it; these advisory counts are NOT a blanket requirement to expand every region. For the specific deferred work demanded by the critique, compare its exact owned sources/upper instances to actual regions and return concrete packages.put region edits when needed. Claiming upper work in purpose prose or re-emitting unchanged regions does not allocate it. Uncovered AABBs are summaries, not overwrite permission or a prescribed box to copy. Only accepted current seed review plus exact checked expansion freezes these packages for manufacturing. Later package edits cannot change purposes, regions, interfaces, protections or other owners. No world authority or additional model calls are granted.`;
