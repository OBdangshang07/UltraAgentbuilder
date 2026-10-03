import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionChunks, regionCells} from '../../contracts/world-selection.mjs';
import {createContextSnapshot, contextHash} from '../../src/world/context-snapshot.mjs';
import {summarizeContextSnapshot} from '../../src/world/context-summary.mjs';

function fixture() {
  const s = {format: 'WorldSelection', version: 1, world: {worldId: 'test', dimension: 'minecraft:overworld', minY: -64, maxY: 320}, revision: 0,
    context: {min: [-1, -2, -1], max: [3, 2, 3]}, edit: {min: [0, -1, 0], max: [2, 1, 2]}, protected: []};
  const chunks = selectionChunks(s).map(c => ({x: c.x, z: c.z, coverage: 'known', palette: [{state: 'minecraft:stone', blockEntity: false}], runs: [[0, regionCells(c.region)]]}));
  return {s, capture: {fence: {start: 1, end: 1}, chunks}};
}

test('bounded summary reports facts, exact count totals and source hashes, not semantic assertions', () => {
  const f = fixture(), v = createContextSnapshot(f.s, f.capture), summary = summarizeContextSnapshot(v);
  assert.equal(summary.totalCells, 64); assert.equal(summary.knownNonAirCells, 64); assert.equal(summary.unknownCells, 0);
  assert.equal(summary.heightLod.tiles.length, 1); assert.equal(summary.heightLod.tiles[0].knownHighestNonAirY, 1);
  assert.equal(summary.heightLod.tiles[0].knownColumns, 16); assert.equal(summary.heightLod.tiles[0].coverage, 'known');
  assert.equal(summary.snapshotHash, v.snapshotHash); assert.equal(summary.canAuthorizePlacement, false);
  assert.equal(summary.semantics, 'unclassified-block-facts');
  const {summaryHash, ...content} = summary; assert.equal(contextHash(content), summaryHash);
});

test('unknown chunk is not counted as air, and a crossing LOD tile stays partial', () => {
  const f = fixture(); f.capture.chunks[0] = {...f.capture.chunks[0], coverage: 'unknown', palette: [], runs: []};
  const summary = summarizeContextSnapshot(createContextSnapshot(f.s, f.capture));
  assert.equal(summary.unknownCells, 4); assert.equal(summary.knownCells, 60); assert.equal(summary.knownAirCells, 0);
  const tile = summary.heightLod.tiles[0]; assert.equal(tile.coverage, 'partial'); assert.equal(tile.unknownColumns, 1);
  assert.equal(tile.knownHighestNonAirY, 1); assert.equal(summary.materialCounts[0].cells, 60);
});

test('known all-air and totally unknown contexts remain distinguishable', () => {
  for (const unknown of [false, true]) {
    const f = fixture(); for (const c of f.capture.chunks) {if (unknown) {c.coverage = 'unknown'; c.palette = []; c.runs = [];} else c.palette[0].state = 'minecraft:air';}
    const summary = summarizeContextSnapshot(createContextSnapshot(f.s, f.capture));
    assert.equal(summary.heightLod.tiles[0].coverage, unknown ? 'unknown' : 'known');
    assert.equal(summary.heightLod.tiles[0].knownHighestNonAirY, null);
    assert.equal(summary.knownAirCells, unknown ? 0 : 64); assert.equal(summary.unknownCells, unknown ? 64 : 0);
  }
});

test('negative-height observations retain absolute world Y and no fake zero plane', () => {
  const f = fixture(); for (const c of f.capture.chunks) {
    const firstLayer = c.runs[0][1] / 4;
    c.palette.push({state: 'minecraft:air', blockEntity: false}); c.runs = [[0, firstLayer], [1, firstLayer * 3]];
  }
  const summary = summarizeContextSnapshot(createContextSnapshot(f.s, f.capture));
  assert.equal(summary.heightLod.tiles[0].knownHighestNonAirY, -2); assert.equal(summary.knownAirCells, 48);
});

test('truncated material histogram retains omitted counts rather than pretending full coverage', () => {
  const f = fixture(); f.capture.chunks[0].palette[0] = {state: 'minecraft:chest', blockEntity: true};
  const summary = summarizeContextSnapshot(createContextSnapshot(f.s, f.capture), {maximumMaterials: 1});
  assert.equal(summary.materialCounts.length, 1); assert.equal(summary.omittedMaterialKinds, 1);
  assert.equal(summary.omittedMaterialCells, 4); assert.equal(summary.knownBlockEntityCells, 4);
  assert.equal(summary.materialCounts[0].cells + summary.omittedMaterialCells, summary.knownCells);
});

test('invalid detail/budget options and cancellation fail before returning a model summary', () => {
  const f = fixture(), v = createContextSnapshot(f.s, f.capture);
  for (const options of [{cellSize: 1}, {cellSize: 17}, {maximumMaterials: 0}, {maximumMaterials: 65}]) assert.throws(() => summarizeContextSnapshot(v, options));
  const controller = new AbortController(); controller.abort();
  assert.throws(() => summarizeContextSnapshot(v, {signal: controller.signal}), /abort/i);
});

test('LOD tiling preserves clipped edge column counts at non-aligned coordinates', () => {
  const f = fixture(); f.s.context.max[0] = 8; f.s.context.max[2] = 6;
  f.capture.chunks = selectionChunks(f.s).map(c => ({x: c.x, z: c.z, coverage: 'known', palette: [{state: 'minecraft:stone', blockEntity: false}], runs: [[0, regionCells(c.region)]]}));
  const summary = summarizeContextSnapshot(createContextSnapshot(f.s, f.capture));
  assert.equal(summary.heightLod.columns, 3); assert.equal(summary.heightLod.rows, 2);
  assert.equal(summary.heightLod.tiles.reduce((n, t) => n + t.knownColumns, 0), 9 * 7);
  assert.deepEqual(summary.heightLod.tiles.at(-1).max, [8, 6]);
});
