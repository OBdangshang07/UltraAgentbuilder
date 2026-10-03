import {fullSupport} from './block-states.mjs';
import {staticOpenDoorCells} from './static-open-doors.mjs';

/** Shared conservative rules. KEEP is unknown; partial blocks never become
 * full support. Explicit staticOpenDoors adds paired leaf-edge sweeps only,
 * without changing air(), simulating actuation or treating doors as empty. */
export function walkingGrid({cells,palette,width:w,height:h,length:d,staticOpenDoors=false}){
  const plane=w*d,index=(x,y,z)=>x+z*w+y*plane;
  const air=id=>id===1||id>=2&&palette[id].startsWith('minecraft:light[');
  const support=palette.map((s,i)=>i>=2&&fullSupport(s)),floor=id=>support[id]===true;
  const inside=(x,y,z)=>x>=0&&x<w&&y>=0&&y<h&&z>=0&&z<d;
  const doors=staticOpenDoors?staticOpenDoorCells(cells,palette,w,h,d):null;
  const clear=i=>air(cells[i])||!!doors?.faces[i];
  const stand=(x,y,z)=>x>=0&&x<w&&z>=0&&z<d&&y>=1&&y+1<h&&floor(cells[index(x,y-1,z)])&&clear(index(x,y,z))&&clear(index(x,y+1,z));
  const step=(x,y,z,nx,ny,nz)=>{
    const dy=ny-y,dx=nx-x,dz=nz-z;
    if(Math.abs(dx)+Math.abs(dz)!==1||Math.abs(dy)>1||!stand(x,y,z)||!stand(nx,ny,nz)||dy===1&&!air(cells[index(x,y+2,z)]))return false;
    if(doors){
      // No stepping up/down through a door; only level centred movement has
      // the native edge-slab swept-collision proof below.
      if(dy){for(let sy=Math.min(y,ny);sy<=Math.max(y,ny)+1;sy++)if(doors.faces[index(x,sy,z)]||doors.faces[index(nx,sy,nz)])return false;}
      else{
        const outgoing=dx===1?2:dx===-1?8:dz===1?4:1,incoming=dx===1?8:dx===-1?2:dz===1?1:4;
        for(const sy of [y,y+1])if((doors.faces[index(x,sy,z)]&outgoing)||(doors.faces[index(nx,sy,nz)]&incoming))return false;
      }
    }
    return true;
  };
  function trace(origin,{region={origin:[0,0,0],size:[w,h,d]},maxVisits=cells.length}={}){
    if(!Number.isSafeInteger(maxVisits)||maxVisits<1||maxVisits>cells.length)throw new Error('Invalid walking trace budget');
    const o=region.origin,s=region.size;
    if(!Array.isArray(o)||!Array.isArray(s)||o.length!==3||s.length!==3||o.some((v,i)=>!Number.isSafeInteger(v)||v<0||!Number.isSafeInteger(s[i])||s[i]<1||v+s[i]>[w,h,d][i]))throw new Error('Invalid walking trace region');
    const localPlane=s[0]*s[2],seen=new Uint8Array(s[0]*s[1]*s[2]),queue=new Uint32Array(seen.length);
    const inRegion=(x,y,z)=>x>=o[0]&&x<o[0]+s[0]&&y>=o[1]&&y<o[1]+s[1]&&z>=o[2]&&z<o[2]+s[2];
    const localIndex=(x,y,z)=>x-o[0]+(z-o[2])*s[0]+(y-o[1])*localPlane;
    const point=i=>[i%s[0]+o[0],Math.floor(i/localPlane)+o[1],Math.floor(i/s[0])%s[2]+o[2]];
    let read=0,write=0;const startValid=inRegion(...origin)&&stand(...origin);
    if(startValid){const first=localIndex(...origin);seen[first]=1;queue[write++]=first;}
    while(read<write&&read<maxVisits){const [x,y,z]=point(queue[read++]);
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]])for(const dy of [0,1,-1]){
        const nx=x+dx,ny=y+dy,nz=z+dz;
        if(!inRegion(nx,ny,nz)||!step(x,y,z,nx,ny,nz))continue;
        const next=localIndex(nx,ny,nz);if(!seen[next]){seen[next]=1;queue[write++]=next;}
      }
    }
    return {startValid,complete:read===write,visits:read,reachable:write,seen,queue,has:p=>inRegion(...p)&&seen[localIndex(...p)]===1};
  }
  return {index,air,floor,inside,stand,step,trace,staticOpenDoorCells:doors?.pairedCells??0};
}
