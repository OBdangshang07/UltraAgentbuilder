import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionChunks, regionCells} from '../../contracts/world-selection.mjs';
import {validateWorldPatchProposal, WORLD_PATCH_LIMITS} from '../../contracts/world-patch.mjs';
import {createContextSnapshot, readSnapshotCell, readSnapshotBlockFact, contextHash} from '../../src/world/context-snapshot.mjs';
import {compileWorldPatch, validateWorldPatch, checkWorldPatchBaseline} from '../../src/world/world-patch.mjs';

const block = (state = 'minecraft:stone', blockEntity = false) => ({state, blockEntity});
const selection = () => ({format: 'WorldSelection', version: 1,
  world: {worldId: 'patch_test', dimension: 'minecraft:overworld', minY: -64, maxY: 320}, revision: 7,
  context: {min: [-3, -3, -3], max: [4, 4, 4]}, edit: {min: [-2, -2, -2], max: [3, 3, 3]}, protected: []});
function snapshot({s = selection(), changes = [], unknown = [], revision = 12} = {}) {
  const capture = {fence: {start: revision, end: revision}, chunks: selectionChunks(s).map(c => {
    if (unknown.some(p => p[0] === c.x && p[1] === c.z)) return {x: c.x, z: c.z, coverage: 'unknown', palette: [], runs: []};
    const palette = [], runs = [], {min, max} = c.region;
    for (let y = min[1]; y < max[1]; y++) for (let z = min[2]; z < max[2]; z++) for (let x = min[0]; x < max[0]; x++) {
      const entry = changes.find(item => item.position.join() === [x, y, z].join())?.entry ?? block();
      let index = palette.findIndex(item => item.state === entry.state && item.blockEntity === entry.blockEntity);
      if (index < 0) { index = palette.length; palette.push(entry); }
      if (runs.at(-1)?.[0] === index) runs.at(-1)[1]++; else runs.push([index, 1]);
    }
    assert.equal(runs.reduce((n, r) => n + r[1], 0), regionCells(c.region));
    return {x: c.x, z: c.z, coverage: 'known', palette, runs};
  })};
  return createContextSnapshot(s, capture);
}
const proposal = (s, operations = [{op: 'set', position: [0, 0, 0], before: 'minecraft:stone', after: 'minecraft:glass'}]) =>
  ({format: 'WorldPatchProposal', version: 1, snapshotHash: s.snapshotHash, selectionHash: s.selectionHash, operations});

test('patch has exact added/removed/replaced states; omission is KEEP, never excavation', () => {
  const s = snapshot({changes: [{position: [1, 0, 0], entry: block('minecraft:air')}]});
  const p = proposal(s, [
    {op: 'set', position: [1, 0, 0], before: 'minecraft:air', after: 'minecraft:quartz_block'},
    {op: 'clear', position: [0, 1, 0], before: 'minecraft:stone'},
    {op: 'set', position: [0, 0, 0], before: 'minecraft:stone', after: 'minecraft:glass'},
    {op: 'keep', position: [-1, 0, 0], before: 'minecraft:stone'},
  ]);
  const original = JSON.stringify({s, p}), patch = compileWorldPatch(s, p);
  assert.equal(JSON.stringify({s, p}), original);
  assert.deepEqual(patch.summary.counts, {added: 1, removed: 1, replaced: 1});
  assert.deepEqual(patch.summary.bounds, {min: [0, 0, 0], max: [2, 2, 1]});
  assert.equal(patch.summary.explicitKeeps, 1); assert.equal(patch.summary.omittedCells, 'keep');
  assert.equal(patch.writes.length, 3);
  assert.equal(patch.writes.some(w => w.position.join() === '-1,0,0'), false);
  assert.equal(patch.writes.find(w => w.action === 'clear').after, 'minecraft:air');
  assert.equal(patch.canAuthorizePlacement, false); assert.equal(patch.physicsVerified, false);
  assert.equal(patch.serverBaselineVerified, false); assert.ok(Object.isFrozen(patch.writes[0].position));
  assert.deepEqual(validateWorldPatch(s, JSON.parse(JSON.stringify(patch))), patch);
  assert.equal(validateWorldPatch(s, patch), patch);
});

for (const [name, mutate] of [
  ['version', p => p.version = 2], ['format', p => p.format = 'Command'],
  ['wrong baseline', p => p.snapshotHash = '0'.repeat(64)], ['wrong selection', p => p.selectionHash = '0'.repeat(64)],
  ['nonhash', p => p.snapshotHash = '../private'], ['scope escalation', p => p.edit = {min: [0, 0, 0], max: [99, 99, 99]}],
  ['permission', p => p.canAuthorizePlacement = true], ['token/limit override', p => p.limits = {operations: Infinity}],
  ['script', p => p.script = 'server.setBlock()'], ['command', p => p.operations[0].command = '/fill'],
  ['unknown op', p => p.operations[0] = {op: 'fill', position: [0, 0, 0], before: 'minecraft:stone'}],
  ['fractional coordinate', p => p.operations[0].position[0] = 0.5], ['NaN', p => p.operations[0].position[1] = NaN],
  ['unsafe world coordinate', p => p.operations[0].position[0] = 30000001],
  ['context-only write', p => p.operations[0].position[0] = 3], ['outside context', p => p.operations[0].position[0] = 4],
  ['wrong before', p => p.operations[0].before = 'minecraft:air'],
  ['omitted before', p => delete p.operations[0].before], ['omitted after', p => delete p.operations[0].after],
  ['duplicate position', p => p.operations.push(structuredClone(p.operations[0]))],
  ['contradictory position', p => p.operations.push({op: 'clear', position: [0, 0, 0], before: 'minecraft:stone'})],
  ['implicit clear via set-air', p => p.operations[0].after = 'minecraft:air'],
  ['no-op set', p => p.operations[0].after = 'minecraft:stone'], ['no operations', p => p.operations = []],
  ['dynamic target', p => p.operations[0].after = 'minecraft:water[level=0]'],
  ['gravity target', p => p.operations[0].after = 'minecraft:sand'],
  ['container target', p => p.operations[0].after = 'minecraft:chest[facing=north,type=single,waterlogged=false]'],
  ['unknown mod target', p => p.operations[0].after = 'example:stone'],
  ['coupled door target', p => p.operations[0].after = 'minecraft:oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]'],
  ['trapdoor support not verified', p => p.operations[0].after = 'minecraft:oak_trapdoor[facing=north,half=bottom,open=false,powered=false,waterlogged=false]'],
  ['waterlogged target', p => p.operations[0].after = 'minecraft:stone_brick_stairs[facing=north,half=bottom,shape=straight,waterlogged=true]'],
  ['empty write list', p => p.operations = [{op: 'keep', position: [0, 0, 0], before: 'minecraft:stone'}]],
]) test('proposal refuses ' + name, () => { const s = snapshot(), p = proposal(s); mutate(p); assert.throws(() => compileWorldPatch(s, p)); });

test('all writes respect explicit P, including existing safe blocks and clear operations', () => {
  const s = selection(); s.protected = [{min: [0, 0, 0], max: [1, 1, 1]}]; const v = snapshot({s});
  for (const op of ['set', 'clear']) {
    const p = proposal(v); if (op === 'clear') p.operations = [{op, position: [0, 0, 0], before: 'minecraft:stone'}];
    assert.throws(() => compileWorldPatch(v, p), /protected/);
  }
  const p = proposal(v, [{op: 'keep', position: [0, 0, 0], before: 'minecraft:stone'},
    {op: 'set', position: [1, 0, 0], before: 'minecraft:stone', after: 'minecraft:glass'}]);
  assert.equal(compileWorldPatch(v, p).summary.explicitKeeps, 1);
});

test('negative coordinates and lower-Y changes do not shift the selected baseline', () => {
  const s = snapshot(); const p = proposal(s, [{op: 'clear', position: [-2, -2, -2], before: 'minecraft:stone'}]);
  const patch = compileWorldPatch(s, p);
  assert.deepEqual(patch.summary.bounds, {min: [-2, -2, -2], max: [-1, -1, -1]});
  assert.equal(patch.guards.length, 7); assert.ok(patch.guards.some(g => g.position.join() === '-3,-2,-2'));
});

test('explicit neighbor data is required; no implicit extension or chunk load', () => {
  const s = selection(); s.edit = structuredClone(s.context); const v = snapshot({s});
  assert.throws(() => compileWorldPatch(v, proposal(v, [{op: 'clear', position: [-3, 0, 0], before: 'minecraft:stone'}])), /captured neighbor/);
  const unknown = snapshot({unknown: [[-1, 0]]});
  assert.throws(() => compileWorldPatch(unknown, proposal(unknown)), /unknown/);
});

for (const [name, entry] of [
  ['block entity', block('minecraft:obsidian', true)], ['fluid', block('minecraft:water[level=0]')],
  ['gravity', block('minecraft:sand')], ['redstone', block('minecraft:redstone_wire[power=0]')],
  ['coupled door', block('minecraft:oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]')],
  ['stair topology', block('minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]')],
]) test('unsafe neighbor is checked independently of context-only scope: ' + name, () => {
  const s = selection(); s.edit.max[0] = 1;
  const v = snapshot({s, changes: [{position: [1, 0, 0], entry}]});
  assert.equal(readSnapshotCell(v, [1, 0, 0]).reason, 'context-only');
  assert.deepEqual(readSnapshotBlockFact(v, [1, 0, 0]).state, entry.state);
  assert.throws(() => compileWorldPatch(v, proposal(v)));
});

test('unknown cell never supplies a before state, including an explicit KEEP', () => {
  const s = snapshot({unknown: [[0, 0]]});
  assert.deepEqual(readSnapshotBlockFact(s, [0, 0, 0]), {coverage: 'unknown', state: null, blockEntity: null, blockProtection: 'unknown'});
  assert.throws(() => compileWorldPatch(s, proposal(s)), /unknown/);
  assert.throws(() => compileWorldPatch(s, proposal(s, [{op: 'keep', position: [0, 0, 0], before: 'minecraft:air'}])), /unknown/);
});

test('property order normalizes, but full special state survives diff and hash', () => {
  const v = snapshot(), p = proposal(v);
  p.operations[0].after = 'minecraft:stone_brick_stairs[waterlogged=false,shape=straight,half=top,facing=west]';
  const patch = compileWorldPatch(v, p);
  assert.equal(patch.writes[0].after, 'minecraft:stone_brick_stairs[facing=west,half=top,shape=straight,waterlogged=false]');
  assert.equal(patch.physicsVerified, false);
  p.operations[0].after = 'minecraft:quartz_slab[waterlogged=false,type=top]';
  assert.equal(compileWorldPatch(v, p).writes[0].after, 'minecraft:quartz_slab[type=top,waterlogged=false]');
});

for (const mutate of [v => v.writes[0].after = 'minecraft:gold_block', v => v.writes[0].position[0]++,
  v => v.guards[0].before = 'minecraft:air', v => v.guards.pop(), v => v.summary.counts.added++,
  v => v.canAuthorizePlacement = true, v => v.physicsVerified = true, v => v.serverBaselineVerified = true,
  v => v.contextRevision++, v => v.selectionRevision++, v => v.world.worldId = 'another',
  v => v.proposalHash = '0'.repeat(64), v => v.extra = 'hidden-command'])
  test('saved patch requires full recomputation even if attacker replaces digest', () => {
    const s = snapshot(), patch = JSON.parse(JSON.stringify(compileWorldPatch(s, proposal(s)))); mutate(patch);
    const {patchHash, ...content} = patch; patch.patchHash = contextHash(content);
    assert.throws(() => validateWorldPatch(s, patch));
  });

test('saved patch digest alone cannot be replaced', () => {
  const s = snapshot(), value = JSON.parse(JSON.stringify(compileWorldPatch(s, proposal(s))));
  value.patchHash = '0'.repeat(64); assert.throws(() => validateWorldPatch(s, value), /integrity/);
});

test('unchanged baseline is read-only success, not approval to place', () => {
  const s = snapshot(), patch = compileWorldPatch(s, proposal(s));
  const result = checkWorldPatchBaseline(s, patch, snapshot());
  assert.equal(result.result, 'unchanged'); assert.deepEqual(result.conflicts, []);
  assert.equal(result.canAuthorizePlacement, false); assert.equal(result.serverBaselineVerified, false);
});

for (const [name, options, reason] of [
  ['write cell changed', {changes: [{position: [0, 0, 0], entry: block('minecraft:bricks')}]}, 'snapshot-facts-changed'],
  ['neighbor changed', {changes: [{position: [1, 0, 0], entry: block('minecraft:glass')}]}, 'snapshot-facts-changed'],
  ['distant C changed', {changes: [{position: [3, 3, 3], entry: block('minecraft:air')}]}, 'snapshot-facts-changed'],
  ['whole C revision changed', {revision: 13}, 'context-changed'],
  ['guard chunk unloaded', {unknown: [[0, 0]]}, 'snapshot-facts-changed'],
]) test('second precise capture refuses old proposal: ' + name, () => {
  const s = snapshot(), patch = compileWorldPatch(s, proposal(s));
  const result = checkWorldPatchBaseline(s, patch, snapshot(options));
  assert.equal(result.result, 'conflict'); assert.equal(result.reason, reason);
  assert.equal(result.canAuthorizePlacement, false); assert.equal(patch.writes.length, 1);
  if (name !== 'distant C changed' && name !== 'whole C revision changed') assert.ok(result.conflicts.length > 0);
});

for (const [name, mutate, reason] of [
  ['world', s => s.world.worldId = 'another', 'world-changed'],
  ['dimension', s => s.world.dimension = 'minecraft:the_nether', 'world-changed'],
  ['selection revision', s => s.revision++, 'selection-changed'],
  ['scope with forged same revision', s => s.edit.min[0]++, 'selection-facts-changed'],
]) test('identity change blocks old patch without silent rebasing: ' + name, () => {
  const original = snapshot(), patch = compileWorldPatch(original, proposal(original)), s = selection(); mutate(s);
  const result = checkWorldPatchBaseline(original, patch, snapshot({s}));
  assert.equal(result.result, 'conflict'); assert.equal(result.reason, reason);
});

test('same block state with changed block-entity presence is also a guard conflict', () => {
  const s = selection(); s.context = {min: [0, -3, 0], max: [4, 4, 4]}; s.edit = {min: [1, -2, 1], max: [3, 3, 3]};
  const before = snapshot({s, changes: [{position: [2, 0, 1], entry: block('minecraft:bricks')}]}), patch = compileWorldPatch(before, proposal(before,
    [{op: 'set', position: [1, 0, 1], before: 'minecraft:stone', after: 'minecraft:glass'}]));
  const changed = snapshot({s, changes: [{position: [2, 0, 1], entry: block('minecraft:bricks', true)}]});
  const result = checkWorldPatchBaseline(before, patch, changed);
  assert.equal(result.result, 'conflict'); assert.ok(result.conflicts.some(c => c.actual.blockEntity === true));
});

test('cancellation propagates before compile/validation; no partial diff is returned', () => {
  const s = snapshot(), p = proposal(s), patch = compileWorldPatch(s, p), signal = AbortSignal.abort(new Error('cancelled'));
  assert.throws(() => compileWorldPatch(s, p, {signal}), /cancelled/);
  assert.throws(() => checkWorldPatchBaseline(s, patch, s, {signal}), /cancelled/);
});

test('data quotas remain independent of model token settings', () => {
  const s = snapshot(), p = proposal(s);
  p.operations = Array(WORLD_PATCH_LIMITS.operations + 1).fill(p.operations[0]);
  assert.throws(() => validateWorldPatchProposal(p), /quota/);
  assert.throws(() => validateWorldPatchProposal({payload: 'x'.repeat(WORLD_PATCH_LIMITS.bytes + 1)}), /byte quota/);
});

test('operations normalize independently of caller ordering; callers cannot change verified data', () => {
  const s = snapshot(), p = proposal(s, [
    {op: 'set', position: [0, 1, 0], before: 'minecraft:stone', after: 'minecraft:glass'},
    {op: 'clear', position: [-1, -1, -1], before: 'minecraft:stone'},
  ]);
  const patch = compileWorldPatch(s, p); p.operations.reverse();
  assert.deepEqual(compileWorldPatch(s, p), patch); p.operations[0].position[0] = 999;
  assert.throws(() => { patch.writes[0].before = 'minecraft:air'; }, TypeError);
  assert.equal(validateWorldPatch(s, patch), patch);
});
