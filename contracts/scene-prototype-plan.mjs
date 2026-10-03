import {assemblyPlanSchema,assemblyPlanEditSchema,assemblyPlanRepairSchema} from './scene-assembly.schema.mjs';
import {prototypeExpansionSchema,validatePrototypeExpansion} from './scene-prototype-expansion.mjs';
import {hash} from '../src/generation/compiler.mjs';

const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const formats={ScenePrototypePlan:['plan',assemblyPlanSchema],ScenePrototypePlanEdit:['edit',assemblyPlanEditSchema],ScenePrototypePlanRepair:['repair',assemblyPlanRepairSchema]};
function wrap(format){
 const [key,base]=formats[format],nested=structuredClone(base);delete nested.$defs;
 const schema=object({format:{type:'string',enum:[format]},version:{type:'integer',enum:[1]},
  ...(format==='ScenePrototypePlan'?{}:{programHash:{type:'string',pattern:'^[a-f0-9]{64}$'}}),
  [key]:nested,recipes:structuredClone(prototypeExpansionSchema.properties.recipes)});
 schema.$defs=structuredClone(base.$defs);return schema;
}
export const prototypePlanSchema=wrap('ScenePrototypePlan');
export const prototypePlanEditSchema=wrap('ScenePrototypePlanEdit');
export const prototypePlanRepairSchema=wrap('ScenePrototypePlanRepair');
export const prototypePlanSchemas={SceneAssemblyPlan:prototypePlanSchema,SceneAssemblyPlanEdit:prototypePlanEditSchema,SceneAssemblyPlanRepair:prototypePlanRepairSchema};
export const prototypePlanKey=format=>formats[format]?.[0]??null;

// The provider cannot calculate the hash of its own new JSON. Bind its literal
// recipes to the preserved inner scene here, without altering either output.
export function bindPrototypeProgram(plan,recipes){
 const program={format:'ScenePrototypeExpansion',version:1,seedSourceHash:hash(plan.scene),recipes:structuredClone(recipes)};
 validatePrototypeExpansion(plan.scene,program);return program;
}
// Also identifies an UNAPPROVED invalid recipe for bounded correction. This
// does not validate it or grant any authority over the seed or world.
export const prototypeProgramHash=(plan,recipes)=>hash({format:'ScenePrototypeExpansion',version:1,seedSourceHash:plan?.scene?hash(plan.scene):null,recipes:recipes??null});

export const PROTOTYPE_PLAN_RULES=`VERIFIED PROTOTYPE WORKFLOW: the response root is the supplied ScenePrototypePlan/ScenePrototypePlanEdit/ScenePrototypePlanRepair wrapper. Instructions describing SceneAssemblyPlan/Edit/Repair apply to its plan/edit/repair field, NOT a different root response. recipes is the COMPLETE replacement list of explicit expansion rules, not a delta or executable program. Edit/repair programHash must exactly match input.prototypeProgramHash, including when correcting only recipes. Never calculate a new scene hash yourself; the program binds your saved seed scene to recipes.
Build an original FULL-HEIGHT structural skeleton with real core, floors, entrance and required interfaces, PLUS actual representative design geometry: a complete typical-floor spatial/furnishing study, a facade bay/row and corner treatment, entry/lobby, and the requested exceptional layer or crown. These are designed for this brief, not a stock template. Do not label a single desk as a complete typical floor or claim unfinished floors are furnished. Repeated detail seeds start at repeat.count=1, floors.count=1, or count[1]=1 as appropriate; other structural/floor/core elements may already repeat to preserve the full requested function and height.
Each recipe names a REAL component with surviving solid or explicit-clear geometry. mode=repeat uses an explicit nonzero [X,Y,Z] step and count=2..256 for shape/module/void/roomZone/stairs/pergola/balcony/planter/path. mode=storeys uses count=2..64 and step=[0,0,0] for storeyRoom/storeyOpening/storeyFacade, deriving actual heights from their floor schedules. mode=panelRows uses count=2..64 and step=[0,positiveY,0] for facade/panelFacade/edgeFacade. Recipes cannot alter materials, definitions, anchors, permissions, functions or bounds. ALL instances are compiled before seed visual review; errors in later floors/last rows must be corrected together, never clipped or hidden. Include intentional entrance/special-floor exclusions in the seed.
Seed visual acceptance authorizes only the explicit, prechecked design expansion as a NEW unplaced building baseline. It is not final visual approval or world permission. Packages still need meaningful detail work, complete authority regions for all expanded consumers and final whole-building review. Feedback.prototypeExpansion describes full-instance checks of an unapproved proposal, not images of the expanded building. All stages share the existing call budget; no extra model call is created by deterministic expansion.`;
