import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {WorldContextStore} from '../../bridge/world-context-store.mjs';
import {freezeSavedWorldPatchTask, readFrozenWorldPatchTaskCapsule, WORLD_PATCH_CAPSULE_LIMITS} from '../../bridge/world-patch-task-capsule.mjs';
import {contextHash, createContextSnapshot} from '../../src/world/context-snapshot.mjs';
import {selectionChunks, regionCells} from '../../contracts/world-selection.mjs';
import {startBridge} from '../../bridge/server.mjs';

const raw = value => Buffer.from(JSON.stringify(value));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const intent = changes => ({format: 'WorldPatchDesignIntent', version: 1, purpose: 'world-patch-design', agent: 'codex',
  model: 'gpt-6.1-sol', effort: 'max', prompt: '  结合环境改造入口 🏙️\n保留周围道路  ', maximumCalls: 1, ...changes});
function capture() {
  const selection = {format: 'WorldSelection', version: 1, world: {worldId: 'capsule_fixture', dimension: 'minecraft:overworld', minY: -64, maxY: 320}, revision: 3,
    context: {min: [-2, -2, -2], max: [2, 2, 2]}, edit: {min: [-1, -1, -1], max: [1, 1, 1]}, protected: []};
  return {selection, capture: {fence: {start: 9, end: 9}, chunks: selectionChunks(selection).map(c => ({x: c.x, z: c.z, coverage: 'known',
    palette: [{state: 'minecraft:stone', blockEntity: false}], runs: [[0, regionCells(c.region)]]}))}};
}
const confirmation = prepared => ({format: 'SavedWorldPatchDesignConfirmation', version: 1, purpose: 'world-patch-design', confirmed: true,
  taskDisclosureHash: prepared.taskDisclosureHash, taskHash: prepared.taskHash, requestHash: prepared.task.requestHash,
  disclosureHash: prepared.task.disclosure.disclosureHash, promptSha256: prepared.task.request.promptSha256});
async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir()), dir = await fs.realpath(await fs.mkdtemp(path.join(parent, 'voxel-patch-capsule-')));
  const store = new WorldContextStore({dataDir: dir}), id = randomUUID(), payload = Buffer.from(JSON.stringify(capture(), null, 2) + '\n');
  t.after(async () => { await store.close(); assert.equal(await fs.realpath(dir), dir); assert.equal(path.dirname(dir), parent);
    assert.match(path.basename(dir), /^voxel-patch-capsule-/); await fs.rm(dir, {recursive: true}); });
  const saved = await store.operation('capture', id, payload), prepared = await store.operation('patch-task-disclosure', id, raw(intent()));
  return {dir, store, id, payload, saved, prepared, root: path.join(dir, 'world-patch-tasks')};
}
const freeze = f => f.store.operation('patch-freeze-task', f.id, raw({intent: intent(), confirmation: confirmation(f.prepared)}));
const audit = (f, receipt) => f.store.operation('patch-frozen-task', receipt.capsuleId);
const capsule = (f, receipt) => path.join(f.root, receipt.capsuleId);
async function privateSaved(f) {
  const context = path.join(f.dir, 'world-contexts', f.id), load = async name => JSON.parse(await fs.readFile(path.join(context, name)));
  return {record: await load('record.json'), snapshot: await load('snapshot.json'), summary: await load('summary.json'),
    payload: await fs.readFile(path.join(context, 'payload.json')), contextOwner: await load('_owner.json'),
    contextStore: JSON.parse(await fs.readFile(path.join(f.dir, 'world-contexts/_store.json')))};
}
async function rewriteWithInventory(dir, name, value) {
  const bytes = raw(value); await fs.writeFile(path.join(dir, name), bytes);
  const file = path.join(dir, 'manifest.json'), manifest = JSON.parse(await fs.readFile(file)), entry = manifest.files.find(f => f.path === name);
  manifest.bytes += bytes.length - entry.bytes; entry.bytes = bytes.length; entry.sha256 = sha(bytes);
  const {manifestHash, ...content} = manifest; manifest.manifestHash = contextHash(content); await fs.writeFile(file, JSON.stringify(manifest));
}

test('freeze preserves original payload bytes, exact task and independent confirmation without dispatch/world authority', async t => {
  const f = await fixture(t), receipt = await freeze(f), dir = capsule(f, receipt);
  assert.equal(receipt.format, 'FrozenWorldPatchTaskReceipt'); assert.equal(receipt.state, 'frozen-not-sent');
  assert.equal(receipt.contextId, f.id); assert.equal(receipt.recordHash, f.saved.record.recordHash);
  assert.equal(receipt.payloadSha256, sha(f.payload)); assert.equal(receipt.taskDisclosureHash, f.prepared.taskDisclosureHash);
  assert.equal(receipt.confirmationHash, contextHash(confirmation(f.prepared))); assert.equal(receipt.maximumCalls, 1);
  assert.deepEqual(await fs.readFile(path.join(dir, 'payload.json')), f.payload, 'Original UTF-8 whitespace is retained');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'task-disclosure.json'))), f.prepared);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'confirmation.json'))), confirmation(f.prepared));
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'))), {manifestHash, ...content} = manifest;
  assert.equal(manifestHash, contextHash(content)); assert.equal(receipt.manifestHash, manifestHash); assert.equal(manifest.files.length, 10);
  for (const file of manifest.files) { const bytes = await fs.readFile(path.join(dir, file.path)); assert.equal(bytes.length, file.bytes); assert.equal(sha(bytes), file.sha256); }
  for (const field of ['modelSent', 'sendingImplemented', 'canAuthorizePlacement', 'serverBaselineVerified', 'summaryConsentTransferable']) assert.equal(receipt[field], false);
  assert.equal(receipt.sourceAuthority, 'client-submitted-block-facts-not-a-server-signature');
  for (const field of ['ownerId', 'files', 'modelPrompt', 'snapshot', 'payload', 'confirmation', 'sendToken']) assert.equal(receipt[field], undefined);
  assert.deepEqual(await audit(f, receipt), receipt); assert.deepEqual(await f.store.operation('get', f.id), f.saved);
  const original = await fs.readFile(path.join(dir, 'manifest.json'));
  assert.deepEqual(await freeze(f), receipt); assert.deepEqual(await fs.readFile(path.join(dir, 'manifest.json')), original);
  assert.deepEqual((await fs.readdir(f.root)).sort(), ['_store.json', receipt.capsuleId].sort());
});

test('lost freeze receipt is recovered by stable capsule identity after restart and original capture discard', async t => {
  const f = await fixture(t), receipt = await freeze(f); await f.store.close();
  const reopened = new WorldContextStore({dataDir: f.dir}); t.after(() => reopened.close());
  assert.deepEqual(await reopened.operation('patch-freeze-task', f.id, raw({intent: intent(), confirmation: confirmation(f.prepared)})), receipt);
  await reopened.operation('discard', f.id);
  assert.deepEqual(await reopened.operation('patch-frozen-task', receipt.capsuleId), receipt);
  await assert.rejects(reopened.operation('patch-freeze-task', f.id, raw({intent: intent(), confirmation: confirmation(f.prepared)})), /not found/);
  assert.equal(Object.hasOwn(receipt, 'snapshot'), false);
});

test('archived source can be audited after expiry, but is never refreshed into a current capture or send permission', async t => {
  const f = await fixture(t), receipt = await freeze(f);
  t.mock.timers.enable({apis: ['Date'], now: f.saved.record.expiresAt + 1000});
  assert.deepEqual(await readFrozenWorldPatchTaskCapsule({root: f.root, capsuleId: receipt.capsuleId}), receipt);
  assert.ok(receipt.recordExpiresAt < Date.now()); assert.equal(receipt.modelSent, false); assert.equal(receipt.canAuthorizePlacement, false);
});

for (const file of ['_owner.json', 'context-owner.json', 'context-store.json', 'payload.json', 'record.json',
  'snapshot.json', 'summary.json', 'task-disclosure.json', 'confirmation.json', 'review.json', 'manifest.json']) {
  test('frozen ' + file + ' corruption is rejected and preserved', async t => {
    const f = await fixture(t), receipt = await freeze(f), target = path.join(capsule(f, receipt), file);
    await fs.appendFile(target, ' broken'); await assert.rejects(audit(f, receipt));
    assert.ok((await fs.readFile(target, 'utf8')).endsWith(' broken')); await assert.rejects(freeze(f));
  });
}

for (const [name, file, mutate] of [
  ['review authority', 'review.json', v => v.canAuthorizePlacement = true],
  ['confirmation', 'confirmation.json', v => v.confirmed = false],
  ['task model', 'task-disclosure.json', v => v.task.request.intent.model = 'other-model'],
  ['summary coverage', 'summary.json', v => v.knownCells = 0],
  ['source owner', 'context-owner.json', v => v.ownerId = randomUUID()],
  ['source store', 'context-store.json', v => v.ownerId = randomUUID()],
  ['source identity', 'record.json', v => { v.identity.worldId = 'different'; const {recordHash, ...content} = v; v.recordHash = contextHash(content); }],
]) test('self-rehashed file inventory cannot legitimize changed ' + name, async t => {
  const f = await fixture(t), receipt = await freeze(f), dir = capsule(f, receipt), value = JSON.parse(await fs.readFile(path.join(dir, file)));
  mutate(value); await rewriteWithInventory(dir, file, value); await assert.rejects(audit(f, receipt));
});

test('self-rehashed normalized snapshot is still checked against original payload', async t => {
  const f = await fixture(t), receipt = await freeze(f), changed = capture(); changed.capture.chunks[0].palette[0].state = 'minecraft:gold_block';
  await rewriteWithInventory(capsule(f, receipt), 'snapshot.json', createContextSnapshot(changed.selection, changed.capture));
  await assert.rejects(audit(f, receipt), /snapshot binding/);
});

for (const changes of [{prompt: intent().prompt + ' '}, {model: 'gpt-6.1-luna'}, {agent: 'claude'}, {effort: 'high'}, {maximumCalls: 2}]) {
  test('changed intent cannot reuse old confirmation: ' + JSON.stringify(changes), async t => {
    const f = await fixture(t); await assert.rejects(f.store.operation('patch-freeze-task', f.id, raw({intent: intent(changes), confirmation: confirmation(f.prepared)})));
    await assert.rejects(fs.stat(f.root), {code: 'ENOENT'});
  });
}

test('distinct exact tasks and saved context identities require distinct frozen identities', async t => {
  const f = await fixture(t), first = await freeze(f), changed = intent({prompt: intent().prompt + ' 多一点玻璃。'});
  const prepared = await f.store.operation('patch-task-disclosure', f.id, raw(changed));
  const second = await f.store.operation('patch-freeze-task', f.id, raw({intent: changed, confirmation: confirmation(prepared)}));
  assert.notEqual(first.capsuleId, second.capsuleId); assert.notEqual(first.taskHash, second.taskHash);
  const other = randomUUID(); await f.store.operation('capture', other, f.payload);
  await assert.rejects(f.store.operation('patch-freeze-task', other, raw({intent: intent(), confirmation: confirmation(f.prepared)})), /Independent confirmation/);
});

test('unknown and incomplete archive directories block new publication, are preserved and not adopted', async t => {
  const f = await fixture(t), first = await freeze(f), unknown = path.join(f.root, 'do-not-touch'); await fs.mkdir(unknown);
  await fs.writeFile(path.join(unknown, 'private'), 'preserve');
  const changed = intent({prompt: '另一种入口'}), prepared = await f.store.operation('patch-task-disclosure', f.id, raw(changed));
  await assert.rejects(f.store.operation('patch-freeze-task', f.id, raw({intent: changed, confirmation: confirmation(prepared)})), /Unknown patch archive/);
  assert.equal(await fs.readFile(path.join(unknown, 'private'), 'utf8'), 'preserve'); assert.deepEqual(await audit(f, first), first);
  assert.ok(await fs.stat(unknown));
});

test('actual worker termination before commit preserves the original partial archive and claim', {timeout: 15000}, async t => {
  const f = await fixture(t), saved = await privateSaved(f);
  const worker = new Worker(new URL('../fixtures/world-patch-capsule-process.mjs', import.meta.url),
    {workerData: {root: f.root, saved, intent: intent(), confirmation: confirmation(f.prepared)}});
  t.after(() => worker.terminate());
  const message = await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject);
    worker.once('exit', code => reject(Error('Crash barrier not reached: ' + code))); });
  assert.equal(message.state, 'before-original-commit'); assert.equal(path.dirname(message.capsuleDirectory), f.root);
  const id = path.basename(message.capsuleDirectory); assert.match(id, /^[a-f0-9]{64}$/);
  const lock = await fs.readFile(path.join(f.root, '_publish.lock')), payload = await fs.readFile(path.join(message.capsuleDirectory, 'payload.json'));
  assert.equal(await worker.terminate(), 1, 'Original publisher must still be live when explicitly terminated');
  await assert.rejects(f.store.operation('patch-frozen-task', id), /Incomplete/);
  await assert.rejects(freeze(f), /Incomplete/);
  assert.deepEqual(await fs.readFile(path.join(f.root, '_publish.lock')), lock);
  assert.deepEqual(await fs.readFile(path.join(message.capsuleDirectory, 'payload.json')), payload);
  await assert.rejects(fs.stat(path.join(message.capsuleDirectory, 'manifest.json')), {code: 'ENOENT'});
});

test('real filesystem publication error preserves partial source files but releases only its own claim', async t => {
  const f = await fixture(t), saved = await privateSaved(f), originalOpen = fs.open;
  const mock = t.mock.method(fs, 'open', async function (target, ...args) {
    if (path.basename(target) === 'manifest.json' && args[0] === 'wx') throw Object.assign(Error('Simulated storage write failure'), {code: 'EIO'});
    return originalOpen.call(fs, target, ...args);
  });
  await assert.rejects(freezeSavedWorldPatchTask({root: f.root, saved, intent: intent(), confirmation: confirmation(f.prepared)}), /storage write failure/);
  mock.mock.restore();
  const entries = await fs.readdir(f.root), id = entries.find(name => /^[a-f0-9]{64}$/.test(name)); assert.ok(id);
  assert.equal(entries.includes('_publish.lock'), false);
  assert.deepEqual(await fs.readFile(path.join(f.root, id, 'payload.json')), f.payload);
  await assert.rejects(f.store.operation('patch-frozen-task', id), /Incomplete/); await assert.rejects(freeze(f), /Incomplete/);
});

test('missing commit marker never becomes a reusable frozen task', async t => {
  const f = await fixture(t), receipt = await freeze(f), target = path.join(capsule(f, receipt), 'manifest.json');
  const original = await fs.readFile(target); await fs.unlink(target);
  await assert.rejects(audit(f, receipt), /Incomplete/); await assert.rejects(freeze(f), /Incomplete/);
  await assert.rejects(fs.stat(target), {code: 'ENOENT'}); assert.ok(original.length > 0);
  assert.ok(await fs.stat(path.join(capsule(f, receipt), 'payload.json')));
});

test('unknown publication lock is never released or taken over by PID/age guesses', async t => {
  const f = await fixture(t), first = await freeze(f), lock = path.join(f.root, '_publish.lock');
  await fs.writeFile(lock, 'crashed publisher claim');
  const changed = intent({prompt: '另一种入口'}), prepared = await f.store.operation('patch-task-disclosure', f.id, raw(changed));
  await assert.rejects(f.store.operation('patch-freeze-task', f.id, raw({intent: changed, confirmation: confirmation(prepared)})), /pending\/unknown/);
  assert.equal(await fs.readFile(lock, 'utf8'), 'crashed publisher claim'); assert.deepEqual(await audit(f, first), first);
});

test('capsule storage has finite capacity and never evicts original sources', async t => {
  const f = await fixture(t), receipts = [];
  for (let i = 0; i < WORLD_PATCH_CAPSULE_LIMITS.records; i++) {
    const value = intent({prompt: '入口方案 ' + i}), prepared = await f.store.operation('patch-task-disclosure', f.id, raw(value));
    receipts.push(await f.store.operation('patch-freeze-task', f.id, raw({intent: value, confirmation: confirmation(prepared)})));
  }
  await assert.rejects(freeze(f), /quota reached/);
  assert.equal((await fs.readdir(f.root)).length, WORLD_PATCH_CAPSULE_LIMITS.records + 1);
  assert.deepEqual(await audit(f, receipts[0]), receipts[0]);
});

test('linked capsule directory is rejected without touching the external target', async t => {
  const f = await fixture(t), first = await freeze(f), outside = path.join(f.dir, 'external'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'private'), 'preserve');
  const id = '1'.repeat(64); try { await fs.symlink(outside, path.join(f.root, id), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (e) { if (['EPERM', 'EACCES'].includes(e.code)) { t.skip('OS link privilege unavailable'); return; } throw e; }
  await assert.rejects(f.store.operation('patch-frozen-task', id), /link/); assert.equal(await fs.readFile(path.join(outside, 'private'), 'utf8'), 'preserve');
  assert.deepEqual(await audit(f, first), first);
});

test('hardlinked capsule source is rejected even when bytes and hashes match', async t => {
  const f = await fixture(t), receipt = await freeze(f), target = path.join(capsule(f, receipt), 'payload.json'), alias = path.join(f.dir, 'payload-alias');
  await fs.link(target, alias); await assert.rejects(audit(f, receipt), /link/); assert.deepEqual(await fs.readFile(alias), f.payload);
});

test('unsafe inventory paths, byte claims, missing files and authority flags cannot be self-rehashed into a commit', async t => {
  for (const mutate of [v => v.files[0].path = '../private', v => v.files[0].bytes = -1,
    v => v.bytes++, v => v.canAuthorizePlacement = true, v => v.modelSent = true,
    v => v.maximumCalls = 2, v => v.frozenAt = v.recordExpiresAt, v => v.capsuleId = '0'.repeat(64)]) {
    const f = await fixture(t), receipt = await freeze(f), file = path.join(capsule(f, receipt), 'manifest.json'), value = JSON.parse(await fs.readFile(file));
    mutate(value); const {manifestHash, ...content} = value; value.manifestHash = contextHash(content); await fs.writeFile(file, JSON.stringify(value));
    await assert.rejects(audit(f, receipt));
  }
});

test('strict input shape, byte/UTF-8 bounds and cancellation reject before any capsule is published', async t => {
  const f = await fixture(t), value = {intent: intent(), confirmation: confirmation(f.prepared)};
  for (const bytes of [raw({...value, snapshot: capture()}), raw({...value, confirmation: {...value.confirmation, confirmed: false}}),
    raw({...value, confirmation: {confirmed: true, task: {agent: 'codex'}}}), new Uint8Array(), new Uint8Array(32769), Buffer.from([0xff]), Buffer.from('{')]) {
    await assert.rejects(f.store.operation('patch-freeze-task', f.id, bytes));
  }
  const abort = new AbortController(); abort.abort();
  await assert.rejects(f.store.operation('patch-freeze-task', f.id, raw(value), {signal: abort.signal}), /cancelled/);
  await assert.rejects(fs.stat(f.root), {code: 'ENOENT'});
  for (const id of ['../private', f.id, 'C:/private', 'a'.repeat(63), 'A'.repeat(64)]) await assert.rejects(f.store.operation('patch-frozen-task', id), /identity/);
});

test('same task queued twice reuses one publication and original manifest', async t => {
  const f = await fixture(t), results = await Promise.all([freeze(f), freeze(f)]);
  assert.deepEqual(results[0], results[1]); assert.equal((await fs.readdir(f.root)).length, 2);
});

test('paired HTTP freeze/reopen exposes no private baseline or dispatch capability', async t => {
  const f = await fixture(t); let calls = 0; const adapter = {close() {}, async generate() { calls++; throw Error('No provider call permitted'); }};
  const service = await startBridge({dataDir: f.dir, adapter, claudeAdapter: adapter, deepseekAdapter: adapter}); t.after(() => service.close());
  const base = 'http://127.0.0.1:' + service.connection.port, route = '/v1/world-contexts/' + f.id + '/patch-freeze-task',
    headers = {Authorization: 'Bearer ' + service.connection.token, 'Content-Type': 'application/json'}, input = {intent: intent(), confirmation: confirmation(f.prepared)};
  const request = async (target, {method = 'GET', value, custom = headers, bytes} = {}) => {
    const response = await fetch(base + target, {method, headers: custom, body: bytes ?? (value === undefined ? undefined : JSON.stringify(value))});
    return {status: response.status, value: await response.json()};
  };
  assert.equal((await request(route, {method: 'POST', value: input, custom: {'Content-Type': 'application/json'}})).status, 401);
  assert.equal((await request(route, {method: 'POST', value: input, custom: {...headers, Origin: 'https://example.com'}})).status, 403);
  assert.equal((await request(route, {method: 'POST', value: input, custom: {...headers, 'Content-Type': 'text/plain'}})).status, 400);
  assert.equal((await request(route, {method: 'POST', bytes: Buffer.alloc(32769)})).status, 413);
  const frozen = await request(route, {method: 'POST', value: input}); assert.equal(frozen.status, 200);
  assert.deepEqual((await request(route, {method: 'POST', value: input})).value, frozen.value);
  const readRoute = '/v1/world-patch/tasks/' + frozen.value.capsuleId;
  assert.equal((await request(readRoute, {custom: {}})).status, 401);
  assert.equal((await request(readRoute, {custom: {...headers, Origin: 'https://example.com'}})).status, 403);
  assert.deepEqual((await request(readRoute)).value, frozen.value); assert.equal((await request(readRoute, {method: 'POST', value: {confirmed: true}})).status, 405);
  assert.equal((await request('/v1/world-patch/tasks/' + '0'.repeat(64))).status, 404);
  assert.equal((await request(route)).status, 405);
  const capabilities = (await request('/v1/world-patch/capabilities')).value;
  assert.equal(capabilities.freezePreparationImplemented, true); assert.equal(capabilities.frozenTaskAuditImplemented, true);
  assert.equal(capabilities.sendingImplemented, false); assert.equal(capabilities.placementImplemented, false);
  for (const field of ['snapshot', 'ownerId', 'modelPrompt', 'files', 'payload']) assert.equal(frozen.value[field], undefined);
  assert.equal(calls, 0); assert.equal((await request('/v1/health')).status, 200);
});
