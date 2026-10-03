import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {profileFootprint,profileContainsInterior} from '../../src/design/profile.mjs';
import {compileScene,lowerScene} from '../../src/design/compiler.mjs';
import {compileSpec,hash} from '../../src/generation/compiler.mjs';
import {readNativeBundle} from '../../src/generation/bundle.mjs';
import {reviseScene} from '../../src/design/revision.mjs';
import {basicScene,mass,shape,at,once,facade} from './fixtures.mjs';
import {profileMass,chamfer,profileTower,profileGallery,profileCourt,profileWorldTower} from './profile-fixtures.mjs';
const state=(c,x,y,z)=>c.manifest.palette[c.cells[x+z*c.manifest.dimensions.width+y*c.manifest.dimensions.width*c.manifest.dimensions.length]];
const polygonContains=(points,x,z)=>{
 let inside=false;
 for(let i=0,j=points.length-1;i<points.length;j=i++){
  const a=points[j],b=points[i];
  if((b[0]-a[0])*(z-a[1])===(b[1]-a[1])*(x-a[0])&&x>=Math.min(a[0],b[0])&&x<=Math.max(a[0],b[0])&&z>=Math.min(a[1],b[1])&&z<=Math.max(a[1],b[1]))return true;
  if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }
 return inside;
};
test('polygon raster and inset agree cell-by-cell with an independent point/erosion reference',()=>{
 const cases=[[[0,0],[20,0],[20,20],[0,20]],chamfer(20,20,5),[[0,0],[20,0],[20,8],[8,8],[8,20],[0,20]],[[0,0],[20,0],[20,20],[14,20],[14,8],[6,8],[6,20],[0,20]],[[0,0],[20,2],[17,20],[1,18]]];
 for(const points of cases)for(const thickness of [1,2]){
  const p=profileFootprint(20,20,points,thickness);
  for(let z=0;z<20;z++)for(let x=0;x<20;x++){
   let expected=polygonContains(points,x+.5,z+.5)?2:0;
   if(expected)for(let dz=-thickness;dz<=thickness;dz++)for(let dx=-thickness;dx<=thickness;dx++)if(!polygonContains(points,x+dx+.5,z+dz+.5))expected=1;
   assert.equal(p.mask[x+z*20],expected,`at ${x},${z} thickness ${thickness}`);
  }
  const rebuilt=new Uint8Array(400);for(const r of p.footprint)for(let z=r.origin[1];z<r.origin[1]+r.size[1];z++)for(let x=r.origin[0];x<r.origin[0]+r.size[0];x++){assert.equal(rebuilt[x+z*20],0);rebuilt[x+z*20]=1;}
  assert.deepEqual([...rebuilt],[...p.mask].map(v=>v?1:0));
 }
});
test('profile centre-on-edge rule is invariant to winding, rotations and reflection',()=>{
 const points=[[0,5],[5,0],[20,3],[18,17],[6,20],[0,15]],p=profileFootprint(20,20,points,1);
 assert.deepEqual(profileFootprint(20,20,[...points].reverse(),1).mask,p.mask);
 const r=profileFootprint(20,20,points.map(([x,z])=>[20-z,x]),1),m=profileFootprint(20,20,points.map(([x,z])=>[20-x,z]),1);
 for(let z=0;z<20;z++)for(let x=0;x<20;x++){assert.equal(r.mask[19-z+x*20],p.mask[x+z*20]);assert.equal(m.mask[19-x+z*20],p.mask[x+z*20]);}
});
test('profile rectangle matches legacy mass cell-for-cell without changing the legacy implementation',()=>{
 const a=basicScene();a.constraints={interior:false,walkable:false,passages:[]};a.components=[mass('body',[4,0,4],[24,20,24],[5,10,15],{thickness:2})];
 const b=structuredClone(a);b.components[0]={...b.components[0],kind:'profileMass',points:[[0,0],[24,0],[24,24],[0,24]]};
 assert.deepEqual(compileScene(a).binary,compileScene(b).binary);
});
for(const factory of [profileTower,profileGallery,profileCourt])test(`${factory.name} compiles deterministic masks via the original kernel, without a fixed architecture template`,()=>{
 const s=factory(),before=hash(s),c=compileScene(s);
 assert.equal(hash(s),before);assert.equal(c.manifest.assetHash,compileScene(s).manifest.assetHash);
 assert.deepEqual(c.binary,compileSpec(c.spec,{navigationPolicy:'review'}).binary);
 assert.ok(c.manifest.scene.expandedNodes<4096);assert.ok(c.manifest.setCount>1000);
 for(let i=0;i<c.cells.length;i++)if(c.cells[i]!==0)assert.ok(c.designSources.traceSources[c.sourceOwners[i]]?.component);
});
test('concave courtyard and chamfered corners remain KEEP at every height, not secretly excavated',()=>{
 const s=profileCourt(),c=compileScene(s);for(let y=0;y<s.bounds.height;y++)for(let z=14;z<32;z++)for(let x=14;x<26;x++)assert.equal(state(c,x,y,z),'@keep');
 const t=compileScene(profileTower());for(let y=0;y<192;y++)assert.equal(state(t,8,y,8),'@keep');
 assert.equal(state(c,5,1,5),'minecraft:air');
 assert.equal(state(c,4,1,5),'minecraft:bricks');
 assert.equal(state(c,5,0,5),'minecraft:oak_planks');
});
test('224-block polygon tower keeps actual height and compact floors without raising any quotas',()=>{
 const s=profileTower(),c=compileScene(s);let lo=Infinity,hi=-1;const plane=s.bounds.width*s.bounds.length;
 c.cells.forEach((v,i)=>{if(v>=2){lo=Math.min(lo,Math.floor(i/plane));hi=Math.max(hi,Math.floor(i/plane));}});
 assert.equal(hi-lo+1,224);assert.ok(c.spec.nodes.some(n=>n.repeat.count===38));assert.ok(c.spec.nodes.length<300);
});
test('profile stairs connect 45 floor checkpoints in strict mode, but cannot excavate a recess or sloping exterior',()=>{
 const s=profileWorldTower(),c=compileScene(s,{navigationPolicy:'strict'});assert.equal(c.manifest.quality.navigation,'verified');
 assert.equal(s.constraints.passages.length,45);assert.ok(c.designSources.stairAccess.every(a=>a.status==='local-opening-found'));
 for(const p of [[3,0,3],[4,0,4]]){const bad=structuredClone(s);bad.components[1].at.offset=p;assert.throws(()=>compileScene(bad),/actual profile interior|alter exterior/);}
});
test('profile rejects malformed polygons, missing headroom, unknown material and oversized analysis',()=>{
 for(const points of [[[0,0],[20,20],[0,20],[20,0]],[[0,0],[10,0],[5,0],[5,20]],[[0,0],[20,0],[20,20],[0,0]],[[0,0],[21,0],[20,20]],[[0,0],[20,0],[20,1],[0,1]],[[0,0],[10,0],[20,0]]])assert.throws(()=>profileFootprint(20,20,points,1));
 for(const edit of [c=>c.levels=[2],c=>c.levels=[12],c=>c.material='unknown',c=>c.size[1]=3,c=>c.points[0][0]=100]){
  const s=profileGallery();s.components=s.components.slice(0,1);edit(s.components[0]);const before=hash(s);assert.throws(()=>compileScene(s));assert.equal(hash(s),before);
 }
 const s=basicScene();s.bounds={width:256,height:4,length:256};s.components=Array.from({length:60},(_,i)=>profileMass('p'+i,[0,0,0],[256,4,256],[[0,0],[256,0],[256,256],[0,256]],[]));
 assert.throws(()=>lowerScene(s),/Profile raster analysis quota/);
});
test('profile is furnishable in ordinary interior but walls, explicit voids and reservations remain protected',()=>{
 const s=profileGallery();s.components=s.components.slice(0,1);s.components.push(shape('desk',[8,1,8],[2,1,2],'frame'));assert.doesNotThrow(()=>compileScene(s));
 s.components[1].at.offset=[4,1,6];assert.throws(()=>compileScene(s),/Ownership conflict/);
 s.components[1].at.offset=[8,1,8];s.components.splice(1,0,{id:'shaft',kind:'void',at:at([8,1,8]),size:[2,5,2],repeat:once,allowOverwrite:['gallery']});
 assert.throws(()=>compileScene(s),/Ownership conflict/);s.components[2].allowOverwrite=['shaft'];
 s.reservations=[{id:'keepShaft',at:at([8,1,8]),size:[2,5,2],allowedComponents:[]}];assert.throws(()=>compileScene(s),/Reserved space/);
});
test('existing rectangular facade cannot silently treat a concave profile as a rectangle',()=>{
 const s=profileGallery();s.components=[s.components[0],facade('wrong','gallery','north')];assert.throws(()=>compileScene(s),/single mass/);
});
test('saved profile base allows bounded furnishing revisions but never edits to locked shell',()=>{
 const s=profileGallery();s.components=s.components.slice(0,1);s.components.push(shape('desk',[8,1,8],[2,1,2],'frame'));const base=compileScene(s);
 const replacement={...s.components[1],size:[3,1,2]},patch={baseHash:base.manifest.assetHash,replaceComponents:[replacement],removeComponents:[],replaceModules:[],replaceInstances:[]};
 const scope={components:['desk'],protectedComponents:['gallery'],regions:[{origin:[4,0,4],size:[28,14,24]}],shared:'all'};
 assert.equal(reviseScene(s,patch,scope,{baseCompiled:base}).revision.changedCells,2);
 replacement.at=at([4,1,6]);replacement.allowOverwrite=['gallery'];assert.throws(()=>reviseScene(s,patch,scope,{baseCompiled:base}),/Protected component/);
});
test('profile sources, cell masks and door pairing survive the real native bundle reader',async()=>{
 const c=compileScene(profileGallery()),dir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-profile-native-'));
 const owners=Buffer.alloc(c.sourceOwners.length*2);c.sourceOwners.forEach((v,i)=>owners.writeUInt16LE(v,i*2));
 for(const [file,value] of Object.entries({'manifest.json':c.manifest,'spec.json':c.spec,'scene.json':c.scene,'design-sources.json':c.designSources}))await fs.writeFile(path.join(dir,file),JSON.stringify(value));
 await fs.writeFile(path.join(dir,'cells.bin'),c.binary);await fs.writeFile(path.join(dir,'source-owners.bin'),owners);
 const native=await readNativeBundle(dir);assert.equal(native.manifest.assetHash,c.manifest.assetHash);assert.deepEqual(native.cells,c.cells);assert.deepEqual(native.sourceOwners,c.sourceOwners);
});
