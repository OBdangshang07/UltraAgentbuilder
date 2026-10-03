import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScene,lowerScene} from '../../src/design/compiler.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {reviseScene} from '../../src/design/revision.mjs';
import {basicScene,mass,facade,shape,courtyard,teahouse,commercial,highrise} from './fixtures.mjs';
const state=(c,x,y,z)=>c.manifest.palette[c.cells[x+z*c.manifest.dimensions.width+y*c.manifest.dimensions.width*c.manifest.dimensions.length]];
function panel(face='north',extra={}){return {...facade('panels','main',face,{count:[1,1],start:[3,2],size:[6,4],projection:0,sill:0,shade:0}),kind:'panelFacade',borders:[0,0,0,0],recess:0,...extra};}
function study(face='north',extra={}){const s=basicScene();s.constraints={interior:false,walkable:false,passages:[]};s.components=[mass('main',[8,1,8],[20,14,20],[],{thickness:2}),panel(face,extra)];return s;}

test('scene-1.2 additions preserve every legacy lowered operation and cell byte in four different studies',()=>{
 const frozen=[
  [courtyard,'989ce51f9c16717f4e332e19277c3d90f1deea62e1d00930168602f8fdfbe06a','8918097d99fcbac6fd5b34407874dce7381fc7eccf2e42256992d2313a170cc1'],
  [teahouse,'eb9e18b3af771b2d5870b5ef664be0f6418041e78742af2d71f12084b80bdd19','235fc834a2e473a1ef7bc98d0a01ab683142d5980643888051ec449ac2592fb9'],
  [commercial,'861e0b80143e68f8c8e068c515aac1da0530e729b801c0160d291ce99afde252','583eb5675fd4eb2318c5fbfcdb10ab89966697e390d3f1f606cd65e6f5e0e14d'],
  [highrise,'0588d9865e062c18d11f4e5e3a65b3b510cb23b982debc176a20a71464e9ec19','c62d53fb454d95bf493e0138fe0d878067fe65edc9b984dab2d7cdbc23b26546']
 ];
 for(const [f,cells,lowered] of frozen){const s=f();assert.equal(hash(lowerScene(s).spec),lowered);assert.equal(compileScene(s).manifest.cellsHash,cells);}
});
for(const face of ['north','east','south','west'])test(`${face}: frameless panels clear the entire thick-wall opening and place flush glass`,()=>{
 const s=study(face),c=compileScene(s);
 const points={north:[[11,3,8],[16,6,8],[12,4,9],[10,4,8]],south:[[11,3,27],[16,6,27],[12,4,26],[10,4,27]],west:[[8,3,11],[8,6,16],[9,4,12],[8,4,10]],east:[[27,3,11],[27,6,16],[26,4,12],[27,4,10]]}[face];
 assert.equal(state(c,...points[0]),'minecraft:glass');assert.equal(state(c,...points[1]),'minecraft:glass');assert.equal(state(c,...points[2]),'minecraft:air');assert.equal(state(c,...points[3]),'minecraft:sandstone');
 assert.ok(c.designSources.surviving.panels===24);assert.ok(c.designSources.survivingClear.panels===24);
 const inset=structuredClone(s);inset.components[1].recess=1;const b=compileScene(inset);
 assert.equal(state(b,...points[0]),'minecraft:air');assert.equal(state(b,...points[2]),'minecraft:glass');
});
test('asymmetric borders, horizontal bands and one-cell openings are real geometry, not decorative labels',()=>{
 const s=study('north',{borders:[2,0,1,0],projection:1}),c=compileScene(s);
 assert.equal(state(c,11,4,7),'minecraft:spruce_planks');assert.equal(state(c,12,4,7),'minecraft:spruce_planks');
 assert.equal(state(c,13,4,8),'minecraft:glass');assert.equal(state(c,16,6,8),'minecraft:glass');assert.equal(state(c,15,3,7),'minecraft:spruce_planks');
 const ribbon=compileScene(study('north',{borders:[0,0,1,1]}));assert.equal(ribbon.designSources.surviving.panels,24);assert.equal(state(ribbon,11,4,8),'minecraft:glass');
 const narrow=compileScene(study('north',{size:[1,4]}));assert.equal(narrow.designSources.surviving.panels,4);
});
test('legacy one-block borders and deep recess are exactly expressible without changing legacy semantics',()=>{
 const a=study();a.components[1]={...facade('panels','main','north',{count:[1,1],start:[3,2],size:[6,4],projection:1,sill:1,shade:1,lattice:true})};
 const b=structuredClone(a);b.components[1]={...b.components[1],kind:'panelFacade',borders:[1,1,1,1],recess:1};
 assert.deepEqual(compileScene(a).binary,compileScene(b).binary);
});
test('row compression and exclusions preserve door bands without silently creating a frame',()=>{
 const s=study('north',{count:[2,2],step:[7,5],exclude:[[0,0]]}),c=compileScene(s);
 assert.equal(state(c,11,3,8),'minecraft:sandstone');assert.equal(state(c,18,3,8),'minecraft:glass');assert.equal(state(c,11,8,8),'minecraft:glass');
 assert.ok(c.spec.nodes.some(n=>n.repeat.count===2));assert.equal(state(c,11,7,8),'minecraft:sandstone');
});
test('an intentionally clear aperture is a valid negative-space feature, not a missing component',()=>{
 const s=study('north',{glazing:null});s.featureBindings=[{feature:'Open view to courtyard',components:['panels']}];const c=compileScene(s);
 assert.equal(c.designSources.survivingClear.panels,48);assert.ok(!c.manifest.scene.diagnostics.some(d=>d.code==='component-covered'||d.code==='feature-not-visible'));
});
test('invalid borders, recess, sill, overlap and projection are rejected without cropping or changing dimensions',()=>{
 for(const edit of [c=>c.borders=[4,4,0,0],c=>c.recess=2,c=>c.sill=1,c=>c.shade=1,c=>{c.count=[2,1];c.step=[3,0];},c=>c.start=[19,1]]){const s=study();edit(s.components[1]);assert.throws(()=>compileScene(s));}
 const s=study('north',{borders:[1,1,1,1],projection:3});s.components[0].at.offset[2]=1;assert.throws(()=>compileScene(s),/outside scene/);
});
test('new panel permission is restricted to its own host and does not grant unrelated overwrite authority',()=>{
 const s=study();s.components.push(shape('locked',[11,3,8],[6,4,1],'frame',{stage:'structure',allowOverwrite:['main']}));
 assert.throws(()=>compileScene(s),/Ownership conflict: panels -> locked/);
 s.components[1].allowOverwrite=['locked'];assert.doesNotThrow(()=>compileScene(s));
});
test('panel refinement stays inside saved source bounds and cannot silently enlarge the aperture',()=>{
 const s=study(),base=compileScene(s),replacement={...s.components[1],glazing:'blue_glass'};
 const scope={components:['panels'],protectedComponents:['main'],regions:base.designSources.componentBounds.panels,shared:'instance'};
 const patch={baseHash:base.manifest.assetHash,replaceComponents:[replacement],removeComponents:[],replaceModules:[],replaceInstances:[]};
 const revised=reviseScene(s,patch,scope,{baseCompiled:base});assert.equal(revised.revision.changedCells,24);
 assert.equal(state(revised.compiled,11,3,8),'minecraft:light_blue_stained_glass');
 replacement.size=[7,4];assert.throws(()=>reviseScene(s,patch,scope,{baseCompiled:base}),/protected|outside approved/i);
 assert.equal(base.manifest.cellsHash,compileScene(s).manifest.cellsHash);
});
