import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../../src/generation/compiler.mjs';
import {compileScene} from '../../src/design/compiler.mjs';
import {createContextSnapshot} from '../../src/world/context-snapshot.mjs';
import {selectionChunks,regionCells} from '../../contracts/world-selection.mjs';
import {prepareAssemblyWorldContext,compileAssemblyWorldPatch,streamAssemblyWorldPatch} from '../../src/world/assembly-context.mjs';
import {basicScene,shape} from './fixtures.mjs';

function fixture() {
  const selection={format:'WorldSelection',version:1,world:{worldId:'synthetic_stream',dimension:'minecraft:overworld',minY:-64,maxY:320},revision:1,
    context:{min:[-1,-1,-1],max:[23,34,23]},edit:{min:[0,0,0],max:[22,33,22]},protected:[]};
  const snapshot=createContextSnapshot(selection,{fence:{start:1,end:1},chunks:selectionChunks(selection).map(c=>({x:c.x,z:c.z,coverage:'known',
    palette:[{state:'minecraft:air',blockEntity:false}],runs:[[0,regionCells(c.region)]]}))});
  const scene=basicScene('synthetic-stream-capacity');scene.bounds={width:22,height:33,length:22};scene.constraints={interior:false,walkable:false,passages:[]};
  scene.components=[shape('capacity',[0,0,0],[22,33,22],'glass')];return {context:prepareAssemblyWorldContext(snapshot),native:compileScene(scene)};
}
test('streaming and legacy lowering retain identical original complete-set hashes and every write',async()=>{
  const f=fixture(),legacy=compileAssemblyWorldPatch(f.context,f.native),parts=[];
  const streamed=await streamAssemblyWorldPatch(f.context,f.native,{onPart:part=>parts.push(part)});
  assert.deepEqual(streamed.patchSet,legacy.patchSet);assert.deepEqual(streamed.binding,legacy.binding);
  assert.equal(parts.length,2);assert.equal(streamed.patchSet.operationCount,15972);
  parts.forEach((p,i)=>{assert.equal(p.index,i);assert.deepEqual(p.patch,legacy.patches[i]);assert.equal(p.provisional,true);assert.equal(p.partIsApplyScope,false);assert.equal(p.canAuthorizePlacement,false);assert.ok(Object.isFrozen(p));});
  assert.equal(Object.hasOwn(streamed,'patches'),false);
});
test('next original part waits for the prior sink to finish',async()=>{
  const f=fixture(),events=[];let pending=0;
  await streamAssemblyWorldPatch(f.context,f.native,{onPart:async p=>{pending++;assert.equal(pending,1);events.push('begin-'+p.index);await Promise.resolve();events.push('end-'+p.index);pending--;}});
  assert.deepEqual(events,['begin-0','end-0','begin-1','end-1']);
});
test('caller mutations during an awaited sink cannot rebind the owned original bytes or metadata',async()=>{
  const f=fixture(),original=compileAssemblyWorldPatch(f.context,f.native),parts=[];
  const streamed=await streamAssemblyWorldPatch(f.context,f.native,{onPart:async p=>{
    parts.push(p.patch);f.native.binary.fill(0);f.native.manifest.palette[2]='minecraft:stone';
    f.native.manifest.setCount=1;f.native.manifest.cellsHash='f'.repeat(64);await Promise.resolve();
  }});
  assert.deepEqual(streamed.patchSet,original.patchSet);assert.deepEqual(streamed.binding,original.binding);
  assert.deepEqual(parts,original.patches);
});
test('sink failure keeps its exact provisional history but never returns a complete result or re-invokes',async()=>{
  const f=fixture(),seen=[];let completed=false;
  await assert.rejects(async()=>{await streamAssemblyWorldPatch(f.context,f.native,{onPart:p=>{seen.push(p.index);throw Error('synthetic sink failed');}});completed=true;},/sink failed/);
  assert.deepEqual(seen,[0]);assert.equal(completed,false);
});
test('cancellation after the first sink cannot publish a partial complete-set result',async()=>{
  const f=fixture(),controller=new AbortController(),seen=[];
  await assert.rejects(streamAssemblyWorldPatch(f.context,f.native,{signal:controller.signal,onPart:p=>{seen.push(p.index);controller.abort();}}),{name:'AbortError'});
  assert.deepEqual(seen,[0]);
});
test('source count mismatch is rejected before any provisional sink',async()=>{
  const f=fixture(),metadata={...f.native.manifest,setCount:f.native.manifest.setCount+1};delete metadata.assetHash;
  const native={...f.native,manifest:{...metadata,assetHash:hash(metadata)}};let sinks=0;
  await assert.rejects(streamAssemblyWorldPatch(f.context,native,{onPart:()=>sinks++}),/counts differ/);assert.equal(sinks,0);
});
test('source byte tampering and copied context cannot gain a streaming capability',async()=>{
  const f=fixture(),bytes=Buffer.from(f.native.binary);bytes[0]^=1;let sinks=0;
  await assert.rejects(streamAssemblyWorldPatch(f.context,{...f.native,binary:bytes},{onPart:()=>sinks++}),/eligible/);
  await assert.rejects(streamAssemblyWorldPatch(structuredClone(f.context),f.native,{onPart:()=>sinks++}),/opaque/);assert.equal(sinks,0);
});
test('missing sink is rejected without authorizing SEND or writes',async()=>{
  const f=fixture();await assert.rejects(streamAssemblyWorldPatch(f.context,f.native),/sink required/);
  assert.equal(f.context.canAuthorizePlacement,false);
});
