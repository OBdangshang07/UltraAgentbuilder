// Deterministic data-only polygon rasterization. Grid corners are integer X/Z;
// a cell belongs to the profile iff its centre is inside or on the boundary.
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const onSegment=(a,b,p)=>cross(a,b,p)===0&&p.every((v,i)=>v>=Math.min(a[i],b[i])&&v<=Math.max(a[i],b[i]));
function intersects(a,b,c,d){
 const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
 return abC*abD<0&&cdA*cdB<0||onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b);
}
function validatePolygon(points,w,d){
 if(!Array.isArray(points)||points.length<3||points.length>64)throw new Error('Profile needs 3..64 polygon corners');
 for(const p of points)if(!Array.isArray(p)||p.length!==2||p.some((v,i)=>!Number.isSafeInteger(v)||v<0||v>(i===0?w:d)))throw new Error('Profile corner outside local X/Z bounds');
 if(new Set(points.map(p=>p.join(','))).size!==points.length)throw new Error('Profile polygon has duplicate corners; do not repeat the first corner');
 let area=0;
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length],c=points[(i+2)%points.length];
  area+=a[0]*b[1]-b[0]*a[1];
  if(cross(a,b,c)===0&&(b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1])<0)throw new Error('Profile polygon doubles back along an edge');
  for(let j=i+1;j<points.length;j++){
   if(j===i+1||i===0&&j===points.length-1)continue;
   if(intersects(a,b,points[j],points[(j+1)%points.length]))throw new Error('Profile polygon self-intersects or touches itself');
  }
 }
 if(area===0)throw new Error('Profile polygon has no area');
}

/** Merge identical horizontal runs on consecutive rows into exact rectangles. */
export function profileRectangles(mask,w,d,predicate=v=>v!==0){
 const result=[];let previous=new Map();
 for(let z=0;z<d;z++){
  const current=new Map();
  for(let x=0;x<w;){
   if(!predicate(mask[x+z*w])){x++;continue;}
   const start=x;while(x<w&&predicate(mask[x+z*w]))x++;
   const key=start+':'+x,prior=previous.get(key),r=prior??{origin:[start,z],size:[x-start,1]};
   if(prior)r.size[1]++;else result.push(r);
   current.set(key,r);
  }
  previous=current;
 }
 return result;
}

/** No solid rectangular bounding-box fill and no implicit courtyard excavation. */
export function profileFootprint(width,length,points,thickness){
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(length)||width<1||length<1||width>256||length>256||!Number.isSafeInteger(thickness)||thickness<1||thickness>4)throw new Error('Invalid bounded profile dimensions/thickness');
 validatePolygon(points,width,length);
 const mask=new Uint8Array(width*length);
 for(let z=0;z<length;z++){
  const y2=2*z+1,cuts=[];
  for(let i=0;i<points.length;i++){
   let a=points[i],b=points[(i+1)%points.length];
   if(a[1]>b[1])[a,b]=[b,a];
   if(y2<2*a[1]||y2>=2*b[1])continue;
   cuts.push({n:2*a[0]*(b[1]-a[1])+(y2-2*a[1])*(b[0]-a[0]),d:2*(b[1]-a[1])});
  }
  cuts.sort((a,b)=>a.n*b.d-b.n*a.d);
  if(cuts.length%2)throw new Error('Profile scanline is not closed');
  for(let i=0;i<cuts.length;i+=2){
   const a=cuts[i],b=cuts[i+1],start=Math.ceil((2*a.n-a.d)/(2*a.d)),end=Math.floor((2*b.n-b.d)/(2*b.d))+1;
   for(let x=start;x<end;x++){
    if(x<0||x>=width)throw new Error('Profile raster escaped declared bounds');
    mask[x+z*width]=1;
   }
  }
 }
 // Chessboard distance gives an explicit grid-thickness shell, including concave corners.
 const stride=width+2,dist=new Uint16Array(stride*(length+2)),far=1024;
 for(let z=0;z<length;z++)for(let x=0;x<width;x++)if(mask[x+z*width])dist[x+1+(z+1)*stride]=far;
 for(let z=1;z<=length;z++)for(let x=1;x<=width;x++){
  const i=x+z*stride;if(dist[i])dist[i]=Math.min(dist[i],1+Math.min(dist[i-1],dist[i-stride-1],dist[i-stride],dist[i-stride+1]));
 }
 for(let z=length;z>=1;z--)for(let x=width;x>=1;x--){
  const i=x+z*stride;if(dist[i])dist[i]=Math.min(dist[i],1+Math.min(dist[i+1],dist[i+stride-1],dist[i+stride],dist[i+stride+1]));
 }
 const depth=new Uint8Array(width*length);let area=0,interiorArea=0;
 for(let z=0;z<length;z++)for(let x=0;x<width;x++)if(mask[x+z*width]){
  depth[x+z*width]=dist[x+1+(z+1)*stride];area++;if(depth[x+z*width]>thickness){mask[x+z*width]=2;interiorArea++;}
 }
 if(!interiorArea)throw new Error('Profile thickness leaves no hollow interior');
 return {width,length,mask,depth,area,interiorArea,footprint:profileRectangles(mask,width,length,v=>v>0),walls:profileRectangles(mask,width,length,v=>v===1),interior:profileRectangles(mask,width,length,v=>v===2)};
}

export function profileContainsInterior(profile,x,z,width,length){
 if(x<0||z<0||x+width>profile.width||z+length>profile.length)return false;
 for(let dz=z;dz<z+length;dz++)for(let dx=x;dx<x+width;dx++)if(profile.mask[dx+dz*profile.width]!==2)return false;
 return true;
}
