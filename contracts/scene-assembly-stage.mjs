import {componentReferences} from '../src/design/floor-components.mjs';
import {schemaFeedback} from './schema-feedback.mjs';
import {prototypePlanKey} from './scene-prototype-plan.mjs';

/** Narrow the model-facing schema to this already-authorized stage. Local
 * validators remain authoritative; this prevents avoidable model mistakes,
 * rather than normalizing a stale hash or expanding edit authority. */
export function assemblyStageSchema(base,input){
  const schema=structuredClone(base),format=schema.properties.format.enum[0];
  const bind=(object,key,value)=>{if(object?.properties?.[key]&&typeof value==='string')object.properties[key]={type:'string',enum:[value]};};
  const prototypeKey=prototypePlanKey(format);
  if(prototypeKey){
    bind(schema,'programHash',input.prototypeProgramHash);
    const nested=assemblyStageSchema({...schema.properties[prototypeKey],$defs:schema.$defs},input);
    schema.$defs=nested.$defs;delete nested.$defs;schema.properties[prototypeKey]=nested;
    return schema;
  }
  bind(schema,'sourceHash',input.sourceHash);bind(schema,'planHash',input.planHash);
  bind(schema,'evidenceHash',input.designEvidence?.evidenceHash);
  bind(schema,'candidateSetHash',input.candidateSetHash);
  if(format==='ScenePackageRepair'){
    bind(schema,'candidateHash',input.repairBase.candidateHash);
    const nested=assemblyStageSchema({...schema.properties.edit,$defs:schema.$defs},{...input,sourceHash:input.repairBase.candidateHash,previousDraft:input.repairBase.scene});
    schema.$defs=nested.$defs;delete nested.$defs;
    // A repair is not an optional review: an all-empty delta can only repeat
    // the rejected candidate. Keep the root an object and use nested anyOf,
    // complete strict branches and shared definitions (not unsupported not/
    // allOf, nor five copies of the entire geometry schema). This constrains
    // model output only; the existing semantic no-progress/scope checks remain.
    const mutable=[];
    for(const field of ['components','modules','palette','reservations']){
      for(const operation of ['put','remove']){
        const definition='repair_'+field+'_'+operation;
        const array=nested.properties[field].properties[operation];
        schema.$defs[definition]=array;
        nested.properties[field].properties[operation]={$ref:'#/$defs/'+definition};
        if((array.maxItems??256)>0)mutable.push({field,operation,definition});
      }
    }
    schema.properties.edit={description:'A rejected candidate requires a nonempty corrective delta; unchanged geometry still fails full validation.',anyOf:mutable.map(({field,operation,definition})=>{
      const variant=structuredClone(nested),nonempty=definition+'_nonempty';
      schema.$defs[nonempty]={...schema.$defs[definition],minItems:1};
      variant.properties[field].properties[operation]={$ref:'#/$defs/'+nonempty};
      return variant;
    })};
    return schema;
  }
  if(format==='SceneAssemblyPlanEdit'){
    bind(schema.properties.sceneEdit,'sourceHash',input.sourceHash);
    if(input.callBudget)schema.properties.packages.properties.put.maxItems=input.callBudget.maximumPackages;
  }
  if(format==='SceneAssemblyReview'){
    const ids=input.packages.map(p=>p.id);
    schema.properties.task={type:['string','null'],enum:[null,...ids]};
    schema.properties.issues.items.properties.task={type:'string',enum:ids};
  }
  const proposal=format==='SceneAssemblyPlan'?schema:format==='SceneAssemblyPlanRepair'?schema.properties.proposal:null;
  if(proposal){
    proposal.properties.packages.maxItems=input.callBudget.maximumPackages;
    const constraints=proposal.properties.scene.properties.constraints;
    for(const key of ['interior','walkable'])constraints.properties[key]={type:'boolean',enum:[true]};
    constraints.properties.passages.minItems=1;
    if(input.selectedConcept){
      const chosen=input.selectedConcept.selected.scene;
      for(const key of ['id','seed'])proposal.properties.scene.properties[key]={...proposal.properties.scene.properties[key],enum:[chosen[key]]};
      for(const axis of ['width','height','length'])proposal.properties.scene.properties.bounds.properties[axis]={type:'integer',enum:[chosen.bounds[axis]]};
    }
    if(format==='SceneAssemblyPlanRepair'&&input.priorPlan){
      // Provider guidance is exact JSON equality, not a request to paraphrase
      // read-only intent. The local repair validator still enforces it.
      const prior=input.priorPlan;
      for(const [object,key,value] of [[proposal,'designIntent',prior.designIntent],...[ 'id','seed','bounds','design' ].map(key=>[proposal.properties.scene,key,prior.scene?.[key]])]){
        const fieldSchema=object.properties[key];
        if(schemaFeedback(value,{...fieldSchema,$defs:schema.$defs}).valid)object.properties[key]={...fieldSchema,enum:[structuredClone(value)]};
      }
    }
  }
  if(!['SceneDraftEdit','SceneCoordinatedEdit'].includes(format))return schema;
  const scene=input.previousDraft,task=input.task,prefix=task.id+'__';
  const owned=id=>task.editableComponents.includes(id)||id.startsWith(prefix);
  const selector=ids=>ids.length?{anyOf:[{type:'string',enum:ids},{type:'string',pattern:'^'+prefix+'[A-Za-z0-9_-]{1,'+(32-prefix.length)+'}$'}]}:{type:'string',pattern:'^'+prefix+'[A-Za-z0-9_-]{1,'+(32-prefix.length)+'}$'};
  const componentIds=scene.components.filter(c=>owned(c.id)).map(c=>c.id);
  for(const variant of schema.$defs.component.anyOf)variant.properties.id=selector(componentIds);
  for(const key of ['design','featureBindings','constraints'])schema.properties[key]={type:'null'};
  for(const key of ['put','remove'])schema.properties.reservations.properties[key].maxItems=0;
  schema.properties.palette.properties.remove.maxItems=0;
  schema.properties.palette.properties.put.items.properties.role={type:'string',pattern:'^'+prefix+'[A-Za-z0-9_-]{1,'+(32-prefix.length)+'}$'};
  const fixed=new Set([...scene.featureBindings.flatMap(f=>f.components),...scene.reservations.flatMap(r=>[r.at.relativeTo,...r.allowedComponents]),...scene.components.filter(c=>!owned(c.id)).flatMap(componentReferences)]);
  const removable=componentIds.filter(id=>!fixed.has(id));
  if(removable.length)schema.properties.components.properties.remove.items={type:'string',enum:removable};
  else schema.properties.components.properties.remove.maxItems=0;
  const modules=scene.modules.filter(m=>{
    const consumers=scene.components.filter(c=>c.kind==='module'&&c.module===m.id);
    return consumers.every(c=>owned(c.id))&&(consumers.length||m.id.startsWith(prefix));
  }).map(m=>m.id);
  schema.properties.modules.properties.put.items.properties.id=selector(modules);
  if(modules.length)schema.properties.modules.properties.remove.items={type:'string',enum:modules};
  else schema.properties.modules.properties.remove.maxItems=0;
  return schema;
}
