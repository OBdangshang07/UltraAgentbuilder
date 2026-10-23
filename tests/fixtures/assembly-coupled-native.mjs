import {hash} from '../../src/generation/compiler.mjs';
import {createContextSnapshot} from '../../src/world/context-snapshot.mjs';
import {selectionChunks,regionCells} from '../../contracts/world-selection.mjs';
import {resolveState} from '../../src/generation/block-states.mjs';

// Pure synthetic mask data, not a generated SceneSpec or certified bundle.
export const coupledDoor=(half='lower',extra={})=>resolveState('dark_oak_door',{half,...extra});
export const coupledDoorEntries=()=>[[[1,0,1],'minecraft:stone'],[[1,1,1],coupledDoor()],[[1,2,1],coupledDoor('upper')]];
export function coupledNative(entries=coupledDoorEntries(),dimensions={width:3,height:4,length:3}){
  const {width:w,height:h,length:d}=dimensions,palette=['@keep','minecraft:air'],binary=Buffer.alloc(w*h*d*2);
  for(const [p,state]of entries){if(!palette.includes(state))palette.push(state);binary.writeUInt16LE(palette.indexOf(state),(p[0]+p[2]*w+p[1]*w*d)*2);}
  let setCount=0,clearCount=0;for(let i=0;i<binary.length;i+=2){const n=binary.readUInt16LE(i);if(n>=2)setCount++;else if(n===1)clearCount++;}
  const metadata={dimensions,palette,setCount,clearCount,cellsHash:hash(binary)};
  return {manifest:{...metadata,assetHash:hash(metadata)},binary};
}
export function coupledSnapshot({dimensions={width:3,height:4,length:3},origin=[0,0,0],changes=[],unknown=[],protect=[],tight=false}={}){
  const lengths=[dimensions.width,dimensions.height,dimensions.length],selection={format:'WorldSelection',version:1,
    world:{worldId:'coupled_plan_fixture',dimension:'minecraft:overworld',minY:-64,maxY:320},revision:3,
    context:{min:origin.map(n=>n-1),max:origin.map((n,i)=>n+lengths[i]+1)},edit:{min:[...origin],max:origin.map((n,i)=>n+lengths[i])},protected:protect};
  if(tight)selection.context=structuredClone(selection.edit);
  const facts=new Map(changes.map(([p,state,blockEntity=false])=>[p.join(','),{state,blockEntity}]));
  const capture={fence:{start:5,end:5},chunks:selectionChunks(selection).map(c=>{
    if(unknown.some(p=>p[0]===c.x&&p[1]===c.z))return {x:c.x,z:c.z,coverage:'unknown',palette:[],runs:[]};
    const palette=[],runs=[],lookup=new Map(),{min,max}=c.region;
    for(let y=min[1];y<max[1];y++)for(let z=min[2];z<max[2];z++)for(let x=min[0];x<max[0];x++){
      const fact=facts.get([x,y,z].join(','))??{state:'minecraft:air',blockEntity:false},key=JSON.stringify(fact);
      if(!lookup.has(key)){lookup.set(key,palette.length);palette.push(fact);}const n=lookup.get(key);
      if(runs.at(-1)?.[0]===n)runs.at(-1)[1]++;else runs.push([n,1]);
    }
    if(runs.reduce((n,r)=>n+r[1],0)!==regionCells(c.region))throw Error('Synthetic fixture omitted cells');
    return {x:c.x,z:c.z,coverage:'known',palette,runs};
  })};
  return {snapshot:createContextSnapshot(selection,capture),selection,capture};
}
export function coupledBoundaryEntries(){
  const dimensions={width:64,height:3,length:64},entries=[];
  for(let y=0;y<2;y++)for(let z=0;z<64;z++)for(let x=0;x<64;x++)entries.push([[x,y,z],x===63&&z===63&&y===1?coupledDoor():'minecraft:stone']);
  entries.push([[63,2,63],coupledDoor('upper')]);return {entries,dimensions};
}
