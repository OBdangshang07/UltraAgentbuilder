import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureDir, resolveProject } from './paths.mjs';

const MAGIC = Buffer.from('VXP1');

export async function writePreviewBundle(id, prepared, reportDir) {
  ensureDir(reportDir);
  const dataFile = path.join(reportDir, 'preview-data.bin');
  const htmlFile = path.join(reportDir, 'preview.html');
  const colors = JSON.parse(fs.readFileSync(resolveProject('config', 'block-colors.json'), 'utf8'));
  const dimensions = prepared.asset.dimensions;
  if ([dimensions.width, dimensions.height, dimensions.length].some(value => value > 0xffff)) {
    throw new Error(`Preview binary supports dimensions up to 65535: ${JSON.stringify(dimensions)}`);
  }
  let visibleCount = 0;
  for (const [, paletteId] of prepared.placements) if (isPreviewVisible(prepared.palette[paletteId])) visibleCount++;
  const handle = await fs.promises.open(dataFile, 'w');
  try {
    const header = Buffer.alloc(16);
    MAGIC.copy(header, 0);
    header.writeUInt16LE(dimensions.width, 4);
    header.writeUInt16LE(dimensions.height, 6);
    header.writeUInt16LE(dimensions.length, 8);
    header.writeUInt32LE(visibleCount, 10);
    await handle.write(header);
    let chunk = Buffer.allocUnsafe(9 * 8192);
    let records = 0;
    const flush = async () => {
      if (!records) return;
      await handle.write(chunk.subarray(0, records * 9));
      chunk = Buffer.allocUnsafe(9 * 8192);
      records = 0;
    };
    const plane = dimensions.width * dimensions.length;
    for (const [index, paletteId] of prepared.placements) {
      if (!isPreviewVisible(prepared.palette[paletteId])) continue;
      const x = index % dimensions.width;
      const z = Math.floor(index / dimensions.width) % dimensions.length;
      const y = Math.floor(index / plane);
      const state = prepared.palette[paletteId];
      const [r, g, b] = colorForBlock(state, colors);
      const offset = records * 9;
      chunk.writeUInt16LE(x, offset);
      chunk.writeUInt16LE(y, offset + 2);
      chunk.writeUInt16LE(z, offset + 4);
      chunk[offset + 6] = r; chunk[offset + 7] = g; chunk[offset + 8] = b;
      records++;
      if (records === 8192) await flush();
    }
    await flush();
  } finally {
    await handle.close();
  }
  fs.writeFileSync(htmlFile, previewHtml(id), 'utf8');
  return { htmlFile, dataFile, dataBytes: (await fs.promises.stat(dataFile)).size };
}

function isPreviewVisible(state) {
  return state.replace(/\[.*$/, '') !== 'minecraft:light';
}

function colorForBlock(state, colors) {
  const base = state.replace(/\[.*$/, '');
  let hex = colors[base];
  if (!hex) hex = `#${crypto.createHash('sha256').update(base).digest('hex').slice(0, 6)}`;
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
}

function previewHtml(id) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${id} · schematic preview</title><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#10141b;color:#eef3f7;font:14px/1.4 system-ui,sans-serif}canvas{width:100%;height:100%;display:block}.hud{position:fixed;left:18px;top:16px;padding:10px 13px;background:#10141bd9;border:1px solid #ffffff20;border-radius:8px;pointer-events:none}.hud b{display:block;font-size:16px}.hud span{color:#aeb9c5}
</style></head><body><canvas id="gl"></canvas><div class="hud"><b>${id}</b><span id="stats">loading…</span></div><script type="module">
const canvas=document.querySelector('#gl'),gl=canvas.getContext('webgl',{antialias:true,preserveDrawingBuffer:true});if(!gl)throw new Error('WebGL unavailable');
const view=new URLSearchParams(location.search).get('view')||'iso';
const response=await fetch('./preview-data.bin');if(!response.ok)throw new Error('preview-data.bin '+response.status);const data=await response.arrayBuffer(),dv=new DataView(data);
const magic=String.fromCharCode(...new Uint8Array(data,0,4));if(magic!=='VXP1')throw new Error('Bad preview data magic');
const width=dv.getUint16(4,true),height=dv.getUint16(6,true),length=dv.getUint16(8,true),count=dv.getUint32(10,true);
const positions=new Uint16Array(count*3),colors=new Uint8Array(count*3);for(let i=0,o=16;i<count;i++,o+=9){positions[i*3]=dv.getUint16(o,true);positions[i*3+1]=dv.getUint16(o+2,true);positions[i*3+2]=dv.getUint16(o+4,true);colors[i*3]=dv.getUint8(o+6);colors[i*3+1]=dv.getUint8(o+7);colors[i*3+2]=dv.getUint8(o+8);}
const vs='attribute vec3 p;attribute vec3 c;uniform vec3 dims;uniform float mode;uniform float aspect;varying vec3 color;void main(){vec3 extent=max(dims-vec3(1.0),vec3(1.0));float longest=max(extent.x,max(extent.y,extent.z));vec3 n=(p-extent*0.5)/longest*2.0;vec2 q;float d;if(mode<0.5){q=vec2(n.x,n.y);d=-n.z;}else if(mode<1.5){q=vec2(n.z,n.y);d=-n.x;}else if(mode<2.5){q=vec2(n.x,n.z);d=-n.y;}else{q=vec2((n.x-n.z)*0.62,n.y*0.82-(n.x+n.z)*0.24);d=-(n.x+n.z)*0.28-n.y*0.08;q*=0.78;}q*=0.92;q.x/=max(1.0,aspect);gl_Position=vec4(q,d*0.45,1.0);gl_PointSize=clamp(880.0/max(dims.x,max(dims.y,dims.z)),1.0,7.0);color=c/255.0;}';
const fs='precision mediump float;varying vec3 color;void main(){vec2 d=gl_PointCoord-0.5;if(dot(d,d)>0.25)discard;gl_FragColor=vec4(color,1.0);}';
function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vs));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);
const pb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,pb);gl.bufferData(gl.ARRAY_BUFFER,positions,gl.STATIC_DRAW);const pa=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(pa);gl.vertexAttribPointer(pa,3,gl.UNSIGNED_SHORT,false,0,0);
const cb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,cb);gl.bufferData(gl.ARRAY_BUFFER,colors,gl.STATIC_DRAW);const ca=gl.getAttribLocation(program,'c');gl.enableVertexAttribArray(ca);gl.vertexAttribPointer(ca,3,gl.UNSIGNED_BYTE,false,0,0);
const modes={front:0,side:1,top:2,iso:3};function draw(){const ratio=devicePixelRatio||1;canvas.width=Math.round(innerWidth*ratio);canvas.height=Math.round(innerHeight*ratio);gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(0.063,0.078,0.106,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.uniform3f(gl.getUniformLocation(program,'dims'),width,height,length);gl.uniform1f(gl.getUniformLocation(program,'mode'),modes[view]??3);gl.uniform1f(gl.getUniformLocation(program,'aspect'),canvas.width/canvas.height);gl.drawArrays(gl.POINTS,0,count);gl.finish();document.querySelector('#stats').textContent=view+' · '+width+'×'+height+'×'+length+' · '+count.toLocaleString()+' blocks';window.__previewStats={ready:true,view,width,height,length,count};}addEventListener('resize',draw);draw();
</script></body></html>`;
}
