import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScene} from '../../src/design/compiler.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {parseState} from '../../src/generation/block-states.mjs';
import {validateRoomZone,emitRoomZone} from '../../src/design/room-zone.mjs';
import {basicScene,mass,shape,at,once} from './fixtures.mjs';
import {storeyRoom} from './floor-components-fixtures.mjs';

const wall=(face,openings=[])=>({face,material:'wall',openings});
const portal=(extra={})=>({u:1,width:1,height:2,door:null,hinge:'left',open:true,...extra});
function fixture(kind,footprint,faces,withDoor=false){
 const s=basicScene('boundary-clearance');s.constraints={interior:false,walkable:false,passages:[]};
 const boundaries=faces.map(face=>wall(face,withDoor&&face==='west'?[portal({door:'door'})]:[]));
 const room=kind==='storeyRoom'?storeyRoom('service','body',{offset:[2,2],footprint,floors:{source:'body',first:0,count:3},boundaries})
  :{id:'service',kind:'roomZone',host:'body',at:at([4,0,4]),size:[footprint[0],5,footprint[1]],repeat:once,
   use:'room',purpose:'Synthetic asymmetric partition case',floorMaterial:'floor',boundaries,allowOverwrite:[]};
 s.components=[mass('body',[2,0,2],[24,20,24],[5,10,15]),room];return s;
}
const cell=(bundle,x,y,z)=>bundle.manifest.palette[bundle.cells[x+z*bundle.manifest.dimensions.width+y*bundle.manifest.dimensions.width*bundle.manifest.dimensions.length]];

test('a three-sided 2x4 room retains a real 1x2 interior without resizing or removing partitions',()=>{
 const s=fixture('roomZone',[2,4],['north','south','west']),before=hash(s),c=compileScene(s);
 assert.equal(hash(s),before);assert.deepEqual(c.scene.components[1].size,[2,5,4]);
 for(let y=1;y<5;y++)for(let z=5;z<7;z++)assert.equal(cell(c,5,y,z),'minecraft:air');
 for(let y=1;y<5;y++){
  for(const x of [4,5])for(const z of [4,7])assert.equal(cell(c,x,y,z),'minecraft:sandstone');
  for(let z=4;z<8;z++)assert.equal(cell(c,4,y,z),'minecraft:sandstone');
 }
 // Independent ordinary boxes encode the same specified wall geometry. Their
 // explicit mutual permissions are test data, not a production room repair.
 const manual=structuredClone(s);manual.components.splice(1,1,
  shape('northWall',[4,1,4],[2,4,1],'wall'),
  shape('southWall',[4,1,7],[2,4,1],'wall'),
  shape('westWall',[4,1,4],[1,4,4],'wall',{allowOverwrite:['northWall','southWall']}));
 assert.deepEqual(c.binary,compileScene(manual).binary);
});

test('floor-derived narrow rooms retain every partition, paired door and actual floor',()=>{
 const s=fixture('storeyRoom',[2,4],['north','south','west'],true),before=hash(s),c=compileScene(s);
 for(const floor of [0,5,10]){
  for(const [y,half] of [[floor+1,'lower'],[floor+2,'upper']]){
   const d=parseState(cell(c,4,y,5));assert.equal(d.id,'minecraft:oak_door');
   assert.deepEqual(d.properties,{facing:'west',half,hinge:'left',open:'true',powered:'false'});
  }
  assert.equal(cell(c,4,floor,5),'minecraft:oak_planks');assert.equal(cell(c,5,floor+1,5),'minecraft:air');
 }
 assert.equal(hash(s),before);assert.deepEqual(c.scene.components[1].footprint,[2,4]);
 assert.equal(c.designSources.componentBounds.service.length,3);
});

test('strict navigation follows the existing side opening into the actual narrow interior',()=>{
 const s=fixture('roomZone',[2,4],['north','south','west']);s.components[0].levels=[];
 s.components[1].boundaries[2].openings=[portal()];
 s.constraints={interior:true,walkable:true,passages:[{origin:[3,1,5],size:[1,2,1]},{origin:[5,1,5],size:[1,2,1]}]};
 assert.equal(compileScene(s,{navigationPolicy:'strict'}).manifest.quality.navigation,'verified');
 const blocked=structuredClone(s);blocked.components[1].boundaries.push(wall('east'));blocked.components[1].size[0]=3;
 blocked.components[1].boundaries[2].openings=[];
 assert.throws(()=>compileScene(blocked,{navigationPolicy:'strict'}),/disconnect|reachable|interior/i);
});

// Exhaust all declared-face sets and small footprints against independently
// counted emitted cells. This is geometry validation, not an architectural
// minimum-size policy or evidence that a tiny room suits its intended use.
const cardinal=['north','east','south','west'];
for(let mask=0;mask<16;mask++)test(`boundary subset ${mask} agrees with every emitted small-footprint cell`,()=>{
 const faces=cardinal.filter((_,i)=>mask&(1<<i));
 for(let w=1;w<=4;w++)for(let d=1;d<=4;d++){
  const s=fixture('roomZone',[w,d],faces),c=s.components[1],host=s.components[0];
  const cells=new Map(),write=(origin,size,material)=>{
   for(let y=origin[1];y<origin[1]+size[1];y++)for(let z=origin[2];z<origin[2]+size[2];z++)for(let x=origin[0];x<origin[0]+size[0];x++)cells.set(`${x},${y},${z}`,material);
  };
  emitRoomZone(c,{box:write,floor:write,clear:(p,s)=>write(p,s,'air'),door:()=>assert.fail('No openings in this exhaustive fixture')});
  let interior=0;
  for(let z=0;z<d;z++)for(let x=0;x<w;x++){
   const isWall=faces.some(face=>face==='north'?z===0:face==='south'?z===d-1:face==='west'?x===0:x===w-1);
   for(let y=1;y<5;y++)assert.equal(cells.get(`${x},${y},${z}`),isWall?'wall':'air');
   assert.equal(cells.get(`${x},0,${z}`),'floor');if(!isWall)interior++;
  }
  const before=hash(s),check=()=>validateRoomZone(c,host,{origin:[2,0,2],size:host.size},[4,0,4]);
  if(interior)assert.doesNotThrow(check);else assert.throws(check,/partitioned room needs interior width\/depth/);
  assert.equal(hash(s),before);
 }
 const minimum=[1+Number(faces.includes('west'))+Number(faces.includes('east')),1+Number(faces.includes('north'))+Number(faces.includes('south'))];
 for(const kind of ['roomZone','storeyRoom'])assert.doesNotThrow(()=>compileScene(fixture(kind,minimum,faces)));
});

for(const kind of ['roomZone','storeyRoom'])test(`${kind} narrow validity grants no host, floor, owner or reservation bypass`,()=>{
 const original=fixture(kind,[2,4],['north','south','west']);
 const outside=structuredClone(original);
 if(kind==='roomZone')outside.components[1].at.offset=[2,0,4];else outside.components[1].offset=[0,2];
 assert.throws(()=>compileScene(outside),/actual host interior/);
 const floor=structuredClone(original);
 if(kind==='roomZone')floor.components[1].at.offset[1]=1;
 else {floor.components[1].floors.count=1;floor.components[1].ceilingInset=3;}
 assert.throws(()=>compileScene(floor),/floor|two air cells/);
 const intruder=structuredClone(original);intruder.components.push(shape('intruder',[4,1,5],[1,1,1]));
 assert.throws(()=>compileScene(intruder),/intruder -> service/);
 const reserved=structuredClone(original);reserved.reservations=[{id:'retainedWall',at:at([4,1,5]),size:[1,2,1],allowedComponents:[]}];
 assert.throws(()=>compileScene(reserved),/Reserved space/);
 assert.equal(hash(original),hash(fixture(kind,[2,4],['north','south','west'])));
});

test('opposite walls with no remaining room interior still reject before construction',()=>{
 for(const kind of ['roomZone','storeyRoom'])for(const [footprint,faces] of [
  [[2,4],['east','west']],[[4,2],['north','south']],[[1,4],['west']],[[4,1],['north']]
 ]){const s=fixture(kind,footprint,faces),before=hash(s);assert.throws(()=>compileScene(s),/partitioned room needs interior width\/depth/);assert.equal(hash(s),before);}
});
