import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScene,lowerScene} from '../../src/design/compiler.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {reviseScene,affectedComponents} from '../../src/design/revision.mjs';
import {parseState} from '../../src/generation/block-states.mjs';
import {basicScene,mass,shape,at,once} from './fixtures.mjs';
import {profileMass,chamfer} from './profile-fixtures.mjs';

const state=(c,x,y,z)=>c.manifest.palette[c.cells[x+z*c.manifest.dimensions.width+y*c.manifest.dimensions.width*c.manifest.dimensions.length]];
const opening=(extra={})=>({u:3,width:2,height:2,door:'door',hinge:'left',open:false,...extra});
const boundary=(face,openings=[])=>({face,material:'wall',openings});
function study(profile=false){
 const s=basicScene('room-zone-study');s.constraints={interior:false,walkable:false,passages:[]};
 s.components=[profile?profileMass('body',[2,0,2],[28,20,28],chamfer(28,28,4),[5,10,15]):mass('body',[2,0,2],[28,20,28],[5,10,15]),
  {id:'room',kind:'roomZone',host:'body',at:at([5,0,5]),repeat:{count:3,step:[0,5,0]},size:[10,5,8],use:'room',purpose:'Meeting space chosen by the designer, not a predefined building',floorMaterial:'paving',boundaries:[boundary('north',[opening()]),boundary('east',[opening({u:2})]),boundary('south'),boundary('west')],allowOverwrite:[]}];
 return structuredClone(s);
}
for(const profile of [false,true])test(`room zones on ${profile?'polygonal':'rectangular'} floors retain actual partitions, doors and compact repeated finishes`,()=>{
 const s=study(profile),before=hash(s),c=compileScene(s);assert.equal(hash(s),before);
 assert.ok(c.spec.nodes.filter(n=>c.designSources.nodeSources[n.nodeId]?.component==='room').every(n=>n.repeat.count===3));
 assert.equal(c.designSources.roomZones.length,1);assert.equal(c.designSources.roomZones[0].repeat.count,3);
 for(const y of [0,5,10]){
  assert.equal(state(c,7,y,7),'minecraft:stone_bricks');assert.equal(state(c,7,y+1,7),'minecraft:air');
  assert.equal(state(c,5,y+2,7),'minecraft:sandstone');
  for(const [x,z,face] of [[8,5,'north'],[14,7,'east']]){
   const a=parseState(state(c,x,y+1,z)),b=parseState(state(c,x,y+2,z));assert.equal(a.id,'minecraft:oak_door');assert.equal(a.properties.facing,face);assert.equal(a.properties.hinge,'left');assert.deepEqual(b.properties,{...a.properties,half:'upper'});
  }
 }
 assert.deepEqual(c.designSources.componentBounds.room.map(b=>b.origin[1]),[0,5,10]);
});
test('open portals and deliberately absent boundaries do not add a door, ceiling or extra wall',()=>{
 const s=study();s.components[1].boundaries=[boundary('east',[opening({u:2,width:3,height:3,door:null})])];const c=compileScene(s);
 for(let z=7;z<10;z++)for(let y=1;y<=3;y++)assert.equal(state(c,14,y,z),'minecraft:air');
 assert.equal(state(c,14,4,8),'minecraft:sandstone');assert.equal(state(c,5,2,7),'minecraft:air');
 assert.ok(!c.cells.some(v=>c.manifest.palette[v].includes('_door[')));
});
test('room furniture may use ordinary clear air, but walls and explicit shafts remain protected',()=>{
 const s=study();s.components.push(shape('table',[7,2,7],[3,1,2],'frame'));assert.doesNotThrow(()=>compileScene(s));
 s.components.at(-1).at.offset=[5,2,7];assert.throws(()=>compileScene(s),/table -> room/);
 s.components.at(-1).at.offset=[7,2,7];s.components.splice(2,0,{id:'shaft',kind:'void',at:at([7,1,7]),size:[3,3,3],repeat:once,allowOverwrite:['room']});
 assert.throws(()=>compileScene(s),/table -> shaft/);
});
test('circulation clearances are preserved even when later furniture has overwrite permission',()=>{
 const s=study();s.components.push({id:'route',kind:'roomZone',host:'body',at:at([15,0,5]),repeat:once,size:[2,5,8],use:'circulation',purpose:'Connection to meeting-room doors',floorMaterial:'paving',boundaries:[],allowOverwrite:[]});
 assert.doesNotThrow(()=>compileScene(s));
 s.components.push(shape('wrongTable',[15,1,7],[2,1,2],'frame',{allowOverwrite:['route']}));
 assert.throws(()=>compileScene(s),/Circulation zone was obstructed: route -> wrongTable/);
 const view=compileScene(s,{diagnosticOnly:true});assert.equal(view.manifest.diagnosticOnly,true);assert.equal(state(view,15,1,7),'minecraft:spruce_planks');
 s.components.at(-1).allowOverwrite=[];assert.throws(()=>compileScene(s),/Ownership conflict: wrongTable -> route/);
});
test('strict navigation checks real links through open rooms, not their names',()=>{
 const s=study();s.components[0].levels=[];s.components[1].repeat=once;s.components[1].boundaries=[boundary('east',[opening({u:2,door:null})])];
 s.constraints={interior:true,walkable:true,passages:[{origin:[7,1,7],size:[1,2,1]},{origin:[16,1,7],size:[1,2,1]}]};
 assert.equal(compileScene(s,{navigationPolicy:'strict'}).manifest.quality.navigation,'verified');
 s.components[1].boundaries=[boundary('north'),boundary('south'),boundary('west'),boundary('east')];
 assert.throws(()=>compileScene(s,{navigationPolicy:'strict'}),/disconnect|reachable|interior/i);
});
for(const [name,edit] of [
 ['outside footprint',c=>c.at.offset=[2,0,2]],['not on a floor',c=>c.at.offset[1]=1],['through ceiling',c=>c.size[1]=6],['headroom',c=>c.size[1]=2],
 ['overlap repeats',c=>c.repeat.step=[0,4,0]],['last repeat outside',c=>c.repeat.count=5],['duplicate walls',c=>c.boundaries.push(boundary('north'))],
 ['opening corners',c=>c.boundaries[0].openings[0].u=0],['portal overlap',c=>c.boundaries[0].openings.push(opening())],['wide raw door',c=>c.boundaries[0].openings[0].width=3],
 ['tall raw door',c=>c.boundaries[0].openings[0].height=3],['door material',c=>c.boundaries[0].openings[0].door='wall'],['unknown finish',c=>c.floorMaterial='missing'],
 ['walled circulation',c=>c.use='circulation']
])test(`room zone refuses ${name} without changing bounds or silently re-planning`,()=>{
 const s=study(true);edit(s.components[1]);const before=hash(s);assert.throws(()=>compileScene(s));assert.equal(hash(s),before);
});
test('a polygonal recess is not an available room even inside the declared bounding rectangle',()=>{
 const s=study(true);s.components[0].points=[[0,0],[28,0],[28,10],[10,10],[10,28],[0,28]];s.components[1].at.offset=[15,0,15];
 assert.throws(()=>compileScene(s),/actual host interior/);
});
test('room partitions cannot cut a nested service core and reservations still forbid declared occupancy',()=>{
 const s=study();s.components.splice(1,0,mass('core',[6,0,6],[6,20,6],[5,10,15],{allowOverwrite:['body']}));assert.throws(()=>compileScene(s),/room -> core/);
 const a=study();a.reservations=[{id:'keepAir',at:at([5,1,7]),size:[1,2,1],allowedComponents:[]}];assert.throws(()=>compileScene(a),/Reserved space/);
});
test('revision retains room source dependencies and immutable wall/corridor boundaries',()=>{
 const s=study();s.components.push(shape('table',[7,2,7],[2,1,2],'frame'));const base=compileScene(s);
 const replacement={...s.components.at(-1),size:[3,1,2]},patch={baseHash:base.manifest.assetHash,replaceComponents:[replacement],removeComponents:[],replaceModules:[],replaceInstances:[]};
 const scope={components:['table'],protectedComponents:['room','body'],regions:[{origin:[5,0,5],size:[10,5,8]}],shared:'all'};
 assert.equal(reviseScene(s,patch,scope,{baseCompiled:base}).revision.changedCells,2);
 replacement.at=at([5,2,7]);replacement.allowOverwrite=['room'];assert.throws(()=>reviseScene(s,patch,scope,{baseCompiled:base}),/Protected component/);
 assert.deepEqual(affectedComponents(s,['body']),['body','room']);assert.deepEqual(lowerScene(s).dependencies.room,['body']);
});
test('a later repeated room can change its finish without repainting sibling floors',()=>{
 const s=study(),base=compileScene(s),replacement=structuredClone(s.components[1]);replacement.at.offset[1]=5;replacement.repeat=once;replacement.floorMaterial='white_terracotta';
 const patch={baseHash:base.manifest.assetHash,replaceComponents:[],removeComponents:[],replaceModules:[],replaceInstances:[{component:'room',index:1,replacement,module:null}]};
 const scope={components:['room'],protectedComponents:['body'],regions:[base.designSources.componentBounds.room[1]],shared:'instance',instances:[{component:'room',index:1}]};
 const revised=reviseScene(s,patch,scope,{baseCompiled:base});assert.equal(revised.revision.changedCells,80);assert.equal(state(revised.compiled,7,0,7),'minecraft:stone_bricks');assert.equal(state(revised.compiled,7,5,7),'minecraft:white_terracotta');assert.equal(state(revised.compiled,7,10,7),'minecraft:stone_bricks');
});
