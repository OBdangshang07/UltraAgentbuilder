import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../generation/compiler.mjs';
import {furnishableAirSource} from './ownership.mjs';
import {sceneCapacity} from '../../contracts/scene-draft-edit.schema.mjs';
import {PACKAGE_SCOPE_EVIDENCE} from './correction-feedback.mjs';

const ownsComponent=(task,id)=>task.editableComponents.includes(id)||id.startsWith(task.id+'__');

/** Minimum first-construction headroom, NOT a design-quality quota. A removal
 * may fund an addition; enforcement checks the actual merged collection. */
export function assemblyCapacity(plan,scene,completed=[],task=null,phase='component'){
  const capacity=sceneCapacity(scene),ids=new Set(plan.packages.map(p=>p.id));
  if(completed.some(id=>!ids.has(id))||new Set(completed).size!==completed.length||task&&!ids.has(task.id))throw new Error('Invalid assembly capacity context');
  const pending=plan.packages.filter(p=>!completed.includes(p.id));
  if(phase==='refine-component'&&pending.length)throw new Error('Refinement requires completed first construction');
  const packages=pending.map(p=>{
    const ownedComponentCount=scene.components.filter(c=>ownsComponent(p,c.id)).length;
    return {id:p.id,ownedComponentCount,minimumAdditionalComponents:ownedComponentCount?0:1};
  });
  const minimumRequired=packages.reduce((n,p)=>n+p.minimumAdditionalComponents,0);
  const reservedForPendingConstruction=packages.filter(p=>p.id!==task?.id).reduce((n,p)=>n+p.minimumAdditionalComponents,0);
  const remaining=capacity.collections.components.remaining;
  return {...capacity,assembly:{version:1,phase,task:task?.id??null,pendingPackages:packages,
    remaining,minimumRequired,reservedForPendingConstruction,
    maximumNewComponentsAtTurn:task?Math.max(0,remaining-reservedForPendingConstruction):null,
    feasible:remaining>=minimumRequired,deficit:Math.max(0,minimumRequired-remaining),
    allowanceExcludesRemovalCredits:true,aestheticQualityVerified:false,canAuthorizePlacement:false}};
}

/** Call ONLY after hashed edit validation and package authority checks. */
export function checkAssemblyCapacity(capacity,applied){
  const remaining=sceneCapacity(applied.scene).collections.components.remaining;
  return {accepted:remaining>=capacity.assembly.reservedForPendingConstruction,
    remainingAfter:remaining,reservedForPendingConstruction:capacity.assembly.reservedForPendingConstruction,
    added:applied.changes.components.added.length,removed:applied.changes.components.removed.length,
    netGrowth:applied.changes.components.added.length-applied.changes.components.removed.length,
    canAuthorizePlacement:false};
}

/** Summarize existing evidence; no navigation gate, geometry edits, new
 * traversal or claim that an editable owner can bypass frozen interfaces. */
export function assemblyAdvisory(plan,scene,feedback){
  if(feedback?.sourceHash!==hash(scene))throw new Error('Assembly advisory source mismatch');
  const nav=feedback.navigationFeedback;
  const interfaces=[...new Set(plan.packages.flatMap(p=>p.interfaces))].map(index=>{
    const declared=scene.constraints.passages[index],p=nav?.passages?.find(p=>p.index===index);
    const total=declared.size[0]*declared.size[2];
    const complete=p?.checksComplete===true&&p.checked===total;
    return {index,packages:plan.packages.filter(t=>t.interfaces.includes(index)).map(t=>t.id),
      status:!complete?'incomplete':p.standable===total&&p.clearanceObstructions===0?'clearance-checked':'clearance-unverified',
      entryRelation:p?.entryRelation??'unknown'};
  });
  const stairs=scene.components.filter(c=>c.kind==='stairs').map(c=>{
    const g=nav?.stairs?.groups?.find(g=>g.component===c.id),expectedInstances=c.repeat.count;
    const checked=g?.checkedLowerFloors?.length??0,unverified=g?.unverifiedFloors?.length??0,skipped=g?.skippedFloors?.length??0;
    const complete=checked===expectedInstances&&!skipped;
    return {component:c.id,expectedInstances,checked,unverified,skipped,
      localTwoWayPaths:g?.localTwoWayPaths??0,status:!complete?'incomplete':!unverified&&g?.localTwoWayPaths===expectedInstances?'local-two-way':'unverified',
      editableOwners:plan.packages.filter(p=>ownsComponent(p,c.id)).map(p=>p.id)};
  });
  return {version:1,planHash:hash(plan),sourceHash:hash(scene),canAuthorizePlacement:false,geometryChanged:false,navigationGate:false,
    evidenceAvailable:!!nav,checksComplete:nav?.checksComplete===true,qualityNavigation:feedback.quality?.navigation??'unknown',
    interfaces,stairs,unownedUnverifiedStairs:stairs.filter(s=>s.status!=='local-two-way'&&!s.editableOwners.length).map(s=>s.component),
    limitations:['Advisory only: incomplete or unverified navigation remains previewable under the existing per-asset acknowledgement policy.',
      'An editable owner is not proof a repair fits its regions, frozen interfaces or other owners; no scope is expanded.',
      'Local paths/declared interfaces do not certify an outdoor entrance, every floor/room, independent egress or visual quality.',
      'Dynamic doors and partial-block walking remain unverified; missing/skipped evidence is unknown, not pass.']};
}

/** Only for private intermediate snapshots. Does NOT relax native import. */
export async function readAssemblyBaseline(directory,expectedHash){
  const read=async name=>JSON.parse(await fs.readFile(path.join(directory,name),'utf8'));
  const manifest=await read('manifest.json'),{assetHash,...metadata}=manifest;
  if(!manifest.diagnosticOnly||!manifest.checkpointOnly||assetHash!==expectedHash||hash(metadata)!==assetHash)throw new Error('Assembly baseline manifest identity mismatch');
  const {width:w,height:h,length:d}=manifest.dimensions;
  if(![w,h,d].every(Number.isSafeInteger)||w<1||w>256||h<1||h>384||d<1||d>256||w*h*d>8388608)throw new Error('Assembly baseline bounds');
  const binary=await fs.readFile(path.join(directory,'cells.bin')),owners=await fs.readFile(path.join(directory,'source-owners.bin')),designSources=await read('design-sources.json');
  if(binary.length!==w*h*d*2||owners.length!==binary.length||hash(binary)!==manifest.cellsHash||hash(owners)!==manifest.scene.ownersHash||hash(designSources)!==manifest.scene.sourcesHash)throw new Error('Assembly baseline geometry/provenance mismatch');
  const cells=Uint16Array.from({length:binary.length/2},(_,i)=>binary.readUInt16LE(i*2)),sourceOwners=Uint16Array.from({length:cells.length},(_,i)=>owners.readUInt16LE(i*2));
  if(cells.some(v=>v>=manifest.palette.length)||sourceOwners.some(v=>v>=designSources.traceSources.length))throw new Error('Assembly baseline palette/owner index');
  return {manifest,cells,designSources,sourceOwners};
}
/** Intermediate seed cell/owner scope only. Never asserts preserved routes or
 * permits final adoption: the caller still owes full expanded package checks. */
export function checkPackageCellScope(base,next,task){
  if(hash(base.manifest.dimensions)!==hash(next.manifest.dimensions))throw new Error('Package cannot change dimensions');
  const owned=id=>id&&(task.editableComponents.includes(id)||id.startsWith(task.id+'__'));
  const {width:w,length:d}=base.manifest.dimensions;let changedCells=0,firstError=null,conflictCells=0;const conflicts=new Map();
  const conflict=(code,message,point,owner,after)=>{
    firstError??=message;conflictCells++;const key=code+'|'+(owner?.component??'@unknown')+'|'+(after?.component??'@unknown');
    if(!conflicts.has(key)&&conflicts.size<32)conflicts.set(key,{code,before:owner?.component??null,after:after?.component??null,cells:0,min:[...point],max:[...point],samples:[]});
    const group=conflicts.get(key);if(group){group.cells++;for(let a=0;a<3;a++){group.min[a]=Math.min(group.min[a],point[a]);group.max[a]=Math.max(group.max[a],point[a]);}if(group.samples.length<4)group.samples.push(point);}
  };
  for(let i=0;i<base.cells.length;i++){
    const owner=base.designSources.traceSources[base.sourceOwners[i]],after=next.designSources.traceSources[next.sourceOwners[i]];
    const geometryChanged=base.manifest.palette[base.cells[i]]!==next.manifest.palette[next.cells[i]];
    const ownershipChanged=owner?.component!==after?.component;
    if(!geometryChanged&&!ownershipChanged)continue;
    const point=[i%w,Math.floor(i/(w*d)),Math.floor(i/w)%d];
    if(!task.regions.some(r=>point.every((v,a)=>v>=r.origin[a]&&v<r.origin[a]+r.size[a])))conflict('outside-region','Package changed cells outside approved regions at ['+point+']',point,owner,after);
    else if(base.cells[i]!==0&&!owned(owner?.component)&&!(base.cells[i]===1&&furnishableAirSource(owner)&&next.cells[i]>=2))conflict('protected-owner','Package altered protected component '+(owner?.component??'@unknown')+' at ['+point+']',point,owner,after);
    if(geometryChanged)changedCells++;
  }
  if(firstError)throw Object.assign(new Error(firstError),{packageScopeFeedback:{authority:'frozen-package-scope',interpretation:PACKAGE_SCOPE_EVIDENCE,conflictCells,groups:[...conflicts.values()],truncated:[...conflicts.values()].reduce((n,g)=>n+g.cells,0)<conflictCells,canAuthorizePlacement:false,scopeExpanded:false}});
  if(!changedCells)throw new Error('Package made no actual block/material change');
  return {changedCells,scopeVerified:true,previouslyCheckedRoutesPreserved:false,aestheticImprovementVerified:false};
}
export function checkPackageGeometry(base,next,task,previousFeedback,feedback){
  const scope=checkPackageCellScope(base,next,task);
  // Check conservative evidence that was genuinely established before this
  // edit; never reinterpret an unverified old route as certified.
  const old=previousFeedback.navigationFeedback,now=feedback.navigationFeedback;
  const regression=(message,kind,previous,current,identity={})=>Object.assign(new Error(message),{packageNavigationFeedback:{kind,...identity,
    acceptedSourceHash:base.designSources.sourceHash,candidateSourceHash:next.designSources.sourceHash,previous:structuredClone(previous),current:current?structuredClone(current):null,
    canAuthorizePlacement:false,geometryChanged:false,scopeExpanded:false,
    interpretation:'Existing conservative passage/stair evidence was lost. Compare exact before/after checks and source interfaces; incomplete evidence is unknown, not permission to erase a route. No automatic block edit or navigation-policy relaxation.'}});
  if(old?.entry?.startValid&&!now?.entry?.startValid)throw regression('Package regressed declared entry headroom/support','entry',old.entry,now?.entry);
  for(const p of old?.passages??[]){const q=now?.passages[p.index];if(p.checksComplete&&(!q?.checksComplete||q.standable<p.standable||q.clearanceObstructions>p.clearanceObstructions)||p.entryRelation==='reachable'&&q?.entryRelation!=='reachable')throw regression('Package regressed a previously checked passage: '+p.index,'passage',p,q,{index:p.index});}
  for(const group of old?.stairs.groups??[]){const after=now?.stairs.groups.find(g=>g.component===group.component);
    for(const floor of group.checkedLowerFloors.filter(y=>!group.unverifiedFloors.includes(y)))if(!after?.checkedLowerFloors.includes(floor)||after.unverifiedFloors.includes(floor))throw regression('Package regressed local stair route '+group.component+' floor '+floor,'stair',group,after,{component:group.component,floor});
  }
  if(previousFeedback.quality?.navigation==='verified'&&feedback.quality?.issues.some(i=>i.code!=='partial-block-collision'))throw new Error('Package regressed previously verified navigation');
  return {...scope,previouslyCheckedRoutesPreserved:true};
}
