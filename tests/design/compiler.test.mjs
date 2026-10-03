import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScene,lowerScene} from '../../src/design/compiler.mjs';
import {compileSpec,hash} from '../../src/generation/compiler.mjs';
import {exportCompiled} from '../../src/generation/export.mjs';
import {basicScene,courtyard,teahouse,commercial,highrise,shape,mass,facade,at,once} from './fixtures.mjs';
const state=(c,x,y,z)=>c.manifest.palette[c.cells[x+z*c.manifest.dimensions.width+y*c.manifest.dimensions.width*c.manifest.dimensions.length]];

test('canonical names of approved planks match aliases without accepting arbitrary block IDs',()=>{
 for(const wood of ['oak','spruce','dark_oak']){
  const a=basicScene();a.components=[shape('planks',[1,1,1],[2,2,2],wood)];
  const b=structuredClone(a);b.components[0].material=wood+'_planks';
  assert.deepEqual(compileScene(a).binary,compileScene(b).binary);
  b.palette[0].material=wood+'_planks';assert.doesNotThrow(()=>compileScene(b));
 }
 const s=basicScene();s.palette[0].material='minecraft:command_block';assert.throws(()=>compileScene(s),/invalid choice/);
 s.palette[0].material='command_block';assert.throws(()=>compileScene(s),/invalid choice/);
});

for(const fixture of [courtyard,teahouse,commercial,highrise])test(`${fixture.name}: deterministic independent composition, existing-kernel geometry and complete provenance`,()=>{
 const scene=fixture(),original=hash(scene),a=compileScene(scene),b=compileScene(scene);
 assert.equal(hash(scene),original);assert.equal(a.manifest.assetHash,b.manifest.assetHash);
 assert.deepEqual(a.binary,compileSpec(a.spec,{navigationPolicy:'review'}).binary);
 for(let i=0;i<a.cells.length;i++)if(a.cells[i]!==0)assert.ok(a.designSources.traceSources[a.sourceOwners[i]]?.component);
 assert.ok(a.manifest.setCount>1000);assert.ok(a.manifest.scene.expandedNodes<4096);
 assert.equal(a.scene.format,'SceneSpec');
});
test('224-block occupied high-rise preserves dimensions and compresses 1000+ windows without increasing kernel limits',()=>{
 const c=compileScene(highrise());let min=Infinity,max=-1;
 c.cells.forEach((v,i)=>{if(v>=2){const y=Math.floor(i/4096);min=Math.min(min,y);max=Math.max(max,y);}});
 assert.equal(max-min+1,224);assert.ok(c.spec.nodes.some(n=>n.repeat.count===43));
 assert.ok(c.manifest.scene.expandedNodes<1200);assert.equal(c.manifest.dimensions.height,240);
});
test('unknown data, cyclic/missing references and unbounded expansion are rejected, not executed',()=>{
 for(const edit of [s=>s.exec='shell command',s=>s.components[0].at.relativeTo='main',s=>s.components[0].at.relativeTo='missing',s=>s.components[0].repeat.count=99999,s=>s.bounds.width=999]){
  const s=courtyard();edit(s);assert.throws(()=>compileScene(s));
 }
});
test('relative anchors use half-open integer coordinates with explicit center rounding',()=>{
 const s=basicScene();s.components=[shape('base',[3,1,4],[5,3,7]),shape('top',[0,0,0],[1,1,1],'wall',{at:at([1,0,1],'base','top')}),shape('center',[0,0,0],[1,1,1],'wall',{at:at([0,5,0],'base','center')})];
 const c=lowerScene(s);assert.deepEqual(c.componentBounds.top[0].origin,[4,4,5]);assert.deepEqual(c.componentBounds.center[0].origin,[5,7,7]);
});
test('courtyard stays clear after mass phase irrespective of source order',()=>{
 const s=courtyard();s.components.unshift(s.components.splice(1,1)[0]);
 const c=compileScene(s);assert.equal(state(c,16,8,15),'minecraft:air');
});
test('cut permission is explicit and reserved courtyard cannot be refilled by unrelated decoration',()=>{
 const s=courtyard();s.components.find(c=>c.id==='court').allowOverwrite=[];assert.throws(()=>compileScene(s),/Ownership conflict/);
 const a=courtyard();a.reservations=[{id:'courtAir',at:at([9,1,6],'main'),size:[6,14,8],allowedComponents:[]}];
 a.components.push(shape('accidental',[16,5,15],[2,2,2],'wall',{allowOverwrite:['court']}));assert.throws(()=>compileScene(a),/Reserved space/);
});
for(const face of ['north','east','south','west'])test(`${face}: window actually cuts a thick wall and preserves an exterior frame/recess`,()=>{
 const s=basicScene();s.components=[mass('main',[8,1,8],[20,10,20],[],{thickness:2}),facade('windows','main',face,{count:[1,1],start:[3,2]})];
 const c=compileScene(s),points={north:[[12,4,8],[12,4,9],[11,3,7]],south:[[12,4,27],[12,4,26],[11,3,28]],west:[[8,4,12],[9,4,12],[7,3,11]],east:[[27,4,12],[26,4,12],[28,3,11]]}[face];
 assert.equal(state(c,...points[0]),'minecraft:air');assert.equal(state(c,...points[1]),'minecraft:glass');assert.equal(state(c,...points[2]),'minecraft:spruce_planks');
});
test('array exceptions preserve entry space and invalid margins are diagnosed, not silently cropped',()=>{
 const s=courtyard();s.components.find(c=>c.id==='front').exclude=[];assert.throws(()=>compileScene(s),/Ownership conflict/);
 const a=courtyard();a.components.find(c=>c.id==='front').start[0]=23;assert.throws(()=>compileScene(a),/margins/);
});
test('stair engineering refuses insufficient space and cannot cut a locked exterior',()=>{
 const s=courtyard();s.components.find(c=>c.id==='stair').size[0]=3;assert.throws(()=>compileScene(s),/insufficient staircase footprint/);
 const a=courtyard();a.components.find(c=>c.id==='stair').at.offset[0]=0;assert.throws(()=>compileScene(a),/alter exterior/);
});
test('stairs reach the intended slab and keep two cells of headroom',()=>{
 const c=compileScene(courtyard());
 // Rise 7: 4-step outward flight, 3-step return, final landing x=1 at floor+7.
 assert.equal(state(c,9,8,14),'minecraft:oak_planks');assert.equal(state(c,9,9,14),'minecraft:air');assert.equal(state(c,9,10,14),'minecraft:air');
});
test('data-only parameterized modules rotate/mirror special states with typed finite values',()=>{
 const s=basicScene();s.constraints={interior:false,walkable:false,passages:[]};
 s.modules=[{id:'beam',parameters:[{name:'height',type:'integer',minimum:2,maximum:8,default:3},{name:'wood',type:'material',minimum:1,maximum:1,default:'beam'}],size:[2,{parameter:'height',offset:0},2],nodes:[{nodeId:'post',op:'box',origin:[0,0,0],size:[1,{parameter:'height',offset:0},1],material:'$wood',thickness:1,axis:'x',repeat:once,points:[],blockState:null}]}];
 s.components=[{id:'columns',kind:'module',module:'beam',values:[{name:'height',value:5}],at:at([2,1,2]),rotation:1,mirror:true,repeat:{count:3,step:[5,0,0]},allowOverwrite:[]}];
 const c=compileScene(s);assert.equal(c.manifest.setCount,15);assert.equal(state(c,3,5,3),'minecraft:stripped_oak_log[axis=y]');
 s.components[0].values[0].value=100;assert.throws(()=>compileScene(s),/parameter/);
});
test('design advisories never force glass, complexity, materials or ornamental count',()=>{
 const s=basicScene();s.components=[shape('minimal',[5,1,5],[20,10,20],'wall')];s.featureBindings=[{feature:'Unbuilt promised wing',components:['missing']}];
 const c=compileScene(s);assert.equal(c.manifest.scene.diagnostics[0].severity,'design');assert.equal(c.manifest.setCount,4000);
});
test('all ownership conflicts are reported together; diagnostic views cannot be exported',async()=>{
 const s=basicScene();s.components=[shape('a',[1,1,1],[3,3,3],'wall'),shape('b',[2,1,1],[3,3,3],'frame'),shape('c',[3,1,1],[3,3,3],'roof')];
 assert.throws(()=>compileScene(s),e=>e.designConflicts.length===2&&e.message.includes('b -> a')&&e.message.includes('c -> b'));
 const c=compileScene(s,{diagnosticOnly:true});assert.equal(c.manifest.diagnosticOnly,true);await assert.rejects(exportCompiled(c,'unused'),/Diagnostic-only/);
});
test('custom module lamp parameters survive legacy row helpers; disjoint repeats remain compact',()=>{
 const s=basicScene();s.bounds.height=240;s.modules=[{id:'light',parameters:[{name:'lamp',type:'material',minimum:1,maximum:1,default:'sea_lantern'}],size:[2,1,2],nodes:[{nodeId:'lamp',op:'lampRow',origin:[0,0,0],size:[2,1,2],material:'$lamp',thickness:1,axis:'x',points:[],repeat:once,blockState:null}]}];
 s.palette=s.palette.filter(p=>p.role!=='lamp');s.components=[{id:'floorLights',kind:'module',at:at([2,1,2]),module:'light',values:[],rotation:0,mirror:false,repeat:{count:56,step:[0,4,0]},allowOverwrite:[]}];
 const c=compileScene(s);assert.equal(c.manifest.scene.expandedNodes,1);assert.equal(c.manifest.setCount,224);assert.equal(c.designSources.componentBounds.floorLights.length,56);assert.equal(state(c,2,221,2),'minecraft:sea_lantern');
});

test('negative-space features validate actual clear masks, including later intentional fill and keep',()=>{
 const s=basicScene();s.components=[mass('main',[4,0,4],[20,12,20],[]),{id:'shaft',kind:'void',at:at([8,1,8]),size:[3,10,3],repeat:once,allowOverwrite:['main']}];
 s.featureBindings=[{feature:'Elevator shaft is empty',components:['shaft']}];
 const c=compileScene(s);assert.equal(c.designSources.negativeSpace.shaft.clear,90);assert.ok(!c.manifest.scene.diagnostics.some(d=>d.code==='feature-not-visible'));
 s.components.push(shape('plug',[8,2,8],[3,1,3],'wall',{allowOverwrite:['shaft']}));
 const filled=compileScene(s);assert.equal(filled.designSources.negativeSpace.shaft.set,9);assert.ok(filled.manifest.scene.diagnostics.some(d=>d.code==='negative-space-obstructed'));
});
for(const size of [[1,2,1],[2,3,10],[10,2,2],[3,3,3]])test(`planter ${size} fits its declared footprint without an arbitrary three-block minimum`,()=>{
 const s=basicScene();s.constraints={interior:false,walkable:false,passages:[]};s.components=[{id:'ledgePlanter',kind:'planter',at:at([2,1,2]),size,material:'wall',foliage:'foliage',repeat:once,allowOverwrite:[]}];
 const c=compileScene(s),ix=size[0]>=3?1:0,iz=size[2]>=3?1:0;
 assert.equal(c.manifest.setCount,size[0]*size[2]+(size[0]-2*ix)*(size[1]-1)*(size[2]-2*iz));assert.equal(state(c,2+ix,2,2+iz),'minecraft:oak_leaves[persistent=true]');
 assert.equal(c.cells[1+2*s.bounds.width+2*s.bounds.width*s.bounds.length],0);
});
test('ordinary room air is furnishable without cut permission, but solids and explicit shafts remain protected',()=>{
 const s=basicScene();s.components=[mass('room',[4,0,4],[20,12,20],[]),shape('desk',[8,1,8],[2,1,2],'frame')];assert.doesNotThrow(()=>compileScene(s));
 s.components[1].at.offset=[4,1,4];assert.throws(()=>compileScene(s),/Ownership conflict/);
 s.components[1].at.offset=[8,1,8];s.components.splice(1,0,{id:'shaft',kind:'void',at:at([8,1,8]),size:[3,10,3],repeat:once,allowOverwrite:['room']});assert.throws(()=>compileScene(s),/Ownership conflict/);
 s.components[2].allowOverwrite=['shaft'];s.reservations=[{id:'shaftReservation',at:at([8,1,8]),size:[3,10,3],allowedComponents:[]}];assert.throws(()=>compileScene(s),/Reserved space/);
});
test('reservation feature references check actual air, reject ambiguous IDs and bound inspection work',()=>{
 const s=basicScene();s.components=[mass('room',[4,0,4],[20,12,20],[])];s.reservations=[{id:'liftReservation',at:at([8,1,8]),size:[3,10,3],allowedComponents:[]}];s.featureBindings=[{feature:'Elevator space',components:['liftReservation']}];
 const c=compileScene(s);assert.equal(c.designSources.negativeSpace.liftReservation.clear,90);assert.ok(!c.manifest.scene.diagnostics.some(d=>d.code==='feature-not-visible'));
 s.reservations[0].id='room';assert.throws(()=>compileScene(s),/reservation ID/);
 s.reservations[0].id='liftReservation';s.bounds={width:256,height:128,length:256};s.reservations=Array.from({length:5},(_,i)=>({id:'r'+i,at:at([0,0,0]),size:[256,128,256],allowedComponents:[]}));assert.throws(()=>lowerScene(s),/inspection work quota/);
});
test('enclosed stacked switchbacks connect the common landing to an east-side door on every floor',()=>{
 const s=basicScene();s.components=[mass('main',[1,0,1],[16,20,14],[5,10,15]),mass('core',[4,0,4],[8,19,7],[5,10,15],{allowOverwrite:['main'],roof:false}),
 {id:'doors',kind:'void',at:at([11,1,7]),size:[1,3,2],repeat:{count:4,step:[0,5,0]},allowOverwrite:['core','main']},
 {id:'flights',kind:'stairs',at:at([5,0,5]),size:[6,8,5],host:'core',style:'switchback',rotation:2,width:2,rise:5,material:'floor',repeat:{count:3,step:[0,5,0]},allowOverwrite:['main']}];
 s.constraints={interior:true,walkable:true,passages:[0,5,10,15].map(y=>({origin:[2,y+1,2],size:[1,2,1]}))};
 const c=compileScene(s,{navigationPolicy:'strict'});assert.equal(c.manifest.quality.navigation,'verified');
 assert.ok(c.designSources.stairAccess.every(a=>a.status==='local-opening-found'));
 assert.ok(!c.manifest.scene.diagnostics.some(d=>d.code==='stair-floor-access-unverified'));
 for(const y of [5,10,15])assert.equal(state(c,10,y,7),'minecraft:oak_planks');
 // Wrong-facing flights still compile for preview but must not be described as connected.
 s.components.at(-1).rotation=0;const wrong=compileScene(s);
 assert.ok(wrong.manifest.scene.diagnostics.some(d=>d.code==='stair-floor-access-unverified'&&d.face==='west'));
 assert.ok(wrong.designSources.stairAccess.some(a=>a.status==='unverified'));
 assert.deepEqual(wrong.binary,compileSpec(wrong.spec,{navigationPolicy:'review'}).binary);
});
