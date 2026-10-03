import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorldContextStore, CONTEXT_STORE_LIMITS} from '../../bridge/world-context-store.mjs';
import {contextHash} from '../../src/world/context-snapshot.mjs';
import {selectionChunks, regionCells} from '../../contracts/world-selection.mjs';
import {startBridge} from '../../bridge/server.mjs';

const raw = value => Buffer.from(JSON.stringify(value));
const intent = changes => ({format: 'WorldPatchDesignIntent', version: 1, purpose: 'world-patch-design', agent: 'codex',
  model: 'gpt-6.1-sol', effort: 'max', prompt: '  基于周围环境改造入口 🏙️\n保留街道  ', maximumCalls: 1, ...changes});
function capture() {
  const selection = {format: 'WorldSelection', version: 1, world: {worldId: 'review_fixture', dimension: 'minecraft:overworld', minY: -64, maxY: 320}, revision: 3,
    context: {min: [-2, -2, -2], max: [2, 2, 2]}, edit: {min: [-1, -1, -1], max: [1, 1, 1]}, protected: []};
  return {selection, capture: {fence: {start: 9, end: 9}, chunks: selectionChunks(selection).map(c => ({x: c.x, z: c.z, coverage: 'known',
    palette: [{state: 'minecraft:stone', blockEntity: false}], runs: [[0, regionCells(c.region)]]}))}};
}
async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir()), dir = await fs.realpath(await fs.mkdtemp(path.join(parent, 'voxel-patch-review-')));
  const store = new WorldContextStore({dataDir: dir}), id = randomUUID();
  t.after(async () => { await store.close(); assert.equal(await fs.realpath(dir), dir); assert.equal(path.dirname(dir), parent);
    assert.match(path.basename(dir), /^voxel-patch-review-/); await fs.rm(dir, {recursive: true}); });
  const saved = await store.operation('capture', id, raw(capture())), prepared = await store.operation('patch-task-disclosure', id, raw(intent()));
  return {dir, store, id, saved, prepared};
}
const confirmation = prepared => ({format: 'SavedWorldPatchDesignConfirmation', version: 1, purpose: 'world-patch-design', confirmed: true,
  taskDisclosureHash: prepared.taskDisclosureHash, taskHash: prepared.taskHash, requestHash: prepared.task.requestHash,
  disclosureHash: prepared.task.disclosure.disclosureHash, promptSha256: prepared.task.request.promptSha256});
const payload = prepared => ({intent: intent(), confirmation: confirmation(prepared)});
const review = f => f.store.operation('patch-review-task', f.id, raw(payload(f.prepared)));

test('exact independent content review binds the original saved capture and remains an unsent artifact', async t => {
  const f = await fixture(t), result = await review(f), {reviewHash, ...content} = result;
  assert.equal(result.format, 'SavedWorldPatchDesignReview'); assert.equal(result.version, 1); assert.equal(result.purpose, 'world-patch-design');
  assert.equal(reviewHash, contextHash(content)); assert.equal(result.state, 'reviewed-not-sent');
  for (const field of ['contextId', 'payloadSha256', 'recordHash', 'recordExpiresAt', 'snapshotHash', 'selectionHash', 'summaryHash', 'identity', 'taskDisclosureHash', 'taskHash']) {
    assert.deepEqual(result[field], f.prepared[field], field);
  }
  assert.equal(result.requestHash, f.prepared.task.requestHash); assert.equal(result.taskReview.taskHash, f.prepared.taskHash);
  assert.deepEqual(result.taskReview.recipient, f.prepared.task.disclosure.recipient); assert.equal(result.taskReview.maximumCalls, 1);
  for (const field of ['modelSent', 'sendingImplemented', 'canAuthorizePlacement', 'serverBaselineVerified', 'summaryConsentTransferable']) assert.equal(result[field], false, field);
  assert.equal(result.taskReview.modelSent, false); assert.equal(result.taskReview.sendingImplemented, false);
  assert.equal(result.sourceAuthority, 'client-submitted-block-facts-not-a-server-signature');
  assert.deepEqual(await review(f), result, 'Repeated content review is deterministic, not a new call reservation');
  assert.deepEqual(await f.store.operation('get', f.id), f.saved); assert.equal(result.modelPrompt, undefined);
  assert.deepEqual((await fs.readdir(path.join(f.dir, 'world-contexts', f.id))).sort(),
    ['_owner.json', 'payload.json', 'snapshot.json', 'summary.json', 'record.json'].sort(), 'Review never creates a journal/send/world artifact');
});

for (const field of ['taskDisclosureHash', 'taskHash', 'requestHash', 'disclosureHash', 'promptSha256']) {
  test('independent content review rejects changed ' + field, async t => {
    const f = await fixture(t), value = payload(f.prepared); value.confirmation[field] = '0'.repeat(64);
    await assert.rejects(f.store.operation('patch-review-task', f.id, raw(value)), /Independent confirmation/);
    assert.deepEqual(await f.store.operation('get', f.id), f.saved);
  });
}

for (const [name, change] of [['not confirmed', v => v.confirmation.confirmed = false], ['string confirmation', v => v.confirmation.confirmed = 'true'],
  ['old analysis format', v => v.confirmation.format = 'WorldContextConsent'], ['old analysis purpose', v => v.confirmation.purpose = 'context-analysis'],
  ['generic patch-only format', v => v.confirmation.format = 'WorldPatchDesignConfirmation'], ['unsupported version', v => v.confirmation.version = 2],
  ['injected send permission', v => v.confirmation.sendingImplemented = true], ['caller snapshot', v => v.snapshot = capture()],
  ['caller prepared task', v => v.task = {}], ['missing exact disclosure hash', v => delete v.confirmation.taskDisclosureHash]]) {
  test('patch content review refuses ' + name, async t => {
    const f = await fixture(t), value = payload(f.prepared); change(value);
    await assert.rejects(f.store.operation('patch-review-task', f.id, raw(value)));
  });
}

for (const [name, changes] of [['prompt whitespace', {prompt: intent().prompt + ' '}], ['model', {model: 'gpt-6.1-luna'}],
  ['provider', {agent: 'claude'}], ['effort', {effort: 'high'}], ['purpose', {purpose: 'context-analysis'}], ['call budget', {maximumCalls: 2}]]) {
  test('changed ' + name + ' cannot use the previous exact content review', async t => {
    const f = await fixture(t), value = payload(f.prepared); value.intent = intent(changes);
    await assert.rejects(f.store.operation('patch-review-task', f.id, raw(value)));
  });
}

test('same block facts and generic task cannot transfer confirmation across saved context IDs', async t => {
  const f = await fixture(t), second = randomUUID(); await f.store.operation('capture', second, raw(capture()));
  const prepared = await f.store.operation('patch-task-disclosure', second, raw(intent()));
  assert.equal(prepared.taskHash, f.prepared.taskHash, 'Identical captured facts and task content');
  assert.notEqual(prepared.taskDisclosureHash, f.prepared.taskDisclosureHash, 'Saved context identity is separately authoritative for review');
  await assert.rejects(f.store.operation('patch-review-task', second, raw(payload(f.prepared))), /Independent confirmation/);
  const result = await f.store.operation('patch-review-task', second, raw(payload(prepared))); assert.equal(result.contextId, second);
});

test('old confirmation cannot survive snapshot edits, expiry or discard', async t => {
  for (const mutate of [async f => { await fs.appendFile(path.join(f.dir, 'world-contexts', f.id, 'snapshot.json'), ' altered'); },
    async f => {
      const file = path.join(f.dir, 'world-contexts', f.id, 'record.json'), record = JSON.parse(await fs.readFile(file));
      record.createdAt = Date.now() - CONTEXT_STORE_LIMITS.lifetimeMs - 1000; record.expiresAt = record.createdAt + CONTEXT_STORE_LIMITS.lifetimeMs;
      const {recordHash, ...content} = record; record.recordHash = contextHash(content); await fs.writeFile(file, JSON.stringify(record));
    }, async f => { await f.store.operation('discard', f.id); }]) {
    const f = await fixture(t); await mutate(f); await assert.rejects(review(f));
  }
});

test('worker review preserves strict byte, JSON, UTF-8 and cancellation limits', async t => {
  const f = await fixture(t);
  for (const bytes of [new Uint8Array(), new Uint8Array(32769), Buffer.from([0xff]), Buffer.from('{')]) await assert.rejects(f.store.operation('patch-review-task', f.id, bytes));
  const abort = new AbortController(); abort.abort();
  await assert.rejects(f.store.operation('patch-review-task', f.id, raw(payload(f.prepared)), {signal: abort.signal}), /cancelled/);
});

test('paired HTTP content review does not consume P3 consent or invoke any provider', async t => {
  const f = await fixture(t); let calls = 0; const adapter = {close() {}, async generate() { calls++; throw Error('No model may be called'); }};
  const service = await startBridge({dataDir: f.dir, adapter, claudeAdapter: adapter, deepseekAdapter: adapter}); t.after(() => service.close());
  const base = 'http://127.0.0.1:' + service.connection.port, route = '/v1/world-contexts/' + f.id + '/',
    headers = {Authorization: 'Bearer ' + service.connection.token, 'Content-Type': 'application/json'};
  const request = async (action, {method = 'POST', value, custom = headers, bytes} = {}) => {
    const response = await fetch(base + route + action, {method, headers: custom, body: method === 'POST' ? bytes ?? JSON.stringify(value ?? payload(f.prepared)) : undefined});
    return {status: response.status, value: await response.json()};
  };
  assert.equal((await request('patch-review-task', {custom: {'Content-Type': 'application/json'}})).status, 401);
  assert.equal((await request('patch-review-task', {custom: {...headers, Origin: 'https://example.com'}})).status, 403);
  const result = await request('patch-review-task'); assert.equal(result.status, 200); assert.deepEqual(result.value, await review(f));
  assert.deepEqual((await request('patch-review-task')).value, result.value);
  assert.equal((await request('patch-review-task', {method: 'GET'})).status, 405);
  assert.equal((await request('patch-review-task', {bytes: Buffer.alloc(32769, 32)})).status, 413);
  assert.equal((await request('patch-review-task', {bytes: Buffer.from([0xff])})).status, 400);
  assert.equal((await request('patch-review-task', {custom: {...headers, 'Content-Type': 'text/plain'}})).status, 400);
  const analysisIntent = {...intent(), format: 'WorldContextTaskIntent', purpose: 'context-analysis'};
  const analysis = (await request('task-disclosure', {value: analysisIntent})).value;
  const analysisConsent = {confirmed: true, disclosureHash: analysis.disclosure.disclosureHash, task: analysis.disclosure.recipient};
  assert.equal((await request('confirm-disclosure', {value: analysisConsent})).status, 200);
  assert.equal((await request('patch-review-task', {value: {intent: intent(), confirmation: analysisConsent}})).status, 400);
  assert.equal((await request('confirm-disclosure', {value: result.value})).status, 413, 'Missing P3 task binding is rejected by the empty-byte guard');
  const wrongPurposeConfirmation = {confirmed: true, disclosureHash: result.value.taskReview.disclosureHash,
    task: {agent: intent().agent, model: intent().model, requestHash: result.value.requestHash}};
  assert.equal((await request('confirm-disclosure', {value: wrongPurposeConfirmation})).status, 400, 'Even a valid-shaped P3 confirmation cannot adopt a P4 exact-data hash');
  const capability = await fetch(base + '/v1/world-patch/capabilities', {headers}), advertised = await capability.json();
  assert.equal(advertised.reviewPreparationImplemented, true); assert.equal(advertised.sendingImplemented, false); assert.equal(advertised.placementImplemented, false);
  for (const action of ['send-patch', 'apply-patch']) assert.equal((await request(action)).status, 404);
  assert.equal(calls, 0); assert.deepEqual((await request('record', {method: 'GET'})).value, f.saved);
});
