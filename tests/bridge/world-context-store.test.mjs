import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID, createHash} from 'node:crypto';
import {WorldContextStore, CONTEXT_STORE_LIMITS} from '../../bridge/world-context-store.mjs';
import {contextDisclosure, WorldContextConsents} from '../../bridge/world-context-consent.mjs';
import {contextHash} from '../../src/world/context-snapshot.mjs';
import {selectionChunks, regionCells} from '../../contracts/world-selection.mjs';
import {startBridge} from '../../bridge/server.mjs';

function input() { const selection = {format: 'WorldSelection', version: 1, world: {worldId: 'opaque_test_session', dimension: 'minecraft:overworld', minY: -64, maxY: 320}, revision: 3,
  context: {min: [-2, -2, -2], max: [2, 2, 2]}, edit: {min: [-1, -1, -1], max: [1, 1, 1]}, protected: []};
  return {selection, capture: {fence: {start: 9, end: 9}, chunks: selectionChunks(selection).map(c => ({x: c.x, z: c.z, coverage: 'known', palette: [{state: 'minecraft:stone', blockEntity: false}], runs: [[0, regionCells(c.region)]]}))}}; }
const raw = value => Buffer.from(JSON.stringify(value ?? input()));
const task = () => ({agent: 'codex', model: 'gpt-6.1-sol', requestHash: 'a'.repeat(64)});
const taskIntent = () => ({format: 'WorldContextTaskIntent', version: 1, purpose: 'context-analysis', agent: 'codex',
  model: 'gpt-6.1-sol', effort: 'max', prompt: '分析这里的环境事实，推断必须标为推断。', maximumCalls: 1});
async function fixture(t) { const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'voxel-context-store-'))), store = new WorldContextStore({dataDir: dir});
  t.after(async () => { await store.close(); assert.equal(await fs.realpath(dir), dir); assert.match(path.basename(dir), /^voxel-context-store-/); await fs.rm(dir, {recursive: true}); }); return {dir, store, id: randomUUID()}; }

test('capture persists exact private baseline and bounded summary, without write/model authority', async t => {
  const {store, dir, id} = await fixture(t), bytes = raw(), saved = await store.operation('capture', id, bytes);
  assert.equal(saved.record.id, id); assert.equal(saved.record.payloadSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(saved.record.identity, {worldId: 'opaque_test_session', dimension: 'minecraft:overworld', selectionRevision: 3, contextRevision: 9});
  assert.equal(saved.record.modelSent, false); assert.equal(saved.summary.canAuthorizePlacement, false); assert.equal(saved.summary.knownCells, 64);
  assert.equal(saved.record.sourceAuthority, 'client-submitted-block-facts-not-a-server-signature'); assert.equal(saved.record.ownerId, undefined);
  assert.deepEqual(await fs.readFile(path.join(dir, 'world-contexts', id, 'payload.json')), bytes);
  assert.deepEqual(await store.operation('get', id), saved); assert.deepEqual(await store.operation('capture', id, bytes), saved);
  const changed = input(); changed.capture.fence = {start: 10, end: 10}; await assert.rejects(store.operation('capture', id, raw(changed)), /reused/);
});

for (const [name, mutate] of [
  ['NBT injection', v => v.capture.chunks[0].palette[0].nbt = {Items: []}], ['path injection', v => v.path = 'C:/private/save'],
  ['world authority injection', v => v.selection.canAuthorizePlacement = true], ['changed fence', v => v.capture.fence.end++],
  ['omitted cells', v => v.capture.chunks[0].runs[0][1]--], ['unknown air claim', v => v.capture.chunks[0].coverage = 'unknown']
]) test('worker rejects ' + name + ' before publishing', async t => {
  const {store, dir, id} = await fixture(t), value = input(); mutate(value); await assert.rejects(store.operation('capture', id, raw(value)));
  await assert.rejects(fs.stat(path.join(dir, 'world-contexts', id)), {code: 'ENOENT'});
});

for (const file of ['payload.json', 'snapshot.json', 'summary.json', 'record.json', '_owner.json']) test('saved ' + file + ' tampering rejected', async t => {
  const {store, dir, id} = await fixture(t); await store.operation('capture', id, raw());
  await fs.appendFile(path.join(dir, 'world-contexts', id, file), ' tampered'); await assert.rejects(store.operation('get', id));
});

test('self-rehashed forged summary is rejected by independent recomputation', async t => {
  const {store, dir, id} = await fixture(t); await store.operation('capture', id, raw()); const file = path.join(dir, 'world-contexts', id, 'summary.json');
  const value = JSON.parse(await fs.readFile(file)); value.knownCells = 0; const {summaryHash, ...content} = value; value.summaryHash = contextHash(content);
  await fs.writeFile(file, JSON.stringify(value)); await assert.rejects(store.operation('get', id), /integrity/);
});

test('unknown files are preserved and cannot be recursively discarded', async t => {
  const {store, dir, id} = await fixture(t); await store.operation('capture', id, raw()); const extra = path.join(dir, 'world-contexts', id, 'unrelated.txt'); await fs.writeFile(extra, 'preserve');
  await assert.rejects(store.operation('discard', id), /Unexpected/); assert.equal(await fs.readFile(extra, 'utf8'), 'preserve');
});

test('context record links are rejected without touching their targets', async t => {
  const {store, dir, id} = await fixture(t); await store.operation('capture', id, raw()); const external = path.join(dir, 'untouched'); await fs.mkdir(external); await fs.writeFile(path.join(external, 'private'), 'preserve');
  const linked = randomUUID(); try { await fs.symlink(external, path.join(dir, 'world-contexts', linked), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (e) { if (['EPERM', 'EACCES'].includes(e.code)) { t.skip('OS link privilege unavailable'); return; } throw e; }
  await assert.rejects(store.operation('get', linked), /not a link/); await assert.rejects(store.operation('discard', linked), /not a link/); assert.equal(await fs.readFile(path.join(external, 'private'), 'utf8'), 'preserve');
});

test('expired owned snapshots deny reads and are evicted only on a new capture', async t => {
  const {store, dir, id} = await fixture(t); await store.operation('capture', id, raw()); const file = path.join(dir, 'world-contexts', id, 'record.json');
  const value = JSON.parse(await fs.readFile(file)); value.createdAt = Date.now() - CONTEXT_STORE_LIMITS.lifetimeMs - 1000; value.expiresAt = value.createdAt + CONTEXT_STORE_LIMITS.lifetimeMs;
  const {recordHash, ...content} = value; value.recordHash = contextHash(content); await fs.writeFile(file, JSON.stringify(value));
  await assert.rejects(store.operation('get', id), /expired/); await store.operation('capture', randomUUID(), raw()); await assert.rejects(fs.stat(path.dirname(file)), {code: 'ENOENT'});
});

test('capacity is finite, explicit discard restores room and is idempotent', async t => {
  const {store, id} = await fixture(t); await store.operation('capture', id, raw());
  for (let i = 1; i < CONTEXT_STORE_LIMITS.records; i++) await store.operation('capture', randomUUID(), raw());
  await assert.rejects(store.operation('capture', randomUUID(), raw()), /quota reached/);
  assert.equal((await store.operation('discard', id)).discarded, true); assert.equal((await store.operation('discard', id)).discarded, true);
  await store.operation('capture', randomUUID(), raw());
});

test('invalid paths, oversized bytes and fourth queued operation are rejected', async t => {
  const {store, id} = await fixture(t);
  for (const invalid of ['../jobs', id + '/..', 'C:/private', id.toUpperCase()]) await assert.rejects(store.operation('get', invalid), /identity/);
  await assert.rejects(store.operation('capture', id, Buffer.alloc(CONTEXT_STORE_LIMITS.inputBytes + 1)), /quota/);
  const pending = [store.operation('capture', id, raw()), store.operation('get', id), store.operation('get', id)];
  await assert.rejects(store.operation('get', id), /queue full/); await Promise.all(pending);
});

test('cancellation terminates workers and a fresh operation remains possible', async t => {
  const {store, id} = await fixture(t), abort = new AbortController(), work = store.operation('capture', id, raw(), {signal: abort.signal});
  const rejected = assert.rejects(work, /cancelled/); abort.abort(); await rejected; await store.cancel(id);
  await store.operation('capture', randomUUID(), raw());
});

test('close rejects active/queued work and future requests', async t => {
  const {store, id} = await fixture(t), first = store.operation('capture', id, raw()), second = store.operation('get', id);
  const rejected = [assert.rejects(first, /closed/), assert.rejects(second, /closed/)]; await store.close(); await Promise.all(rejected); await assert.rejects(store.operation('get', id), /closed/);
});

test('consent binds exact recipient, request and disclosure, never sends a model', async t => {
  const {store, id} = await fixture(t), saved = await store.operation('capture', id, raw()), disclosure = contextDisclosure(saved, task()), registry = new WorldContextConsents();
  assert.equal(disclosure.modelSent, false); assert.ok(disclosure.excludedData.includes('precise-per-cell-baseline'));
  const confirmation = {confirmed: true, disclosureHash: disclosure.disclosureHash, task: task()};
  assert.throws(() => registry.confirm(disclosure, {...confirmation, confirmed: false}), /Explicit/);
  for (const changed of [{...task(), model: 'another-model'}, {...task(), agent: 'claude'}, {...task(), requestHash: 'b'.repeat(64)}]) {
    assert.throws(() => registry.confirm(disclosure, {...confirmation, task: changed}), /Explicit/);
    const receipt = registry.confirm(disclosure, confirmation); assert.throws(() => registry.consume(receipt.id, contextDisclosure(saved, changed)), /changed/);
  }
  const receipt = registry.confirm(disclosure, confirmation); assert.equal(receipt.state, 'confirmed-not-sent'); assert.equal(receipt.canAuthorizePlacement, false);
  assert.deepEqual(registry.consume(receipt.id, disclosure), receipt); assert.throws(() => registry.consume(receipt.id, disclosure), /consumed/);
  const revoked = registry.confirm(disclosure, confirmation); registry.revoke(id); assert.throws(() => registry.consume(revoked.id, disclosure), /missing/);
});

test('worker disclosure uses the verified saved baseline and whole exact task', async t => {
  const {store, id} = await fixture(t); await store.operation('capture', id, raw());
  const prepared = await store.operation('task-disclosure', id, raw(taskIntent()));
  assert.equal(prepared.request.contextId, id); assert.equal(prepared.requestHash, contextHash(prepared.request));
  assert.deepEqual(prepared.request.intent, taskIntent()); assert.equal(prepared.sendingImplemented, false);
  assert.equal(prepared.canAuthorizePlacement, false); assert.equal(prepared.modelSent, false);
  const changed = taskIntent(); changed.prompt += ' ';
  assert.notEqual((await store.operation('task-disclosure', id, raw(changed))).requestHash, prepared.requestHash);
  await assert.rejects(store.operation('task-disclosure', id, raw({...taskIntent(), purpose: 'edit-proposal'})), /Unsupported/);
  await assert.rejects(store.operation('task-disclosure', id, new Uint8Array(32769)), /quota/);
});

test('HTTP exact context task preparation and consent do not dispatch a model', async t => {
  const {dir, id} = await fixture(t); let calls = 0; const adapter = {close() {}, async generate() { calls++; throw new Error('No model may be called'); }};
  const service = await startBridge({dataDir: dir, adapter, claudeAdapter: adapter, deepseekAdapter: adapter}); t.after(() => service.close());
  const base = 'http://127.0.0.1:' + service.connection.port + '/v1/world-contexts/' + id + '/', headers = {Authorization: 'Bearer ' + service.connection.token, 'Content-Type': 'application/json'};
  const post = async (action, input, custom = headers) => { const r = await fetch(base + action, {method: 'POST', headers: custom, body: JSON.stringify(input)}); return [r.status, await r.json()]; };
  assert.equal((await post('capture', input()))[0], 200);
  assert.equal((await post('task-disclosure', taskIntent(), {'Content-Type': 'application/json'}))[0], 401);
  const [status, prepared] = await post('task-disclosure', taskIntent()); assert.equal(status, 200);
  assert.equal(prepared.requestHash, contextHash(prepared.request));
  const confirmation = {confirmed: true, disclosureHash: prepared.disclosure.disclosureHash, task: prepared.disclosure.recipient};
  assert.equal((await post('confirm-disclosure', confirmation))[0], 200);
  const changed = taskIntent(); changed.prompt += 'Changed'; const second = (await post('task-disclosure', changed))[1];
  assert.notEqual(second.requestHash, prepared.requestHash);
  assert.equal((await post('confirm-disclosure', {...confirmation, task: second.disclosure.recipient}))[0], 400);
  assert.equal(calls, 0);
});

test('HTTP pairing, raw save/recovery/disclosure/discard never invoke an adapter', async t => {
  const {dir, id} = await fixture(t); let calls = 0; const adapter = {close() {}, async generate() { calls++; throw new Error('No model may be called'); }};
  const service = await startBridge({dataDir: dir, adapter, claudeAdapter: adapter, deepseekAdapter: adapter}); t.after(() => service.close());
  const base = 'http://127.0.0.1:' + service.connection.port, route = '/v1/world-contexts/' + id + '/', headers = {Authorization: 'Bearer ' + service.connection.token, 'Content-Type': 'application/json'};
  const request = async (action, data, custom = headers) => { const result = await fetch(base + route + action, {method: data ? 'POST' : 'GET', headers: custom, body: data ? JSON.stringify(data) : undefined}); return [result.status, await result.json()]; };
  assert.equal((await request('capture', input(), {'Content-Type': 'application/json'}))[0], 401);
  assert.equal((await request('capture', input(), {...headers, Origin: 'https://example.com'}))[0], 403);
  const [status, saved] = await request('capture', input()); assert.equal(status, 200); assert.deepEqual((await request('record'))[1], saved);
  assert.deepEqual((await request('capture', input()))[1], saved);
  const disclosure = (await request('disclosure', task()))[1]; assert.equal(disclosure.modelSent, false);
  const [confirmed, receipt] = await request('confirm-disclosure', {confirmed: true, disclosureHash: disclosure.disclosureHash, task: task()}); assert.equal(confirmed, 200); assert.equal(receipt.state, 'confirmed-not-sent');
  assert.equal((await request('confirm-disclosure', {confirmed: true, disclosureHash: disclosure.disclosureHash, task: {...task(), model: 'changed'}}))[0], 400);
  assert.equal((await request('cancel', {}))[0], 200); assert.equal((await request('discard', {}))[0], 200); assert.equal((await request('record'))[0], 404); assert.equal(calls, 0);
});

test('lost capture receipt recovers by same ID after restart, without a new capture', async t => {
  const {dir, id} = await fixture(t); let calls = 0; const adapter = {close() {}, async generate() { calls++; throw new Error('No model'); }};
  let service = await startBridge({dataDir: dir, adapter, claudeAdapter: adapter, deepseekAdapter: adapter}); t.after(() => service.close());
  const base = 'http://127.0.0.1:' + service.connection.port, headers = {Authorization: 'Bearer ' + service.connection.token, 'Content-Type': 'application/json'};
  // Deliberately ignore the upload receipt; the server must retain its stable identity.
  const upload = await fetch(base + '/v1/world-contexts/' + id + '/capture', {method: 'POST', headers, body: JSON.stringify(input())}); assert.equal(upload.status, 200); await upload.arrayBuffer();
  await service.close(); service = await startBridge({dataDir: dir, adapter, claudeAdapter: adapter, deepseekAdapter: adapter});
  const result = await fetch('http://127.0.0.1:' + service.connection.port + '/v1/world-contexts/' + id + '/record', {headers: {Authorization: 'Bearer ' + service.connection.token}});
  assert.equal(result.status, 200); assert.equal((await result.json()).record.id, id); assert.equal(calls, 0);
});

test('generation cannot silently ignore unsupported context consent or edit fields', async t => {
  const {dir} = await fixture(t); let calls = 0; const adapter = {close() {}, async generate() { calls++; throw new Error('No model'); }};
  const service = await startBridge({dataDir: dir, adapter, claudeAdapter: adapter, deepseekAdapter: adapter}); t.after(() => service.close());
  for (const field of ['worldContext', 'contextId', 'contextConsent', 'worldPatch']) {
    const result = await fetch('http://127.0.0.1:' + service.connection.port + '/v1/jobs', {method: 'POST', headers: {Authorization: 'Bearer ' + service.connection.token, 'Content-Type': 'application/json'}, body: JSON.stringify({key: randomUUID(), prompt: 'edit context', model: 'fixture', [field]: 'unimplemented'})});
    assert.equal(result.status, 400); assert.match((await result.json()).error, /not connected/);
  }
  assert.equal(calls, 0);
});

test('million-cell high-entropy parsing and LOD leave the HTTP health lane responsive', {timeout: 30000}, async t => {
  const {dir, id} = await fixture(t); const adapter = {close() {}, async generate() { throw new Error('No model'); }};
  const service = await startBridge({dataDir: dir, adapter, claudeAdapter: adapter, deepseekAdapter: adapter}); t.after(() => service.close());
  const value = input(); value.selection.context = {min: [-64, -64, -64], max: [64, 0, 64]}; value.selection.edit = {min: [-4, -8, -4], max: [4, 0, 4]};
  const palette = ['stone', 'andesite', 'polished_andesite', 'quartz_block', 'white_concrete', 'glass'].map(state => ({state: 'minecraft:' + state, blockEntity: false}));
  value.capture.chunks = selectionChunks(value.selection).map(c => ({x: c.x, z: c.z, coverage: 'known', palette, runs: Array.from({length: regionCells(c.region)}, (_, i) => [i % palette.length, 1])}));
  const base = 'http://127.0.0.1:' + service.connection.port, headers = {Authorization: 'Bearer ' + service.connection.token, 'Content-Type': 'application/json'}, bytes = JSON.stringify(value);
  let completed = false; const upload = fetch(base + '/v1/world-contexts/' + id + '/capture', {method: 'POST', headers, body: bytes}).then(async r => { assert.equal(r.status, 200); const saved = await r.json(); completed = true; return saved; });
  const latencies = []; while (!completed && latencies.length < 30) { const start = performance.now(), health = await fetch(base + '/v1/health', {headers}); await health.arrayBuffer(); assert.equal(health.status, 200); latencies.push(performance.now() - start); await new Promise(resolve => setTimeout(resolve, 20)); }
  const saved = await upload; assert.equal(saved.summary.knownCells, 1048576); assert.equal(saved.summary.unknownCells, 0);
  assert.ok(latencies.length >= 2); assert.ok(Math.max(...latencies) < 2000, 'Health blocked by large context work');
  t.diagnostic(JSON.stringify({syntheticHighEntropyCells: 1048576, rawBytes: Buffer.byteLength(bytes), healthSamples: latencies.length, maximumHealthLatencyMs: Math.max(...latencies), gameFrameProof: false}));
});
