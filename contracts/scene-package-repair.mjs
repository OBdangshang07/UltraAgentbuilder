import {sceneDraftEditSchema} from './scene-draft-edit.schema.mjs';
import {applyPackageEdit} from './scene-assembly.schema.mjs';
import {schemaFeedback} from './schema-feedback.mjs';
import {hash} from '../src/generation/compiler.mjs';

const edit=structuredClone(sceneDraftEditSchema);delete edit.$defs;
export const packageRepairSchema={type:'object',additionalProperties:false,
  required:['format','version','sourceHash','candidateHash','edit'],properties:{
    format:{type:'string',enum:['ScenePackageRepair']},version:{type:'integer',enum:[1]},
    sourceHash:{type:'string',pattern:'^[a-f0-9]{64}$'},candidateHash:{type:'string',pattern:'^[a-f0-9]{64}$'},edit
  },$defs:structuredClone(sceneDraftEditSchema.$defs)};

/** Only schema-valid, package-authorized DATA may become a repair baseline.
 * It is still unapproved geometry. Never use it as the authority baseline. */
export function packageRepairBase(source,critique,task){
  if(!critique?.rejectedSource||!critique?.rejectedEdit||!schemaFeedback(critique.rejectedEdit,sceneDraftEditSchema).valid)return null;
  try{
    const candidate=applyPackageEdit(source,critique.rejectedEdit,task).scene;
    if(hash(candidate)!==hash(critique.rejectedSource))return null;
    return {candidateHash:hash(candidate),rejectedEditHash:hash(critique.rejectedEdit),scene:candidate,approved:false,canAuthorizePlacement:false};
  }catch{return null;}
}

/** Derive a source delta, not a geometry correction. Keep all untouched
 * candidate objects verbatim; all authority is rechecked against source. */
export function packageDelta(source,candidate){
  const effective={format:'SceneDraftEdit',version:1,sourceHash:hash(source)};
  for(const field of ['components','modules','palette','reservations']){
    const key=field==='palette'?'role':'id',old=new Map(source[field].map(v=>[v[key],v])),next=new Map(candidate[field].map(v=>[v[key],v]));
    effective[field]={put:candidate[field].filter(v=>!old.has(v[key])||hash(old.get(v[key]))!==hash(v)),remove:source[field].filter(v=>!next.has(v[key])).map(v=>v[key])};
  }
  for(const field of ['design','featureBindings','constraints']){
    if(hash(source[field])!==hash(candidate[field]))throw new Error('Package repair changed frozen '+field);
    effective[field]=null;
  }
  if(!schemaFeedback(effective,sceneDraftEditSchema).valid)throw new Error('Combined package proposal exceeds the original edit contract');
  return effective;
}

export function applyPackageRepair(source,base,response,task){
  if(!schemaFeedback(response,packageRepairSchema).valid)throw new Error('Invalid package repair contract');
  if(response.sourceHash!==hash(source)||response.candidateHash!==base.candidateHash||base.candidateHash!==hash(base.scene)||response.edit.sourceHash!==base.candidateHash)throw new Error('Stale/invalid package repair identity');
  // Candidate-local edits cannot touch global data, other packages, shared
  // module consumers or existing palette roles. Even temporary candidates
  // remain subject to the same package authorization checks.
  const candidate=applyPackageEdit(base.scene,response.edit,task).scene;
  const effectiveEdit=packageDelta(source,candidate);
  const checked=applyPackageEdit(source,effectiveEdit,task);
  if(hash(checked.scene)!==hash(candidate))throw new Error('Package repair cannot reorder previously existing source objects');
  return {...checked,effectiveEdit};
}
