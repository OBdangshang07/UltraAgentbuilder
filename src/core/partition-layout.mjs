import crypto from 'node:crypto';
import {validateDimensions} from './asset-schema.mjs';

export function planColumns(boxes, dimensions, {width=256,length=256}={}) {
  if (![width,length].every(n=>Number.isInteger(n)&&n>0&&n<=32767)) throw new Error('Invalid partition size');
  const nx=Math.ceil(dimensions.width/width), nz=Math.ceil(dimensions.length/length);
  const parts=[];
  for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++)parts.push({
    key:`x${String(ix*width).padStart(4,'0')}-z${String(iz*length).padStart(4,'0')}`,
    offset:{x:ix*width,y:0,z:iz*length},
    dimensions:{width:Math.min(width,dimensions.width-ix*width),height:1,length:Math.min(length,dimensions.length-iz*length)},
  });
  for(const [x,y,z,w,h,d] of boxes){
    if(x+w<=0||z+d<=0||x>=dimensions.width||z>=dimensions.length)continue;
    if(y<0||y+h>dimensions.height)throw new Error('Source vertical bounds exceeded');
    for(let iz=Math.max(0,Math.floor(z/length));iz<=Math.min(nz-1,Math.floor((z+d-1)/length));iz++)
      for(let ix=Math.max(0,Math.floor(x/width));ix<=Math.min(nx-1,Math.floor((x+w-1)/width));ix++)
        parts[iz*nx+ix].dimensions.height=Math.max(parts[iz*nx+ix].dimensions.height,y+h);
  }
  validateLayout(parts,dimensions);
  return parts;
}

export function validateLayout(parts, full) {
  if(!parts.length)throw new Error('Empty partition set');
  if(!Object.values(full).every(n=>Number.isInteger(n)&&n>0&&n<=32767))throw new Error('Invalid source dimensions');
  const keys=new Set();let area=0;
  for(let i=0;i<parts.length;i++){
    const p=parts[i],o=p.offset,d=p.dimensions;validateDimensions(d);
    if(keys.has(p.key))throw new Error(`Duplicate partition ${p.key}`);keys.add(p.key);
    if(![o.x,o.y,o.z].every(Number.isInteger)||o.x<0||o.z<0||o.y!==0||o.x+d.width>full.width||o.z+d.length>full.length||d.height>full.height)throw new Error('Partition out of source bounds');
    area+=d.width*d.length;
    for(let j=0;j<i;j++){const q=parts[j];if(o.x<q.offset.x+q.dimensions.width&&o.x+d.width>q.offset.x&&o.z<q.offset.z+q.dimensions.length&&o.z+d.length>q.offset.z)throw new Error('Overlapping partitions');}
  }
  if(area!==full.width*full.length)throw new Error('Partition coverage has holes');
  return {status:'passed',horizontalCells:area,columns:parts.length,verticalPolicy:'Only trailing source-air above each column is omitted.'};
}

export function collectionHash(dimensions,parts) {
  const hash=crypto.createHash('sha256');hash.update(JSON.stringify(dimensions)+'\n');
  for(const p of [...parts].sort((a,b)=>a.key.localeCompare(b.key)))hash.update(JSON.stringify([p.key,p.offset,p.dimensions,p.semanticSha256])+'\n');
  return hash.digest('hex');
}
