import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCoupledAssemblyPlan,coupledAssemblyPlanData,validateCoupledAssemblyPlan,coupledAssemblyExecutionGroups,streamCoupledAssemblyParts} from '../../src/world/assembly-coupled-plan.mjs';
import {coupledNative,coupledSnapshot,coupledDoorEntries,coupledDoor,coupledBoundaryEntries} from '../fixtures/assembly-coupled-native.mjs';
import {contextHash} from '../../src/world/context-snapshot.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {resolveState} from '../../src/generation/block-states.mjs';
import {compileWorldPatch} from '../../src/world/world-patch.mjs';

const collect=async plan=>{const parts=[];const patchSet=await streamCoupledAssemblyParts(plan,{onPart:async part=>parts.push(part)});return {parts,patchSet};};

test('complete plan pairs native-order indices, binds support and retains no placement authority',()=>{
  const {snapshot}=coupledSnapshot(),native=coupledNative(),before=JSON.stringify({snapshot,native});
  const plan=compileCoupledAssemblyPlan(snapshot,native);
  assert.equal(JSON.stringify({snapshot,native}),before);assert.equal(plan.operationCount,3);assert.equal(plan.pairCount,1);
  assert.deepEqual(plan.pairs[0].nativeIndices,[13,22]);assert.deepEqual(plan.pairs[0].operationIndices,[1,2]);
  assert.deepEqual([...coupledAssemblyExecutionGroups(plan)].map(g=>g.operationIndices),[[0],[1,2]]);
  assert.equal(plan.serverBaselineVerified,false);assert.equal(plan.physicsVerified,false);assert.equal(plan.canAuthorizePlacement,false);assert.equal(plan.worldWrites,0);
  assert.ok(Object.isFrozen(plan.pairs[0].support));assert.deepEqual(coupledAssemblyPlanData(plan),plan);
  assert.deepEqual(validateCoupledAssemblyPlan(snapshot,native,structuredClone(plan)),plan);
});

test('upper promotion is global and never changes fixed part/native coordinate order',async()=>{
  const {entries,dimensions}=coupledBoundaryEntries(),{snapshot}=coupledSnapshot({dimensions});
  const plan=compileCoupledAssemblyPlan(snapshot,coupledNative(entries,dimensions)),{parts,patchSet}=await collect(plan);
  assert.equal(plan.operationCount,8193);assert.deepEqual(plan.pairs[0].operationIndices,[8191,8192]);
  assert.deepEqual(parts.map(p=>p.writes.length),[8192,1]);assert.equal(parts[0].writes.at(-1).nativeIndex,8191);assert.equal(parts[1].writes[0].nativeIndex,12287);
  const groups=[...coupledAssemblyExecutionGroups(plan)];assert.deepEqual(groups.at(-1).operationIndices,[8191,8192]);
  assert.equal(patchSet.partCount,2);assert.equal(patchSet.partialPublicationAllowed,false);
  assert.deepEqual(patchSet.partHashes,parts.map(p=>p.partHash));
  for(const part of parts){assert.equal(part.planHash,plan.planHash);assert.equal(part.partIsApplyScope,false);assert.equal(part.completePlanRequired,true);}
});

test('multiple interleaved door pairs execute together without dropping intervening static writes',async()=>{
  const entries=coupledDoorEntries();entries.push([[2,0,1],'minecraft:stone'],[[2,1,1],coupledDoor()],[[2,2,1],coupledDoor('upper')],[[0,1,1],'minecraft:glass']);
  const plan=compileCoupledAssemblyPlan(coupledSnapshot().snapshot,coupledNative(entries)),groups=[...coupledAssemblyExecutionGroups(plan)];
  assert.deepEqual(groups.map(g=>g.operationIndices),[[0],[1],[2],[3,5],[4,6]]);
  assert.deepEqual(groups.map(g=>g.offset),[0,1,2,3,5]);
  const scheduled=groups.flatMap(g=>g.operationIndices);assert.equal(new Set(scheduled).size,plan.operationCount);
  assert.deepEqual([...scheduled].sort((a,b)=>a-b),Array.from({length:plan.operationCount},(_,i)=>i));
  const {parts}=await collect(plan);assert.deepEqual(parts[0].writes.map(w=>w.nativeIndex),[4,5,12,13,14,22,23]);
});

test('known write with an UNKNOWN neighboring chunk is rejected, independently of unknown-write tests',()=>{
  const {snapshot}=coupledSnapshot({origin:[-2,0,0],unknown:[[0,0]]});
  assert.throws(()=>compileCoupledAssemblyPlan(snapshot,coupledNative()),/UNKNOWN/);
});

test('the complete after mask is checked before the first transport part is visible',async()=>{
  const {entries,dimensions}=coupledBoundaryEntries();entries.pop();let observed=0;
  assert.throws(()=>compileCoupledAssemblyPlan(coupledSnapshot({dimensions}).snapshot,coupledNative(entries,dimensions)),/both explicit matching/);
  assert.equal(observed,0);
});

test('owned native bytes and manifest survive caller mutation and awaited sink reentry',async()=>{
  const {entries,dimensions}=coupledBoundaryEntries(),{snapshot}=coupledSnapshot({dimensions}),native=coupledNative(entries,dimensions);
  const plan=compileCoupledAssemblyPlan(snapshot,native),original=await collect(plan);native.binary.fill(0);native.manifest.palette.fill('minecraft:air');
  const parts=[];const patchSet=await streamCoupledAssemblyParts(plan,{onPart:async part=>{
    parts.push(part);await Promise.resolve();assert.throws(()=>{part.writes[0].after='minecraft:air';},TypeError);
  }});
  assert.deepEqual(parts,original.parts);assert.deepEqual(patchSet,original.patchSet);
});

test('untrusted reports, transport parts and matching hashes cannot substitute for a complete original plan',async()=>{
  const plan=compileCoupledAssemblyPlan(coupledSnapshot().snapshot,coupledNative()),{parts}=await collect(plan);
  for(const value of [structuredClone(plan),{planHash:plan.planHash},parts[0]]){
    assert.throws(()=>coupledAssemblyPlanData(value),/Original complete/);
    assert.throws(()=>[...coupledAssemblyExecutionGroups(value)],/Original complete/);
    await assert.rejects(streamCoupledAssemblyParts(value,{onPart:async()=>{}}),/Original complete/);
  }
});

test('complete plan identity cannot be forged by rehashing changed pairs or authority fields',()=>{
  const {snapshot}=coupledSnapshot(),native=coupledNative(),plan=compileCoupledAssemblyPlan(snapshot,native);
  for(const mutate of [p=>p.canAuthorizePlacement=true,p=>p.pairs[0].operationIndices.reverse(),p=>p.pairs[0].support.state='minecraft:glass',p=>p.executionOrder='part-order']){
    const value=structuredClone(plan);mutate(value);const {planHash,...content}=value;value.planHash=contextHash(content);
    assert.throws(()=>validateCoupledAssemblyPlan(snapshot,native,value),/differs/);
  }
});

test('provisional parts carry exact original WRITE and neighbor guards, including shared roles',async()=>{
  const plan=compileCoupledAssemblyPlan(coupledSnapshot().snapshot,coupledNative()),{parts}=await collect(plan),p=parts[0];
  assert.equal(p.guards.find(g=>g.position.join(',')==='1,1,1').before,'minecraft:air');
  assert.deepEqual(p.guards.find(g=>g.position.join(',')==='1,1,1').roles,['neighbor','write']);
  assert.ok(p.guards.every(g=>g.blockEntity===false));
  assert.deepEqual(p.writes.map(w=>[w.action,w.before]),[['set','minecraft:air'],['set','minecraft:air'],['set','minecraft:air']]);
  const {partHash,...content}=p;assert.equal(partHash,contextHash(content));
  assert.equal(p.offset,0);assert.equal(p.index,0);assert.equal(p.totalWrites,3);
});

test('explicit CLEAR and omitted KEEP remain distinct in the complete schedule and streamed parts',async()=>{
  const {snapshot}=coupledSnapshot({changes:[[[0,1,0],'minecraft:stone'],[[2,1,2],'minecraft:stone']]}),entries=[...coupledDoorEntries(),[[0,1,0],'minecraft:air']];
  const plan=compileCoupledAssemblyPlan(snapshot,coupledNative(entries)),{parts}=await collect(plan),writes=parts.flatMap(p=>p.writes);
  assert.equal(writes.find(w=>w.position.join(',')==='0,1,0').action,'clear');
  assert.equal(writes.some(w=>w.position.join(',')==='2,1,2'),false);
});

test('static no-op cells do not consume native operation ranks or break pairing',()=>{
  const {snapshot}=coupledSnapshot({changes:[[[1,0,1],'minecraft:stone']]}),plan=compileCoupledAssemblyPlan(snapshot,coupledNative());
  assert.equal(plan.operationCount,2);assert.deepEqual(plan.pairs[0].operationIndices,[0,1]);
});

test('non-door special states remain exact single operations, not invented coupled groups',async()=>{
  const entries=[[[0,1,0],resolveState('oak_trapdoor',{open:true,half:'top'})],[[1,1,0],resolveState('quartz_slab',{type:'top'})],[[2,1,0],resolveState('oak_stairs',{shape:'outer_right'})]];
  const plan=compileCoupledAssemblyPlan(coupledSnapshot().snapshot,coupledNative(entries)),{parts}=await collect(plan);
  assert.equal(plan.pairCount,0);assert.deepEqual([...coupledAssemblyExecutionGroups(plan)].map(g=>g.operationIndices),[[0],[1],[2]]);
  assert.deepEqual(parts[0].writes.map(w=>w.after),entries.map(e=>e[1]));
});

test('cancellation or sink failure never returns a completed set and never silently repeats a sink',async()=>{
  const plan=compileCoupledAssemblyPlan(coupledSnapshot().snapshot,coupledNative()),controller=new AbortController();let calls=0;
  await assert.rejects(streamCoupledAssemblyParts(plan,{signal:controller.signal,onPart:async()=>{calls++;controller.abort();}}),{name:'AbortError'});assert.equal(calls,1);
  const failed=Error('sink closed without receipt');calls=0;
  await assert.rejects(streamCoupledAssemblyParts(plan,{onPart:async()=>{calls++;throw failed;}}),e=>e===failed);assert.equal(calls,1);
  controller.abort();assert.throws(()=>compileCoupledAssemblyPlan(coupledSnapshot().snapshot,coupledNative(),{signal:controller.signal}),{name:'AbortError'});
});

test('part/state formats cannot enter legacy v1 write routes or waive original protection',async()=>{
  const {snapshot}=coupledSnapshot(),plan=compileCoupledAssemblyPlan(snapshot,coupledNative()),{parts}=await collect(plan);
  assert.throws(()=>compileWorldPatch(snapshot,parts[0]),/unexpected or missing|Unsupported/);
  const before=coupledSnapshot({changes:[[[1,1,1],coupledDoor()],[[1,2,1],coupledDoor('upper')]]}).snapshot;
  assert.throws(()=>compileCoupledAssemblyPlan(before,coupledNative([[[1,1,1],'minecraft:stone']])),/protected BEFORE/);
});

test('invalid native lengths are rejected before allocating an owned input copy',()=>{
  const native=coupledNative();native.manifest.dimensions.width=Number.MAX_SAFE_INTEGER;
  assert.throws(()=>compileCoupledAssemblyPlan(coupledSnapshot().snapshot,native),/before coupled allocation/);
  const value=coupledNative();value.binary=Buffer.alloc(1);assert.throws(()=>compileCoupledAssemblyPlan(coupledSnapshot().snapshot,value),/before coupled allocation/);
});

test('tampered original masks or manifest hashes cannot become a coupled plan',()=>{
  const {snapshot}=coupledSnapshot(),native=coupledNative();native.binary[0]^=1;
  assert.throws(()=>compileCoupledAssemblyPlan(snapshot,native),/hash mismatch/);
  native.manifest.cellsHash=hash(native.binary);assert.throws(()=>compileCoupledAssemblyPlan(snapshot,native),/eligible/);
});
