import {NavigationQualityError} from './quality.mjs';
import {walkingGrid} from './walking-grid.mjs';
/** Full-block support and centred walking, plus native-verified static open
 * door edge collisions. Kept terrain and unsupported partial states stay unknown. */
export function inspectNavigation({cells,palette,width:w,height:h,length:d,passages,floorCells,requireConnected=false,includeReachability=false}){
  const plane=w*d,{index,floor,stand,trace,staticOpenDoorCells}=walkingGrid({cells,palette,width:w,height:h,length:d,staticOpenDoors:true});
  if(!passages.length)return {mode:'not-requested',reachable:0,walkable:0,unreachable:0,warnings:[]};
  const [sx,sy,sz]=passages[0].origin;if(!stand(sx,sy,sz))throw new NavigationQualityError('Navigation entry has no verified full-block floor/headroom');
  const {seen,queue,reachable:write}=trace([sx,sy,sz]);
  for(const [p,passage] of passages.entries()){
    const [x,y,z]=passage.origin,[pw,,pd]=passage.size;
    for(let dz=0;dz<pd;dz++)for(let dx=0;dx<pw;dx++)if(!seen[index(x+dx,y,z+dz)])throw new NavigationQualityError(`Passages are disconnected from the entry: passage[${p}] at [${x+dx},${y},${z+dz}]; add a door or traversable stairs`);
  }
  let walkable=0,unreachable=0,unclaimedSurfaces=0;
  const required=new Uint8Array(cells.length),reachableFloorByLevel=new Uint32Array(h),blocked=[];
  for(let y=1;y<h-1;y++)for(let z=0;z<d;z++)for(let x=0;x<w;x++)if(stand(x,y,z)){
    walkable++;const i=index(x,y,z),isFloor=!floorCells||floorCells[i-plane]===1;
    if(isFloor){required[i]=1;if(seen[i])reachableFloorByLevel[y]++;else blocked.push(i);}
    if(!seen[i]){unreachable++;if(!isFloor)unclaimedSurfaces++;}
  }
  const at=i=>[i%w,Math.floor(i/plane),Math.floor(i/w)%d];
  // Reuse the queue to trace the solid, declared support plane underneath furniture.
  // A remote one-cell platform at the same Y must not be mistaken for a room recess.
  if(floorCells){let head=0,tail=0;
    for(let i=0;i<required.length;i++)if(required[i]&&seen[i]){required[i]|=2;queue[tail++]=i;}
    while(head<tail){const i=queue[head++],[x,y,z]=at(i);
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,nz=z+dz;if(nx<0||nx>=w||nz<0||nz>=d)continue;const n=index(nx,y,nz);
        if(!(required[n]&2)&&floorCells[n-plane]&&floor(cells[n-plane])){required[n]|=2;queue[tail++]=n;}
      }
    }
  }
  // An unclaimed, one-cell recess on an otherwise accessible floor is not a room.
  // Never waive passage checkpoints, a separate floor level, or a multi-cell room.
  const pockets=[],disconnected=[];
  for(const i of blocked){const [x,y,z]=at(i);const singleton=floorCells&&(required[i]&2)&&reachableFloorByLevel[y]>=8&&[[1,0],[-1,0],[0,1],[0,-1]].every(([dx,dz])=>{
    const nx=x+dx,nz=z+dz;return nx<0||nx>=w||nz<0||nz>=d||!(required[index(nx,y,nz)]&1);
  });(singleton?pockets:disconnected).push(i);}
  if(pockets.length>4)disconnected.push(...pockets.splice(0));
  if(requireConnected&&disconnected.length)throw new NavigationQualityError(`Interior has ${disconnected.length} disconnected floor cells; local feet coordinates ${JSON.stringify(disconnected.slice(0,8).map(at))}; connect rooms/floors with doors and stairs`);
  const warnings=[];
  if(unclaimedSurfaces)warnings.push(`有 ${unclaimedSurfaces} 个未声明为地板/通道的高处表面未连通（可能为家具、柜顶或灯具）。不要求爬上这些表面；请在预览中核对，不代表完整可达性认证。`);
  if(pockets.length)warnings.push(`有 ${pockets.length} 个未声明通道的单格死角，局部脚部坐标 ${JSON.stringify(pockets.map(at))}。已保留为预览警告，没有拆家具、填洞或修改任何方块。`);
  const limitations=staticOpenDoorCells?'Floor targets are shell/room floors, floor-role geometry and explicit passages. Other surfaces are reviewed as warnings. Paired supported open doors use native-verified static edge collisions; no door actuation, swimming, parkour or other partial-block collision simulation. Keep cells remain unknown; this is not full player-motion certification.':'Floor targets are shell/room floors, floor-role geometry and explicit passages. Other surfaces are reviewed as warnings. No dynamic doors, swimming, parkour or partial-stair collision simulation; keep cells remain unknown';
  return {mode:'declared-floors-and-passages',reachable:write,walkable,unreachable,unclaimedSurfaces,isolatedPockets:pockets.map(at),disconnectedFloorCells:disconnected.length,warnings,...(staticOpenDoorCells?{staticOpenDoorCells,doorTraversal:'paired-supported-open-state-centred-level-sweeps'}:{}),...(includeReachability?{reachableCells:seen}:{}),limitations};
}
