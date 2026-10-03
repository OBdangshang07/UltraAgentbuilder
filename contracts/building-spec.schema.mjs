import { MATERIALS } from '../src/generation/materials.mjs';
import {BUILDING_LIMITS as LIMITS} from './building-limits.mjs';
const vector = { type: 'array', items: { type: 'integer',minimum:0,maximum:LIMITS.height }, minItems: 3, maxItems: 3 };
const sizeVector = {...vector,items:{type:'integer',minimum:1,maximum:LIMITS.height}};
export const specSchema = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'id', 'seed', 'units', 'bounds', 'palette', 'nodes', 'constraints'],
  properties: {
    schemaVersion: { type: 'integer', enum: [1] }, id: { type: 'string',pattern:'^[a-z0-9][a-z0-9-]{0,63}$' }, seed: { type: 'integer',minimum:0,maximum:2147483647 }, units: { type: 'string', enum: ['block'] },
    bounds: { type: 'object', additionalProperties: false, required: ['width', 'height', 'length'], properties: { width: { type: 'integer',minimum:1,maximum:LIMITS.width }, height: { type: 'integer',minimum:1,maximum:LIMITS.height }, length: { type: 'integer',minimum:1,maximum:LIMITS.length } } },
    palette: { type: 'object', additionalProperties: false, required: ['wall', 'floor', 'roof', 'glass', 'lamp', 'beam'], properties: Object.fromEntries(['wall', 'floor', 'roof', 'glass', 'lamp', 'beam'].map(k => [k, { type: 'string', enum: Object.keys(MATERIALS) }])) },
    nodes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['nodeId', 'op', 'origin', 'size', 'material', 'thickness', 'axis', 'repeat', 'points'], properties: {
      nodeId: { type: 'string',pattern:'^[A-Za-z0-9_-]{1,48}$' }, op: { type: 'string', enum: ['box', 'shell', 'clear', 'keep', 'cylinder', 'stair', 'arch', 'polygonExtrude','room','gableRoof','windowRow','lampRow','staircase'] },
      origin: {...vector,description:'Local [X,Y,Z] block coordinate. A tread at Y has feet at Y+1. Later nodes overwrite earlier nodes.'}, size: {...sizeVector,description:'[width,height,depth]. Entire staircase: axis x requires width>=height; axis z requires depth>=height. Individual step/support columns use box, not staircase.'}, material: { type: 'string', enum: ['wall', 'floor', 'roof', 'glass', 'lamp', 'beam'] }, thickness: { type: 'integer',minimum:1,maximum:64 }, axis: { type: 'string', enum: ['x', 'z'],description:'stair/staircase ascends along POSITIVE axis only. Return flights use explicitly positioned box treads; reserve slab holes/headroom.' },
      repeat: { type: 'object', additionalProperties: false, required: ['count', 'step'], properties: { count: { type: 'integer',minimum:1,maximum:256 }, step: {...vector,items:{type:'integer',minimum:-LIMITS.height,maximum:LIMITS.height}} } },
      points: { type: 'array', items: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 } },
    } } },
    constraints: { type: 'object', additionalProperties: false, required: ['interior', 'walkable', 'passages'], properties: {
      interior: { type: 'boolean' }, walkable: { type: 'boolean' }, passages: { type: 'array', description:'Verified empty walking regions, not floors or whole furnished rooms. origin.y is feet height, one above a solid floor. Every cell must be explicitly cleared and connected to the first passage.', items: { type: 'object', additionalProperties: false, required: ['origin', 'size'], properties: { origin: {...vector,description:'Feet position [x,y,z], y >= 1. Floor is at y-1; never include the floor in the passage.'}, size: {...sizeVector,description:'[width, clearanceHeight, length]. clearanceHeight MUST be >= 2 (normally 2). Use narrow corridors avoiding furniture, walls and keep cells.'} } } },
    } },
  },
};
// v1 remains readable; generation v2 adds design intent, material roles and bounded modules.
export const legacySpecSchema=structuredClone(specSchema);
export const MATERIAL_ROLES=['wall','floor','roof','glass','lamp','beam','trim','accent','frame','foundation','paving','foliage','furniture','metal','door','trapdoor','stairs','slab','secondaryWall','secondaryRoof','secondaryGlass','detail'];
const stateSchema={type:['object','null'],additionalProperties:false,required:['facing','half','hinge','open','shape','axis','type'],properties:{
  facing:{type:['string','null'],enum:[null,'north','east','south','west']},half:{type:['string','null'],enum:[null,'top','bottom','lower','upper']},hinge:{type:['string','null'],enum:[null,'left','right']},open:{type:['boolean','null']},shape:{type:['string','null'],enum:[null,'straight','inner_left','inner_right','outer_left','outer_right']},axis:{type:['string','null'],enum:[null,'x','y','z']},type:{type:['string','null'],enum:[null,'top','bottom','double']}
}};
specSchema.properties.schemaVersion.enum=[2];
specSchema.properties.palette.required=MATERIAL_ROLES;
specSchema.properties.palette.properties=Object.fromEntries(MATERIAL_ROLES.map(k=>[k,{type:'string',enum:Object.keys(MATERIALS)}]));
const nodeSchema=specSchema.properties.nodes.items;
nodeSchema.properties.material.enum=[...new Set([...MATERIAL_ROLES,...Object.keys(MATERIALS)])];
nodeSchema.properties.op.enum.push('door','windowFrame','cornice');
nodeSchema.required.push('blockState');nodeSchema.properties.blockState=stateSchema;
specSchema.properties.design={type:'object',additionalProperties:false,required:['style','concept','silhouette','paletteIntent','features'],properties:{style:{type:'string'},concept:{type:'string'},silhouette:{type:'string'},paletteIntent:{type:'string'},features:{type:'array',items:{type:'string'}}}};
specSchema.properties.groups={type:'array',items:{type:'object',additionalProperties:false,required:['id','size','nodes'],properties:{id:{type:'string'},size:sizeVector,nodes:{type:'array',items:structuredClone(nodeSchema)}}}};
specSchema.properties.instances={type:'array',items:{type:'object',additionalProperties:false,required:['id','group','origin','rotation','mirror','repeat'],properties:{id:{type:'string'},group:{type:'string'},origin:vector,rotation:{type:'integer',enum:[0,1,2,3]},mirror:{type:'boolean'},repeat:structuredClone(nodeSchema.properties.repeat)}}};
specSchema.required.push('design','groups','instances');
// Share enum/node definitions: do not repeat the entire material catalog for 22 roles.
// This also keeps structured-output enum counts bounded as the catalog grows.
specSchema.$defs={material:{type:'string',enum:Object.keys(MATERIALS)},node:nodeSchema};
for(const role of MATERIAL_ROLES)specSchema.properties.palette.properties[role]={$ref:'#/$defs/material'};
specSchema.properties.nodes.items={$ref:'#/$defs/node'};
specSchema.properties.groups.items.properties.nodes.items={$ref:'#/$defs/node'};
