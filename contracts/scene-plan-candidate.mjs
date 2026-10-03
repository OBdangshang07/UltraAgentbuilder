import {assemblyPlanEditSchema,applyAssemblyPlanEdit,inspectAssemblyPlan} from './scene-assembly.schema.mjs';
import {schemaFeedback} from './schema-feedback.mjs';
import {hash} from '../src/generation/compiler.mjs';

/** A schema-valid rejected proposal may receive a small candidate-local edit.
 * It is not the accepted authority source and cannot authorize placement. */
export function planCandidateBase(source,rejected,tier){
  const effective=rejected?.effectiveEdit??rejected?.response;
  if(!rejected?.plan||!schemaFeedback(effective,assemblyPlanEditSchema).valid)return null;
  try{
    const rebuilt=applyAssemblyPlanEdit(source,effective,tier,{designReview:true}).plan;
    if(hash(rebuilt)!==hash(rejected.plan)||!inspectAssemblyPlan(rebuilt,tier).contract.valid)return null;
    return {authorityPlanHash:hash(source),candidatePlanHash:hash(rebuilt),candidateSourceHash:hash(rebuilt.scene),
      plan:rebuilt,effectiveEditHash:hash(effective),approved:false,canAuthorizePlacement:false};
  }catch{return null;}
}

/** Encode the entire repaired proposal against the original accepted plan.
 * This only derives a data delta; it does not choose or repair any geometry. */
export function planCandidateDelta(source,candidate){
  if(source.designIntent!==candidate.designIntent)throw new Error('Candidate correction changed original design intent');
  for(const field of ['id','seed','bounds'])if(hash(source.scene[field])!==hash(candidate.scene[field]))throw new Error('Candidate correction changed fixed '+field);
  const delta=(old,next,key)=>({put:next.filter(v=>!old.some(p=>p[key]===v[key]&&hash(p)===hash(v))),remove:old.filter(p=>!next.some(v=>v[key]===p[key])).map(p=>p[key])});
  const sceneEdit={format:'SceneDraftEdit',version:1,sourceHash:hash(source.scene)};
  for(const field of ['components','modules','palette','reservations'])sceneEdit[field]=delta(source.scene[field],candidate.scene[field],field==='palette'?'role':'id');
  for(const field of ['design','featureBindings','constraints'])sceneEdit[field]=hash(source.scene[field])===hash(candidate.scene[field])?null:structuredClone(candidate.scene[field]);
  const effectiveEdit={format:'SceneAssemblyPlanEdit',version:1,planHash:hash(source),sceneEdit,packages:delta(source.packages,candidate.packages,'id')};
  if(!schemaFeedback(effectiveEdit,assemblyPlanEditSchema).valid)throw new Error('Combined design correction exceeds original edit contract');
  return effectiveEdit;
}

export function applyPlanCandidateCorrection(source,base,edit,tier){
  if(base.approved!==false||base.canAuthorizePlacement!==false||base.authorityPlanHash!==hash(source)||base.candidatePlanHash!==hash(base.plan)||base.candidateSourceHash!==hash(base.plan.scene)||edit?.planHash!==base.candidatePlanHash||edit?.sceneEdit?.sourceHash!==base.candidateSourceHash)throw new Error('Stale/invalid design candidate identity');
  if(!schemaFeedback(edit,assemblyPlanEditSchema).valid)throw new Error('Invalid design candidate edit contract');
  const repaired=applyAssemblyPlanEdit(base.plan,edit,tier,{designReview:true});
  const effectiveEdit=planCandidateDelta(source,repaired.plan);
  const checked=applyAssemblyPlanEdit(source,effectiveEdit,tier,{designReview:true});
  if(hash(checked.plan)!==hash(repaired.plan))throw new Error('Design candidate correction cannot reorder original objects');
  return {...checked,effectiveEdit};
}
