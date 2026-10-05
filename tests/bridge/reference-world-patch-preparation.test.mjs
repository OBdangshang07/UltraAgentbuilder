import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorldContextStore, CONTEXT_STORE_LIMITS} from '../../bridge/world-context-store.mjs';
import {encodeReferencePixels} from '../../bridge/reference-pixels.mjs';
import {importReferenceSet} from '../../bridge/reference-attachments.mjs';
import {patchTaskSnapshot, patchTaskIntent} from '../fixtures/world-patch-task-fixture.mjs';
import {regionCells, selectionChunks} from '../../contracts/world-selection.mjs';
import {contextHash} from '../../src/world/context-snapshot.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {prepareSavedReferenceWorldPatchTaskDisclosure, reviewSavedReferenceWorldPatchTaskDisclosure} from '../../bridge/reference-world-patch-task-disclosure.mjs';
import {readReferenceWorldPatchPreparationSource} from '../../bridge/reference-world-patch-source.mjs';
import {startBridge} from '../../bridge/server.mjs';
import {referenceArchiveOperation} from '../../bridge/reference-archive.mjs';

const raw = value => Buffer.from(JSON.stringify(value));
async function fixture(t, {unknown = false, protectedCell = false} = {}) {
  const parent = await fs.realpath(os.tmpdir());
  const dir = await fs.realpath(await fs.mkdtemp(path.join(parent, 'voxel-joint-prepare-')));
  const store = new WorldContextStore({dataDir: dir}), id = randomUUID(), owner = randomUUID();
  t.after(async () => {
    await store.close(); assert.equal(await fs.realpath(dir), dir); assert.equal(path.dirname(dir), parent);
    assert.match(path.basename(dir), /^voxel-joint-prepare-/); await fs.rm(dir, {recursive: true});
  });
  const selection = patchTaskSnapshot({protectedCell}).selection;
  const capture = {fence: {start: 4, end: 4}, chunks: selectionChunks(selection).map(c => unknown
    ? {x: c.x, z: c.z, coverage: 'unknown', palette: [], runs: []}
    : {x: c.x, z: c.z, coverage: 'known', palette: [{state: 'minecraft:stone', blockEntity: false}], runs: [[0, regionCells(c.region)]]})};
  const saved = await store.operation('capture', id, raw({selection, capture}));
  const referenceRoot = path.join(dir, 'reference-drafts', owner); await fs.mkdir(referenceRoot, {recursive: true});
  const png = encodeReferencePixels(2, 1, Buffer.from([240,240,240,255,40,60,80,255]));
  const reference = await importReferenceSet(referenceRoot, {format: 'UserReferenceUpload', version: 1, mode: 'inspire',
    references: ['front','side'].map(view => ({png: png.toString('base64'), annotation: {purpose: 'style', view,
      caption: '保留环境，借鉴浅色框架与后退玻璃', scale: {dimension: 'bay', meters: 4}}}))});
  const input = {intent: {...patchTaskIntent(), format: 'ReferenceWorldPatchDesignIntent', purpose: 'reference-world-patch-design',
    referenceOwnerId: owner, referenceSetHash: reference.setHash},
    capability: {id: 'gpt-6.1-sol', supportsImages: true, efforts: ['high','max']}, runtimeHash: 'a'.repeat(64)};
  return {dir, store, id, owner, saved, reference, input, referenceRoot, capture, selection};
}
const prepare = f => f.store.operation('reference-patch-task-disclosure', f.id, raw(f.input));
const confirmation = p => ({format: 'SavedReferenceWorldPatchDesignConfirmation', version: 1,
  purpose: 'reference-world-patch-design', confirmed: true, taskDisclosureHash: p.taskDisclosureHash,
  taskHash: p.taskHash, requestHash: p.task.requestHash, disclosureHash: p.task.disclosure.disclosureHash,
  promptSha256: p.task.request.promptSha256, referenceSetHash: p.task.request.referenceSetHash,
  runtimeHash: p.task.request.runtimeHash, imageCapabilityHash: p.task.request.imageCapabilityHash});
const review = (f, p, changes = {}) => f.store.operation('reference-patch-review-task', f.id,
  raw({...f.input, confirmation: confirmation(p), ...changes}));
async function inventory(root, prefix = '') {
  const result = {};
  for (const item of await fs.readdir(root, {withFileTypes: true})) {
    const name = prefix + item.name, full = path.join(root, item.name);
    assert.equal(item.isSymbolicLink(), false);
    if (item.isDirectory()) Object.assign(result, await inventory(full, name + '/'));
    else result[name] = hash(await fs.readFile(full));
  }
  return result;
}

test('joint worker reads saved original context and reference pixels without model or write authority', async t => {
  const f = await fixture(t);
  const task = await f.store.operation('reference-patch-task-disclosure', f.id, raw(f.input));
  assert.equal(task.format, 'SavedReferenceWorldPatchTaskDisclosure');
  assert.equal(task.contextId, f.id); assert.equal(task.recordHash, f.saved.record.recordHash);
  assert.equal(task.snapshotHash, f.saved.record.snapshotHash); assert.equal(task.recordExpiresAt, f.saved.record.expiresAt);
  assert.equal(task.task.request.referenceSetHash, f.reference.setHash);
  for (const field of ['modelSent','sendingImplemented','serverBaselineVerified','canAuthorizePlacement']) assert.equal(task[field], false);
  assert.equal(JSON.stringify(task).includes(f.dir), false);
  assert.deepEqual(await f.store.operation('get', f.id), f.saved);
});

test('saved joint preparation and repeat review preserve every original file byte without consent consumption', async t => {
  const f = await fixture(t), before = await inventory(f.dir), p = await prepare(f), r = await review(f, p);
  const {reviewHash, ...content} = r; assert.equal(reviewHash, contextHash(content));
  assert.equal(r.format, 'SavedReferenceWorldPatchDesignReview'); assert.equal(r.state, 'reviewed-not-sent');
  assert.equal(r.taskReview.maximumCalls, 1); assert.equal(r.taskReview.referenceSetHash, f.reference.setHash);
  for (const field of ['contextId','payloadSha256','recordHash','recordExpiresAt','snapshotHash','selectionHash','summaryHash','taskHash','taskDisclosureHash']) assert.deepEqual(r[field], p[field]);
  for (const field of ['modelSent','sendingImplemented','serverBaselineVerified','canAuthorizePlacement','summaryConsentTransferable','referenceConsentTransferable']) assert.equal(r[field], false);
  assert.deepEqual(await prepare(f), p); assert.deepEqual(await review(f, p), r);
  assert.deepEqual(await inventory(f.dir), before);
  assert.equal(JSON.stringify(r).includes(f.dir), false); assert.equal(Object.hasOwn(r, 'token'), false);
});

test('same facts under another original capture ID cannot borrow joint review', async t => {
  const f = await fixture(t), p = await prepare(f), secondId = randomUUID();
  await f.store.operation('capture', secondId, raw({selection: f.selection, capture: f.capture}));
  const next = {...f, id: secondId}, nextTask = await prepare(next);
  assert.equal(p.taskHash, nextTask.taskHash); assert.notEqual(p.taskDisclosureHash, nextTask.taskDisclosureHash);
  await assert.rejects(review(next, p), /New confirmation/); assert.equal((await review(next, nextTask)).contextId, secondId);
});

for (const [name, change] of [
  ['task text', i => {i.intent.prompt += ' ';}], ['runtime', i => {i.runtimeHash = 'b'.repeat(64);}],
  ['model', i => {i.intent.model = 'gpt-6.1-luna'; i.capability.id = i.intent.model;}],
  ['effort', i => {i.intent.effort = 'high';}], ['capability declaration', i => {i.capability.efforts = ['medium','max'];}],
]) test('stored joint review rejects changed ' + name, async t => {
  const f = await fixture(t), p = await prepare(f); change(f.input);
  const next = await prepare(f); assert.notEqual(next.taskDisclosureHash, p.taskDisclosureHash);
  await assert.rejects(review(f, p), /New confirmation/); await review(f, next);
});

for (const field of ['taskDisclosureHash','taskHash','requestHash','disclosureHash','promptSha256','referenceSetHash','runtimeHash','imageCapabilityHash']) {
  test('stored joint confirmation binds ' + field, async t => {
    const f = await fixture(t), p = await prepare(f), c = confirmation(p); c[field] = 'f'.repeat(64);
    await assert.rejects(review(f, p, {confirmation: c}), /New confirmation/);
  });
}

test('legacy confirmations, consent hints and caller pixels cannot acquire joint stored review', async t => {
  const f = await fixture(t), p = await prepare(f);
  const legacy = await f.store.operation('patch-task-disclosure', f.id, raw(patchTaskIntent()));
  const old = {format: 'SavedWorldPatchDesignConfirmation', version: 1, purpose: 'world-patch-design', confirmed: true,
    taskDisclosureHash: legacy.taskDisclosureHash, taskHash: legacy.taskHash, requestHash: legacy.task.requestHash,
    disclosureHash: legacy.task.disclosure.disclosureHash, promptSha256: legacy.task.request.promptSha256};
  for (const c of [old, {format: 'ReferenceSendConfirmation', accepted: true}, {...confirmation(p), confirmed: false}, {...confirmation(p), version: 2}]) await assert.rejects(review(f, p, {confirmation: c}));
  for (const extra of [{reference: {images: ['fixture.png']}}, {snapshot: f.selection}, {now: 0}, {sourcePath: 'fixture/image.png'}, {consentId: randomUUID()}]) {
    await assert.rejects(f.store.operation('reference-patch-task-disclosure', f.id, raw({...f.input, ...extra})));
  }
  await assert.rejects(f.store.operation('patch-review-task', f.id, raw({intent: patchTaskIntent(), confirmation: confirmation(p)})));
});

for (const [name, change] of [
  ['text-only capability', i => {i.capability.supportsImages = false;}],
  ['undeclared effort', i => {i.capability.efforts = ['low'];}], ['missing capability', i => {i.capability = null;}],
  ['extra call', i => {i.intent.maximumCalls = 2;}], ['world authority', i => {i.intent.canAuthorizePlacement = true;}],
  ['reference path', i => {i.intent.referenceOwnerId = '../other';}], ['reference URL', i => {i.intent.referenceSetHash = 'https://example.com/picture';}],
]) test('joint worker refuses ' + name + ' without touching original sources', async t => {
  const f = await fixture(t), before = await inventory(f.dir); change(f.input);
  await assert.rejects(prepare(f)); assert.deepEqual(await inventory(f.dir), before);
});

for (const [name, relative] of [['_store.json', f => 'world-contexts/_store.json'],
  ...['_owner.json','payload.json','snapshot.json','summary.json','record.json'].map(name => [name, f => 'world-contexts/' + f.id + '/' + name]),
  ['reference manifest', f => 'reference-drafts/' + f.owner + '/reference-sets/' + f.reference.setHash + '/manifest.json'],
  ['reference pixels', f => 'reference-drafts/' + f.owner + '/reference-sets/' + f.reference.setHash + '/image-0.png']]) {
  test('joint worker rejects changed original ' + name + ' and preserves evidence', async t => {
    const f = await fixture(t), p = await prepare(f), target = path.join(f.dir, relative(f));
    await fs.appendFile(target, ' changed'); const before = await inventory(f.dir);
    await assert.rejects(prepare(f)); await assert.rejects(review(f, p)); assert.deepEqual(await inventory(f.dir), before);
  });
}

test('self-rehashed stored snapshot cannot replace the original payload', async t => {
  const f = await fixture(t), target = path.join(f.dir, 'world-contexts', f.id, 'snapshot.json');
  const changed = patchTaskSnapshot({revision: 10}); await fs.writeFile(target, JSON.stringify(changed));
  await assert.rejects(prepare(f), /snapshot mismatch/); assert.deepEqual(JSON.parse(await fs.readFile(target)), changed);
});

test('canonical new reference selection invalidates the old picture confirmation', async t => {
  const f = await fixture(t), p = await prepare(f);
  const png = encodeReferencePixels(1, 1, Buffer.from([120,140,160,255]));
  const set = await importReferenceSet(f.referenceRoot, {format: 'UserReferenceUpload', version: 1, mode: 'reconstruct',
    references: [{png: png.toString('base64'), annotation: {purpose: 'exterior', view: 'rear', caption: '另一张合成图'}}]});
  f.input.intent.referenceSetHash = set.setHash;
  const next = await prepare(f); await assert.rejects(review(f, p), /New confirmation/); await review(f, next);
});

test('expired saved context is not refreshed, deleted or confirmed again', async t => {
  const f = await fixture(t), p = await prepare(f), target = path.join(f.dir, 'world-contexts', f.id, 'record.json');
  const record = JSON.parse(await fs.readFile(target)); record.createdAt = Date.now() - CONTEXT_STORE_LIMITS.lifetimeMs - 1000;
  record.expiresAt = record.createdAt + CONTEXT_STORE_LIMITS.lifetimeMs;
  const {recordHash, ...content} = record; record.recordHash = contextHash(content); await fs.writeFile(target, JSON.stringify(record));
  const before = await inventory(f.dir); await assert.rejects(prepare(f), /expired/); await assert.rejects(review(f, p), /expired/);
  assert.deepEqual(await inventory(f.dir), before);
});

test('unknown block facts and original protection cannot turn into reference-derived air or editable space', async t => {
  const f = await fixture(t, {unknown: true, protectedCell: true}), p = await prepare(f);
  assert.equal(p.task.disclosure.cells.exactUnknown, 81); assert.equal(p.task.disclosure.cells.exactKnown, 0);
  assert.deepEqual(p.task.disclosure.protected, f.selection.protected);
  assert.equal(p.task.canAuthorizePlacement, false); assert.equal((await review(f, p)).canAuthorizePlacement, false);
});

test('stored preparation survives lane reopening, but discarded capture cannot be recreated', async t => {
  const f = await fixture(t), p = await prepare(f); await f.store.close();
  f.store = new WorldContextStore({dataDir: f.dir}); t.after(() => f.store.close());
  assert.deepEqual(await prepare(f), p); await review(f, p);
  await f.store.operation('discard', f.id); const before = await inventory(f.dir);
  await assert.rejects(prepare(f)); await assert.rejects(review(f, p)); assert.deepEqual(await inventory(f.dir), before);
});

test('joint operation does not create a missing or unowned context store', async t => {
  const f = await fixture(t), dataDir = path.join(f.dir, 'empty'); await fs.mkdir(dataDir);
  const store = new WorldContextStore({dataDir}); t.after(() => store.close());
  await assert.rejects(store.operation('reference-patch-task-disclosure', f.id, raw(f.input)));
  assert.deepEqual(await fs.readdir(dataDir), []);
  await fs.mkdir(path.join(dataDir, 'world-contexts')); await fs.writeFile(path.join(dataDir, 'world-contexts', 'unknown.txt'), 'preserve');
  await assert.rejects(store.operation('reference-patch-task-disclosure', f.id, raw(f.input)));
  assert.deepEqual(await fs.readdir(path.join(dataDir, 'world-contexts')), ['unknown.txt']);
});

test('byte bounds, invalid UTF-8/JSON, cancellation and closed lanes reject before source work', async t => {
  const f = await fixture(t), before = await inventory(f.dir);
  for (const operation of ['reference-patch-task-disclosure','reference-patch-review-task']) {
    for (const bytes of [new Uint8Array(), new Uint8Array(32769), Buffer.from([0xff]), Buffer.from('{'), raw(f.input).toString()]) await assert.rejects(f.store.operation(operation, f.id, bytes));
    const abort = new AbortController(); abort.abort();
    await assert.rejects(f.store.operation(operation, f.id, raw(f.input), {signal: abort.signal}), /cancelled/);
  }
  assert.deepEqual(await inventory(f.dir), before); await f.store.close(); await assert.rejects(prepare(f), /closed/);
});

test('pure saved helper checks expiration again after picture preparation, without a public clock override', async t => {
  const f = await fixture(t), source = await readReferenceWorldPatchPreparationSource({dataDir: f.dir, contextId: f.id, intent: f.input.intent});
  const input = {...f.input, reference: source.reference}; let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const p = prepareSavedReferenceWorldPatchTaskDisclosure(source.saved, input);
  assert.deepEqual(reviewSavedReferenceWorldPatchTaskDisclosure(source.saved, input, confirmation(p)).taskHash, p.taskHash);
  const capability = {...input.capability}; Object.defineProperty(capability, 'supportsImages', {enumerable: true,
    get() {now = source.saved.record.expiresAt; return true;}});
  assert.throws(() => prepareSavedReferenceWorldPatchTaskDisclosure(source.saved, {...input, capability}), /expired/);
});

for (const target of ['context','reference']) test('joint source directory junction cannot redirect to a copy', async t => {
  const f = await fixture(t), original = target === 'context' ? path.join(f.dir, 'world-contexts', f.id)
    : path.join(f.referenceRoot, 'reference-sets', f.reference.setHash);
  const replacement = path.join(f.dir, target + '-preserved'); await fs.rename(original, replacement);
  await fs.symlink(replacement, original, process.platform === 'win32' ? 'junction' : 'dir');
  const before = await inventory(replacement); await assert.rejects(prepare(f), /link\/type/);
  assert.deepEqual(await inventory(replacement), before); assert.equal((await fs.lstat(original)).isSymbolicLink(), true);
});

for (const kind of ['context','reference']) test('joint ' + kind + ' source hardlink is refused even when bytes and hash match', async t => {
  const f = await fixture(t), target = kind === 'reference' ? path.join(f.referenceRoot, 'reference-sets', f.reference.setHash, 'image-0.png')
    : path.join(f.dir, 'world-contexts', f.id, 'payload.json');
  const linked = path.join(f.dir, 'preserved-hardlink.png'); await fs.link(target, linked);
  const original = await fs.readFile(target); await assert.rejects(prepare(f), /link\/type\/size/);
  assert.deepEqual(await fs.readFile(target), original); assert.deepEqual(await fs.readFile(linked), original);
});

for (const kind of ['context','reference']) test('joint ' + kind + ' preparation does not adopt unknown original files', async t => {
  const f = await fixture(t), folder = kind === 'context' ? path.join(f.dir, 'world-contexts', f.id)
    : path.join(f.referenceRoot, 'reference-sets', f.reference.setHash);
  await fs.writeFile(path.join(folder, 'unknown.txt'), 'retain this authored evidence');
  const before = await inventory(f.dir); await assert.rejects(prepare(f), /unknown/); assert.deepEqual(await inventory(f.dir), before);
});

test('an archived owner cannot be manually recreated to reuse original picture consent', async t => {
  const f = await fixture(t), p = await prepare(f);
  const snapshot = await referenceArchiveOperation({dataDir: f.dir, operation: 'archive-snapshot', ownerId: f.owner});
  const c = {format: 'ReferenceDraftArchiveConfirmation', version: 1, action: 'archive-reference-draft', actionId: randomUUID(),
    ownerId: f.owner, snapshotHash: snapshot.snapshotHash, accepted: true};
  const archived = await referenceArchiveOperation({dataDir: f.dir, operation: 'archive-confirm', ownerId: f.owner, input: raw(c)});
  assert.equal(archived.state, 'archived');
  await fs.cp(path.join(f.dir, 'reference-archives', c.actionId, f.owner), f.referenceRoot, {recursive: true, errorOnExist: true});
  const before = await inventory(f.dir); await assert.rejects(prepare(f), /original archive action/);
  await assert.rejects(review(f, p), /original archive action/); assert.deepEqual(await inventory(f.dir), before);
});

test('internal stored preparation adds no public SEND, preparation or apply route', async t => {
  const f = await fixture(t); let calls = 0;
  const adapter = {close() {}, async generate() {calls++; throw Error('No provider allowed');}};
  const service = await startBridge({dataDir: f.dir, adapter, claudeAdapter: adapter, deepseekAdapter: adapter}); t.after(() => service.close());
  const headers = {Authorization: 'Bearer ' + service.connection.token, 'Content-Type': 'application/json'};
  for (const action of ['reference-patch-task-disclosure','reference-patch-review-task','reference-patch-send','reference-patch-apply']) {
    const response = await fetch('http://127.0.0.1:' + service.connection.port + '/v1/world-contexts/' + f.id + '/' + action,
      {method: 'POST', headers, body: JSON.stringify(f.input)}); assert.equal(response.status, 404);
  }
  assert.equal(calls, 0); assert.deepEqual(await f.store.operation('get', f.id), f.saved);
});
