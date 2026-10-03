import {walkingGrid} from '../generation/walking-grid.mjs';
import {transformPoint} from '../generation/groups.mjs';

/** Inspect final cells at semantic common landings, without carving or certifying global routes. */
export function inspectStairAccess(scene,compiled,componentBounds){
 // Reuse native-verified paired open-door edge sweeps. Doors are not air:
 // support, both halves, opening state and actual crossing direction matter.
 const grid=walkingGrid({cells:compiled.cells,palette:compiled.manifest.palette,...compiled.manifest.dimensions,staticOpenDoors:true});
 const access=[];
 for(const c of scene.components.filter(c=>c.kind==='stairs'&&c.style==='switchback')){
  const local=c.rotation%2?[c.size[2],c.size[1],c.size[0]]:c.size;
  const direction=[[-1,0,0],[0,0,-1],[1,0,0],[0,0,1]][c.rotation];
  for(const [instance,box] of componentBounds[c.id].entries())for(const y of [0,c.rise]){
   let connections=0;const candidates=[];
   for(let z=0;z<2*c.width+1;z++){
    const landing=transformPoint([0,y+1,z],local,c.rotation,false).map((v,i)=>v+box.origin[i]);
    const outside=landing.map((v,i)=>v+direction[i]);
    if(grid.step(...landing,...outside)&&grid.step(...outside,...landing))connections++;
    candidates.push({landing,outside});
   }
   access.push({component:c.id,instance,floor:box.origin[1]+y,face:['west','north','east','south'][c.rotation],connections,status:connections?'local-opening-found':'unverified',candidates});
  }
 }
 return access;
}
