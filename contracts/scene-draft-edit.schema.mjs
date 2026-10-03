import {sceneSchema,validateScene} from './scene-spec.schema.mjs';
import {BUILDING_LIMITS as L} from './building-limits.mjs';
import {SCENE_COLLECTION_LIMITS,SCENE_EDIT_LIMITS} from './scene-limits.mjs';
import {schemaFeedback} from './schema-feedback.mjs';
import {hash} from '../src/generation/compiler.mjs';

const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const nullable=schema=>({anyOf:[structuredClone(schema),{type:'null'}]});
const array=(items,maxItems)=>({type:'array',items:structuredClone(items),maxItems});
const id={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,31}$'};
const collection=(name,max)=>object({put:array(sceneSchema.properties[name].items,max),remove:array(id,max)});
export const sceneDraftEditSchema=object({format:{type:'string',enum:['SceneDraftEdit']},version:{type:'integer',enum:[1]},sourceHash:{type:'string',pattern:'^[a-f0-9]{64}$'},
  ...Object.fromEntries(Object.entries(SCENE_EDIT_LIMITS).map(([name,max])=>[name,collection(name,max)])),
  design:nullable(sceneSchema.properties.design),featureBindings:nullable(sceneSchema.properties.featureBindings),constraints:nullable(sceneSchema.properties.constraints)});
sceneDraftEditSchema.$defs=structuredClone(sceneSchema.$defs);

const only=(o,keys,label)=>{if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(o,k)))throw new Error(label+': unexpected/missing fields');};
const validId=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(value);
export function sceneCapacity(scene){
  return {collections:Object.fromEntries(Object.entries(SCENE_COLLECTION_LIMITS).map(([field,total])=>[field,{used:scene?.[field]?.length??0,total,remaining:Math.max(0,total-(scene?.[field]?.length??0)),maximumPut:SCENE_EDIT_LIMITS[field]}])),sourceBytes:Buffer.byteLength(JSON.stringify(scene??{})),maximumSourceBytes:L.bytes,maximumExpandedNodes:L.nodes,maximumCellVisits:L.visits,maximumOccupiedCells:L.occupied};
}
export class DraftCandidateError extends Error{
  constructor(error,scene,changes){super(error.message);this.name='DraftCandidateError';this.scene=scene;this.changes=changes;
    this.contract=schemaFeedback(scene,sceneSchema);
    if(this.contract.valid){this.contract.valid=false;this.contract.issues.push({path:'$',code:'merged-scene',message:error.message});}
  }
}
/** Draft edits have NO authority over approved assets. Source hash, not asset
 * hash, selects an unapproved stage. Native scoped revisions use revision.mjs. */
export function applySceneDraftEdit(source,edit){
  validateScene(source);
  if(Buffer.byteLength(JSON.stringify(edit))>L.bytes)throw new Error('SceneDraftEdit byte quota exceeded');
  only(edit,Object.keys(sceneDraftEditSchema.properties),'SceneDraftEdit');
  if(edit.format!=='SceneDraftEdit'||edit.version!==1||typeof edit.sourceHash!=='string'||edit.sourceHash!==hash(source))throw new Error('Stale/invalid draft source hash; no edit was applied');
  const next=structuredClone(source),changes={};
  for(const [field,max] of Object.entries(SCENE_EDIT_LIMITS)){
    const key=field==='palette'?'role':'id';
    const delta=edit[field];only(delta,['put','remove'],field);
    if(!Array.isArray(delta.put)||!Array.isArray(delta.remove)||delta.put.length>max||delta.remove.length>max)throw new Error('Invalid draft edit collection: '+field);
    const old=new Map(next[field].map(v=>[v[key],v])),put=new Map(),remove=new Set();
    if(old.size!==next[field].length)throw new Error('Ambiguous duplicate source ID: '+field);
    for(const id of delta.remove){if(!validId(id)||remove.has(id)||!old.has(id))throw new Error('Unknown/duplicate draft removal: '+field);remove.add(id);}
    for(const v of delta.put){if(!v||!validId(v[key])||put.has(v[key])||remove.has(v[key]))throw new Error('Ambiguous draft replacement: '+field);put.set(v[key],structuredClone(v));}
    next[field]=next[field].filter(v=>!remove.has(v[key])).map(v=>put.get(v[key])??v);
    for(const [id,v] of put)if(!old.has(id))next[field].push(v);
    changes[field]={added:[...put.keys()].filter(id=>!old.has(id)),changed:[...put.keys()].filter(id=>old.has(id)&&hash(old.get(id))!==hash(put.get(id))),removed:[...remove]};
  }
  for(const field of ['design','featureBindings','constraints'])if(edit[field]!==null)next[field]=structuredClone(edit[field]);
  for(const field of ['interior','walkable'])if(source.constraints[field]&&next.constraints?.[field]!==true)throw new Error('Draft edit cannot disable original '+field+' intent');
  try{validateScene(next);}catch(error){throw new DraftCandidateError(error,next,changes);}
  return {scene:next,sourceHash:hash(next),changes};
}
