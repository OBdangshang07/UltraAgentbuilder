import {hash} from '../src/generation/compiler.mjs';
import {checkStagedDesignAllocation} from '../contracts/scene-design-allocation.mjs';
import {readAssemblyBaseline} from '../src/design/assembly-scope.mjs';

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
 const {width:w,length:d}=compiled.manifest.dimensions,byTask=new Map(plan.packages.map(p=>[p.id,p]));
 for(let i=0;i<compiled.cells.length;i++){
  const id=owners[compiled.sourceOwners[i]];if(!id)continue;
  const task=byTask.get(required.get(id));
  if(!task.editableComponents.includes(id)&&!id.startsWith(task.id+'__'))throw Error('Design allocation witness crosses exclusive ownership: '+id);
  const point=[i%w,Math.floor(i/(w*d)),Math.floor(i/w)%d];
  if(!task.regions.some(r=>point.every((v,a)=>v>=r.origin[a]&&v<r.origin[a]+r.size[a])))throw Error('Design allocation misses actual witness/expanded cell: '+task.id+'/'+id+' at ['+point+']');
  counts.set(id,counts.get(id)+1);
 }
 for(const [id,n] of counts)if(!n)throw Error('Design allocation witness has no surviving cells: '+id);
 return {sourceHash:hash(plan.scene),assetHash:compiled.manifest.assetHash,cellsHash:compiled.manifest.cellsHash,ownersHash:compiled.manifest.scene.ownersHash,
  sources:[...required].map(([id,task])=>({id,task,cells:counts.get(id)})),allRequiredSourceCellsCovered:true,
  ownedSourceCoverage:designOwnedSourceCoverage(plan,compiled),
  futureWorkComplete:false,architecturalQualityVerified:false,canAuthorizePlacement:false};
}

export async function inspectDesignAllocation({before,plan,prototype,feedback,diagnostic,roles,representatives,tier}){
 const authority=checkStagedDesignAllocation(before,plan,representatives,tier);
 if(!authority)return null;
 const seed=designAllocationCoverage(plan,await readAssemblyBaseline(diagnostic,feedback.diagnosticAssetHash),roles,representatives,prototype.program.recipes);
 const expanded=designAllocationCoverage(prototype.plan,await readAssemblyBaseline(prototype.diagnostic,prototype.feedback.diagnosticAssetHash),roles,representatives,prototype.program.recipes);
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
