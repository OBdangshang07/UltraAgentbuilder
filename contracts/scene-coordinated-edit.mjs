import {hash} from '../src/generation/compiler.mjs';
import {applyPackageEdit} from './scene-assembly.schema.mjs';
import {sceneDraftEditSchema} from './scene-draft-edit.schema.mjs';
import {schemaFeedback} from './schema-feedback.mjs';

/** New-building-only authorization; never usable with baseJobId/approved assets.
 * Union only explicitly implicated existing packages, not the whole scene. */
export function coordinatedScope(plan,scene,review){
  const ids=[...new Set([review.task,...review.issues.map(i=>i.task)])].sort();
  if(ids.some(id=>!plan.packages.some(p=>p.id===id)))throw new Error('Unknown coordinated package');
  const packages=plan.packages.filter(p=>ids.includes(p.id));
  const primary=packages.find(p=>p.id===review.task);
  if(!primary)throw new Error('Missing coordinated primary package');
  const editableComponents=scene.components.filter(c=>packages.some(p=>p.editableComponents.includes(c.id)||c.id.startsWith(p.id+'__'))).map(c=>c.id);
  const task={...structuredClone(primary),name:'Coordinated revision',purpose:review.summary,
    regions:packages.flatMap(p=>p.regions),editableComponents,interfaces:[...new Set(packages.flatMap(p=>p.interfaces))]};
  const data={version:1,sourceHash:hash(scene),planHash:hash(plan),packages:ids,task,
    reservationsFrozen:true,interfacesFrozen:true,approvedAsset:false,canAuthorizePlacement:false};
  return {...data,scopeHash:hash(data)};
}
export function coordinatedEditSchema(scope){
  const schema=structuredClone(sceneDraftEditSchema);
  schema.properties.format={type:'string',enum:['SceneCoordinatedEdit']};
  schema.properties.scopeHash={type:'string',enum:[scope.scopeHash]};schema.required.push('scopeHash');
  return schema;
}
export function applyCoordinatedEdit(plan,source,scope,response){
  const {scopeHash,...identity}=scope;
  if(hash(identity)!==scopeHash||scope.sourceHash!==hash(source)||scope.planHash!==hash(plan)||scope.approvedAsset!==false||scope.canAuthorizePlacement!==false)throw new Error('Coordinated authority identity changed');
  if(!schemaFeedback(response,coordinatedEditSchema(scope)).valid)throw new Error('Invalid coordinated edit contract');
  const {scopeHash:provided,...edit}=response;
  if(provided!==scopeHash)throw new Error('Stale coordinated scope');
  // Existing palette, reservations, design and passage constraints remain frozen.
  // Shared modules require every old AND new consumer in the selected union.
  return applyPackageEdit(source,{...edit,format:'SceneDraftEdit'},scope.task);
}
