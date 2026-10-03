import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {compileScene} from '../../src/design/compiler.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {parseState} from '../../src/generation/block-states.mjs';
import {basicScene,at,once} from './fixtures.mjs';

const node=(nodeId,op,origin,size,material,blockState=null)=>({nodeId,op,origin,size,material,blockState,axis:'x',thickness:1,repeat:once,points:[]});
function doors(facing='north',rotation=0,mirror=false){
 const scene=basicScene('module-double-door');scene.constraints={interior:false,walkable:false,passages:[]};
 const state={facing,half:null,hinge:'left',open:false,shape:null,axis:null,type:null};
 scene.modules=[{id:'core_doors',size:[4,3,4],parameters:[],nodes:[
  node('support','box',[0,0,0],[4,1,4],'floor'),
  node('door_a','door',[1,1,1],[1,2,1],'door',state),
  node('door_b','door',facing==='north'||facing==='south'?[2,1,1]:[1,1,2],[1,2,1],'door',{...state,hinge:'right'})
 ]}];
 scene.components=[{id:'core_doors_tower',kind:'module',module:'core_doors',at:at([4,0,4]),values:[],rotation,mirror,repeat:{count:3,step:[0,5,0]},allowOverwrite:[]}];
 return scene;
}

test('module double doors retain both halves, opposite hinges and support through every facing/transform/repeat',()=>{
 for(const facing of ['north','east','south','west'])for(let rotation=0;rotation<4;rotation++)for(const mirror of [false,true]){
  const scene=doors(facing,rotation,mirror),before=hash(scene),compiled=compileScene(scene),plane=scene.bounds.width*scene.bounds.length;
  assert.equal(hash(scene),before);assert.equal(compiled.manifest.setCount,60);
  const lower=[];
  compiled.cells.forEach((value,i)=>{
   const text=compiled.manifest.palette[value];
   if(!text.includes('_door[')||!text.includes('half=lower'))return;
   const a=parseState(text),b=parseState(compiled.manifest.palette[compiled.cells[i+plane]]);
   assert.equal(a.id,'minecraft:oak_door');assert.deepEqual(b.properties,{...a.properties,half:'upper'});
   assert.ok(compiled.cells[i-plane]>=2);lower.push({y:Math.floor(i/plane),properties:a.properties});
  });
  assert.equal(lower.length,6);
  for(const y of [1,6,11]){
   const pair=lower.filter(d=>d.y===y);assert.equal(pair.length,2);
   assert.deepEqual(pair.map(d=>d.properties.hinge).sort(),['left','right']);
   assert.equal(pair[0].properties.facing,pair[1].properties.facing);
  }
 }
});

for(const [name,edit,expected] of [
 ['invalid double-width node',n=>n.size=[2,2,1],/door component size must be \[1,2,1\]/],
 ['undefined material role',n=>n.material='door_wd',/Unknown design material: door_wd/],
 ['slab type on a door',n=>n.blockState.type='double',/oak_door does not support type/],
 ['non-door material',n=>n.material='wall',/door requires a door material/],
 ['unknown material parameter',n=>n.material='$missing',/Unknown material parameter/],
 ['out of module bounds',n=>n.origin=[4,1,1],/outside scene or invalid size/]
])test(`module diagnostics identify component/template/node without repairing ${name}`,()=>{
 const scene=doors();edit(scene.modules[0].nodes[1]);const before=hash(scene);
 for(const diagnosticOnly of [false,true])assert.throws(()=>compileScene(scene,{diagnosticOnly}),error=>{
  assert.match(error.message,/core_doors_tower \/ module core_doors \/ node door_a:/);
  assert.match(error.message,expected);assert.match(error.cause.message,expected);return true;
 });
 assert.equal(hash(scene),before);
});

test('Scene designer receives distinct hosted-entry/raw-door and slab-state rules',async()=>{
 const rules=await fs.readFile(new URL('../../prompts/scene-v1.md',import.meta.url),'utf8');
 assert.match(rules,/exactly size=\[1,2,1\]/);assert.match(rules,/TWO adjacent door nodes/);
 assert.match(rules,/type=null, NOT type=double/);assert.match(rules,/Names used in other examples are not implicit roles/);
});
