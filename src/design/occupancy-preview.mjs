import {deflateSync} from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';
import {hash,LIMITS} from '../generation/compiler.mjs';
import {validateState} from '../generation/block-states.mjs';

const SIZE=512;
function crc(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;}return (n^0xffffffff)>>>0;}
function chunk(type,data){const bytes=Buffer.alloc(data.length+12);bytes.writeUInt32BE(data.length);bytes.write(type,4);data.copy(bytes,8);bytes.writeUInt32BE(crc(bytes.subarray(4,-4)),bytes.length-4);return bytes;}
function png(pixels){const header=Buffer.alloc(13);header.writeUInt32BE(SIZE);header.writeUInt32BE(SIZE,4);header[8]=8;header[9]=2;const rows=Buffer.alloc(SIZE*(SIZE*3+1));for(let y=0;y<SIZE;y++)pixels.copy(rows,y*(SIZE*3+1)+1,y*SIZE*3,(y+1)*SIZE*3);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);}
// Deliberately approximate: neutral geometry evidence, not a texture renderer.
function color(state){
  const name=state.split('[')[0].replace('minecraft:','');
  if(name.includes('oxidized_copper'))return [79,155,128];if(name.includes('copper'))return [175,108,74];
  if(name.includes('glass'))return name.startsWith('gray')?[79,104,114]:name.startsWith('black')?[47,65,73]:[130,175,190];
  if(/blackstone|deepslate/.test(name))return [62,63,69];
  if(/lantern|glowstone|shroomlight/.test(name))return [230,208,140];
  if(/quartz|calcite|diorite|white/.test(name))return [219,216,205];
  if(/leaves|moss|green/.test(name))return [84,122,62];if(/sandstone|bamboo/.test(name))return [201,182,128];
  if(/dark_oak/.test(name))return [80,58,38];if(/spruce/.test(name))return [119,91,56];if(/oak|birch/.test(name))return [164,135,84];
  if(/brick|red|terracotta/.test(name))return [149,89,70];if(/blue|cyan/.test(name))return [63,122,149];
  if(/black/.test(name))return [44,45,50];if(/light_gray/.test(name))return [172,173,166];return [119,121,123];
}
async function bounded(file,max){const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw new Error('Invalid occupancy preview file: '+path.basename(file));return fs.readFile(file);}
export async function renderOccupancyViews(directory,expected,out){
  const manifest=JSON.parse(await bounded(path.join(directory,'manifest.json'),1024*1024));
  const {assetHash,...metadata}=manifest;
  if(hash(metadata)!==assetHash||assetHash!==expected.assetHash||manifest.scene?.sourceHash!==expected.sourceHash)throw new Error('Occupancy preview asset/source mismatch');
  const {width:w,height:h,length:d}=manifest.dimensions??{},dims=[w,h,d];
  if(!dims.every((n,i)=>Number.isSafeInteger(n)&&n>0&&n<=[LIMITS.width,LIMITS.height,LIMITS.length][i])||w*h*d>LIMITS.cells)throw new Error('Occupancy preview dimensions exceed quota');
  if(!Array.isArray(manifest.palette)||manifest.palette.length<3||manifest.palette.length>256||manifest.palette[0]!=='@keep'||manifest.palette[1]!=='minecraft:air')throw new Error('Invalid occupancy preview palette');
  manifest.palette.slice(2).forEach(validateState);
  const bytes=await bounded(path.join(directory,'cells.bin'),LIMITS.cells*2);
  if(bytes.length!==w*h*d*2||hash(bytes)!==manifest.cellsHash)throw new Error('Occupancy preview cells mismatch');
  const cells=new Uint16Array(w*h*d),min=[w,h,d],max=[-1,-1,-1];let solids=0,clear=0;
  const invisible=manifest.palette.map(s=>/^minecraft:light(?:\[|$)/.test(s));
  for(let i=0;i<cells.length;i++){
    const n=bytes.readUInt16LE(i*2);if(n>=manifest.palette.length)throw new Error('Invalid occupancy preview cell');cells[i]=invisible[n]?0:n;
    if(n===1)clear++;if(n>=2)solids++;
    if(cells[i]<2)continue;
    const p=[i%w,Math.floor(i/(w*d)),Math.floor(i/w)%d];for(let a=0;a<3;a++){min[a]=Math.min(min[a],p[a]);max[a]=Math.max(max[a],p[a]+1);}
  }
  if(!solids||solids>LIMITS.occupied||solids!==manifest.setCount||clear!==manifest.clearCount||max[1]<0)throw new Error('Invalid occupancy preview counts');
  const centre=min.map((n,a)=>(n+max[a])/2),distance=Math.hypot(w,h,d)*2,colors=manifest.palette.map(color),views=[];
  await fs.mkdir(out,{recursive:true});
  for(const [view,yaw] of [-35,55,145,235].entries()){
    const angle=yaw*Math.PI/180,pitch=20*Math.PI/180,
      eye=[Math.sin(angle)*Math.cos(pitch),Math.sin(pitch),Math.cos(angle)*Math.cos(pitch)],
      right=[Math.cos(angle),0,-Math.sin(angle)],up=[-Math.sin(angle)*Math.sin(pitch),Math.cos(pitch),-Math.cos(angle)*Math.sin(pitch)],dir=eye.map(n=>-n);
    const span=axis=>max.reduce((n,v,a)=>n+Math.abs(axis[a])*(v-min[a]),0);
    const scale=Math.max(span(right),span(up))/440,raw=Buffer.alloc(SIZE*SIZE*3);let visiblePixels=0;
    for(let py=0;py<SIZE;py++)for(let px=0;px<SIZE;px++){
      const origin=centre.map((n,a)=>n+right[a]*(px+0.5-256)*scale+up[a]*(256-py-0.5)*scale+eye[a]*distance);
      let start=0,end=Infinity,face=1;
      for(let a=0;a<3;a++){
        if(Math.abs(dir[a])<1e-12){if(origin[a]<0||origin[a]>=dims[a])end=-1;continue;}
        const t0=-origin[a]/dir[a],t1=(dims[a]-origin[a])/dir[a],near=Math.min(t0,t1);
        if(near>start){start=near;face=a;}end=Math.min(end,Math.max(t0,t1));
      }
      let shade=[238,241,242];
      if(end>start){
        const p=origin.map((n,a)=>Math.floor(n+dir[a]*(start+1e-7))),step=dir.map(Math.sign),delta=dir.map(n=>Math.abs(1/n));
        const next=p.map((v,a)=>Math.abs(dir[a])<1e-12?Infinity:((step[a]>0?v+1:v)-origin[a])/dir[a]);
        for(let count=0;count<w+h+d+3&&p.every((v,a)=>v>=0&&v<dims[a]);count++){
          const id=cells[(p[1]*d+p[2])*w+p[0]];
          if(id>=2){shade=colors[id].map(n=>Math.round(n*[0.84,1,0.69][face]));visiblePixels++;break;}
          face=next[0]<next[1]?(next[0]<next[2]?0:2):(next[1]<next[2]?1:2);
          if(next[face]>end)break;p[face]+=step[face];next[face]+=delta[face];
        }
      }
      const offset=(py*SIZE+px)*3;raw[offset]=shade[0];raw[offset+1]=shade[1];raw[offset+2]=shade[2];
    }
    if(!visiblePixels)throw new Error('Empty occupancy preview');
    const file=`view-${view}.png`,data=png(raw);await fs.writeFile(path.join(out,file),data,{flag:'wx'});
    views.push({file,sha256:hash(data),yaw,pitch:20,visiblePixels});
  }
  const evidence={version:1,renderer:'occupancy-v1',sourceHash:expected.sourceHash,assetHash,views,
    assetOnly:true,worldCaptured:false,approximateColours:true,partialBlocksAsFullCells:true,glassRenderedOpaque:true,
    canAuthorizePlacement:false};
  await fs.writeFile(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2),{flag:'wx'});
  return evidence;
}
