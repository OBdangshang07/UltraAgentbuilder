import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {selectionChunks, regionCells} from '../../contracts/world-selection.mjs';
import {createContextSnapshot} from '../../src/world/context-snapshot.mjs';
import {compileWorldPatch} from '../../src/world/world-patch.mjs';
import {WorldPatchCompiler, WORLD_PATCH_WORKER_LIMITS} from '../../bridge/world-patch-compiler.mjs';

function fixture() {
  const s = {format: 'WorldSelection', version: 1, world: {worldId: 'patch_worker', dimension: 'minecraft:overworld', minY: -64, maxY: 320},
    revision: 0, context: {min: [-2, -2, -2], max: [3, 3, 3]}, edit: {min: [-1, -1, -1], max: [2, 2, 2]}, protected: []};
  const snapshot = createContextSnapshot(s, {fence: {start: 4, end: 4}, chunks: selectionChunks(s).map(c => ({
    x: c.x, z: c.z, coverage: 'known', palette: [{state: 'minecraft:stone', blockEntity: false}], runs: [[0, regionCells(c.region)]],
  }))});
  const proposal = {format: 'WorldPatchProposal', version: 1, snapshotHash: snapshot.snapshotHash, selectionHash: snapshot.selectionHash,
    operations: [{op: 'set', position: [0, 0, 0], before: 'minecraft:stone', after: 'minecraft:glass'}]};
  return {snapshot, proposal};
}
const bytes = value => new TextEncoder().encode(JSON.stringify(value));
const parse = result => JSON.parse(new TextDecoder().decode(result.payload));

test('worker returns same fully verified patch and exact submitted raw hash, without a model or write', async () => {
  const worker = new WorldPatchCompiler(), input = fixture(), raw = bytes(input), before = new Uint8Array(raw);
  try {
    const expectedHash = createHash('sha256').update(raw).digest('hex');
    const result = await worker.operation('compile', raw);
    assert.deepEqual(parse(result), compileWorldPatch(input.snapshot, input.proposal));
    assert.equal(result.inputSha256, expectedHash); assert.deepEqual(raw, before);
    assert.equal(result.additionalModelCalls, 0); assert.equal(result.worldWrites, 0); assert.equal(result.canAuthorizePlacement, false);
  } finally { await worker.close(); }
});

test('submission owns an immutable byte copy; caller edits do not change delayed work', async () => {
  const worker = new WorldPatchCompiler(), input = fixture(), raw = bytes(input), expectedHash = createHash('sha256').update(raw).digest('hex');
  try {
    const first = worker.operation('compile', bytes(input)), second = worker.operation('compile', raw); raw.fill(0);
    assert.equal((await second).inputSha256, expectedHash); await first;
  } finally { await worker.close(); }
});

test('worker verifies second capture and saved guard data; old baseline is never rebased', async () => {
  const worker = new WorldPatchCompiler(), {snapshot, proposal} = fixture(), patch = compileWorldPatch(snapshot, proposal);
  try {
    const unchanged = await worker.operation('check', bytes({snapshot, patch, currentSnapshot: snapshot}));
    assert.equal(parse(unchanged).result, 'unchanged'); assert.equal(unchanged.canAuthorizePlacement, false);
    const changed = createContextSnapshot(snapshot.selection, {fence: {start: 5, end: 5}, chunks: snapshot.chunks.map(({x, z, coverage, palette, runs}) => ({x, z, coverage, palette, runs}))});
    assert.equal(parse(await worker.operation('check', bytes({snapshot, patch, currentSnapshot: changed}))).reason, 'context-changed');
    const forged = structuredClone(patch); forged.writes[0].position[0]++;
    await assert.rejects(worker.operation('check', bytes({snapshot, patch: forged, currentSnapshot: snapshot})), /integrity/);
  } finally { await worker.close(); }
});

test('malformed bytes, private fields and invalid patch do not produce partial success', async () => {
  const worker = new WorldPatchCompiler();
  try {
    await assert.rejects(worker.operation('compile', new Uint8Array([0xff])), /encoded|encoding/i);
    await assert.rejects(worker.operation('compile', new TextEncoder().encode('{')), /JSON/);
    await assert.rejects(worker.operation('compile', bytes({...fixture(), command: '/fill'})), /fields/);
    const input = fixture(); input.proposal.operations[0].position[0] = 2;
    await assert.rejects(worker.operation('compile', bytes(input)), /outside approved W/);
    assert.equal((await worker.operation('compile', bytes(fixture()))).result, 'compiled');
  } finally { await worker.close(); }
});

test('queue is bounded and cancellation handles both active and pending CPU work', async () => {
  const worker = new WorldPatchCompiler(), raw = bytes(fixture()), active = new AbortController(), queued = new AbortController();
  try {
    const first = worker.operation('compile', raw, {signal: active.signal});
    const second = worker.operation('compile', raw, {signal: queued.signal});
    const third = worker.operation('compile', raw);
    await assert.rejects(worker.operation('compile', raw), /queue full/);
    const firstRejected = assert.rejects(first, /cancelled/), secondRejected = assert.rejects(second, /cancelled/);
    active.abort(); queued.abort(); await Promise.all([firstRejected, secondRejected]);
    assert.equal((await third).result, 'compiled');
    await assert.rejects(worker.operation('compile', raw, {signal: AbortSignal.abort()}), /cancelled/);
  } finally { await worker.close(); }
});

test('close drains worker resources, rejects waiting calculations and cannot restart', async () => {
  const worker = new WorldPatchCompiler(), raw = bytes(fixture());
  const first = assert.rejects(worker.operation('compile', raw), /closed/);
  const second = assert.rejects(worker.operation('compile', raw), /closed/);
  await worker.close(); await Promise.all([first, second]);
  await assert.rejects(worker.operation('compile', raw), /closed/);
  assert.equal(worker.stopping.size, 0); assert.equal(worker.queue.length, 0);
});

test('invalid operation/type/size is rejected before a worker is started', async () => {
  const worker = new WorldPatchCompiler();
  try {
    await assert.rejects(worker.operation('write', bytes(fixture())), /Invalid/);
    await assert.rejects(worker.operation('compile', '{}'), /byte quota/);
    await assert.rejects(worker.operation('compile', new Uint8Array()), /byte quota/);
    await assert.rejects(worker.operation('compile', new Uint8Array(WORLD_PATCH_WORKER_LIMITS.compileInputBytes + 1)), /byte quota/);
    assert.equal(worker.active, null); assert.equal(worker.queue.length, 0);
  } finally { await worker.close(); }
});
