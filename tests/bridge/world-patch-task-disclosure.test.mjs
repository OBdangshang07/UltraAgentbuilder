import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID, createHash} from 'node:crypto';
import {WorldContextStore, CONTEXT_STORE_LIMITS} from '../../bridge/world-context-store.mjs';
import {WorldContextConsents} from '../../bridge/world-context-consent.mjs';
import {prepareSavedWorldPatchTaskDisclosure} from '../../bridge/world-patch-task-disclosure.mjs';
import {createContextSnapshot, contextHash, readSnapshotBlockFact} from '../../src/world/context-snapshot.mjs';
import {prepareWorldPatchDesignInput, compileWorldPatchDesignResponse} from '../../src/world/world-patch-design-input.mjs';
import {prepareWorldPatchDesignTask, validateWorldPatchDesignTask, confirmWorldPatchDesignTask} from '../../src/world/world-patch-design-task.mjs';
import {selectionChunks, regionCells, pointInRegion} from '../../contracts/world-selection.mjs';
import {startBridge} from '../../bridge/server.mjs';

const intent = changes => ({format: 'WorldPatchDesignIntent', version: 1, purpose: 'world-patch-design', agent: 'codex',
  model: 'gpt-6.1-sol', effort: 'max', prompt: '  基于周围环境改造入口 🏙️\n保留街道  ', maximumCalls: 1, ...changes});
const analysisIntent = () => ({...intent(), format: 'WorldContextTaskIntent', purpose: 'context-analysis'});
const raw = value => Buffer.from(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
function capture() {
  const selection = {format: 'WorldSelection', version: 1,
    world: {worldId: 'opaque_patch_context', dimension: 'minecraft:overworld', minY: -64, maxY: 320}, revision: 3,
    context: {min: [-2, -2, -2], max: [2, 2, 2]}, edit: {min: [-1, -1, -1], max: [1, 1, 1]}, protected: []};
  return {selection, capture: {fence: {start: 9, end: 9}, chunks: chunks(selection)}};
}
function chunks(selection) {
  return selectionChunks(selection).map(c => ({x: c.x, z: c.z, coverage: 'known',
    palette: [{state: 'minecraft:stone', blockEntity: false}], runs: [[0, regionCells(c.region)]]}));
}
async function fixture(t, value = capture()) {
  const parent = await fs.realpath(os.tmpdir()), dir = await fs.realpath(await fs.mkdtemp(path.join(parent, 'voxel-patch-disclosure-')));
  const store = new WorldContextStore({dataDir: dir}), id = randomUUID();
  t.after(async () => { await store.close(); assert.equal(await fs.realpath(dir), dir); assert.equal(path.dirname(dir), parent);
    assert.match(path.basename(dir), /^voxel-patch-disclosure-/); await fs.rm(dir, {recursive: true}); });
  const bytes = raw(value), saved = await store.operation('capture', id, bytes);
  const snapshot = createContextSnapshot(value.selection, value.capture);
  return {parent, dir, store, id, bytes, saved, snapshot};
}
const prepare = f => f.store.operation('patch-task-disclosure', f.id, raw(intent()));
function promptData(result) { return JSON.parse(result.task.disclosure.modelPrompt.split('\n\n').slice(1).join('\n\n')); }
function decoded(input) {
  const map = new Map();
  for (const region of input.exactBaseline.regions) {
    const {min, max} = region.region, width = max[0] - min[0], length = max[2] - min[2]; let offset = 0;
    for (const [index, count] of region.runs) for (let n = 0; n < count; n++, offset++) {
      const position = [min[0] + offset % width, min[1] + Math.floor(offset / (width * length)), min[2] + Math.floor(offset / width) % length];
      assert.equal(map.has(position.join()), false); map.set(position.join(), {position, region, fact: index === -1 ? null : input.exactBaseline.palette[index]});
    }
    assert.equal(offset, region.cells);
  }
  return map;
}

test('worker prepares exact W plus six faces from the independently saved original, not analysis LOD', async t => {
  const f = await fixture(t), result = await prepare(f), input = promptData(result).input, cells = decoded(input);
  assert.equal(result.format, 'SavedWorldPatchTaskDisclosure'); assert.equal(result.purpose, 'world-patch-design');
  assert.equal(result.contextId, f.id); assert.equal(result.payloadSha256, sha(f.bytes));
  assert.equal(result.recordHash, f.saved.record.recordHash); assert.equal(result.recordExpiresAt, f.saved.record.expiresAt);
  assert.equal(result.snapshotHash, f.snapshot.snapshotHash); assert.equal(result.selectionHash, f.snapshot.selectionHash);
  assert.deepEqual(result.identity, {worldId: 'opaque_patch_context', dimension: 'minecraft:overworld', selectionRevision: 3, contextRevision: 9});
  assert.deepEqual(result.task, prepareWorldPatchDesignTask(f.snapshot, prepareWorldPatchDesignInput(f.snapshot), intent()));
  assert.equal(input.exactBaseline.regions.length, 7); assert.equal(input.exactBaseline.knownCells, 32); assert.equal(cells.size, 32);
  assert.equal(input.exactBaseline.regions[0].cells, 8); assert.equal(input.exactBaseline.regions.slice(1).reduce((n, r) => n + r.cells, 0), 24);
  assert.equal(cells.has('-2,-2,-2'), false, 'No diagonal context cell is disclosed exactly');
  for (const {position, fact, region} of cells.values()) {
    const original = readSnapshotBlockFact(f.snapshot, position);
    assert.equal(fact.state, original.state); assert.equal(fact.blockEntity, original.blockEntity);
    assert.equal(fact.blockProtection, original.blockProtection); assert.ok(pointInRegion(input.context, position));
    assert.equal(pointInRegion(input.edit, position), region.role === 'edit-baseline');
  }
  const {taskDisclosureHash, ...content} = result; assert.equal(taskDisclosureHash, contextHash(content));
  assert.equal(result.taskHash, result.task.taskHash); assert.equal(result.task.disclosure.promptSha256, sha(result.task.disclosure.modelPrompt));
  assert.equal(promptData(result).userTask, intent().prompt); assert.deepEqual(result.task.request.intent, intent());
  for (const key of ['modelSent', 'sendingImplemented', 'serverBaselineVerified', 'canAuthorizePlacement', 'summaryConsentTransferable']) assert.equal(result[key], false);
  assert.equal(result.sourceAuthority, 'client-submitted-block-facts-not-a-server-signature');
  assert.ok(result.task.disclosure.transmittedData.includes('whole-W-exact-block-state-and-protection-facts'));
  assert.equal(result.task.disclosure.excludedData.includes('precise-per-cell-baseline'), false);
  assert.deepEqual(await prepare(f), result);
  assert.deepEqual(await f.store.operation('get', f.id), f.saved, 'Existing public GET still excludes the private snapshot');
});

test('unknown chunks remain unknown while explicit P and block-entity protection stay disclosed', async t => {
  const value = capture(); value.selection.protected = [{min: [0, 0, 0], max: [1, 1, 1]}];
  value.capture.chunks[0] = {...value.capture.chunks[0], coverage: 'unknown', palette: [], runs: []};
  value.capture.chunks[1].palette[0].blockEntity = true;
  const f = await fixture(t, value), result = await prepare(f), input = promptData(result).input, cells = decoded(input);
  assert.deepEqual(input.protected, value.selection.protected); assert.ok(input.exactBaseline.unknownCells > 0);
  assert.equal(cells.get('-1,-1,-1').fact, null); assert.equal(input.exactBaseline.unknownPaletteIndex, -1);
  assert.ok([...cells.values()].some(c => c.fact?.blockProtection === 'block-entity'));
  assert.equal(JSON.stringify(input).includes('Items'), false); assert.equal(JSON.stringify(input).includes('nbt'), false);
});

test('a W equal to C records missing faces and never expands capture', async t => {
  const value = capture(); value.selection.edit = structuredClone(value.selection.context);
  const f = await fixture(t, value), input = promptData(await prepare(f)).input;
  assert.equal(input.exactBaseline.regions.length, 1); assert.equal(input.exactBaseline.missingFaces.length, 6);
  assert.deepEqual(input.context, value.selection.context); assert.equal(decoded(input).size, 64);
  const proposal = {format: 'WorldPatchProposal', version: 1, snapshotHash: f.snapshot.snapshotHash,
    selectionHash: f.snapshot.selectionHash, operations: [{op: 'set', position: [-2, 0, 0], before: 'minecraft:stone', after: 'minecraft:glass'}]};
  assert.throws(() => compileWorldPatchDesignResponse(f.snapshot, input, proposal), /captured neighbor/);
});

test('each task text, model, effort, capture revision and world identity change binds a different task', async t => {
  const f = await fixture(t), original = await prepare(f);
  for (const changes of [{prompt: intent().prompt + ' '}, {model: 'gpt-6.1-luna'}, {effort: 'high'}, {agent: 'claude'}]) {
    const changed = await f.store.operation('patch-task-disclosure', f.id, raw(intent(changes)));
    assert.notEqual(changed.task.requestHash, original.task.requestHash); assert.notEqual(changed.taskDisclosureHash, original.taskDisclosureHash);
  }
  for (const mutate of [v => v.selection.revision++, v => { v.capture.fence.start++; v.capture.fence.end++; },
    v => v.selection.world.worldId = 'other_world', v => v.selection.world.dimension = 'minecraft:the_nether']) {
    const value = capture(); mutate(value); const next = await fixture(t, value), result = await prepare(next);
    assert.notEqual(result.snapshotHash, original.snapshotHash); assert.notEqual(result.task.taskHash, original.task.taskHash);
  }
});

for (const [name, changes] of [
  ['analysis purpose', {purpose: 'context-analysis'}], ['analysis format', {format: 'WorldContextTaskIntent'}],
  ['unsupported version', {version: 2}], ['zero budget', {maximumCalls: 0}], ['expanded budget', {maximumCalls: 2}],
  ['provider injection', {agent: 'remote-shell'}], ['invalid model characters', {model: 'model --flag'}],
  ['effort injection', {effort: 'automatic'}], ['blank prompt', {prompt: '  '}], ['prompt quota', {prompt: 'x'.repeat(6001)}],
  ['null character', {prompt: 'edit\u0000world'}], ['authority field', {canAuthorizePlacement: true}],
  ['input baseline supplied', {input: {before: 'minecraft:air'}}], ['analysis consent supplied', {consentId: randomUUID()}]
]) test('patch worker rejects ' + name + ' without publishing a model task', async t => {
  const f = await fixture(t); await assert.rejects(f.store.operation('patch-task-disclosure', f.id, raw(intent(changes))));
  assert.deepEqual(await f.store.operation('get', f.id), f.saved);
  assert.deepEqual((await fs.readdir(path.join(f.dir, 'world-contexts', f.id))).sort(),
    ['_owner.json', 'payload.json', 'record.json', 'snapshot.json', 'summary.json'].sort());
});

test('intent byte, malformed UTF-8, malformed JSON, and cancellation bounds apply before preparation', async t => {
  const f = await fixture(t);
  for (const payload of [new Uint8Array(), new Uint8Array(32769), raw(intent()).toString()]) {
    await assert.rejects(f.store.operation('patch-task-disclosure', f.id, payload), /quota/);
  }
  await assert.rejects(f.store.operation('patch-task-disclosure', f.id, Buffer.from([0xff])));
  await assert.rejects(f.store.operation('patch-task-disclosure', f.id, Buffer.from('{')));
  const abort = new AbortController(); abort.abort();
  await assert.rejects(f.store.operation('patch-task-disclosure', f.id, raw(intent()), {signal: abort.signal}), /cancelled/);
});

for (const file of ['payload.json', 'snapshot.json', 'summary.json', 'record.json', '_owner.json']) {
  test('patch preparation independently rejects stored ' + file + ' tampering', async t => {
    const f = await fixture(t); await fs.appendFile(path.join(f.dir, 'world-contexts', f.id, file), ' changed');
    await assert.rejects(prepare(f)); assert.ok((await fs.readFile(path.join(f.dir, 'world-contexts', f.id, file), 'utf8')).endsWith(' changed'));
  });
}

test('self-rehashed snapshot cannot replace the original hashed payload for a patch task', async t => {
  const f = await fixture(t), changed = capture(); changed.capture.chunks[0].palette[0].state = 'minecraft:gold_block';
  const snapshot = createContextSnapshot(changed.selection, changed.capture);
  await fs.writeFile(path.join(f.dir, 'world-contexts', f.id, 'snapshot.json'), JSON.stringify(snapshot));
  await assert.rejects(prepare(f), /identity/);
});

test('expired original record is rejected without refreshing or deleting its evidence', async t => {
  const f = await fixture(t), file = path.join(f.dir, 'world-contexts', f.id, 'record.json'), value = JSON.parse(await fs.readFile(file));
  value.createdAt = Date.now() - CONTEXT_STORE_LIMITS.lifetimeMs - 10000; value.expiresAt = value.createdAt + CONTEXT_STORE_LIMITS.lifetimeMs;
  const {recordHash, ...content} = value; value.recordHash = contextHash(content); await fs.writeFile(file, JSON.stringify(value));
  await assert.rejects(prepare(f), /expired/); assert.deepEqual(JSON.parse(await fs.readFile(file)), value);
});

test('pure binding helper refuses mismatched public saved metadata and is not a disk verification substitute', async t => {
  const f = await fixture(t), saved = {...f.saved, snapshot: f.snapshot};
  assert.deepEqual(prepareSavedWorldPatchTaskDisclosure(saved, intent()), await prepare(f));
  for (const mutate of [v => v.record.modelSent = true, v => v.record.canAuthorizePlacement = true,
    v => v.record.snapshotHash = '0'.repeat(64), v => v.record.identity.contextRevision++,
    v => v.record.summaryHash = '0'.repeat(64), v => v.record.knownCells--,
    v => v.record.sourceAuthority = 'server-signed', v => v.summary.knownCells--]) {
    const changed = structuredClone(saved); mutate(changed); assert.throws(() => prepareSavedWorldPatchTaskDisclosure(changed, intent()));
  }
});

test('summary-only confirmation is not transferable to exact-data design confirmation', async t => {
  const f = await fixture(t), analysis = await f.store.operation('task-disclosure', f.id, raw(analysisIntent()));
  const consents = new WorldContextConsents(), confirmation = {confirmed: true, disclosureHash: analysis.disclosure.disclosureHash,
    task: analysis.disclosure.recipient}, consent = consents.confirm(analysis.disclosure, confirmation), result = await prepare(f);
  assert.ok(analysis.disclosure.excludedData.includes('precise-per-cell-baseline'));
  assert.equal(result.summaryConsentTransferable, false); assert.notEqual(analysis.requestHash, result.task.requestHash);
  const input = prepareWorldPatchDesignInput(f.snapshot);
  assert.throws(() => confirmWorldPatchDesignTask(f.snapshot, input, result.task, confirmation));
  assert.throws(() => confirmWorldPatchDesignTask(f.snapshot, input, result.task, consent));
  const tampered = structuredClone(result.task); tampered.request.intent.prompt += ' changed';
  assert.throws(() => validateWorldPatchDesignTask(f.snapshot, input, tampered), /integrity/);
  assert.deepEqual(consents.consume(consent.id, analysis.disclosure), consent, 'Patch preparation does not consume unrelated analysis consent');
});

test('same saved capture reopens and re-prepares after Bridge restart without private snapshot exposure', async t => {
  const f = await fixture(t), original = await prepare(f); await f.store.close();
  const reopened = new WorldContextStore({dataDir: f.dir}); t.after(() => reopened.close());
  assert.deepEqual(await reopened.operation('patch-task-disclosure', f.id, raw(intent())), original);
  assert.equal(Object.hasOwn(await reopened.operation('get', f.id), 'snapshot'), false);
});

test('paired HTTP preparation advertises only actual capability, blocks origins and never invokes adapters', async t => {
  const f = await fixture(t); let calls = 0; const adapter = {close() {}, async generate() { calls++; throw Error('No provider call allowed'); }};
  const service = await startBridge({dataDir: f.dir, adapter, claudeAdapter: adapter, deepseekAdapter: adapter}); t.after(() => service.close());
  const base = 'http://127.0.0.1:' + service.connection.port, route = '/v1/world-contexts/' + f.id + '/',
    headers = {Authorization: 'Bearer ' + service.connection.token, 'Content-Type': 'application/json'};
  const request = async (route, {method = 'GET', value, custom = headers, bytes} = {}) => {
    const response = await fetch(base + route, {method, headers: custom, body: bytes ?? (value === undefined ? undefined : JSON.stringify(value))});
    return {status: response.status, value: await response.json()};
  };
  assert.equal((await request('/v1/world-patch/capabilities', {custom: {}})).status, 401);
  assert.equal((await request('/v1/world-patch/capabilities', {custom: {...headers, Origin: 'https://example.com'}})).status, 403);
  const capabilities = (await request('/v1/world-patch/capabilities')).value;
  assert.equal(capabilities.preparationImplemented, true); assert.equal(capabilities.preparationEnabled, true);
  for (const key of ['sendingImplemented', 'placementImplemented', 'canAuthorizePlacement', 'serverBaselineVerified', 'summaryConsentTransferable']) assert.equal(capabilities[key], false);
  assert.equal((await request(route + 'patch-task-disclosure', {method: 'POST', value: intent(), custom: {'Content-Type': 'application/json'}})).status, 401);
  assert.equal((await request(route + 'patch-task-disclosure', {method: 'POST', value: intent(), custom: {...headers, Origin: 'https://example.com'}})).status, 403);
  const result = await request(route + 'patch-task-disclosure', {method: 'POST', value: intent()});
  assert.equal(result.status, 200); assert.deepEqual(result.value, await prepare(f)); assert.equal(calls, 0);
  assert.equal((await request(route + 'patch-task-disclosure')).status, 405);
  assert.equal((await request(route + 'patch-task-disclosure', {method: 'POST', value: analysisIntent()})).status, 400);
  assert.equal((await request(route + 'patch-task-disclosure', {method: 'POST', value: intent(), custom: {...headers, 'Content-Type': 'text/plain'}})).status, 400);
  assert.equal((await request(route + 'patch-task-disclosure', {method: 'POST', bytes: Buffer.alloc(32769, 32)})).status, 413);
  const bad = Buffer.concat([Buffer.from(JSON.stringify(intent()).replace('入口', '')), Buffer.from([0xff])]);
  assert.equal((await request(route + 'patch-task-disclosure', {method: 'POST', bytes: bad})).status, 400);
  for (const action of ['send-patch', 'apply-patch', 'confirm-patch']) assert.equal((await request(route + action, {method: 'POST', value: intent()})).status, 404);
  const summaryConfirmation = {confirmed: true, disclosureHash: result.value.task.disclosure.disclosureHash, task: result.value.task.disclosure.recipient};
  assert.equal((await request(route + 'confirm-disclosure', {method: 'POST', value: summaryConfirmation})).status, 400);
  assert.equal(Object.hasOwn((await request(route + 'record')).value, 'snapshot'), false);
  assert.equal(calls, 0); assert.equal((await request('/v1/health')).status, 200);
});
