import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSpec, patchSpec, hash } from '../../src/generation/compiler.mjs';
import { sampleSpec } from '../../src/generation/sample.mjs';

test('deterministic sample has explicit interior, retained exterior and real lamps', () => {
  const spec = sampleSpec(), a = compileSpec(spec), b = compileSpec(spec);
  assert.equal(a.manifest.assetHash, b.manifest.assetHash); assert.deepEqual(a.binary, b.binary);
  assert.equal(a.cells[3 + 3 * 19 + 2 * 19 * 17], 1);
  assert.equal(a.cells[0 + 0 * 19 + 2 * 19 * 17], 0);
  assert.ok(a.manifest.palette.includes('minecraft:sea_lantern')); assert.equal(a.manifest.setCount, 1937);
});
test('unknown materials, invalid operations, oversized and out-of-bounds input fail', () => {
  for (const mutate of [s=>s.palette.wall='lava',s=>s.nodes[0].op='eval',s=>s.bounds.width=257,s=>s.nodes[0].origin=[-1,0,0],s=>s.nodes[0].size=[300,2,2],s=>s.nodes[0].repeat={count:300,step:[0,0,0]},s=>s.nodes.push({...s.nodes[0]})]) {
    const s = sampleSpec(); mutate(s); assert.throws(()=>compileSpec(s));
  }
});
test('explicit passages validate floor and headroom', () => {
  const s=sampleSpec(); s.nodes.push({nodeId:'blocked-door',op:'box',origin:[8,2,2],size:[3,3,1],material:'wall'});
  assert.throws(()=>compileSpec(s),/Passage obstructed/);
});
test('local revision preserves other nodes and rejects stale base', () => {
  const s=sampleSpec(); const patched=patchSpec(s,{baseHash:hash(s),palette:{roof:'red'}});
  assert.equal(s.palette.roof,'blue'); assert.equal(patched.palette.roof,'red'); assert.deepEqual(patched.nodes,s.nodes);
  assert.notEqual(compileSpec(s).manifest.assetHash,compileSpec(patched).manifest.assetHash);
  assert.throws(()=>patchSpec(s,{baseHash:'stale',palette:{roof:'red'}}),/Stale/);
});
test('clear/keep mask participates in content hash even when visible blocks match', () => {
  const a=sampleSpec(), b=sampleSpec(); b.nodes.push({nodeId:'air-mask',op:'clear',origin:[0,5,0],size:[1,1,1]});
  const ca=compileSpec(a), cb=compileSpec(b); assert.equal(ca.manifest.setCount,cb.manifest.setCount); assert.notEqual(ca.manifest.assetHash,cb.manifest.assetHash);
});
test('general geometry composes cylinder, arch, stair and polygon without executing source', () => {
  for(const op of ['cylinder','stair','arch','polygonExtrude']) {
    const s=sampleSpec();s.constraints={interior:false,walkable:false};s.nodes=[{nodeId:op,op,origin:[1,1,1],size:[12,6,12],material:'wall',points:[[0,0],[12,0],[6,12]]}];
    const a=compileSpec(s);assert.ok(a.manifest.setCount>0);assert.ok(a.manifest.setCount<12*6*12);
  }
});
