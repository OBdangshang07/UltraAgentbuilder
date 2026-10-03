import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScene} from '../../src/design/compiler.mjs';
import {profileFootprint} from '../../src/design/profile.mjs';
import {profileEdgeTopology} from '../../src/design/edge-facade.mjs';
import {reviseScene} from '../../src/design/revision.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {basicScene,shape,at,facade,mass} from './fixtures.mjs';
import {profileMass,chamfer} from './profile-fixtures.mjs';
import {edgeFacade} from './space-fixtures.mjs';
const state=(c,x,y,z)=>c.manifest.palette[c.cells[x+z*c.manifest.dimensions.width+y*c.manifest.dimensions.width*c.manifest.dimensions.length]];
function study(edge=0,extra={}){
 const s=basicScene('edge-facade-study');s.constraints={interior:false,walkable:false,passages:[]};s.bounds={width:40,height:24,length:40};
 s.components=[profileMass('body',[4,0,4],[32,20,32],chamfer(32,32,8),[5,10,15],{thickness:2}),edgeFacade('panels','body',edge,{start:[edge%2?2:3,1],...extra})];return structuredClone(s);
}
test('edge ownership partitions real wall cells without overlaps, courtyards or invented geometry',()=>{
 const points=[[0,0],[32,0],[32,28],[22,28],[22,10],[10,10],[10,28],[0,28]],p=profileFootprint(32,28,points,2),edges=profileEdgeTopology(p,points),seen=new Set();
 for(const e of edges)for(const c of e.cells){assert.equal(p.mask[c.index],1);assert.ok(!seen.has(c.index));seen.add(c.index);}
 assert.equal(seen.size,[...p.mask].filter(v=>v===1).length);
});
for(let edge=0;edge<8;edge++)test(`edge ${edge}: windows on cardinal/diagonal walls keep all exterior masks, floors and source boundaries`,()=>{
 const s=study(edge),before=hash(s),c=compileScene(s),p=profileFootprint(32,32,s.components[0].points,2);assert.equal(hash(s),before);
 assert.ok(c.designSources.surviving.panels>0);assert.ok(c.spec.nodes.some(n=>n.repeat.count===3));
 for(let z=0;z<32;z++)for(let x=0;x<32;x++){
  if(!p.mask[x+z*32])for(const y of [0,1,5,11,19])assert.equal(state(c,x+4,y,z+4),'@keep');
  if(p.mask[x+z*32])assert.equal(state(c,x+4,5,z+4),'minecraft:oak_planks');
 }
 for(let i=0;i<c.cells.length;i++)if(c.designSources.traceSources[c.sourceOwners[i]]?.component==='panels'){
  const x=i%40-4,z=Math.floor(i/40)%40-4;assert.equal(p.mask[x+z*32],1);
 }
});
test('new rectangular edge panels match existing frameless panels on all four faces',()=>{
 for(const [edge,face] of ['north','east','south','west'].entries()){
  const s=basicScene();s.constraints={interior:false,walkable:false,passages:[]};
  s.components=[mass('body',[5,0,5],[24,20,24],[5,10,15],{thickness:2}),{...facade('panels','body',face,{margin:2,start:[edge<2?3:17,1],size:[4,4],count:[1,3],step:[5,5],projection:0,sill:0,shade:0}),kind:'panelFacade',borders:[0,0,0,0],recess:0}];
  const a=compileScene(s);s.components[0]={...s.components[0],kind:'profileMass',points:[[0,0],[24,0],[24,24],[0,24]]};s.components[1]=edgeFacade('panels','body',edge);
  assert.deepEqual(compileScene(s).binary,a.binary);
 }
});
test('concave courtyard edge panels address the recess wall, not the bounding-box exterior',()=>{
 const s=study();s.components[0].points=[[0,0],[32,0],[32,32],[22,32],[22,10],[10,10],[10,32],[0,32]];s.components[1]=edgeFacade('panels','body',3,{recess:1});
 const c=compileScene(s);assert.equal(state(c,26,2,30),'minecraft:air');assert.equal(state(c,27,2,30),'minecraft:glass');assert.equal(state(c,25,2,30),'@keep');
});
test('asymmetric frame, recessed glazing, lattice and exclusions remain explicit',()=>{
 const s=study(0,{borders:[1,0,1,0],recess:1,exclude:[[0,1]]}),c=compileScene(s);
 assert.equal(state(c,15,2,4),'minecraft:spruce_planks');assert.equal(state(c,16,2,4),'minecraft:air');assert.equal(state(c,16,2,5),'minecraft:glass');
 assert.equal(state(c,16,7,4),'minecraft:sandstone');assert.equal(state(c,16,1,4),'minecraft:spruce_planks');
 s.components[1].lattice=true;assert.equal(state(compileScene(s),17,2,4),'minecraft:spruce_planks');
});
test('clear edge apertures remain valid negative-space features and do not invent glazing',()=>{
 const s=study(1,{glazing:null});s.featureBindings=[{feature:'Open lattice edge',components:['panels']}];const c=compileScene(s);
 assert.equal(c.designSources.surviving.panels,undefined);assert.ok(c.designSources.survivingClear.panels>0);
 assert.ok(!c.manifest.scene.diagnostics.some(d=>['feature-not-visible','component-covered'].includes(d.code)));
});
test('roofless segment may glaze to its exclusive top, while a real roof remains protected',()=>{
 const s=study(0,{start:[3,16],count:[1,1]});s.components[0].roof=false;
 const c=compileScene(s);assert.equal(state(c,16,19,4),'minecraft:glass');assert.equal(state(c,16,20,4),'@keep');
 s.components[0].roof=true;assert.throws(()=>compileScene(s),/floor\/roof margins/);
});
test('invalid edge, margins, empty opening, overlap and floor cuts fail without cropping the request',()=>{
 for(const edit of [c=>c.edge=8,c=>c.start=[15,1],c=>c.start=[3,0],c=>c.borders=[3,3,0,0],c=>c.recess=2,c=>c.size=[4,5],c=>{c.count=[2,3];c.step=[2,5];},c=>c.exclude=[[2,0]]]){
  const s=study();edit(s.components[1]);const original=hash(s);assert.throws(()=>compileScene(s));assert.equal(hash(s),original);
 }
 const s=study();s.components[0].repeat.count=2;s.components[0].repeat.step=[0,1,0];assert.throws(()=>compileScene(s),/one profileMass/);
});
test('edge permission only covers its host, and user reservations/protected revisions remain authoritative',()=>{
 const s=study();s.components.push(shape('other',[15,2,4],[3,2,1],'roof',{stage:'structure',allowOverwrite:['body']}));assert.throws(()=>compileScene(s),/panels -> other/);
 const a=study();a.reservations=[{id:'keepSpace',at:at([15,2,4]),size:[3,2,1],allowedComponents:[]}];assert.throws(()=>compileScene(a),/Reserved space/);
 const source=study(0),base=compileScene(source),replacement={...source.components[1],glazing:'blue_glass'};
 const patch={baseHash:base.manifest.assetHash,replaceComponents:[replacement],removeComponents:[],replaceModules:[],replaceInstances:[]};
 const scope={components:['panels'],protectedComponents:['body'],regions:base.designSources.componentBounds.panels,shared:'all'};
 assert.ok(reviseScene(source,patch,scope,{baseCompiled:base}).revision.changedCells>0);
 replacement.start=[2,1];assert.throws(()=>reviseScene(source,patch,scope,{baseCompiled:base}),/Protected component|outside approved/);
});
