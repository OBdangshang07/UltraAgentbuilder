import {lowerComponent} from '../generation/components.mjs';
import {isFloorComponent,expandFloorComponent} from './floor-components.mjs';

// Shared arithmetic for compilation and read-only construction feedback. These
// functions never infer a different coordinate frame, resize or mutate a source.
export const addVector=(a,b)=>a.map((v,i)=>v+b[i]);
export function numeric(value,parameters){
  const result=typeof value==='number'?value:parameters.get(value.parameter)?.value+value.offset;
  if(!Number.isSafeInteger(result)||Math.abs(result)>384)throw new Error('Invalid bounded integer parameter');return result;
}
export function moduleValues(template,values){
  const parameters=new Map();for(const p of template.parameters){if(parameters.has(p.name)||p.minimum>p.maximum)throw new Error('Invalid/duplicate module parameter');parameters.set(p.name,{...p,value:p.default});}
  const seen=new Set();for(const v of values){if(seen.has(v.name)||!parameters.has(v.name))throw new Error('Unknown/duplicate module parameter value');seen.add(v.name);parameters.get(v.name).value=v.value;}
  for(const p of parameters.values())if(p.type==='integer'?!Number.isSafeInteger(p.value)||p.value<p.minimum||p.value>p.maximum:typeof p.value!=='string')throw new Error('Module parameter type/range: '+p.name);
  return parameters;
}
export function resolveAnchor(at,resolved,bounds){
  const parent=at.relativeTo?resolved.get(at.relativeTo):{origin:[0,0,0],size:bounds};
  if(!parent)throw new Error('Unresolved component anchor: '+at.relativeTo);
  const delta=at.anchor==='top'?[0,parent.size[1],0]:at.anchor==='max'?parent.size:at.anchor==='center'?parent.size.map(v=>Math.floor(v/2)):[0,0,0];
  return {origin:addVector(addVector(parent.origin,delta),at.offset),frame:{relativeTo:at.relativeTo,anchor:at.anchor,parentOrigin:[...parent.origin],parentSize:[...parent.size],anchorDelta:[...delta],offset:[...at.offset]}};
}
export function resolvePlacement(c,modules,resolved,bounds,components){
  if(isFloorComponent(c)){
    const layout=expandFloorComponent(c,components.get(c.host),resolved.get(c.host),components.get(c.floors.source),resolved.get(c.floors.source),bounds);
    return {...layout.bands[0].resolved,floorLayout:layout};
  }
  let size=c.size,parameters;
  if(c.kind==='doorway')size=c.face==='north'||c.face==='south'?[c.width,2,1]:[1,2,c.width];
  if(c.kind==='module'){
    const m=modules.get(c.module);if(!m)throw new Error('Unknown module: '+c.module);
    parameters=moduleValues(m,c.values);size=m.size.map(v=>numeric(v,parameters));
    if(c.rotation%2)size=[size[2],size[1],size[0]];
  }
  if(c.at)return {...resolveAnchor(c.at,resolved,bounds),size,parameters};
  const host=resolved.get(c.host);if(!host)throw new Error('Unresolved component host: '+c.host);
  return {origin:[...host.origin],size:[...host.size],parameters};
}
export function lowerModuleNode(sourceNode,parameters){
  const material=sourceNode.material.startsWith('$')?parameters.get(sourceNode.material.slice(1))?.value:sourceNode.material;
  if(typeof material!=='string')throw new Error('Unknown material parameter');
  const n={...sourceNode,material,origin:sourceNode.origin.map(v=>numeric(v,parameters)),size:sourceNode.size.map(v=>numeric(v,parameters))};
  // Preserve the SceneSpec row material instead of legacy implicit floor/lamp roles.
  return ['windowRow','lampRow'].includes(n.op)?[{...n,op:'box'}]:lowerComponent(n);
}

export function boxViolations(origin,size,bounds){
  return ['x','y','z'].flatMap((axis,i)=>{
    const end=origin[i]+size[i],invalid=!Number.isSafeInteger(origin[i])||!Number.isSafeInteger(size[i])||size[i]<1;
    return invalid||origin[i]<0||end>bounds[i]?[{axis,origin:origin[i],size:size[i],endExclusive:end,bound:bounds[i],belowBy:Math.max(0,-origin[i]),aboveBy:Math.max(0,end-bounds[i]),invalidSize:invalid}]:[];
  });
}
