import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {WorldContextStore} from '../../bridge/world-context-store.mjs';
import {encodeReferencePixels} from '../../bridge/reference-pixels.mjs';
import {importReferenceSet} from '../../bridge/reference-attachments.mjs';
import {patchTaskSnapshot, patchTaskIntent} from '../fixtures/world-patch-task-fixture.mjs';
import {regionCells, selectionChunks} from '../../contracts/world-selection.mjs';
import {contextHash, createContextSnapshot} from '../../src/world/context-snapshot.mjs';
import {startBridge} from '../../bridge/server.mjs';
import {readFrozenWorldPatchTaskCapsule} from '../../bridge/world-patch-task-capsule.mjs';
import {freezeReferenceWorldPatchTask, readFrozenReferenceWorldPatchTaskCapsule,
  readFrozenReferenceWorldPatchTaskSource, REFERENCE_PATCH_CAPSULE_LIMITS} from '../../bridge/reference-world-patch-task-capsule.mjs';

const raw = value => Buffer.from(JSON.stringify(value));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const confirmationFor = prepared => ({format: 'SavedReferenceWorldPatchDesignConfirmation', version: 1,
  purpose: 'reference-world-patch-design', confirmed: true, taskDisclosureHash: prepared.taskDisclosureHash,
  taskHash: prepared.taskHash, requestHash: prepared.task.requestHash, disclosureHash: prepared.task.disclosure.disclosureHash,
  promptSha256: prepared.task.request.promptSha256, referenceSetHash: prepared.task.request.referenceSetHash,
  runtimeHash: prepared.task.request.runtimeHash, imageCapabilityHash: prepared.task.request.imageCapabilityHash});
async function fixture(t, options = {}) {
  const parent = await fs.realpath(os.tmpdir()), dir = await fs.realpath(await fs.mkdtemp(path.join(parent, 'voxel-joint-capsule-')));
  const store = new WorldContextStore({dataDir: dir}), id = randomUUID(), owner = randomUUID();
  t.after(async () => {await store.close(); assert.equal(await fs.realpath(dir), dir); assert.equal(path.dirname(dir), parent);
    assert.match(path.basename(dir), /^voxel-joint-capsule-/); await fs.rm(dir, {recursive: true});});
  const selection = patchTaskSnapshot(options).selection;
  const capture = {fence: {start: 4, end: 4}, chunks: selectionChunks(selection).map(c => ({x: c.x, z: c.z,
    coverage: 'known', palette: [{state: 'minecraft:stone', blockEntity: false}], runs: [[0, regionCells(c.region)]]}))};
  const payload = Buffer.from(' \n' + JSON.stringify({selection, capture}) + ' \n');
  const saved = await store.operation('capture', id, payload);
  const referenceRoot = path.join(dir, 'reference-drafts', owner); await fs.mkdir(referenceRoot, {recursive: true});
  const image = encodeReferencePixels(1, 1, Buffer.from([220,235,240,255]));
  const reference = await importReferenceSet(referenceRoot, {format: 'UserReferenceUpload', version: 1, mode: 'inspire',
    references: ['front','side'].map(view => ({png: image.toString('base64'), annotation: {purpose: 'style', view, caption: '合成浅色幕墙'}}))});
  const input = {intent: {...patchTaskIntent(), format: 'ReferenceWorldPatchDesignIntent', purpose: 'reference-world-patch-design',
    referenceOwnerId: owner, referenceSetHash: reference.setHash}, capability: {id: 'gpt-6.1-sol', supportsImages: true, efforts: ['high','max']},
    runtimeHash: 'a'.repeat(64)};
  const prepared = await store.operation('reference-patch-task-disclosure', id, raw(input));
  const confirmation = confirmationFor(prepared);
  return {dir, store, id, owner, image, payload, saved, reference, input, prepared, confirmation,
    root: path.join(dir, 'reference-world-patch-tasks')};
}
const freeze = f => freezeReferenceWorldPatchTask({dataDir: f.dir, contextId: f.id, input: f.input, confirmation: f.confirmation});
const workerFreeze = f => f.store.operation('reference-patch-freeze-task', f.id, raw({...f.input, confirmation: f.confirmation}));
const audit = (f, receipt) => f.store.operation('reference-patch-frozen-task', receipt.capsuleId);
const capsule = (f, receipt) => path.join(f.root, receipt.capsuleId);
const changeInput = (f, changes) => ({...f.input, ...changes, intent: {...f.input.intent, ...changes.intent}});
async function rewriteWithInventory(dir, name, value) {
  const bytes = value instanceof Uint8Array ? Buffer.from(value) : raw(value); await fs.writeFile(path.join(dir, name), bytes);
  const file = path.join(dir, 'manifest.json'), manifest = JSON.parse(await fs.readFile(file)), entry = manifest.files.find(f => f.path === name);
  manifest.bytes += bytes.length - entry.bytes; entry.bytes = bytes.length; entry.sha256 = sha(bytes);
  const {manifestHash, ...content} = manifest; manifest.manifestHash = contextHash(content); await fs.writeFile(file, raw(manifest));
}
async function inventory(dir) {
  const result = {};
  for (const name of await fs.readdir(dir)) {
    const target = path.join(dir, name), stat = await fs.lstat(target);
    result[name] = stat.isDirectory() && !stat.isSymbolicLink() ? await inventory(target)
      : stat.isFile() ? sha(await fs.readFile(target)) : 'link';
  }
  return result;
}

test('joint capsule freezes original sources and exact confirmation, without any model or world authority', async t => {
  const f = await fixture(t), receipt = await freeze(f);
  assert.equal(receipt.format, 'FrozenReferenceWorldPatchTaskReceipt'); assert.equal(receipt.maximumCalls, 1);
  assert.equal(receipt.state, 'frozen-not-sent'); assert.equal(receipt.referenceSetHash, f.reference.setHash);
  assert.equal(receipt.taskDisclosureHash, f.prepared.taskDisclosureHash); assert.equal(receipt.recordHash, f.saved.record.recordHash);
  for (const field of ['modelSent','sendingImplemented','serverBaselineVerified','canAuthorizePlacement']) assert.equal(receipt[field], false);
  assert.equal(JSON.stringify(receipt).includes(f.dir), false); assert.equal(Object.hasOwn(receipt, 'modelPrompt'), false);
  assert.deepEqual(await readFrozenReferenceWorldPatchTaskCapsule({dataDir: f.dir, capsuleId: receipt.capsuleId}), receipt);
  const source = await readFrozenReferenceWorldPatchTaskSource({dataDir: f.dir, capsuleId: receipt.capsuleId});
  assert.deepEqual(source.prepared, f.prepared); assert.deepEqual(Buffer.from(source.reference.images[0]), f.image);
  const dir = capsule(f, receipt), manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json')));
  assert.deepEqual(manifest.files.map(f => f.path), ['_owner.json','context-store.json','context-owner.json','record.json',
    'payload.json','snapshot.json','summary.json','reference-manifest.json','joint-input.json','base-disclosure.json',
    'task-disclosure.json','confirmation.json','review.json','image-0.png','image-1.png']);
  assert.equal(manifest.imageCount, 2);
  assert.deepEqual(await fs.readFile(path.join(dir, 'payload.json')), f.payload);
  for (const entry of manifest.files) {const bytes = await fs.readFile(path.join(dir, entry.path));
    assert.equal(bytes.length, entry.bytes); assert.equal(sha(bytes), entry.sha256);}
  for (const field of ['ownerId','files','modelPrompt','snapshot','payload','confirmation','sendToken']) assert.equal(receipt[field], undefined);
  assert.equal((await fs.readdir(dir)).includes('legacy-confirmation.json'), false);
  assert.equal((await fs.readdir(dir)).includes('legacy-review.json'), false);
  const original = await inventory(f.root); assert.deepEqual(await freeze(f), receipt);
  assert.deepEqual(await workerFreeze(f), receipt); assert.deepEqual(await audit(f, receipt), receipt);
  assert.deepEqual(await inventory(f.root), original); assert.deepEqual(await f.store.operation('get', f.id), f.saved);
});

test('worker restart and source discard recover only the immutable original audit, without recreating a context store', async t => {
  const f = await fixture(t), receipt = await workerFreeze(f); await f.store.close();
  const reopened = new WorldContextStore({dataDir: f.dir}); t.after(() => reopened.close());
  assert.deepEqual(await reopened.operation('reference-patch-freeze-task', f.id, raw({...f.input, confirmation: f.confirmation})), receipt);
  await reopened.operation('discard', f.id);
  const sourceRoot = path.join(f.dir, 'world-contexts'), preserved = path.join(f.dir, 'discarded-context-store');
  await fs.rename(sourceRoot, preserved);
  assert.deepEqual(await reopened.operation('reference-patch-frozen-task', receipt.capsuleId), receipt);
  await assert.rejects(fs.stat(sourceRoot), {code: 'ENOENT'});
  await assert.rejects(reopened.operation('reference-patch-freeze-task', f.id, raw({...f.input, confirmation: f.confirmation})));
  await assert.rejects(fs.stat(sourceRoot), {code: 'ENOENT'});
  const source = await readFrozenReferenceWorldPatchTaskSource({dataDir: f.dir, capsuleId: receipt.capsuleId});
  assert.deepEqual(source.saved.snapshot, createContextSnapshot(JSON.parse(f.payload).selection, JSON.parse(f.payload).capture));
  assert.deepEqual(await inventory(preserved), {'_store.json': sha(await fs.readFile(path.join(preserved, '_store.json')))});
});

test('expired original can be audited, not refreshed into a new confirmed task', async t => {
  const f = await fixture(t), receipt = await freeze(f), before = await inventory(f.dir);
  t.mock.timers.enable({apis: ['Date'], now: f.saved.record.expiresAt + 1000});
  assert.deepEqual(await readFrozenReferenceWorldPatchTaskCapsule({dataDir: f.dir, capsuleId: receipt.capsuleId}), receipt);
  await assert.rejects(freeze(f), /expired/); assert.deepEqual(await inventory(f.dir), before);
  assert.equal(receipt.modelSent, false); assert.equal(receipt.canAuthorizePlacement, false);
});

for (const file of ['_owner.json','context-owner.json','context-store.json','payload.json','record.json','snapshot.json','summary.json',
  'reference-manifest.json','image-0.png','image-1.png','joint-input.json','base-disclosure.json','task-disclosure.json',
  'confirmation.json','review.json','manifest.json']) {
  test('frozen joint ' + file + ' corruption is rejected and preserved', async t => {
    const f = await fixture(t), receipt = await freeze(f), target = path.join(capsule(f, receipt), file);
    await fs.appendFile(target, ' broken'); const before = await inventory(f.dir);
    await assert.rejects(audit(f, receipt)); await assert.rejects(freeze(f));
    assert.deepEqual(await inventory(f.dir), before);
  });
}

for (const [name, file, mutate] of [
  ['review authority','review.json', v => v.canAuthorizePlacement = true],
  ['joint confirmation','confirmation.json', v => v.confirmed = false],
  ['task model','joint-input.json', v => v.intent.model = 'gpt-6.1-luna'],
  ['capability','joint-input.json', v => v.capability.supportsImages = false],
  ['runtime','joint-input.json', v => v.runtimeHash = 'b'.repeat(64)],
  ['summary coverage','summary.json', v => v.knownCells = 0],
  ['context ownership','context-owner.json', v => v.ownerId = randomUUID()],
  ['context store','context-store.json', v => v.ownerId = randomUUID()],
  ['picture annotation','reference-manifest.json', v => v.references[0].annotation.caption = 'Changed'],
  ['text baseline','base-disclosure.json', v => v.task.request.intent.prompt += ' changed'],
  ['task authority','task-disclosure.json', v => v.modelSent = true],
]) test('self-rehashed inventory cannot legitimize changed joint ' + name, async t => {
  const f = await fixture(t), receipt = await freeze(f), dir = capsule(f, receipt), value = JSON.parse(await fs.readFile(path.join(dir, file)));
  mutate(value); await rewriteWithInventory(dir, file, value); const before = await inventory(f.dir);
  await assert.rejects(audit(f, receipt)); assert.deepEqual(await inventory(f.dir), before);
  const input = changeInput(f, {intent: {prompt: 'Another synthetic entry'}}), prepared = await f.store.operation('reference-patch-task-disclosure', f.id, raw(input));
  await assert.rejects(f.store.operation('reference-patch-freeze-task', f.id, raw({...input, confirmation: confirmationFor(prepared)})));
  assert.deepEqual(await inventory(f.dir), before, 'A new publication cannot adopt a corrupt existing capsule');
});

test('self-rehashed snapshot and picture bytes remain bound to original block payload and selected reference manifest', async t => {
  for (const kind of ['snapshot','picture']) {
    const f = await fixture(t), receipt = await freeze(f), dir = capsule(f, receipt);
    if (kind === 'snapshot') {
      const input = JSON.parse(f.payload); input.capture.chunks[0].palette[0].state = 'minecraft:gold_block';
      await rewriteWithInventory(dir, 'snapshot.json', createContextSnapshot(input.selection, input.capture));
    } else await rewriteWithInventory(dir, 'image-0.png', encodeReferencePixels(1, 1, Buffer.from([0,0,0,255])));
    await assert.rejects(audit(f, receipt));
  }
});

for (const [name, changes] of [
  ['prompt', {intent: {prompt: 'Different entry'}}], ['model', {intent: {model: 'gpt-6.1-luna'}}],
  ['agent', {intent: {agent: 'claude'}}], ['effort', {intent: {effort: 'high'}}],
  ['pictures', {intent: {referenceSetHash: 'b'.repeat(64)}}], ['owner', {intent: {referenceOwnerId: randomUUID()}}],
  ['budget', {intent: {maximumCalls: 2}}], ['runtime', {runtimeHash: 'b'.repeat(64)}],
  ['advertisement', {capability: {id: 'gpt-6.1-sol', supportsImages: true, efforts: ['max']}}],
]) test('changed joint ' + name + ' cannot reuse the old saved confirmation', async t => {
  const f = await fixture(t), input = changeInput(f, changes), before = await inventory(f.dir);
  await assert.rejects(f.store.operation('reference-patch-freeze-task', f.id, raw({...input, confirmation: f.confirmation})));
  await assert.rejects(fs.stat(f.root), {code: 'ENOENT'}); assert.deepEqual(await inventory(f.dir), before);
});

test('joint and legacy confirmations and capsule protocols cannot be promoted into one another', async t => {
  const f = await fixture(t), legacy = await f.store.operation('patch-task-disclosure', f.id, raw(patchTaskIntent()));
  const confirmation = {format: 'SavedWorldPatchDesignConfirmation', version: 1, purpose: 'world-patch-design', confirmed: true,
    taskDisclosureHash: legacy.taskDisclosureHash, taskHash: legacy.taskHash, requestHash: legacy.task.requestHash,
    disclosureHash: legacy.task.disclosure.disclosureHash, promptSha256: legacy.task.request.promptSha256};
  await assert.rejects(f.store.operation('reference-patch-freeze-task', f.id, raw({...f.input, confirmation})));
  await assert.rejects(f.store.operation('patch-freeze-task', f.id, raw({intent: patchTaskIntent(), confirmation: f.confirmation})));
  const legacyReceipt = await f.store.operation('patch-freeze-task', f.id, raw({intent: patchTaskIntent(), confirmation}));
  const jointReceipt = await workerFreeze(f);
  await assert.rejects(f.store.operation('reference-patch-frozen-task', legacyReceipt.capsuleId));
  await assert.rejects(f.store.operation('patch-frozen-task', jointReceipt.capsuleId));
  await assert.rejects(readFrozenWorldPatchTaskCapsule({root: f.root, capsuleId: jointReceipt.capsuleId}));
  await assert.rejects(f.store.operation('reference-patch-freeze-task', f.id, raw({...f.input, confirmation: jointReceipt})));
  assert.equal(jointReceipt.canAuthorizePlacement, false); assert.equal(jointReceipt.modelSent, false);
});

test('exact new tasks receive distinct identities, while another capture cannot borrow old confirmation', async t => {
  const f = await fixture(t), first = await workerFreeze(f), input = changeInput(f, {intent: {prompt: 'Second synthetic entry'}});
  const prepared = await f.store.operation('reference-patch-task-disclosure', f.id, raw(input));
  const second = await f.store.operation('reference-patch-freeze-task', f.id, raw({...input, confirmation: confirmationFor(prepared)}));
  assert.notEqual(first.capsuleId, second.capsuleId); assert.notEqual(first.taskHash, second.taskHash);
  const id = randomUUID(); await f.store.operation('capture', id, f.payload);
  await assert.rejects(f.store.operation('reference-patch-freeze-task', id, raw({...f.input, confirmation: f.confirmation})), /confirmation/);
  assert.deepEqual(await audit(f, first), first); assert.deepEqual(await audit(f, second), second);
});

test('private capability account and path hints are not persisted or returned', async t => {
  const f = await fixture(t); f.input.capability = {...f.input.capability, accountId: 'private-fixture-account',
    accountPath: '/private-fixture-account', accessToken: 'private-fixture-token'};
  const receipt = await workerFreeze(f), dir = capsule(f, receipt);
  for (const name of ['joint-input.json','task-disclosure.json','review.json','manifest.json']) {
    const value = await fs.readFile(path.join(dir, name), 'utf8'); assert.equal(value.includes('private-fixture-'), false);
  }
  assert.equal(JSON.stringify(receipt).includes('private-fixture-'), false);
  assert.deepEqual(await audit(f, receipt), receipt);
});

for (const kind of ['unknown','partial']) test(kind + ' archive blocks new publication without adoption or deletion', async t => {
  const f = await fixture(t), first = await freeze(f), target = path.join(f.root, kind === 'unknown' ? 'do-not-touch' : '1'.repeat(64));
  await fs.mkdir(target); await fs.writeFile(path.join(target, 'evidence'), 'preserve');
  const input = changeInput(f, {intent: {prompt: 'New synthetic entry'}}), prepared = await f.store.operation('reference-patch-task-disclosure', f.id, raw(input));
  const before = await inventory(f.dir);
  await assert.rejects(f.store.operation('reference-patch-freeze-task', f.id, raw({...input, confirmation: confirmationFor(prepared)})));
  assert.deepEqual(await inventory(f.dir), before); assert.deepEqual(await audit(f, first), first);
});

test('missing commit marker is preserved, never automatically completed or reused', async t => {
  const f = await fixture(t), receipt = await freeze(f), dir = capsule(f, receipt), target = path.join(dir, 'manifest.json');
  await fs.rename(target, path.join(f.dir, 'preserved-original-manifest.json')); const before = await inventory(f.dir);
  await assert.rejects(audit(f, receipt)); await assert.rejects(freeze(f));
  await assert.rejects(fs.stat(target), {code: 'ENOENT'}); assert.deepEqual(await inventory(f.dir), before);
});

test('unknown publication claim is never stolen or released by PID or age guesses', async t => {
  const f = await fixture(t), receipt = await freeze(f), lock = path.join(f.root, '_publish.lock');
  await fs.writeFile(lock, 'unknown original claim');
  const input = changeInput(f, {intent: {prompt: 'New synthetic entry'}}), prepared = await f.store.operation('reference-patch-task-disclosure', f.id, raw(input));
  const before = await inventory(f.dir);
  await assert.rejects(f.store.operation('reference-patch-freeze-task', f.id, raw({...input, confirmation: confirmationFor(prepared)})), /pending\/unknown/);
  assert.deepEqual(await inventory(f.dir), before); assert.deepEqual(await audit(f, receipt), receipt);
});

test('actual worker termination at the original commit barrier preserves partial files and exact unknown claim', {timeout: 15000}, async t => {
  const f = await fixture(t), worker = new Worker(new URL('../fixtures/reference-world-patch-capsule-process.mjs', import.meta.url),
    {workerData: {dataDir: f.dir, contextId: f.id, input: f.input, confirmation: f.confirmation}});
  t.after(() => worker.terminate());
  const message = await new Promise((resolve, reject) => {worker.once('message', resolve); worker.once('error', reject);
    worker.once('exit', code => reject(Error('Original joint commit barrier not reached: ' + code)));});
  assert.equal(message.state, 'before-original-commit'); assert.equal(path.dirname(message.capsuleDirectory), f.root);
  const id = path.basename(message.capsuleDirectory); assert.match(id, /^[a-f0-9]{64}$/);
  const lock = await fs.readFile(path.join(f.root, '_publish.lock')), payload = await fs.readFile(path.join(message.capsuleDirectory, 'payload.json'));
  assert.equal(await worker.terminate(), 1, 'The live worker was explicitly terminated, not naturally exited');
  const before = await inventory(f.dir);
  await assert.rejects(f.store.operation('reference-patch-frozen-task', id)); await assert.rejects(freeze(f));
  assert.deepEqual(await inventory(f.dir), before); assert.deepEqual(await fs.readFile(path.join(f.root, '_publish.lock')), lock);
  assert.deepEqual(await fs.readFile(path.join(message.capsuleDirectory, 'payload.json')), payload);
  await assert.rejects(fs.stat(path.join(message.capsuleDirectory, 'manifest.json')), {code: 'ENOENT'});
});

test('failed publication retains original partial source but releases only its verified own lock', async t => {
  const f = await fixture(t), originalOpen = fs.open;
  const mock = t.mock.method(fs, 'open', async function (target, ...args) {
    if (path.basename(target) === 'manifest.json' && args[0] === 'wx') throw Object.assign(Error('Synthetic storage failure'), {code: 'EIO'});
    return originalOpen.call(fs, target, ...args);
  });
  await assert.rejects(freeze(f), /Synthetic storage failure/); mock.mock.restore();
  const entries = await fs.readdir(f.root), id = entries.find(n => /^[a-f0-9]{64}$/.test(n)); assert.ok(id);
  assert.equal(entries.includes('_publish.lock'), false); assert.deepEqual(await fs.readFile(path.join(f.root, id, 'payload.json')), f.payload);
  const before = await inventory(f.dir); await assert.rejects(freeze(f)); assert.deepEqual(await inventory(f.dir), before);
});

test('expiry during original source writes leaves a partial archive, never a committed refreshed task', async t => {
  const f = await fixture(t), originalOpen = fs.open;
  const mock = t.mock.method(fs, 'open', async function (target, ...args) {
    const handle = await originalOpen.call(fs, target, ...args);
    if (path.basename(target) === 'image-1.png' && args[0] === 'wx') {
      t.mock.timers.enable({apis: ['Date'], now: f.saved.record.expiresAt + 1000});
    }
    return handle;
  });
  await assert.rejects(freeze(f), /expired before publication/); mock.mock.restore();
  const entries = await fs.readdir(f.root), id = entries.find(n => /^[a-f0-9]{64}$/.test(n)); assert.ok(id);
  assert.equal(entries.includes('_publish.lock'), false);
  await assert.rejects(fs.stat(path.join(f.root, id, 'manifest.json')), {code: 'ENOENT'});
  assert.deepEqual(await fs.readFile(path.join(f.root, id, 'payload.json')), f.payload);
});

test('publication never releases a changed claim, even after its own commit is complete', async t => {
  const f = await fixture(t), originalOpen = fs.open, replacement = Buffer.from('preserve a changed original publisher claim');
  const mock = t.mock.method(fs, 'open', async function (target, ...args) {
    if (path.basename(target) === 'manifest.json' && args[0] === 'wx') await fs.writeFile(path.join(f.root, '_publish.lock'), replacement);
    return originalOpen.call(fs, target, ...args);
  });
  await assert.rejects(freeze(f), /lock changed/); mock.mock.restore();
  assert.deepEqual(await fs.readFile(path.join(f.root, '_publish.lock')), replacement);
  const id = (await fs.readdir(f.root)).find(n => /^[a-f0-9]{64}$/.test(n)); assert.ok(id);
  const receipt = await readFrozenReferenceWorldPatchTaskCapsule({dataDir: f.dir, capsuleId: id});
  assert.equal(receipt.modelSent, false); assert.equal(receipt.canAuthorizePlacement, false);
  const input = changeInput(f, {intent: {prompt: 'New synthetic entry'}}), prepared = await f.store.operation('reference-patch-task-disclosure', f.id, raw(input));
  const before = await inventory(f.dir);
  await assert.rejects(f.store.operation('reference-patch-freeze-task', f.id, raw({...input, confirmation: confirmationFor(prepared)})), /pending\/unknown/);
  assert.deepEqual(await inventory(f.dir), before);
});

test('joint archive has a finite quota, preserves all records and never evicts original evidence', async t => {
  const f = await fixture(t), receipts = [];
  assert.equal(REFERENCE_PATCH_CAPSULE_LIMITS.records, 8);
  for (let i = 0; i < REFERENCE_PATCH_CAPSULE_LIMITS.records; i++) {
    const input = changeInput(f, {intent: {prompt: 'Synthetic entry ' + i}}), prepared = await f.store.operation('reference-patch-task-disclosure', f.id, raw(input));
    receipts.push(await f.store.operation('reference-patch-freeze-task', f.id, raw({...input, confirmation: confirmationFor(prepared)})));
  }
  const before = await inventory(f.dir); await assert.rejects(freeze(f), /quota reached/);
  assert.deepEqual(await inventory(f.dir), before); assert.equal((await fs.readdir(f.root)).length, 9);
  assert.deepEqual(await audit(f, receipts[0]), receipts[0]);
});

test('linked capsule directory and hardlinked source are rejected without touching targets', async t => {
  const f = await fixture(t), receipt = await freeze(f), outside = path.join(f.dir, 'external');
  await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'private'), 'preserve');
  const id = '1'.repeat(64); await fs.symlink(outside, path.join(f.root, id), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.store.operation('reference-patch-frozen-task', id), /link/);
  assert.equal(await fs.readFile(path.join(outside, 'private'), 'utf8'), 'preserve');
  const target = path.join(capsule(f, receipt), 'image-0.png'), alias = path.join(f.dir, 'preserved-pixel-alias');
  await fs.link(target, alias); await assert.rejects(audit(f, receipt), /link/); assert.deepEqual(await fs.readFile(alias), f.image);
});

test('capsule cannot adopt unknown files or unowned original archive directories', async t => {
  for (const kind of ['capsule','root']) {
    const f = await fixture(t);
    if (kind === 'capsule') {const receipt = await freeze(f); await fs.writeFile(path.join(capsule(f, receipt), 'unknown'), 'preserve');
      const before = await inventory(f.dir); await assert.rejects(audit(f, receipt), /unknown/); await assert.rejects(freeze(f));
      assert.deepEqual(await inventory(f.dir), before);
    } else {await fs.mkdir(f.root); await fs.writeFile(path.join(f.root, 'unknown'), 'preserve'); const before = await inventory(f.dir);
      await assert.rejects(freeze(f), /Unowned/); assert.deepEqual(await inventory(f.dir), before);}
  }
});

test('self-rehashed unsafe inventory, timestamp, quota and authority flags cannot become a joint commit', async t => {
  for (const mutate of [v => v.files[0].path = '../private', v => v.files[0].bytes = -1, v => v.files[0].sha256 = 'b'.repeat(64),
    v => v.bytes++, v => v.bytes = REFERENCE_PATCH_CAPSULE_LIMITS.bytes + 1, v => v.imageCount = 5,
    v => v.canAuthorizePlacement = true, v => v.modelSent = true, v => v.sendingImplemented = true,
    v => v.serverBaselineVerified = true, v => v.referenceConsentTransferable = true, v => v.maximumCalls = 2,
    v => v.frozenAt = v.recordExpiresAt, v => v.frozenAt = Date.now() + 100000,
    v => v.capsuleId = '0'.repeat(64), v => v.purpose = 'world-patch-design']) {
    const f = await fixture(t), receipt = await freeze(f), file = path.join(capsule(f, receipt), 'manifest.json'), manifest = JSON.parse(await fs.readFile(file));
    mutate(manifest); const {manifestHash, ...content} = manifest; manifest.manifestHash = contextHash(content); await fs.writeFile(file, raw(manifest));
    const before = await inventory(f.dir); await assert.rejects(audit(f, receipt)); assert.deepEqual(await inventory(f.dir), before);
  }
});

test('strict input, UTF-8/byte bounds, cancellation and closed lanes reject before publication', async t => {
  const f = await fixture(t), value = {...f.input, confirmation: f.confirmation};
  for (const bytes of [raw({...value, snapshot: {}}), raw({...value, reference: {images: [f.image]}}),
    raw({...value, confirmation: {...f.confirmation, confirmed: false}}), raw({...value, confirmation: {confirmed: true}}),
    new Uint8Array(), new Uint8Array(32769), Buffer.from([0xff]), Buffer.from('{')]) await assert.rejects(f.store.operation('reference-patch-freeze-task', f.id, bytes));
  const abort = new AbortController(); abort.abort();
  await assert.rejects(f.store.operation('reference-patch-freeze-task', f.id, raw(value), {signal: abort.signal}), /cancelled/);
  for (const id of ['../private',f.id,'a'.repeat(63),'A'.repeat(64)]) await assert.rejects(f.store.operation('reference-patch-frozen-task', id), /identity/);
  await f.store.close(); await assert.rejects(workerFreeze(f), /closed/); await assert.rejects(fs.stat(f.root), {code: 'ENOENT'});
});

test('same exact task queued twice publishes once; default startup rejects joint actions without a provider invocation', async t => {
  const f = await fixture(t), [first, second] = await Promise.all([workerFreeze(f), workerFreeze(f)]);
  assert.deepEqual(first, second); assert.equal((await fs.readdir(f.root)).length, 2);
  let calls = 0; const adapter = {close() {}, async generate() {calls++; throw Error('No provider allowed');}};
  const service = await startBridge({dataDir: f.dir, adapter, claudeAdapter: adapter, deepseekAdapter: adapter}); t.after(() => service.close());
  const headers = {Authorization: 'Bearer ' + service.connection.token, 'Content-Type': 'application/json'};
  // Legacy aliases remain absent. The independent task audit route exists,
  // but POST is always method-rejected, even when its process lane is off.
  for (const [route, status] of [
    ['/v1/world-contexts/' + f.id + '/reference-patch-freeze-task', 404],
    ['/v1/world-contexts/' + f.id + '/reference-patch-frozen-task', 404],
    ['/v1/reference-world-patch/tasks/' + first.capsuleId, 405],
    ['/v1/world-contexts/' + f.id + '/reference-patch-send', 404],
    ['/v1/world-contexts/' + f.id + '/reference-patch-apply', 404],
  ]) {
    const response = await fetch('http://127.0.0.1:' + service.connection.port + route,
      {method: 'POST', headers, body: JSON.stringify({...f.input, confirmation: f.confirmation})}); assert.equal(response.status, status, route);
  }
  assert.equal(calls, 0); assert.deepEqual(await audit(f, first), first); assert.deepEqual(await f.store.operation('get', f.id), f.saved);
});
