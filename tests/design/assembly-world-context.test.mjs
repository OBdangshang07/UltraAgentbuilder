import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScene} from '../../src/design/compiler.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {createContextSnapshot} from '../../src/world/context-snapshot.mjs';
import {regionCells,selectionChunks} from '../../contracts/world-selection.mjs';
import {prepareAssemblyWorldContext,assemblyWorldContextData,compileAssemblyWorldPatch} from '../../src/world/assembly-context.mjs';
import {basicScene,shape,once,at} from './fixtures.mjs';

function snapshot({unknown=false,protectedCell=false}={}) {
  const selection={format:'WorldSelection',version:1,world:{worldId:'joint_synthetic',dimension:'minecraft:overworld',minY:-64,maxY:320},revision:2,
    context:{min:[-5,-41,-5],max:[0,-36,0]},edit:{min:[-4,-40,-4],max:[-1,-37,-1]},
    protected:protectedCell?[{min:[-4,-40,-4],max:[-3,-39,-3]}]:[]};
  return createContextSnapshot(selection,{fence:{start:3,end:3},chunks:selectionChunks(selection).map(c=>({x:c.x,z:c.z,
    coverage:unknown?'unknown':'known',palette:unknown?[]:[{state:'minecraft:stone',blockEntity:false}],runs:unknown?[]:[[0,regionCells(c.region)]]}))});
}
function compiled() {
  const scene=basicScene('joint-mask-fixture');scene.bounds={width:3,height:3,length:3};scene.constraints={interior:false,walkable:false,passages:[]};
  scene.components=[shape('added',[0,0,0],[1,1,1],'glass'),{id:'removed',kind:'void',at:at([1,0,0]),size:[1,1,1],repeat:once,allowOverwrite:[]}];
  return compileScene(scene);
}

test('joint native conversion preserves explicit clear/set and omitted KEEP at original negative world origin',()=>{
  const source=snapshot(),context=prepareAssemblyWorldContext(source),native=compiled(),result=compileAssemblyWorldPatch(context,native);
  assert.deepEqual(result.patch.writes.map(w=>[w.position,w.action,w.before,w.after]),[
    [[-4,-40,-4],'set','minecraft:stone','minecraft:glass'],[[-3,-40,-4],'clear','minecraft:stone','minecraft:air']]);
  assert.equal(result.patch.summary.writes,2);assert.equal(result.patch.summary.omittedCells,'keep');
  assert.equal(result.binding.assetHash,native.manifest.assetHash);assert.equal(result.binding.cellsHash,hash(native.binary));
  assert.equal(result.binding.serverBaselineVerified,false);assert.equal(result.binding.canAuthorizePlacement,false);assert.equal(result.binding.worldWrites,0);
});
test('serialized context cannot substitute for original checked world evidence',()=>{
  const context=prepareAssemblyWorldContext(snapshot());
  assert.throws(()=>assemblyWorldContextData(structuredClone(context)),/opaque/);
  const data=assemblyWorldContextData(context);data.origin[0]=999;
  assert.equal(assemblyWorldContextData(context).origin[0],-4);
});
test('native proposal cannot edit protected or UNKNOWN captured cells',()=>{
  assert.throws(()=>compileAssemblyWorldPatch(prepareAssemblyWorldContext(snapshot({protectedCell:true})),compiled()),/protected/);
  assert.throws(()=>compileAssemblyWorldPatch(prepareAssemblyWorldContext(snapshot({unknown:true})),compiled()),/UNKNOWN/);
});
test('diagnostic assets and tampered cell bytes never become world patches',()=>{
  const context=prepareAssemblyWorldContext(snapshot()),native=compiled();
  assert.throws(()=>compileAssemblyWorldPatch(context,{...native,manifest:{...native.manifest,diagnosticOnly:true}}),/diagnostic/);
  const bytes=Buffer.from(native.binary);bytes[0]^=1;
  assert.throws(()=>compileAssemblyWorldPatch(context,{...native,binary:bytes}),/eligible/);
});
test('native bounds cannot relocate, swap axes or silently crop to W',()=>{
  const scene=basicScene('joint-too-wide');scene.bounds={width:4,height:3,length:3};scene.constraints={interior:false,walkable:false,passages:[]};scene.components=[shape('outside',[3,0,0],[1,1,1],'glass')];
  assert.throws(()=>compileAssemblyWorldPatch(prepareAssemblyWorldContext(snapshot()),compileScene(scene)),/original W/);
});
test('coupled-state new-building support does not waive original world patch neighbor/coupling policy',()=>{
  const scene=basicScene('joint-trapdoor');scene.bounds={width:3,height:3,length:3};scene.constraints={interior:false,walkable:false,passages:[]};
  scene.components=[shape('coupled',[0,0,0],[1,1,1],'oak_trapdoor')];
  assert.throws(()=>compileAssemblyWorldPatch(prepareAssemblyWorldContext(snapshot()),compileScene(scene)),/coupling\/support/);
});
