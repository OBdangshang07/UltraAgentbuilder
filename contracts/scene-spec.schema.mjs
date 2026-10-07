import {MATERIALS} from '../src/generation/materials.mjs';
import {specSchema} from './building-spec.schema.mjs';
import {BUILDING_LIMITS as L} from './building-limits.mjs';
import {SCENE_COLLECTION_LIMITS as C} from './scene-limits.mjs';
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const integer=(minimum,maximum)=>({type:'integer',minimum,maximum});
const array=(items,maxItems=256,minItems=0)=>({type:'array',items,minItems,maxItems});
const vector=(min=0,max=384)=>array(integer(min,max),3,3);
const id={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,31}$'};
const text={type:'string',maxLength:1200};
const ref=name=>({$ref:'#/$defs/'+name});
const choice=(...values)=>({type:'string',enum:values});
const material={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,63}$'};
const at=object({relativeTo:{type:['string','null']},anchor:choice('min','top','center','max'),offset:vector(-384)});
const common={id,at:ref('at'),repeat:ref('repeat'),allowOverwrite:array(id,256)};
// Structured decoders follow schema key order. Select the union branch BEFORE
// emitting coordinates/host fields; an id/host prefix must not accidentally
// commit a planned mass or stair to a hosted facade branch. Semantic fields and
// validators are unchanged; existing SceneSpec object key order remains valid.
const absolute=(kind,props)=>object({kind:choice(kind),...common,...props});
const hosted=(kind,props)=>object({kind:choice(kind),id,host:id,allowOverwrite:array(id,256),...props});
const floorSelection=object({source:id,first:integer(0,128),count:integer(1,64)});
const roomBoundaries={...array(object({face:ref('face'),material,openings:array(object({u:integer(0,383),width:integer(1,32),height:integer(2,32),door:{type:['string','null']},hinge:choice('left','right'),open:{type:'boolean'}}),16)}),4),
  description:'Any nonempty boundaries list requires BOTH room X width and Z depth >=3, including walls, even with only one wall. For each opening retain side/head margins: u>=1, u+width<span (X for north/south, Z for east/west), and 2<=height<total room height INCLUDING its floor. A real door requires width1/2,height2; use=circulation requires boundaries=[]. No implicit clipping or resizing.'};
const scalar={anyOf:[integer(-384,384),object({parameter:id,offset:integer(-384,384)})]};
const moduleNode=structuredClone(specSchema.$defs.node);
moduleNode.properties.op.enum=moduleNode.properties.op.enum.filter(op=>!['stair','staircase','polygonExtrude'].includes(op));
moduleNode.properties.origin=array(ref('scalar'),3,3);
moduleNode.properties.size=array(ref('scalar'),3,3);
moduleNode.properties.material={type:'string',pattern:'^\\$?[A-Za-z][A-Za-z0-9_-]{0,63}$'};
moduleNode.properties.repeat=ref('repeat');
moduleNode.properties.size.description='Local [width,height,depth], including parameter offsets. A door is EXACTLY [1,2,1]; double doors use two adjacent nodes with opposite hinges, not a width-2 door node.';
moduleNode.properties.material.description='An approved material literal, an existing scene.palette role, or a declared $materialParameter. No implicit custom roles; door operations require a *_door material.';
moduleNode.properties.blockState.description='Only properties supported by the resolved material may be non-null. Door: facing/hinge/open, half null or lower; type MUST be null. type=double is a slab state, never a double door.';
const component={anyOf:[
  absolute('mass',{size:vector(1),material,floorMaterial:material,roofMaterial:material,thickness:integer(1,4),levels:array(integer(0,383),128),roof:{type:'boolean'}}),
  absolute('profileMass',{size:vector(1),points:array(array(integer(0,384),2,2),64,3),material,floorMaterial:material,roofMaterial:material,thickness:integer(1,4),levels:array(integer(0,383),128),roof:{type:'boolean'}}),
  absolute('shape',{size:vector(1),material,op:choice('box','cylinder','arch','gableRoof','polygonExtrude'),axis:choice('x','z'),thickness:integer(1,64),points:array(array(integer(0,384),2,2),64),blockState:structuredClone(specSchema.$defs.node.properties.blockState),stage:choice('structure','detail')}),
  absolute('void',{size:vector(1)}),
  absolute('doorway',{host:id,face:ref('face'),width:integer(1,2),door:material,hinge:choice('left','right'),open:{type:'boolean'}}),
  absolute('roomZone',{host:id,size:{...vector(1),description:'[X width,total height INCLUDING its floor,Z depth]. Height>=3. When boundaries is nonempty, BOTH width and depth must be >=3, including wall cells. Only an unpartitioned zone with boundaries=[] may have width/depth1/2. Every instance must fit the actual host interior and floor/ceiling; no implicit resizing.'},use:choice('room','circulation'),purpose:text,floorMaterial:material,boundaries:roomBoundaries}),
  hosted('storeyRoom',{floors:floorSelection,offset:{...array(integer(0,383),2,2),description:'HOST-LOCAL [X,Z] horizontal offset, NEVER [X,Y] and not world coordinates. Y is derived only from floors. World origin is [hostX+offset[0],selectedFloorY,hostZ+offset[1]].'},footprint:{...array(integer(1,256),2,2),description:'[X width,Z depth], INCLUDING wall cells. If boundaries is nonempty, BOTH values must be >=3, even for a single wall. Only boundaries=[] permits width/depth1/2. The entire room must fit inside the HOST interior, not merely scene bounds: offset+footprint <= host size-thickness. A profileMass additionally requires every room cell inside its actual polygon interior.'},ceilingInset:{...integer(0,64),description:'Total room height INCLUDING its floor is nextCeiling-selectedFloor-ceilingInset and must be >=3 on EVERY selected floor. A boundary opening height must be LESS than this total height.'},use:choice('room','circulation'),purpose:text,floorMaterial:material,boundaries:roomBoundaries}),
  hosted('storeyOpening',{floors:floorSelection,face:ref('face'),u:integer(0,383),width:integer(1,32),height:integer(2,32),door:{type:['string','null']},hinge:choice('left','right'),open:{type:'boolean'}}),
  hosted('facade',{face:ref('face'),margin:integer(0,32),start:array(integer(0,383),2,2),count:array(integer(1,64),2,2),step:array(integer(0,384),2,2),size:array(integer(3,64),2,2),frame:material,glazing:{type:['string','null']},lattice:{type:'boolean'},projection:integer(0,3),sill:integer(0,3),shade:integer(0,5),exclude:array(array(integer(0,63),2,2),256)}),
  hosted('panelFacade',{face:ref('face'),margin:integer(0,32),start:array(integer(0,383),2,2),count:array(integer(1,64),2,2),step:array(integer(0,384),2,2),size:array(integer(1,64),2,2),borders:array(integer(0,4),4,4),recess:integer(0,3),frame:material,glazing:{type:['string','null']},lattice:{type:'boolean'},projection:integer(0,3),sill:integer(0,3),shade:integer(0,5),exclude:array(array(integer(0,63),2,2),256)}),
  hosted('storeyFacade',{face:ref('face'),margin:integer(0,32),columns:object({width:integer(1,64),gap:integer(0,64),count:{anyOf:[integer(1,64),choice('fit')]},align:choice('start','center','end')}),floors:object({first:integer(0,128),count:integer(1,64)}),insets:array(integer(0,64),2,2),borders:array(integer(0,4),4,4),recess:integer(0,3),frame:material,glazing:{type:['string','null']},lattice:{type:'boolean'},projection:integer(0,3),sill:integer(0,3),shade:integer(0,5),exclude:array(array(integer(0,63),2,2),256)}),
  hosted('edgeFacade',{edge:integer(0,63),margin:integer(0,32),start:array(integer(0,383),2,2),count:array(integer(1,64),2,2),step:array(integer(0,384),2,2),size:array(integer(1,64),2,2),borders:array(integer(0,4),4,4),recess:integer(0,3),frame:material,glazing:{type:['string','null']},lattice:{type:'boolean'},exclude:array(array(integer(0,63),2,2),256)}),
  hosted('entry',{face:ref('face'),u:integer(0,383),feet:integer(1,383),width:integer(1,2),door:material,frame:material,threshold:{type:'boolean'},thresholdMaterial:material,canopy:integer(0,5),open:{type:'boolean'}}),
  absolute('stairs',{size:{...vector(1),description:'WORLD-axis [X width,Y height,Z depth] of the permitted core box; NOT a module-local size. Rotation 1/3 uses size[2] as local run and size[0] as breadth; it does not rotate this bounding box. Every repeated box must remain inside its host walls, including upper headroom.'},host:id,style:choice('straight','switchback'),rotation:integer(0,3),width:integer(1,8),rise:integer(1,32),material}),
  absolute('pergola',{size:vector(1),material,postMaterial:material,spacing:integer(2,16),axis:choice('x','z')}),
  absolute('balcony',{size:vector(1),material,railMaterial:material,openFace:ref('face')}),
  absolute('planter',{size:vector(1),material,foliage:material}),
  absolute('path',{size:vector(1),material,clearance:integer(2,6)}),
  absolute('module',{module:id,values:array(object({name:id,value:{anyOf:[integer(1,384),material]}}),16),rotation:integer(0,3),mirror:{type:'boolean'}})
]};
export const sceneSchema=object({
  format:choice('SceneSpec'),version:integer(1,1),id:structuredClone(specSchema.properties.id),seed:integer(0,2147483647),
  bounds:object({width:integer(1,L.width),height:integer(1,L.height),length:integer(1,L.length)}),
  design:structuredClone(specSchema.properties.design),
  palette:array(object({role:id,material:ref('material')}),64,1),
  modules:array(object({id,parameters:array(object({name:id,type:choice('integer','material'),minimum:integer(1,384),maximum:integer(1,384),default:{anyOf:[integer(1,384),material]}}),16),size:array(ref('scalar'),3,3),nodes:array(ref('moduleNode'),128,1)}),C.modules),
  components:array(ref('component'),256,1),
  reservations:array(object({id,at:ref('at'),size:vector(1),allowedComponents:array(id,256)}),128),
  featureBindings:array(object({feature:{type:'string',maxLength:300},components:array(id,64,1)}),16),
  constraints:structuredClone(specSchema.properties.constraints)
});
sceneSchema.$defs={material:{type:'string',enum:Object.keys(MATERIALS)},at,repeat:object({count:integer(1,256),step:vector(-384)}),face:choice('north','east','south','west'),scalar,moduleNode,component};

/** A small strict validator for this checked-in schema, not arbitrary remote schemas. */
export function validateScene(scene){
  if(Buffer.byteLength(JSON.stringify(scene))>L.bytes)throw new Error('SceneSpec byte quota exceeded');
  function check(value,schema,label){
    if(schema.$ref)return check(value,sceneSchema.$defs[schema.$ref.split('/').at(-1)],label);
    if(schema.anyOf){const discriminator=schema.anyOf.find(o=>o.properties?.kind?.enum?.includes(value?.kind));if(discriminator)return check(value,discriminator,label);const errors=[];for(const option of schema.anyOf){try{check(value,option,label);return;}catch(e){errors.push(e.message);}}throw new Error(errors[0]);}
    const types=Array.isArray(schema.type)?schema.type:[schema.type];
    const type=value===null?'null':Array.isArray(value)?'array':typeof value;
    if(!types.includes(type)&&!(type==='number'&&types.includes('integer')&&Number.isSafeInteger(value)))throw new Error(`${label}: expected ${types.join('/')}`);
    if(type==='number'&&(!Number.isFinite(value)||value<schema.minimum||value>schema.maximum))throw new Error(`${label}: out of range ${schema.minimum}..${schema.maximum}`);
    if(schema.enum&&!schema.enum.includes(value))throw new Error(`${label}: invalid choice ${String(value)}`);
    if(type==='string'&&(value.length>(schema.maxLength??4096)||schema.pattern&&!new RegExp(schema.pattern).test(value)))throw new Error(`${label}: invalid string`);
    if(type==='array'){if(value.length<(schema.minItems??0)||value.length>(schema.maxItems??256))throw new Error(`${label}: invalid array length`);value.forEach((v,i)=>check(v,schema.items,`${label}[${i}]`));}
    if(type==='object'){for(const k of Object.keys(value))if(!Object.hasOwn(schema.properties,k))throw new Error(`${label}: unknown field ${k}`);for(const k of schema.required??[])if(!Object.hasOwn(value,k))throw new Error(`${label}: missing ${k}`);for(const [k,v] of Object.entries(value))check(v,schema.properties[k],`${label}.${k}`);}
  }
  check(scene,sceneSchema,'scene');
  return scene;
}
