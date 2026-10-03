import {profileRectangles} from './profile.mjs';

// Distance to a segment from a cell centre in doubled integer coordinates.
// Compare rational squared distances: there is no float angle/rounding heuristic.
function distance(edge,x,z){
 const qx=2*x+1-2*edge.a[0],qz=2*z+1-2*edge.a[1],dot=qx*edge.dx+qz*edge.dz;
 if(dot<=0)return {n:qx*qx+qz*qz,d:1};
 if(dot>=2*edge.norm){const bx=qx-2*edge.dx,bz=qz-2*edge.dz;return {n:bx*bx+bz*bz,d:1};}
 const cross=qx*edge.dz-qz*edge.dx;return {n:cross*cross,d:edge.norm};
}

/** Assign only real wall cells to their nearest polygon edge. Lowest index wins ties. */
export function profileEdgeTopology(profile,points){
 const edges=points.map((a,i)=>{
  const b=points[(i+1)%points.length],dx=b[0]-a[0],dz=b[1]-a[1],axis=Math.abs(dx)>=Math.abs(dz)?0:1;
  return {a,b,dx,dz,norm:dx*dx+dz*dz,axis,sign:Math.sign(axis===0?dx:dz),span:Math.max(Math.abs(dx),Math.abs(dz)),cells:[]};
 });
 for(let z=0;z<profile.length;z++)for(let x=0;x<profile.width;x++){
  const index=x+z*profile.width;if(profile.mask[index]!==1)continue;
  let owner=0,best=distance(edges[0],x,z);
  for(let i=1;i<edges.length;i++){const candidate=distance(edges[i],x,z);if(candidate.n*best.d<best.n*candidate.d){owner=i;best=candidate;}}
  const edge=edges[owner],u=Math.floor(edge.sign*((edge.axis===0?x:z)+.5-edge.a[edge.axis]));
  edge.cells.push({index,u,depth:profile.depth[index]});
 }
 return edges;
}

/** Exact footprint masks for one panel; vertical repetition is lowered separately. */
export function edgePanelMasks(profile,edge,{u,width,left,right,recess,lattice,requireGlazing=true}){
 const all=new Uint8Array(profile.mask.length),sides=new Uint8Array(all.length),opening=new Uint8Array(all.length),glass=new Uint8Array(all.length);
 const coverage=new Uint32Array(width),glassCoverage=new Uint32Array(width);
 for(const cell of edge.cells){
  const col=cell.u-u;if(col<0||col>=width)continue;coverage[col]++;all[cell.index]=1;
  if(col<left||col>=width-right||lattice&&col>left&&(col-left)%2===1)sides[cell.index]=1;
  else{opening[cell.index]=1;if(cell.depth===recess+1){glass[cell.index]=1;glassCoverage[col]++;}}
 }
 if(coverage.some(n=>n===0))throw new Error('Requested profile edge column has no wall cells; adjust the explicit panel or corner margin');
 if(requireGlazing)for(let col=left;col<width-right;col++)if(!(lattice&&col>left&&(col-left)%2===1)&&!glassCoverage[col])throw new Error('Requested profile glazing recess has no wall layer in a column; no automatic relocation');
 const rects=mask=>profileRectangles(mask,profile.width,profile.length);
 return {all:rects(all),sides:rects(sides),opening:rects(opening),glass:rects(glass)};
}
