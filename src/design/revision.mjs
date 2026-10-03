import {compileScene,lowerScene} from './compiler.mjs';
import {hash} from '../generation/compiler.mjs';
import {compareCompiled} from '../generation/diff.mjs';
import {sceneSchema} from '../../contracts/scene-spec.schema.mjs';
import {forkInstanceReplacements} from './instance-revision.mjs';
import {furnishableAirSource} from './ownership.mjs';

export const scenePatchSchema={type:'object',additionalProperties:false,required:['baseHash','replaceComponents','removeComponents','replaceModules'],properties:{baseHash:{type:'string',pattern:'^[a-f0-9]{64}$'},replaceComponents:{type:'array',maxItems:256,items:{$ref:'#/$defs/component'}},removeComponents:{type:'array',maxItems:256,items:{type:'string'}},replaceModules:{type:'array',maxItems:32,items:sceneSchema.properties.modules.items}},$defs:sceneSchema.$defs};
scenePatchSchema.properties.replaceInstances={type:'array',maxItems:64,items:{type:'object',additionalProperties:false,required:['component','index','replacement','module'],properties:{component:{type:'string'},index:{type:'integer',minimum:0,maximum:255},replacement:{$ref:'#/$defs/component'},module:{anyOf:[{type:'null'},sceneSchema.properties.modules.items]}}}};
scenePatchSchema.required.push('replaceInstances');
function only(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw new Error('Invalid '+label);}
export function validateSceneScope(scope){
 only(scope,['components','regions','protectedComponents','shared','instances'],'revision scope');
 for(const field of ['components','protectedComponents'])if(!Array.isArray(scope[field])||scope[field].length>256||scope[field].some(id=>typeof id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(id))||new Set(scope[field]).size!==scope[field].length)throw new Error('Invalid revision component scope');
 if(!scope.components.length||!['instance','all'].includes(scope.shared)||!Array.isArray(scope.regions)||!scope.regions.length||scope.regions.length>256)throw new Error('Explicit bounded revision scope is required');
 for(const r of scope.regions){only(r,['origin','size'],'revision region');for(const [k,min] of [['origin',0],['size',1]])if(!Array.isArray(r[k])||r[k].length!==3||r[k].some(n=>!Number.isSafeInteger(n)||n<min||n>384))throw new Error('Invalid revision region');}
 if(scope.instances!==undefined){
  if(scope.shared!=='instance'||!Array.isArray(scope.instances)||!scope.instances.length||scope.instances.length>64)throw new Error('Invalid instance selection scope');
  const seen=new Set();for(const s of scope.instances){only(s,['component','index'],'instance selection');if(!scope.components.includes(s.component)||scope.protectedComponents.includes(s.component)||seen.has(s.component)||!Number.isSafeInteger(s.index)||s.index<0||s.index>255)throw new Error('Invalid/duplicate instance selection');seen.add(s.component);}
 }
 return scope;
}
export function affectedComponents(scene,ids){
 const {dependencies}=lowerScene(scene),result=new Set(ids);let changed=true;
 while(changed){changed=false;for(const [id,refs] of Object.entries(dependencies))if(!result.has(id)&&refs.some(ref=>result.has(ref))){result.add(id);changed=true;}}
 return [...result];
}
export function validateSceneSelection(scene,scope,sources){
 validateSceneScope(scope);const components=new Map(scene.components.map(c=>[c.id,c])),dimensions=[scene.bounds.width,scene.bounds.height,scene.bounds.length];
 for(const id of [...scope.components,...scope.protectedComponents])if(!components.has(id))throw new Error('Scope refers to missing component: '+id);
 for(const r of scope.regions)if(r.origin.some((v,i)=>v+r.size[i]>dimensions[i]))throw new Error('Revision region outside asset');
 for(const selection of scope.instances??[]){
  const c=components.get(selection.component),boxes=sources.componentBounds[selection.component],index=selection.index;
  if(!c?.at||!c.repeat||index>=c.repeat.count||!boxes?.[index])throw new Error('Unknown repeated instance; no model was invoked');
  const chosen=boxes[index];
  if(boxes.some((other,i)=>i!==index&&chosen.origin.every((v,a)=>v<other.origin[a]+other.size[a]&&other.origin[a]<v+chosen.size[a])))throw new Error('Overlapping instance regions require an explicit component-wide revision; no model was invoked');
 }
 return scope;
}

/** Caller-owned scope is separate from model output. Semantic states/masks, never palette indices. */
export function reviseScene(scene,patch,scope,{navigationPolicy='review',baseCompiled}={}){
 validateSceneScope(scope);only(patch,['baseHash','replaceComponents','removeComponents','replaceModules','replaceInstances'],'ScenePatch');
 const base=baseCompiled??compileScene(scene,{navigationPolicy});
 // A persisted base is the asset the user actually approved. Recompiling it with a
 // newer diagnostic/provenance version must not replace that identity implicitly.
 if(baseCompiled){
  const {assetHash,...metadata}=base.manifest,owners=Buffer.alloc(base.sourceOwners?.length*2||0);base.sourceOwners?.forEach((v,i)=>owners.writeUInt16LE(v,i*2));
  if(base.manifest.diagnosticOnly||hash(metadata)!==assetHash||hash(base.binary)!==base.manifest.cellsHash||hash(scene)!==base.manifest.scene?.sourceHash||hash(base.designSources)!==base.manifest.scene.sourcesHash||hash(owners)!==base.manifest.scene.ownersHash||base.sourceOwners.length!==base.cells.length||base.binary.length!==base.cells.length*2||base.cells.some((v,i)=>v!==base.binary.readUInt16LE(i*2)))throw new Error('Immutable scene base integrity failed');
 }
 if(patch.baseHash!==base.manifest.assetHash)throw new Error('Stale scene baseHash');
 validateSceneSelection(scene,scope,base.designSources);
 for(const field of ['replaceComponents','removeComponents','replaceModules'])if(!Array.isArray(patch[field])||patch[field].length>256)throw new Error('Invalid ScenePatch arrays');
 if(!Array.isArray(patch.replaceInstances??[])||(patch.replaceInstances?.length??0)>64)throw new Error('Invalid instance replacement list');
 const forked=forkInstanceReplacements(scene,patch.replaceInstances??[],scope,base);
 const original=new Map(scene.components.map(c=>[c.id,c])),allowed=new Set([...scope.components,...forked.created]),protectedIds=new Set(scope.protectedComponents),changed=new Set(forked.changed),next=forked.scene;
 const selectedInstances=new Set((scope.instances??[]).map(s=>s.component));
 for(const id of [...scope.components,...protectedIds])if(!original.has(id))throw new Error('Scope refers to missing component: '+id);
 const replacements=new Map();for(const c of patch.replaceComponents){if(!c||replacements.has(c.id)||!scope.components.includes(c.id)||protectedIds.has(c.id)||selectedInstances.has(c.id))throw new Error('Component replacement outside scope; selected repeats require replaceInstances');replacements.set(c.id,c);changed.add(c.id);}
 const remove=new Set();for(const id of patch.removeComponents){if(remove.has(id)||!scope.components.includes(id)||protectedIds.has(id)||replacements.has(id)||selectedInstances.has(id))throw new Error('Component removal outside scope');remove.add(id);changed.add(id);}
 const moduleReplacements=new Map();for(const m of patch.replaceModules){
  if(!m||moduleReplacements.has(m.id)||!scene.modules.some(v=>v.id===m.id))throw new Error('Unknown/duplicate module replacement');
  const consumers=scene.components.filter(c=>c.kind==='module'&&c.module===m.id);
  if(scope.shared!=='all'||consumers.some(c=>!allowed.has(c.id)||protectedIds.has(c.id)||selectedInstances.has(c.id)))throw new Error('Shared module change requires explicit all-instances scope');
  consumers.forEach(c=>changed.add(c.id));moduleReplacements.set(m.id,m);
 }
 next.components=next.components.filter(c=>!remove.has(c.id)).map(c=>replacements.get(c.id)??c);
 next.modules=next.modules.map(m=>moduleReplacements.get(m.id)??m);
 // Component-local parameters may change one module placement without changing its shared definition.
 const affected=new Set([...affectedComponents(scene,[...changed]),...affectedComponents(next,[...changed])]);
 for(const id of affected)if(!allowed.has(id)||protectedIds.has(id))throw new Error('Dependency change exceeds approved scope: '+id);
 const revised=compileScene(next,{navigationPolicy}),b=base.manifest.dimensions;
 for(const r of scope.regions)if(r.origin.some((v,i)=>v+r.size[i]>[b.width,b.height,b.length][i]))throw new Error('Revision region outside asset');
 let changedCells=0;
 for(let i=0;i<base.cells.length;i++){
  const old=base.manifest.palette[base.cells[i]],now=revised.manifest.palette[revised.cells[i]];if(old===now)continue;
  const point=[i%b.width,Math.floor(i/(b.width*b.length)),Math.floor(i/b.width)%b.length];
  const oldSource=base.designSources.traceSources[base.sourceOwners[i]],newSource=revised.designSources.traceSources[revised.sourceOwners[i]];
  const oldProtected=protectedIds.has(oldSource?.component)&&!(furnishableAirSource(oldSource)&&base.cells[i]===1);
  const newProtected=protectedIds.has(newSource?.component)&&!(furnishableAirSource(newSource)&&revised.cells[i]===1);
  if(oldProtected||newProtected)throw new Error('Protected component geometry would change: '+(oldProtected?oldSource.component:newSource.component));
  if(forked.protectedRegions.some(r=>point.every((v,a)=>v>=r.origin[a]&&v<r.origin[a]+r.size[a])))throw new Error('Unselected repeated instance geometry would change');
  if(!scope.regions.some(r=>point.every((v,a)=>v>=r.origin[a]&&v<r.origin[a]+r.size[a])))throw new Error(`Revision changes outside approved region at [${point}]`);
  changedCells++;
 }
 return {scene:next,compiled:revised,revision:{baseHash:base.manifest.assetHash,sourceHash:hash(next),affected:[...affected],instanceForks:forked.forks,scope:structuredClone(scope),changedCells,diff:compareCompiled(base,revised)}};
}
