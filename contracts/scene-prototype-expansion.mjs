import {hash} from '../src/generation/compiler.mjs';
import {validateScene} from './scene-spec.schema.mjs';
import {schemaFeedback} from './schema-feedback.mjs';

const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const integer=(minimum,maximum)=>({type:'integer',minimum,maximum});
const componentId={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,31}$'};
const step=items=>({type:'array',minItems:3,maxItems:3,items});
const recipe=(mode,count,placement,description)=>({...object({mode:{type:'string',enum:[mode]},component:componentId,count,step:placement}),description});
export const prototypeRecipeSchema={anyOf:[
 recipe('repeat',integer(2,256),step(integer(-384,384)),
  'Only shape/module/void/roomZone/stairs/pergola/balcony/planter/path with repeat.count=1. Explicit nonzero [dx,dy,dz]; validate every last extent and exceptional floor.'),
 recipe('storeys',integer(2,64),step({type:'integer',enum:[0]}),
  'Only storeyRoom/storeyOpening/storeyFacade with floors.count=1. step MUST be [0,0,0]: the program uses consecutive authoritative floors, not a metre stride.'),
 recipe('panelRows',integer(2,64),step(integer(0,384)),
  'Only facade/panelFacade/edgeFacade with count[1]=1. step MUST be [0,positiveVerticalStride,0]; preserves horizontal columns/step and explicit exclusions.')
]};
export const prototypeExpansionSchema=object({
 format:{type:'string',enum:['ScenePrototypeExpansion']},version:integer(1,1),
 seedSourceHash:{type:'string',pattern:'^[a-f0-9]{64}$'},
 recipes:{type:'array',minItems:1,maxItems:64,items:prototypeRecipeSchema}
});
const repeatKinds=new Set(['shape','module','void','roomZone','stairs','pergola','balcony','planter','path']);
const floorKinds=new Set(['storeyRoom','storeyOpening','storeyFacade']);
const panelKinds=new Set(['facade','panelFacade','edgeFacade']);
export function prototypeDataError(message,issues){
 const error=Error(message+': '+JSON.stringify(issues).slice(0,6000));
 error.contract={valid:false,issues:issues.slice(0,128),truncated:issues.length>128,checksComplete:true};return error;
}
export const PROTOTYPE_EXPANSION_RULES=`Expansion recipes never grant source authority or edit geometry. Choose mode by the ACTUAL seed kind, not by the feature name. repeat: only shape/module/void/roomZone/stairs/pergola/balcony/planter/path; seed.repeat.count=1, count2..256, explicit nonzero step [dx,dy,dz]. storeys: only storeyRoom/storeyOpening/storeyFacade; seed.floors.count=1, count2..64, step EXACTLY [0,0,0]; consecutive source floors and their real ceiling heights determine placement. NEVER use a vertical metre stride for storeys. panelRows: only facade/panelFacade/edgeFacade; seed.count[1]=1, count2..64, step EXACTLY [0,positiveVerticalStride,0]; horizontal rhythm and exclusions remain unchanged. Already replicated components are NOT seeds. Nonrepeated finished features need no recipe. Mass/profileMass cannot use any recipe; their explicit floor schedules are structural source, not prototype repetitions. First/last AND exceptional instances must fit original scene bounds, package regions, host floors, ownership and clearances; nothing is clipped or normalized.`;

/** Explicit replication of ONE constructed seed. It cannot change palette,
 * module definitions, anchors, permissions, functions, bounds or source IDs.
 * This is a proposed new-building design branch, NEVER world-write authority. */
export function validatePrototypeExpansion(scene,program){
 validateScene(scene);
 if(Buffer.byteLength(JSON.stringify(program)??'')>65536)throw Error('Prototype expansion data quota exceeded');
 const check=schemaFeedback(program,prototypeExpansionSchema);
 if(!check.valid)throw prototypeDataError('Invalid prototype expansion contract',check.issues);
 if(program.seedSourceHash!==hash(scene))throw Error('Prototype expansion targets a different seed source');
 const seen=new Set(),issues=[];
 for(const [index,recipe] of program.recipes.entries()){
  const path='$.recipes['+index+']',issue=(code,message)=>issues.push({path,code,component:recipe.component,mode:recipe.mode,message});
  if(seen.has(recipe.component))issue('duplicate-expansion-target','Duplicate prototype expansion target');seen.add(recipe.component);
  const component=scene.components.find(c=>c.id===recipe.component);
  if(!component){issue('unknown-expansion-source','Unknown prototype seed component');continue;}
  if(recipe.mode==='repeat'){
   if(!repeatKinds.has(component.kind))issue('repeat-seed-kind','Repeat expansion requires a supported shape/module/void/roomZone/stairs/pergola/balcony/planter/path seed; actual kind='+component.kind);
   if(component.repeat?.count!==1)issue('repeat-seed-count','Repeat expansion requires one unexpanded seed; actual repeat.count='+component.repeat?.count);
   if(recipe.step.every(v=>v===0))issue('repeat-step','Prototype repetition needs an explicit nonzero step');
  }else if(recipe.mode==='storeys'){
   if(!floorKinds.has(component.kind))issue('storey-seed-kind','Storey expansion only supports storeyRoom/storeyOpening/storeyFacade; actual kind='+component.kind);
   if(component.floors?.count!==1)issue('storey-seed-count','Storey expansion requires one selected seed floor; actual floors.count='+component.floors?.count);
  }else{
   if(!panelKinds.has(component.kind))issue('panel-seed-kind','Panel expansion only supports facade/panelFacade/edgeFacade; actual kind='+component.kind);
   if(component.count?.[1]!==1)issue('panel-seed-count','Panel expansion requires one seed row; actual count[1]='+component.count?.[1]);
   if(recipe.step[0]!==0||recipe.step[2]!==0||recipe.step[1]<1)issue('panel-step','Panel expansion step must be [0,positiveVerticalStride,0]');
  }
 }
 if(issues.length)throw prototypeDataError('Invalid prototype expansion source',issues);
 return program;
}

export function applyPrototypeExpansion(scene,program){
 validatePrototypeExpansion(scene,program);const expanded=structuredClone(scene);
 for(const recipe of program.recipes){
  const component=expanded.components.find(c=>c.id===recipe.component);
  if(recipe.mode==='repeat')component.repeat={count:recipe.count,step:[...recipe.step]};
  else if(recipe.mode==='storeys')component.floors.count=recipe.count;
  else{component.count[1]=recipe.count;component.step[1]=recipe.step[1];}
 }
 validateScene(expanded);return expanded;
}
