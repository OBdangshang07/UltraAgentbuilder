import {BUILDING_LIMITS as LIMITS} from '../../contracts/building-limits.mjs';
const vector=(v,positive=false)=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isSafeInteger(n)&&n>=(positive?1:0)&&n<=384);
function ids(nodes){const set=new Set();for(const n of nodes){if(!n||typeof n.nodeId!=='string'||!/^[\w-]{1,48}$/.test(n.nodeId)||set.has(n.nodeId)||Object.hasOwn(n,'_group')||Object.hasOwn(n,'_door'))throw new Error('Duplicate/invalid source nodeId');set.add(n.nodeId);}}
export function transformPoint([x,y,z],[w,,d],rotation,mirror){if(mirror)x=w-1-x;return rotation===1?[d-1-z,y,x]:rotation===2?[w-1-x,y,d-1-z]:rotation===3?[z,y,w-1-x]:[x,y,z];}
/** Nonrecursive modules. All expansion remains bounded data, never generated code. */
export function expandGroups(spec){
  if(spec.schemaVersion===1){for(const n of spec.nodes)if(Object.hasOwn(n,'_group')||Object.hasOwn(n,'_door'))throw new Error('Reserved node field');return spec.nodes;}
  const groups=spec.groups??[],instances=spec.instances??[];
  if(!Array.isArray(groups)||groups.length>64||!Array.isArray(instances)||instances.length>4096)throw new Error('Invalid group/instance count');
  ids(spec.nodes);const byId=new Map();
  for(const g of groups){
    if(!g||Object.keys(g).some(k=>!['id','size','nodes'].includes(k))||!/^[\w-]{1,32}$/.test(g.id)||byId.has(g.id)||!vector(g.size,true)||g.size[0]>256||g.size[2]>256||!Array.isArray(g.nodes)||!g.nodes.length||g.nodes.length>LIMITS.nodes)throw new Error('Invalid reusable group');
    ids(g.nodes);byId.set(g.id,g);
  }
  const result=[...spec.nodes],seen=new Set();let serial=0;
  for(const instance of instances){
    if(!instance||Object.keys(instance).some(k=>!['id','group','origin','rotation','mirror','repeat'].includes(k))||!/^[\w-]{1,48}$/.test(instance.id)||seen.has(instance.id)||!vector(instance.origin)||![0,1,2,3].includes(instance.rotation)||typeof instance.mirror!=='boolean')throw new Error('Invalid group instance');seen.add(instance.id);
    const g=byId.get(instance.group);if(!g)throw new Error('Unknown reusable group: '+instance.group);
    const repeat=instance.repeat??{count:1,step:[0,0,0]};if(Object.keys(repeat).some(k=>!['count','step'].includes(k))||!Number.isInteger(repeat.count)||repeat.count<1||repeat.count>256||!Array.isArray(repeat.step)||repeat.step.length!==3||!repeat.step.every(n=>Number.isInteger(n)&&Math.abs(n)<=384))throw new Error('Invalid instance repeat');
    for(let r=0;r<repeat.count;r++){
      const origin=instance.origin.map((v,i)=>v+r*repeat.step[i]),size=instance.rotation%2?[g.size[2],g.size[1],g.size[0]]:g.size;
      if(origin.some((v,i)=>v<0||v+size[i]>[spec.bounds.width,spec.bounds.height,spec.bounds.length][i]))throw new Error('Group instance outside bounds');
      if(result.length+g.nodes.length>LIMITS.nodes)throw new Error('Expanded group node quota exceeded');
      const prefix='g'+serial+++'-';for(const n of g.nodes)result.push({...n,nodeId:prefix+n.nodeId,_group:{origin,size:g.size,rotation:instance.rotation,mirror:instance.mirror}});
    }
  }
  return result;
}
