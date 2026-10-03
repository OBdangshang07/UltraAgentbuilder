import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScene,lowerScene} from '../../src/design/compiler.mjs';
import {reviseScene,affectedComponents} from '../../src/design/revision.mjs';
import {parseState} from '../../src/generation/block-states.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {basicScene,at,once,mass,shape} from './fixtures.mjs';

const state=(c,p)=>c.manifest.palette[c.cells[p[0]+p[2]*c.manifest.dimensions.width+p[1]*c.manifest.dimensions.width*c.manifest.dimensions.length]];
function study(face='north',width=2){
 const s=basicScene('explicit-doorway');s.constraints={interior:false,walkable:false,passages:[]};
 const size=face==='north'||face==='south'?[width,2,2]:[2,2,width];
 s.components=[mass('room',[2,0,2],[20,18,20],[5,10]),
  {id:'opening',kind:'void',at:at([8,1,8]),size,repeat:{count:3,step:[0,5,0]},allowOverwrite:['room']},
  {id:'doors',kind:'doorway',host:'opening',at:at([0,0,0],'opening'),repeat:{count:3,step:[0,5,0]},face,width,door:'door',hinge:'left',open:false,allowOverwrite:[]}];
 return s;
}
for(const face of ['north','east','south','west'])for(const width of [1,2])test(`explicit ${face} doorway width ${width} retains paired halves, support and repeated placement`,()=>{
 const s=study(face,width),before=hash(s),c=compileScene(s);assert.equal(hash(s),before);
 for(const y of [1,6,11])for(let u=0;u<width;u++){
  const p=face==='north'||face==='south'?[8+u,y,8]:[8,y,8+u];
  const a=parseState(state(c,p)),b=parseState(state(c,[p[0],y+1,p[2]]));
  assert.equal(a.id,'minecraft:oak_door');assert.equal(a.properties.facing,face);assert.equal(a.properties.hinge,u===1?'right':'left');
  assert.deepEqual(b.properties,{...a.properties,half:'upper'});assert.equal(state(c,[p[0],y-1,p[2]]),'minecraft:oak_planks');
 }
 assert.deepEqual(c.designSources.dependencies.doors,['opening']);
 assert.equal(c.designSources.surviving.doors,width*2*3);
 assert.deepEqual(c.designSources.componentBounds.doors.map(b=>b.origin[1]),[1,6,11]);
 // Beyond the one-cell door plane remains exactly the host's air, not a new frame.
 assert.equal(state(c,face==='north'||face==='south'?[8,1,9]:[9,1,8]),'minecraft:air');
});
test('doorway cannot borrow an unrelated owner or erase solids even with explicit overwrite permissions',()=>{
 for(const op of ['solid','air']){
  const s=study();const other=shape('other',[8,1,8],[2,2,1],'frame');
  if(op==='air'){s.modules=[{id:'airTemplate',parameters:[],size:[2,2,1],nodes:[{nodeId:'clear',op:'clear',origin:[0,0,0],size:[2,2,1],material:'wall',thickness:1,axis:'x',points:[],repeat:once,blockState:null}]}];s.components.splice(2,0,{id:'other',kind:'module',module:'airTemplate',at:at([8,1,8]),values:[],rotation:0,mirror:false,repeat:once,allowOverwrite:['opening']});}
  else{s.components.splice(2,0,{...other,allowOverwrite:['opening']});}
  s.components.at(-1).allowOverwrite=['other'];
  assert.throws(()=>compileScene(s),/Opening is not host-owned clear air: doors -> opening/);
  assert.equal(compileScene(s,{diagnosticOnly:true}).manifest.diagnosticOnly,true);
 }
});
test('reservations independently prohibit filling an opening and require the specific doorway ID',()=>{
 const s=study();s.reservations=[{id:'protectedShaft',at:at([8,1,8]),size:[2,2,2],allowedComponents:[]}];
 assert.throws(()=>compileScene(s),/Reserved space: protectedShaft -> doors/);
 s.reservations[0].allowedComponents=['doors'];assert.doesNotThrow(()=>compileScene(s));
});
test('missing support is not filled; review and strict navigation keep their existing distinction',()=>{
 const s=study();s.components=s.components.slice(1);s.components[0].allowOverwrite=[];const c=compileScene(s);
 assert.equal(state(c,[8,0,8]),'@keep');
 assert.throws(()=>compileScene(s,{navigationPolicy:'strict'}),/support/i);
});
test('bad host, fit, material, repeats and schema fail without enlarging or changing the source',()=>{
 for(const edit of [
  s=>s.components[2].host='room',s=>s.components[2].host='missing',
  s=>s.components[2].width=3,s=>s.components[2].at.offset=[1,0,0],
  s=>s.components[2].repeat.count=4,s=>s.components[2].door='wall',
  s=>s.components[2].door='unknown_door',s=>s.components[2].size=[2,2,1],
  s=>s.components[2].at.relativeTo='doors'
 ]){const s=study();edit(s);const before=hash(s);assert.throws(()=>compileScene(s));assert.equal(hash(s),before);}
});
test('explicit opening binding does not retroactively permit old raw-module door writes',()=>{
 const s=study();s.components.pop();
 s.modules=[{id:'legacyDoors',parameters:[],size:[1,2,1],nodes:[{nodeId:'raw',op:'door',origin:[0,0,0],size:[1,2,1],material:'door',axis:'x',thickness:1,points:[],repeat:once,blockState:null}]}];
 s.components.push({id:'rawDoors',kind:'module',module:'legacyDoors',values:[],rotation:0,mirror:false,at:at([8,1,8]),repeat:once,allowOverwrite:[]});
 assert.throws(()=>compileScene(s),/Ownership conflict: rawDoors -> opening/);
});
test('local doorway revision uses a saved base, preserves unselected floors and respects protected owners',()=>{
 const s=study(),base=compileScene(s),replacement={...s.components[2],open:true};
 const patch={baseHash:base.manifest.assetHash,replaceComponents:[replacement],removeComponents:[],replaceModules:[],replaceInstances:[]};
 const scope={components:['doors'],protectedComponents:['room','opening'],regions:base.designSources.componentBounds.doors,shared:'all'};
 assert.equal(reviseScene(s,patch,scope,{baseCompiled:base}).revision.changedCells,12);
 const narrow={...scope,regions:[scope.regions[0]]};assert.throws(()=>reviseScene(s,patch,narrow,{baseCompiled:base}),/outside approved region/);
 const protect={...scope,protectedComponents:['doors']};assert.throws(()=>reviseScene(s,patch,protect,{baseCompiled:base}),/outside scope/);
 assert.deepEqual(affectedComponents(s,['opening']),['opening','doors']);
 assert.deepEqual(lowerScene(s).dependencies.doors,['opening']);
 assert.equal(base.manifest.cellsHash,compileScene(s).manifest.cellsHash);
});
test('a single selected doorway floor forks without changing any sibling door or host void',()=>{
 const s=study(),base=compileScene(s),replacement=structuredClone(s.components[2]);
 replacement.at.offset=[0,5,0];replacement.repeat=once;replacement.open=true;
 const patch={baseHash:base.manifest.assetHash,replaceComponents:[],removeComponents:[],replaceModules:[],replaceInstances:[{component:'doors',index:1,replacement,module:null}]};
 const scope={components:['doors'],protectedComponents:['room','opening'],regions:[base.designSources.componentBounds.doors[1]],shared:'instance',instances:[{component:'doors',index:1}]};
 const revised=reviseScene(s,patch,scope,{baseCompiled:base});assert.equal(revised.revision.changedCells,4);
 for(const y of [1,11])assert.equal(state(revised.compiled,[8,y,8]),state(base,[8,y,8]));
 assert.match(state(revised.compiled,[8,6,8]),/open=true/);
});
test('right first-leaf hinge is retained, including opposite hinge for a double doorway',()=>{
 for(const width of [1,2]){const s=study('north',width);s.components[2].hinge='right';const c=compileScene(s);
 assert.equal(parseState(state(c,[8,1,8])).properties.hinge,'right');
 if(width===2)assert.equal(parseState(state(c,[9,1,8])).properties.hinge,'left');}
});
