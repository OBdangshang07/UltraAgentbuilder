import {NavigationQualityError} from './quality.mjs';
/** Components lower to the same bounded primitives. Stable child IDs enable localized revision. */
export const COMPONENT_OPS=['room','gableRoof','windowRow','lampRow','staircase','door','windowFrame','cornice'];
export function lowerComponent(n,{review=false,onIssue=()=>{},onCompatibility=()=>{}}={}){
  if(!COMPONENT_OPS.includes(n.op))return [n];
  if(!Array.isArray(n.origin)||!Array.isArray(n.size)||n.origin.length!==3||n.size.length!==3||![...n.origin,...n.size].every(Number.isSafeInteger)||n.size.some((v,i)=>v<1||v>[256,384,256][i])||n.origin.some((v,i)=>v<0||v>[256,384,256][i]))throw new Error('Component requires bounded integer origin/size');
  if(typeof n.nodeId!=='string'||n.nodeId.length>(n._group?58:48))throw new Error('Component nodeId must be <=48 characters');
  const [w,h,d]=n.size;const node=(suffix,op,origin,size,material=n.material)=>({...n,nodeId:n.nodeId+'-'+suffix,op,origin,size,material});
  if(n.op==='door'){
    if(w!==1||h!==2||d!==1||n.blockState?.half&&n.blockState.half!=='lower')throw new Error('door component size must be [1,2,1], origin is lower half');
    return ['lower','upper'].map((half,i)=>({...node(half,'box',[n.origin[0],n.origin[1]+i,n.origin[2]],[1,1,1]),blockState:{...n.blockState,half},_door:true}));
  }
  if(n.op==='cornice')return [node('ledge','box',n.origin,n.size)];
  if(n.op==='windowFrame'){
    const along=n.axis==='z'?2:0,span=n.size[along],depth=n.axis==='z'?w:d;
    if(span<3||h<3||depth!==1)throw new Error('windowFrame requires span>=3, height>=3 and depth=1');
    const parts=[];for(const [suffix,u,y,sw,sh,material] of [['glass',1,1,span-2,h-2,'glass'],['sill',0,0,span,1,n.material],['lintel',0,h-1,span,1,n.material],['left',0,1,1,h-2,n.material],['right',span-1,1,1,h-2,n.material]]){
      const origin=[...n.origin],size=[1,sh,1];origin[along]+=u;origin[1]+=y;size[along]=sw;parts.push(node(suffix,'box',origin,size,material));
    }return parts;
  }
  if(n.op==='room'){
    if(w<3||d<3||h<4)throw new Error('Room needs at least 3x4x3');
    return [node('shell','shell',n.origin,n.size),node('floor','box',[n.origin[0]+1,n.origin[1],n.origin[2]+1],[w-2,1,d-2],'floor')];
  }
  if(n.op==='gableRoof'){
    const span=n.axis==='z'?d:w;if(h>Math.ceil(span/2))throw new Error('Gable roof height exceeds its half-span');
    return Array.from({length:h},(_,i)=>node('tier-'+i,'box',[n.origin[0]+(n.axis==='z'?0:i),n.origin[1]+i,n.origin[2]+(n.axis==='z'?i:0)],[w-(n.axis==='z'?0:2*i),1,d-(n.axis==='z'?2*i:0)]));
  }
  if(n.op==='staircase'){
    const run=n.axis==='z'?d:w;
    if(run===1&&h>1){onCompatibility(`楼梯节点 ${n.nodeId} 使用单列台阶柱写法；按等价实体柱解释，未改动方块，最终通行另行检查。`);return [node('steps','box',n.origin,n.size)];}
    if(run<h){const e=new NavigationQualityError(`楼梯 ${n.nodeId}：沿 ${n.axis??'x'} 水平 ${run} 格、高 ${h} 格。整段楼梯应满足水平长度 ≥ 高度；单个台阶柱请用 box。`,'stair-too-steep');if(!review)throw e;onIssue(e);}
    return [node('steps','stair',n.origin,n.size)];
  }
  return [node(n.op==='windowRow'?'windows':'lamps','box',n.origin,n.size,n.op==='windowRow'?'glass':'lamp')];
}
