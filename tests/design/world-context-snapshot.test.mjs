import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWorldSelection, selectionChunks, selectionCellScope, regionCells} from '../../contracts/world-selection.mjs';
import {createContextSnapshot, validateContextSnapshot, readSnapshotCell, snapshotProtection, snapshotStaleness, contextHash} from '../../src/world/context-snapshot.mjs';

const selection = () => ({format: 'WorldSelection', version: 1,
  world: {worldId: 'world_test_1', dimension: 'minecraft:overworld', minY: -64, maxY: 320}, revision: 3,
  context: {min: [-17, -2, -1], max: [17, 2, 17]}, edit: {min: [-2, -1, -1], max: [2, 1, 2]},
  protected: [{min: [-1, -1, 0], max: [0, 1, 1]}]});
const block = (state = 'minecraft:stone', blockEntity = false) => ({state, blockEntity});
const capture = (s = selection()) => ({fence: {start: 10, end: 10}, chunks: selectionChunks(s).map(c => ({x: c.x, z: c.z, coverage: 'known', palette: [block()], runs: [[0, regionCells(c.region)]]}))});
const snapshot = () => createContextSnapshot(selection(), capture());

test('dual selection uses absolute negative coordinates, half-open bounds and explicit protection', () => {
  const s = selection(), before = JSON.stringify(s); validateWorldSelection(s);
  assert.equal(JSON.stringify(s), before);
  assert.equal(selectionCellScope(s, [-2, 0, 1]), 'edit');
  assert.equal(selectionCellScope(s, [-1, 0, 0]), 'protected');
  assert.equal(selectionCellScope(s, [2, 0, 1]), 'context-only');
  assert.equal(selectionCellScope(s, [17, 0, 1]), 'outside');
});

test('chunk intersections cover the precise selection including negative chunk boundaries', () => {
  const s = selection(), chunks = selectionChunks(s);
  assert.equal(chunks.length, 12); assert.deepEqual([chunks[0].x, chunks[0].z], [-2, -1]);
  assert.equal(chunks.reduce((n, c) => n + regionCells(c.region), 0), regionCells(s.context));
  assert.deepEqual(chunks.at(-1).region, {min: [16, -2, 16], max: [17, 2, 17]});
  s.context = {min: [-16, 0, -16], max: [0, 1, 0]}; s.edit = structuredClone(s.context); s.protected = [];
  assert.equal(selectionChunks(s).length, 1);
});

for (const [name, mutate] of [
  ['non-nested edit', s => s.edit.max[0] = 18], ['invalid dimension height', s => s.context.min[1] = -65],
  ['empty region', s => s.context.max[0] = -17], ['fractional coordinate', s => s.edit.min[0] = -1.5],
  ['unsafe coordinate', s => s.context.min[0] = Number.MAX_SAFE_INTEGER], ['NaN', s => s.edit.max[2] = NaN],
  ['path as world ID', s => s.world.worldId = 'C:/private/world'], ['untrusted authority field', s => s.canWrite = true],
  ['untrusted limits override', s => s.limits = {contextCells: Infinity}], ['negative revision', s => s.revision = -1],
  ['outside protection', s => s.protected[0].min[0] = -18], ['duplicate protection', s => s.protected.push(structuredClone(s.protected[0]))],
  ['context volume', s => {s.context = {min: [0, 0, 0], max: [256, 128, 256]}; s.edit = {min: [0, 0, 0], max: [1, 1, 1]}; s.protected = [];}],
  ['edit volume', s => {s.context = {min: [0, 0, 0], max: [128, 32, 128]}; s.edit = structuredClone(s.context); s.protected = [];}],
]) test('selection rejects ' + name, () => { const s = selection(); mutate(s); assert.throws(() => validateWorldSelection(s)); });

test('snapshot binds selection, exact runs, chunk digests and full-region change fence', () => {
  const s = selection(), c = capture(s), before = JSON.stringify({s, c}), result = createContextSnapshot(s, c);
  assert.equal(JSON.stringify({s, c}), before); assert.equal(result.canAuthorizePlacement, false);
  assert.equal(result.selectionHash, contextHash(validateWorldSelection(s)));
  assert.ok(Object.isFrozen(result.chunks[0].palette[0]));
  assert.deepEqual(validateContextSnapshot(JSON.parse(JSON.stringify(result))), result);
  assert.deepEqual(readSnapshotCell(result, [0, 0, 0]), {coverage: 'known', state: 'minecraft:stone', protected: false, reason: null});
  assert.equal(readSnapshotCell(result, [-1, 0, 0]).reason, 'selection-protection');
  assert.equal(readSnapshotCell(result, [16, 1, 16]).reason, 'context-only');
  assert.throws(() => readSnapshotCell(result, [17, 0, 0]), /outside/);
});

test('unloaded chunks are explicitly unknown, never air or writable', () => {
  const s = selection(), c = capture(s), i = c.chunks.findIndex(x => x.x === 0 && x.z === 0);
  c.chunks[i] = {...c.chunks[i], coverage: 'unknown', palette: [], runs: []};
  const result = createContextSnapshot(s, c);
  assert.deepEqual(readSnapshotCell(result, [0, 0, 0]), {coverage: 'unknown', state: null, protected: true, reason: 'unknown'});
  c.chunks[i].palette.push(block('minecraft:air')); assert.throws(() => createContextSnapshot(s, c), /Unknown/);
});

test('run order is y-z-x and clipped chunks do not shift world coordinates', () => {
  const s = selection(); s.context = {min: [-2, -1, -2], max: [0, 1, 0]}; s.edit = structuredClone(s.context); s.protected = [];
  const c = capture(s); c.chunks[0].palette.push(block('minecraft:air')); c.chunks[0].runs = [[0, 1], [1, 6], [0, 1]];
  const result = createContextSnapshot(s, c);
  assert.equal(readSnapshotCell(result, [-2, -1, -2]).state, 'minecraft:stone');
  assert.equal(readSnapshotCell(result, [-1, -1, -2]).state, 'minecraft:air');
  assert.equal(readSnapshotCell(result, [-1, 0, -1]).state, 'minecraft:stone');
});

for (const [name, mutate] of [
  ['changing context', c => c.fence.end++], ['omitted chunk', c => c.chunks.pop()],
  ['duplicate chunk', c => c.chunks[1] = structuredClone(c.chunks[0])], ['reordered chunks', c => c.chunks.reverse()],
  ['omitted cells', c => c.chunks[0].runs[0][1]--], ['excess cells', c => c.chunks[0].runs[0][1]++],
  ['invalid palette index', c => c.chunks[0].runs[0][0] = 1], ['zero run', c => c.chunks[0].runs[0][1] = 0],
  ['NBT leak', c => c.chunks[0].palette[0].nbt = {Items: ['secret']}], ['sign-text leak', c => c.chunks[0].text = 'private'],
  ['entity leak', c => c.entities = []], ['fake callback', c => c.onWrite = () => {}],
  ['contradictory block-entity facts', c => {c.chunks[0].palette.push(block('minecraft:stone', true)); c.chunks[0].runs = [[0, 1], [1, c.chunks[0].runs[0][1] - 1]];}],
  ['duplicate property', c => c.chunks[0].palette[0].state = 'minecraft:oak_log[axis=x,axis=y]'],
  ['invalid property syntax', c => c.chunks[0].palette[0].state = 'minecraft:stone[test=]'],
]) test('capture rejects ' + name, () => { const s = selection(), c = capture(s); mutate(c); assert.throws(() => createContextSnapshot(s, c)); });

test('metadata filtering is strict and readable unknown blocks never gain write permission', () => {
  assert.equal(snapshotProtection(block('minecraft:chest[facing=north,type=single,waterlogged=false]', true)), 'block-entity');
  assert.equal(snapshotProtection(block('example:static_stone')), 'unclassified-mod-block');
  assert.equal(snapshotProtection(block('minecraft:sand')), 'unclassified-vanilla-state');
  assert.equal(snapshotProtection(block('minecraft:water[level=0]')), 'dynamic-state');
  assert.equal(snapshotProtection(block('minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=true]')), 'dynamic-state');
  assert.equal(snapshotProtection(block('minecraft:oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]')), 'coupled-block');
  assert.equal(snapshotProtection(block('minecraft:air')), null);
  assert.equal(snapshotProtection(block('minecraft:oak_log[axis=x]')), null);
});

test('noncanonical property order is normalized without losing exact state facts', () => {
  const s = selection(), c = capture(s); c.chunks[0].palette[0] = block('minecraft:oak_trapdoor[waterlogged=false,powered=false,open=false,half=top,facing=west]');
  const result = createContextSnapshot(s, c);
  assert.equal(result.chunks[0].palette[0].state, 'minecraft:oak_trapdoor[facing=west,half=top,open=false,powered=false,waterlogged=false]');
});

for (const mutate of [v => v.snapshotHash = '0'.repeat(64), v => v.selectionHash = '0'.repeat(64),
  v => v.chunks[0].chunkHash = '0'.repeat(64), v => v.chunks[0].region.min[0]++, v => v.fence.end++,
  v => v.chunks[0].palette[0].state = 'minecraft:air', v => v.canAuthorizePlacement = true,
  v => v.selection.revision++, v => v.privacy = 'all-data']) test('persisted snapshot tampering is rejected', () => {
  const data = JSON.parse(JSON.stringify(snapshot())); mutate(data); assert.throws(() => validateContextSnapshot(data));
});

test('world, dimension, selector version and context revision each invalidate stale data', () => {
  const s = snapshot(), current = {worldId: 'world_test_1', dimension: 'minecraft:overworld', selectionRevision: 3, contextRevision: 10};
  assert.equal(snapshotStaleness(s, current), null);
  assert.equal(snapshotStaleness(s, {...current, worldId: 'another'}), 'world-changed');
  assert.equal(snapshotStaleness(s, {...current, dimension: 'minecraft:the_nether'}), 'world-changed');
  assert.equal(snapshotStaleness(s, {...current, selectionRevision: 4}), 'selection-changed');
  assert.equal(snapshotStaleness(s, {...current, contextRevision: 11}), 'context-changed');
});

test('bounded randomized selections preserve exact coverage and no direct writes exist', () => {
  let seed = 621;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let i = 0; i < 80; i++) {
    const s = selection(), min = [random(100) - 50, random(20) - 10, random(100) - 50];
    s.context = {min, max: min.map(n => n + 1 + random(20))}; s.edit = structuredClone(s.context); s.protected = [];
    const v = createContextSnapshot(s, capture(s));
    assert.equal(v.chunks.reduce((n, c) => n + regionCells(c.region), 0), regionCells(s.context));
    for (let j = 0; j < 8; j++) {
      const p = min.map((n, axis) => n + random(s.context.max[axis] - n));
      assert.equal(readSnapshotCell(v, p).state, 'minecraft:stone');
    }
    assert.equal(v.canAuthorizePlacement, false);
  }
});

test('resource quotas reject palette/run amplification and oversized serialized input', () => {
  const s = selection(), c = capture(s);
  c.chunks[0].palette = Array.from({length: 4097}, (_, i) => block('test:block_' + i));
  assert.throws(() => createContextSnapshot(s, c), /palette quota/);
  const r = capture(s); r.chunks[0].runs = Array.from({length: regionCells(selectionChunks(s)[0].region) + 1}, () => [0, 1]);
  assert.throws(() => createContextSnapshot(s, r), /run quota/);
  assert.throws(() => validateContextSnapshot({payload: 'x'.repeat(16777217)}), /byte quota/);
});

test('a maximum-volume uniform context remains compressed; no omitted interior baseline', () => {
  const s = selection(); s.context = {min: [-128, 0, -128], max: [128, 16, 128]};
  s.edit = {min: [-64, 0, -64], max: [64, 16, 64]}; s.protected = [];
  const v = createContextSnapshot(s, capture(s));
  assert.equal(regionCells(s.context), 1048576); assert.equal(regionCells(s.edit), 262144);
  assert.equal(v.chunks.length, 256); assert.equal(v.chunks.reduce((n, c) => n + c.runs.length, 0), 256);
  assert.ok(Buffer.byteLength(JSON.stringify(v)) < 100000);
  assert.equal(readSnapshotCell(v, [-64, 0, -64]).reason, null);
  assert.equal(readSnapshotCell(v, [127, 15, 127]).reason, 'context-only');
});

test('caller mutations cannot change a verified in-memory snapshot or its cached index', () => {
  const s = selection(), c = capture(s), v = createContextSnapshot(s, c);
  readSnapshotCell(v, [0, 0, 0]); s.edit.min[0] = 0; c.chunks[0].palette[0].state = 'minecraft:air';
  assert.equal(readSnapshotCell(v, [-2, 0, 1]).reason, null);
  assert.throws(() => { v.chunks[0].runs[0][0] = 1; }, TypeError);
  assert.equal(validateContextSnapshot(v), v);
});
