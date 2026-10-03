import test from 'node:test';
import assert from 'node:assert/strict';
import {createContextReadSession} from '../../src/world/context-reader.mjs';
import {readSnapshotCell} from '../../src/world/context-snapshot.mjs';

function fixture() {
  const selection = {format: 'WorldSelection', version: 1, world: {worldId: 'test', dimension: 'minecraft:overworld', minY: -64, maxY: 320}, revision: 1,
    context: {min: [-1, -1, -1], max: [2, 1, 2]}, edit: {min: [-1, -1, -1], max: [2, 1, 2]}, protected: []};
  const current = {worldId: 'test', dimension: 'minecraft:overworld', selectionRevision: 1, contextRevision: 5}, reads = [];
  const source = {identity: () => ({...current}), isChunkLoaded: () => true,
    readBlock: point => {reads.push([...point]); return {state: 'minecraft:stone', blockEntity: false};}};
  return {selection, current, source, reads};
}
function finish(session) { let state; for (let i = 0; i < 1000; i++) { state = session.step(); if (state.state === 'captured') state = session.finishSnapshot(); if (state.state !== 'reading') return state; } throw new Error('Test read did not finish'); }

test('authoritative seam is step-bounded, data-only and performs each cell once', () => {
  const f = fixture(), session = createContextReadSession(f.selection, f.source, {maxCellsPerStep: 3, clock: () => 0});
  assert.equal(session.step().processedCells, 3); assert.equal(f.reads.length, 3);
  const result = finish(session); assert.equal(result.state, 'ready'); assert.equal(result.totalReadCalls, 18);
  assert.equal(new Set(f.reads.map(JSON.stringify)).size, 18);
  assert.equal(readSnapshotCell(result.snapshot, [-1, -1, -1]).state, 'minecraft:stone');
  assert.equal(result.canAuthorizePlacement, false); assert.equal(session.step().snapshot, result.snapshot);
});

test('elapsed time bounds stop cell work and continue on the next scheduled step', () => {
  const f = fixture(); let now = 0;
  const original = f.source.readBlock; f.source.readBlock = point => {const result = original(point); now += 3; return result;};
  const session = createContextReadSession(f.selection, f.source, {clock: () => now, maxMillisPerStep: 5});
  const first = session.step(); assert.equal(first.readCells, 2); assert.equal(first.state, 'reading');
  // The budget is cooperative, not a promise to preempt a slow source callback.
  assert.equal(first.maxObservedStepMillis, 6); assert.equal(finish(session).state, 'ready');
});

test('missing chunks are explicit unknown and never cause loading/generation or block reads', () => {
  const f = fixture(); f.source.isChunkLoaded = (x, z) => x !== -1 || z !== -1;
  const result = finish(createContextReadSession(f.selection, f.source, {clock: () => 0}));
  assert.equal(result.state, 'ready'); assert.equal(result.totalReadCalls, 16);
  assert.equal(readSnapshotCell(result.snapshot, [-1, -1, -1]).coverage, 'unknown');
  assert.ok(f.reads.every(p => p[0] >= 0 || p[2] >= 0));
});

test('whole-context changes discard partial data and restart within a fixed free-read allowance', () => {
  const f = fixture(), session = createContextReadSession(f.selection, f.source, {maxCellsPerStep: 1, clock: () => 0});
  session.step(); f.current.contextRevision++;
  assert.equal(session.step().restarts, 1); assert.equal(session.status().processedCells, 0);
  f.source.readBlock = point => ({state: 'minecraft:air', blockEntity: false});
  const result = finish(session); assert.equal(result.state, 'ready'); assert.equal(result.totalReadCalls, 19);
  assert.equal(result.snapshot.fence.start, 6); assert.equal(readSnapshotCell(result.snapshot, [-1, -1, -1]).state, 'minecraft:air');
});

test('continuous changes stop as unstable, not an infinite scan or fabricated complete snapshot', () => {
  const f = fixture(), session = createContextReadSession(f.selection, f.source, {maxCellsPerStep: 1, clock: () => 0});
  session.step();
  for (let i = 0; i < 3; i++) {f.current.contextRevision++; session.step();}
  assert.equal(session.status().state, 'unstable'); assert.equal(session.status().restarts, 2);
  assert.equal(session.status().snapshot, null); assert.equal(f.reads.length, 1);
});

for (const key of ['worldId', 'dimension', 'selectionRevision']) test('identity change aborts rather than silently switching ' + key, () => {
  const f = fixture(), session = createContextReadSession(f.selection, f.source, {maxCellsPerStep: 1, clock: () => 0}); session.step();
  f.current[key] = key === 'selectionRevision' ? 2 : 'changed';
  assert.equal(session.step().state, 'stale'); assert.equal(session.status().snapshot, null); assert.equal(f.reads.length, 1);
});

test('unload mid-chunk discards partial facts and handles the missing region explicitly', () => {
  const f = fixture(); let loaded = true; f.source.isChunkLoaded = () => loaded;
  const session = createContextReadSession(f.selection, f.source, {maxCellsPerStep: 1, clock: () => 0}); session.step();
  loaded = false; f.current.contextRevision++;
  const result = finish(session); assert.equal(result.state, 'ready'); assert.equal(result.processedCells, 18);
  assert.ok(result.snapshot.chunks.every(c => c.coverage === 'unknown')); assert.equal(result.totalReadCalls, 1);
});

test('cancellation and AbortSignal never resume reads or publish a partial snapshot', () => {
  for (const viaSignal of [false, true]) {
    const f = fixture(), controller = new AbortController(), session = createContextReadSession(f.selection, f.source, {maxCellsPerStep: 1, clock: () => 0, signal: controller.signal});
    session.step(); if (viaSignal) controller.abort(); else session.cancel();
    assert.equal(session.step().state, 'cancelled'); assert.equal(session.step().snapshot, null); assert.equal(f.reads.length, 1);
  }
});

test('private/invalid read payload fails before it can become a snapshot', () => {
  const f = fixture(); f.source.readBlock = () => ({state: 'minecraft:chest', blockEntity: true, nbt: {Items: ['private']}});
  const session = createContextReadSession(f.selection, f.source, {clock: () => 0});
  assert.equal(session.step().state, 'failed'); assert.match(session.error().message, /fields/); assert.equal(session.status().snapshot, null);
});

test('a source read error remains terminal and does not auto re-invoke or fill with air', () => {
  const f = fixture(); let calls = 0; f.source.readBlock = () => {calls++; throw Error('Read unavailable');};
  const session = createContextReadSession(f.selection, f.source, {clock: () => 0});
  assert.equal(session.step().state, 'failed'); assert.equal(session.step().state, 'failed'); assert.equal(calls, 1);
  assert.equal(session.status().totalReadCalls, 1);
});

test('trusted source and scheduler options cannot request unbounded work', () => {
  const f = fixture();
  for (const options of [{maxCellsPerStep: 0}, {maxCellsPerStep: 16385}, {maxMillisPerStep: 6}, {maxMillisPerStep: NaN}, {maxRestarts: 3}]) assert.throws(() => createContextReadSession(f.selection, f.source, options));
  assert.throws(() => createContextReadSession(f.selection, {}), /source method/);
});

test('read steps defer hashing/final validation; capture is not a ready snapshot', () => {
  const f = fixture(), session = createContextReadSession(f.selection, f.source, {clock: () => 0});
  const result = session.step(); assert.equal(result.state, 'captured'); assert.equal(result.snapshot, null);
  assert.equal(session.step().state, 'captured'); assert.equal(f.reads.length, 18);
  const ready = session.finishSnapshot(); assert.equal(ready.state, 'ready'); assert.ok(ready.snapshot);
  assert.equal(session.finishSnapshot().snapshot, ready.snapshot);
});

test('changes between capture and hash completion discard the capture and restart safely', () => {
  const f = fixture(), session = createContextReadSession(f.selection, f.source, {clock: () => 0});
  assert.equal(session.step().state, 'captured'); f.current.contextRevision++;
  assert.equal(session.finishSnapshot().state, 'reading'); assert.equal(session.status().snapshot, null);
  const result = finish(session); assert.equal(result.state, 'ready'); assert.equal(result.restarts, 1);
  assert.equal(result.totalReadCalls, 36); assert.equal(result.snapshot.fence.end, 6);
});

test('cancelled capture cannot be finalized later', () => {
  const f = fixture(), session = createContextReadSession(f.selection, f.source, {clock: () => 0}); session.step();
  session.cancel(); assert.equal(session.finishSnapshot().state, 'cancelled'); assert.equal(session.status().snapshot, null);
});

test('a regressed region revision cannot masquerade as a new consistent baseline', () => {
  const f = fixture(), session = createContextReadSession(f.selection, f.source, {maxCellsPerStep: 1, clock: () => 0}); session.step();
  f.current.contextRevision = 4; assert.equal(session.step().state, 'failed'); assert.match(session.error().message, /regressed/);
});
