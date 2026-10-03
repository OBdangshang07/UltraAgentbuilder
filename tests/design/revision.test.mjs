import test from 'node:test';import assert from 'node:assert/strict';
import {compileScene} from '../../src/design/compiler.mjs';import {reviseScene,affectedComponents} from '../../src/design/revision.mjs';
import {basicScene,courtyard,shape,mass,at,once} from './fixtures.mjs';
import {hash} from '../../src/generation/compiler.mjs';
const scope=(components,protectedComponents=[],regions=[{origin:[0,0,0],size:[36,24,32]}])=>({components,protectedComponents,regions,shared:'instance'});
function replacement(scene,id,change){const c=structuredClone(scene.components.find(c=>c.id===id));change(c);return {baseHash:compileScene(scene).manifest.assetHash,replaceComponents:[c],removeComponents:[],replaceModules:[]};}
test('local scene branch preserves original and reports semantic differences',()=>{
 const scene=courtyard(),before=JSON.stringify(scene),patch=replacement(scene,'pergola',c=>c.material='wall');
 const r=reviseScene(scene,patch,scope(['pergola'],['main'],[{origin:[2,1,1],size:[10,5,5]}]));
 assert.equal(JSON.stringify(scene),before);assert.ok(r.revision.changedCells>0);assert.equal(r.revision.changedCells,r.revision.diff.changed);
});
test('stale hash, protected geometry and changes outside approved region are rejected',()=>{
 const scene=courtyard(),patch=replacement(scene,'pergola',c=>c.material='wall');
 assert.throws(()=>reviseScene(scene,{...patch,baseHash:'0'.repeat(64)},scope(['pergola'])),/Stale/);
 assert.throws(()=>reviseScene(scene,patch,scope(['pergola'],['pergola'])),/scope/);
 assert.throws(()=>reviseScene(scene,patch,scope(['pergola'],[],[{origin:[0,0,0],size:[1,1,1]}])),/outside approved/);
});
test('dependency closure may not silently expand the selected component',()=>{
 const s=basicScene();s.components=[shape('parent',[1,1,1],[2,2,2]),shape('child',[0,0,0],[1,1,1],'wall',{at:at([1,0,1],'parent','top')})];
 assert.deepEqual(affectedComponents(s,['parent']),['parent','child']);
 const p=replacement(s,'parent',c=>c.at.offset[0]++);assert.throws(()=>reviseScene(s,p,scope(['parent'])),/Dependency/);
 const r=reviseScene(s,p,scope(['parent','child']));assert.ok(r.revision.affected.includes('child'));
});
test('same material under a different role is not a geometry change',()=>{
 const s=basicScene();s.palette.push({role:'sameWall',material:'sandstone'});s.components=[shape('minimal',[1,1,1],[3,3,3],'wall')];
 const r=reviseScene(s,replacement(s,'minimal',c=>c.material='sameWall'),scope(['minimal']));assert.equal(r.revision.changedCells,0);
});
test('untrusted patch cannot change palette, bounds, budget or approved scope',()=>{
 const s=courtyard(),p=replacement(s,'pergola',c=>c.material='wall');
 for(const k of ['palette','bounds','scope','maxCalls'])assert.throws(()=>reviseScene(s,{...p,[k]:{}},scope(['pergola'])),/Invalid ScenePatch/);
});

function repeated(){
 const s=basicScene();s.constraints={interior:false,walkable:false,passages:[]};
 s.modules=[{id:'desk',parameters:[],size:[3,3,3],nodes:[{nodeId:'leg',op:'box',origin:[0,0,0],size:[1,2,1],material:'frame',thickness:1,axis:'x',repeat:once,points:[],blockState:null}]}];
 s.components=[{id:'desks',kind:'module',module:'desk',values:[],at:at([3,1,3]),rotation:0,mirror:false,repeat:{count:4,step:[6,0,0]},allowOverwrite:[]},{id:'other',kind:'module',module:'desk',values:[],at:at([3,1,14]),rotation:0,mirror:false,repeat:once,allowOverwrite:[]}];return s;
}
for(const index of [0,2,3])test(`single repeated instance ${index} forks privately and preserves siblings, shared consumers and original source`,()=>{
 const s=repeated(),before=JSON.stringify(s),base=compileScene(s),replacement=structuredClone(s.components[0]);replacement.at.offset[0]+=index*6;replacement.repeat=once;
 const module=structuredClone(s.modules[0]);module.nodes[0].material='wall';
 const p={baseHash:base.manifest.assetHash,replaceComponents:[],removeComponents:[],replaceModules:[],replaceInstances:[{component:'desks',index,replacement,module}]};
 const bounded={...scope(['desks'],['other'],[base.designSources.componentBounds.desks[index]]),instances:[{component:'desks',index}]};
 const r=reviseScene(s,p,bounded);assert.equal(JSON.stringify(s),before);assert.equal(r.revision.changedCells,2);assert.equal(r.scene.modules.length,2);assert.equal(r.scene.modules[0].nodes[0].material,'frame');
 assert.equal(r.scene.components.find(c=>c.id==='other').module,'desk');assert.equal(r.scene.components.find(c=>c.id==='desks').at.offset[0],3);assert.equal(r.revision.instanceForks[0].index,index);
 assert.equal(compileScene(r.scene).manifest.assetHash,r.compiled.manifest.assetHash);
});
test('single-instance scope forbids whole-array edits and a move over an unselected sibling',()=>{
 const s=repeated(),base=compileScene(s),replacement=structuredClone(s.components[0]);replacement.at.offset[0]=9;replacement.repeat=once;
 const bounded={...scope(['desks']),instances:[{component:'desks',index:2}]};
 assert.throws(()=>reviseScene(s,{baseHash:base.manifest.assetHash,replaceComponents:[replacement],removeComponents:[],replaceModules:[]},bounded),/selected repeats/);
 replacement.values=[];replacement.allowOverwrite=['desks'];const module=structuredClone(s.modules[0]);module.nodes[0].material='wall';
 assert.throws(()=>reviseScene(s,{baseHash:base.manifest.assetHash,replaceComponents:[],removeComponents:[],replaceModules:[],replaceInstances:[{component:'desks',index:2,replacement,module}]},bounded),/Unselected repeated/);
});
test('all shared consumers require explicit scope and update together only when approved',()=>{
 const s=repeated(),base=compileScene(s),m=structuredClone(s.modules[0]);m.nodes[0].material='wall';
 const patch={baseHash:base.manifest.assetHash,replaceComponents:[],removeComponents:[],replaceModules:[m]};
 assert.throws(()=>reviseScene(s,patch,{...scope(['desks']),shared:'all'}),/all-instances/);
 const revised=reviseScene(s,patch,{...scope(['desks','other']),shared:'all'});assert.equal(revised.revision.changedCells,10);
});
test('later-instance fork preserves a protected first-instance anchor',()=>{
 const s=repeated();s.components.push(shape('child',[0,0,0],[1,1,1],'wall',{at:at([0,0,0],'desks','top')}));
 const base=compileScene(s),replacement=structuredClone(s.components[0]);replacement.at.offset[0]=15;replacement.repeat=once;
 const p={baseHash:base.manifest.assetHash,replaceComponents:[],removeComponents:[],replaceModules:[],replaceInstances:[{component:'desks',index:2,replacement,module:null}]};
 const r=reviseScene(s,p,{...scope(['desks'],['child','other']),instances:[{component:'desks',index:2}]});assert.equal(r.revision.changedCells,0);
});
test('revision binds the persisted asset identity across diagnostic versions, never a freshly recomputed hash',()=>{
 const s=courtyard(),base=compileScene(s);base.manifest.scene.compiler='earlier-diagnostic-version';delete base.manifest.assetHash;base.manifest.assetHash=hash(base.manifest);
 const p=replacement(s,'pergola',c=>c.material='wall');p.baseHash=base.manifest.assetHash;
 assert.throws(()=>reviseScene(s,p,scope(['pergola'])),/Stale/);
 assert.ok(reviseScene(s,p,scope(['pergola']),{baseCompiled:base}).revision.changedCells>0);
 base.binary[0]=base.binary[0]^1;assert.throws(()=>reviseScene(s,p,scope(['pergola']),{baseCompiled:base}),/integrity/);
});
test('protected building shell permits bounded furniture edits in ordinary air, never cutting its wall',()=>{
 const s=basicScene();s.components=[mass('shell',[4,0,4],[20,12,20],[]),shape('desk',[8,1,8],[2,1,2],'frame')];
 const p=replacement(s,'desk',c=>c.size=[3,1,2]);assert.ok(reviseScene(s,p,scope(['desk'],['shell'])).revision.changedCells>0);
 p.replaceComponents[0].at.offset=[4,1,4];p.replaceComponents[0].allowOverwrite=['shell'];assert.throws(()=>reviseScene(s,p,scope(['desk'],['shell'])),/Protected component/);
});
