import {profileContainsInterior} from './profile.mjs';

/** Validate every repeated zone against the true host floor and interior. */
export function validateRoomZone(c,host,resolved,origin){
 if(!['mass','profileMass'].includes(host.kind)||host.repeat.count!==1)throw new Error(`${c.id}: roomZone host must be one mass/profileMass`);
 if(c.size[1]<3)throw new Error(`${c.id}: roomZone includes one floor plus at least two air cells`);
 if(c.use==='circulation'&&c.boundaries.length)throw new Error(`${c.id}: circulation zones have no partition walls; put room boundaries outside the declared route`);
 if(c.repeat.count>1&&!c.repeat.step.some((v,i)=>Math.abs(v)>=c.size[i]))throw new Error(`${c.id}: repeated room zones must not overlap`);
 const floors=[...new Set([0,...host.levels])].sort((a,b)=>a-b);
 for(let i=0;i<c.repeat.count;i++){
  const p=origin.map((v,a)=>v+c.repeat.step[a]*i-resolved.origin[a]),s=c.size;
  if(p[0]<host.thickness||p[2]<host.thickness||p[0]+s[0]>resolved.size[0]-host.thickness||p[2]+s[2]>resolved.size[2]-host.thickness||resolved.profile&&!profileContainsInterior(resolved.profile,p[0],p[2],s[0],s[2])){
   let firstInvalidCell=null;
   // Evidence from the same bounded raster used by the containment check, not
   // an alternative polygon rule, suggested repair or implicit crop.
   if(resolved.profile)outer:for(let z=p[2];z<p[2]+s[2];z++)for(let x=p[0];x<p[0]+s[0];x++){
    const inside=x>=0&&z>=0&&x<resolved.profile.width&&z<resolved.profile.length;
    const cell=inside?resolved.profile.mask[x+z*resolved.profile.width]:0;
    if(cell!==2){firstInvalidCell={local:[x,z],world:[x+resolved.origin[0],p[1]+resolved.origin[1],z+resolved.origin[2]],classification:cell===1?'host-wall':'outside-host',gridDepth:inside?resolved.profile.depth[x+z*resolved.profile.width]:0};break outer;}
   }
   throw Object.assign(new Error(`${c.id}: roomZone footprint is outside the actual host interior`),{roomZoneFeedback:{
    rule:'host-interior',component:c.id,host:c.host,instance:i,localOrigin:p,worldOrigin:p.map((v,a)=>v+resolved.origin[a]),size:[...s],
    hostOrigin:[...resolved.origin],hostSize:[...resolved.size],hostThickness:host.thickness,hostPoints:host.points?structuredClone(host.points):null,
    boundingInteriorXZ:{min:[host.thickness,host.thickness],endExclusive:[resolved.size[0]-host.thickness,resolved.size[2]-host.thickness]},firstInvalidCell,
    canAuthorizePlacement:false,geometryChanged:false,interpretation:'All room cells must lie in the actual host interior. Bounding limits alone do not describe a polygonal interior; use the supplied host-local polygon and grid wall thickness. No room is moved, cropped or authorized.'}});
  }
  if(!floors.includes(p[1]))throw new Error(`${c.id}: roomZone base must match a declared host floor, not an arbitrary height`);
  const ceiling=floors.find(y=>y>p[1])??resolved.size[1]-(host.roof?1:0);
  if(p[1]+s[1]>ceiling)throw new Error(`${c.id}: roomZone reaches through the next floor/roof; change its explicit height or repeated range`);
 }
 const faces=new Set();
 for(const wall of c.boundaries){
  if(faces.has(wall.face))throw new Error(`${c.id}: duplicate room boundary face`);faces.add(wall.face);
 }
 // emitRoomZone occupies exactly one cell on each DECLARED side. Omitted
 // sides emit no wall. Reserve at least one cell between those real planes;
 // an arbitrary 3x3 minimum wrongly rejects a one-sided/narrow service room.
 // Openings do not discount a wall: a doorway alone is not a room interior.
 const minimumFootprint=[1+Number(faces.has('west'))+Number(faces.has('east')),1+Number(faces.has('north'))+Number(faces.has('south'))];
 if(c.size[0]<minimumFootprint[0]||c.size[2]<minimumFootprint[1])throw Object.assign(new Error(`${c.id}: partitioned room needs interior width/depth`),{roomZoneFeedback:{
   rule:'partition-footprint',component:c.id,host:c.host,size:[...c.size],
   footprint:[c.size[0],c.size[2]],minimumFootprint,boundaryFaces:[...faces],
   interiorXZ:{min:[Number(faces.has('west')),Number(faces.has('north'))],endExclusive:[c.size[0]-Number(faces.has('east')),c.size[2]-Number(faces.has('south'))]},
   invalidAxes:[0,2].filter((a,i)=>c.size[a]<minimumFootprint[i]).map(a=>a===0?'X':'Z'),
   canAuthorizePlacement:false,geometryChanged:false,
   interpretation:'The one-cell declared wall planes must leave at least one room-interior cell on BOTH X and Z axes: width>=1+west+east, depth>=1+north+south. Openings do not discount walls. Omitted sides emit no wall. These validity bounds also apply to storeyRoom; they do not authorize resizing, deleting required partitions or changing host, workspace, floors or protections.'}});
 for(const wall of c.boundaries){
  const span=wall.face==='north'||wall.face==='south'?c.size[0]:c.size[2];
  const slots=new Set();
  for(const opening of wall.openings){
   if(opening.u<1||opening.u+opening.width>=span||opening.height<2||opening.height>=c.size[1])throw Object.assign(new Error(`${c.id}: room opening exceeds side/head margins`),{roomZoneFeedback:{
    rule:'boundary-opening-margins',component:c.id,host:c.host,size:[...c.size],face:wall.face,
    alongAxis:wall.face==='north'||wall.face==='south'?'X':'Z',span,opening:structuredClone(opening),
    minimumU:1,endExclusive:opening.u+opening.width,maximumEndExclusive:span-1,
    minimumHeight:2,maximumHeight:c.size[1]-1,canAuthorizePlacement:false,geometryChanged:false,
    interpretation:'Retain one side cell on each end: u>=1 and u+width<span. Opening height is >=2 and LESS than total room height (including its floor). Redesign the explicit opening or room within the original scope; nothing is clipped, widened or moved.'}});
   if(opening.door!==null&&(opening.width>2||opening.height!==2))throw new Error(`${c.id}: a room door is width 1/2, height 2; use a clear opening for a larger portal`);
   for(let u=opening.u;u<opening.u+opening.width;u++){if(slots.has(u))throw new Error(`${c.id}: overlapping room openings`);slots.add(u);}
  }
 }
}

/** One zone template, in local coordinates. Caller keeps repeat/provenance authoritative. */
export function emitRoomZone(c,{box,clear,door,floor}){
 const [w,h,d]=c.size;
 floor([0,0,0],[w,1,d],c.floorMaterial);clear([0,1,0],[w,h-1,d]);
 const point=(face,u,y)=>face==='north'?[u,y,0]:face==='south'?[u,y,d-1]:face==='west'?[0,y,u]:[w-1,y,u];
 const size=(face,width,height)=>face==='north'||face==='south'?[width,height,1]:[1,height,width];
 for(const wall of c.boundaries)box(point(wall.face,0,1),size(wall.face,wall.face==='north'||wall.face==='south'?w:d,h-1),wall.material);
 for(const wall of c.boundaries)for(const opening of wall.openings){
  clear(point(wall.face,opening.u,1),size(wall.face,opening.width,opening.height));
  if(opening.door!==null)for(let leaf=0;leaf<opening.width;leaf++)door(point(wall.face,opening.u+leaf,1),opening.door,{facing:wall.face,hinge:leaf===0?opening.hinge:opening.hinge==='left'?'right':'left',open:opening.open});
 }
}
