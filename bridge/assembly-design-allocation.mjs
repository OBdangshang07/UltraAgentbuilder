import {hash} from '../src/generation/compiler.mjs';
import {checkStagedDesignAllocation} from '../contracts/scene-design-allocation.mjs';
import {readAssemblyBaseline} from '../src/design/assembly-scope.mjs';

export const PROTOTYPE_ALLOCATION_POLICY=Object.freeze({version:1,seedAndExpandedOwnerCellsRequired:true,unchangedWitnessPartsRequired:true,
 automaticRegionExpansion:false,canAuthorizePlacement:false});

/** Advisory disclosure of CURRENT surviving source ownership. Structural hosts
 * may deliberately extend outside a task's editable workspace. Do not expand
 * regions, reject such hosts, or interpret bounding boxes as editing authority. */
export function designOwnedSourceCoverage(plan,compiled){
 if(compiled.designSources.sourceHash!==hash(plan.scene)||hash(compiled.manifest.dimensions)!==hash(plan.scene.bounds))throw Error('Owned source coverage identity mismatch');
 const sources=new Map();
 const ownerIds=compiled.designSources.traceSources.map(source=>{
  const id=source?.component;if(!id)return null;
  const tasks=plan.packages.filter(p=>p.editableComponents.includes(id)||id.startsWith(p.id+'__'));
  if(tasks.length>1)throw Error('Owned source coverage has ambiguous package ownership: '+id);
  if(!tasks.length)return null;
  if(!sources.has(id))sources.set(id,{id,task:tasks[0].id,cells:0,insideWorkspace:0,outsideWorkspace:0,
   uncoveredBounds:null,uncoveredSamples:[],regions:tasks[0].regions});
  return id;
 });
 const {width:w,length:d}=compiled.manifest.dimensions;
 for(let i=0;i<compiled.sourceOwners.length;i++){
  const source=sources.get(ownerIds[compiled.sourceOwners[i]]);if(!source)continue;
  source.cells++;const point=[i%w,Math.floor(i/(w*d)),Math.floor(i/w)%d];
  if(source.regions.some(r=>point.every((v,a)=>v>=r.origin[a]&&v<r.origin[a]+r.size[a]))){source.insideWorkspace++;continue;}
  source.outsideWorkspace++;
  if(!source.uncoveredBounds)source.uncoveredBounds={min:[...point],maxExclusive:point.map(v=>v+1)};
  else for(let a=0;a<3;a++){source.uncoveredBounds.min[a]=Math.min(source.uncoveredBounds.min[a],point[a]);source.uncoveredBounds.maxExclusive[a]=Math.max(source.uncoveredBounds.maxExclusive[a],point[a]+1);}
  if(source.uncoveredSamples.length<4)source.uncoveredSamples.push(point);
 }
 const rows=[...sources.values()].filter(s=>s.cells).map(({regions,...s})=>s);
 const data={version:1,sourceHash:hash(plan.scene),assetHash:compiled.manifest.assetHash,cellsHash:compiled.manifest.cellsHash,
  ownersHash:compiled.manifest.scene.ownersHash,packagesHash:hash(plan.packages),sources:rows,
  ownedCells:rows.reduce((n,s)=>n+s.cells,0),outsideWorkspaceCells:rows.reduce((n,s)=>n+s.outsideWorkspace,0),
  advisoryOnly:true,coverageRequiredForAllOwnedSources:false,worldAuthorityChanged:false,canAuthorizePlacement:false,
  limitations:['Counts cover surviving owner-grid cells, including source-owned clearances; not every original primitive visit or potential future edit.',
   'An owned host can intentionally have immutable portions outside workspace. Outside cells are facts, not a mandatory region expansion.',
   'Bounds summarize uncovered samples as a half-open AABB; the entire box is not editable or necessarily occupied.',
   'This disclosure does not prove future design work, navigation or architectural quality and grants no source or world authority.']};
 return {...data,coverageHash:hash(data)};
}

/** Inspect the actual saved owner grid, not labels or an estimated AABB. The
 * assertion covers every seed/expanded witness cell, NOT future design quality
 * or all cells an owned structural host might permit editing. */
export function designAllocationCoverage(plan,compiled,roles,representatives,recipes){
 if(compiled.designSources.sourceHash!==hash(plan.scene)||hash(compiled.manifest.dimensions)!==hash(plan.scene.bounds))throw Error('Design allocation cell source mismatch');
 const required=new Map();
 for(const [role,items] of Object.entries(representatives)){
  const task=roles.find(r=>r.role===role)?.task;
  if(!task||!plan.packages.some(p=>p.id===task))throw Error('Design allocation has an unknown representative responsibility');
  for(const r of items)for(const id of r.components){
   if(required.has(id)&&required.get(id)!==task)throw Error('Design allocation shares a representative owner');required.set(id,task);
  }
 }
 for(const r of recipes){
  const task=plan.packages.find(p=>p.editableComponents.includes(r.component)||r.component.startsWith(p.id+'__'));
  if(!task)throw Error('Design allocation has an unowned expanded source');
  if(required.has(r.component)&&required.get(r.component)!==task.id)throw Error('Design allocation changed a representative owner');
  required.set(r.component,task.id);
 }
 const owners=compiled.designSources.traceSources.map(s=>required.get(s?.component)?s.component:null),counts=new Map([...required.keys()].map(id=>[id,0]));
 const uncovered=new Map();let firstUncovered=null;
 const {width:w,length:d}=compiled.manifest.dimensions,byTask=new Map(plan.packages.map(p=>[p.id,p]));
 for(let i=0;i<compiled.cells.length;i++){
  const id=owners[compiled.sourceOwners[i]];if(!id)continue;
  const task=byTask.get(required.get(id));
  if(!task.editableComponents.includes(id)&&!id.startsWith(task.id+'__'))throw Error('Design allocation witness crosses exclusive ownership: '+id);
  const point=[i%w,Math.floor(i/(w*d)),Math.floor(i/w)%d];
  counts.set(id,counts.get(id)+1);
  if(!task.regions.some(r=>point.every((v,a)=>v>=r.origin[a]&&v<r.origin[a]+r.size[a]))){
   firstUncovered??={task:task.id,id,point};
   if(!uncovered.has(id))uncovered.set(id,{id,task:task.id,outsideWorkspace:0,regions:structuredClone(task.regions),
    uncoveredBounds:{min:[...point],maxExclusive:point.map(v=>v+1)},uncoveredSamples:[]});
   const row=uncovered.get(id);row.outsideWorkspace++;
   for(let a=0;a<3;a++){row.uncoveredBounds.min[a]=Math.min(row.uncoveredBounds.min[a],point[a]);row.uncoveredBounds.maxExclusive[a]=Math.max(row.uncoveredBounds.maxExclusive[a],point[a]+1);}
   if(row.uncoveredSamples.length<4)row.uncoveredSamples.push(point);
  }
 }
 if(firstUncovered){
  const {task,id,point}=firstUncovered,error=Error('Design allocation misses actual witness/expanded cell: '+task+'/'+id+' at ['+point+']');
  const data={version:1,sourceHash:hash(plan.scene),assetHash:compiled.manifest.assetHash,cellsHash:compiled.manifest.cellsHash,
   ownersHash:compiled.manifest.scene.ownersHash,packagesHash:hash(plan.packages),
   uncoveredSources:[...uncovered.values()],outsideWorkspaceCells:[...uncovered.values()].reduce((n,s)=>n+s.outsideWorkspace,0),
   allRequiredSourceCellsCovered:false,geometryChangedByCheck:false,worldAuthorityChanged:false,canAuthorizePlacement:false,
   limitations:['Counts cover the actual surviving seed/expanded owner grid, including source-owned clearances, not an estimated bounding box.',
    'Every listed representative and recipe source requires full coverage, including unchanged parts. Ordinary unlisted structural hosts may have immutable parts outside workspace.',
    'No geometry, ownership or region is automatically changed. Removing an unsupported witness claim does not authorize deleting that source or omitting either required study.']};
  error.designAllocationFeedback={...data,feedbackHash:hash(data)};throw error;
 }
 for(const [id,n] of counts)if(!n)throw Error('Design allocation witness has no surviving cells: '+id);
 return {sourceHash:hash(plan.scene),assetHash:compiled.manifest.assetHash,cellsHash:compiled.manifest.cellsHash,ownersHash:compiled.manifest.scene.ownersHash,
  sources:[...required].map(([id,task])=>({id,task,cells:counts.get(id)})),allRequiredSourceCellsCovered:true,
  ownedSourceCoverage:designOwnedSourceCoverage(plan,compiled),
  futureWorkComplete:false,architecturalQualityVerified:false,canAuthorizePlacement:false};
}

/** Check the CURRENT partial role set before its durable stage is accepted.
 * Storage/provenance failures remain fatal; only an actual uncovered witness
 * receives model-correctable feedback. No compilation or scope expansion. */
export async function inspectPrototypeRoleAllocation({state,checked}){
 const recipes=Object.values(state.recipesByRole).flat();
 const inspect=async(subject,plan,directory,feedback)=>{
  const actual=await readAssemblyBaseline(directory,feedback.diagnosticAssetHash);
  try{return designAllocationCoverage(plan,actual,state.roles,state.representativesByRole,recipes);}
  catch(error){
   if(!error.designAllocationFeedback)throw error;
   const {feedbackHash,...detail}=error.designAllocationFeedback,data={...detail,subject};
   error.designAllocationFeedback={...data,feedbackHash:hash(data)};throw error;
  }
 };
 const seed=await inspect('seed',state.plan,checked.diagnostic,checked.feedback);
 const expanded=checked.prototype?await inspect('expanded',checked.prototype.plan,checked.prototype.diagnostic,checked.prototype.feedback):seed;
 const data={version:1,accepted:true,planHash:hash(state.plan),completedRoles:[...state.completedRoles],seed,expanded,
  programHash:checked.prototype?hash(checked.prototype.program):null,geometryChangedByCheck:false,worldAuthorityChanged:false,
  architecturalQualityVerified:false,canAuthorizePlacement:false};
 return {...data,receiptHash:hash(data)};
}

export const PROTOTYPE_ALLOCATION_RULES=`PROTOTYPE WITNESS COVERAGE: before this role is accepted, ALL actual surviving owner cells of EVERY listed representative and recipe source are checked in the seed and full expansion, including unchanged parts, clearances, entry canopies, trim, and the last repeated instance. A source being task-owned is not proof that its whole witness fits the task's declared half-open regions. An unlisted structural host may intentionally have immutable parts outside workspace. If such a host is context rather than this role's bounded study, keep its geometry and ownership but omit the unsupported whole-host witness claim; BOTH required studies still need actual changed, task-owned construction and will be reviewed visually. If the design genuinely needs that whole witness, its full allocation belongs in the blueprint; this role cannot re-plan it. If prior.feedback.designAllocation is supplied, use its exact source IDs, owner-grid counts, bounds and samples to correct the SAME role delta/representatives/recipes. These bounds are summaries, not editing permission: do not enlarge regions, acquire other owners, erase valid hosts, drop functions, shrink the building or spend reserved later calls. No automatic region expansion or geometry repair is performed.`;

export async function inspectDesignAllocation({before,plan,prototype,feedback,diagnostic,roles,representatives,tier}){
 const authority=checkStagedDesignAllocation(before,plan,representatives,tier);
 if(!authority)return null;
 const inspect=async(subject,candidate,directory,report)=>{
  const actual=await readAssemblyBaseline(directory,report.diagnosticAssetHash);
  try{return designAllocationCoverage(candidate,actual,roles,representatives,prototype.program.recipes);}
  catch(error){
   if(!error.designAllocationFeedback)throw error;
   const {feedbackHash,...detail}=error.designAllocationFeedback,data={...detail,subject};
   error.designAllocationFeedback={...data,feedbackHash:hash(data)};throw error;
  }
 };
 const seed=await inspect('seed',plan,diagnostic,feedback);
 const expanded=await inspect('expanded',prototype.plan,prototype.diagnostic,prototype.feedback);
 const data={version:1,authority,seed,expanded,programHash:hash(prototype.program),expandedPlanHash:hash(prototype.plan),canAuthorizePlacement:false};
 return {...data,receiptHash:hash(data)};
}

export function designAllocationFreeze(receipt,{plan,review,transition}){
 if(!receipt||receipt.authority.candidatePlanHash!==transition.seedPlanHash||receipt.expandedPlanHash!==hash(plan)||
  receipt.programHash!==transition.programHash||receipt.expanded.assetHash!==transition.expandedAssetHash||
  transition.reviewHash!==hash(review)||review.verdict!=='accept'||review.planHash!==receipt.authority.candidatePlanHash)throw Error('Design allocation lacks exact accepted review and expansion');
 const data={version:1,allocationReceiptHash:receipt.receiptHash,seedPlanHash:receipt.authority.candidatePlanHash,
  frozenPlanHash:hash(plan),packagesHash:hash(plan.packages),reviewHash:hash(review),transitionHash:transition.transitionHash,
  manufacturingScopeFrozen:true,worldAuthorityChanged:false,canAuthorizePlacement:false};
 return {...data,freezeHash:hash(data)};
}
