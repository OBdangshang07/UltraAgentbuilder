import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {jointCapsuleFixture, jointRaw} from '../fixtures/reference-world-patch-capsule-fixture.mjs';
import {REFERENCE_PATCH_SEND_PINS} from '../../contracts/reference-world-patch-send.mjs';
import {freezeReferenceWorldPatchTaskImages, readReferenceWorldPatchTaskImages,
  REFERENCE_PATCH_TASK_IMAGE_LIMITS} from '../../bridge/reference-world-patch-task-images.mjs';
import {prepareFrozenReferenceWorldPatchSendInput} from '../../bridge/reference-world-patch-send-input.mjs';
import {startBridge} from '../../bridge/server.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {contextHash} from '../../src/world/context-snapshot.mjs';

const args = f => ({dataDir: f.dir, capsuleId: f.receipt.capsuleId, send: f.send});
const root = f => path.join(f.dir, 'reference-world-patch-task-images');
const target = f => path.join(root(f), f.receipt.capsuleId);
const capsule = f => path.join(f.dir, 'reference-world-patch-tasks', f.receipt.capsuleId);
const freeze = f => freezeReferenceWorldPatchTaskImages(args(f));
const read = f => readReferenceWorldPatchTaskImages(args(f));
async function inventory(dir) {
  const result = {};
  for (const name of await fs.readdir(dir)) {
    const file = path.join(dir, name), stat = await fs.lstat(file);
    result[name] = stat.isDirectory() && !stat.isSymbolicLink() ? await inventory(file) : stat.isFile() ? hash(await fs.readFile(file)) : 'link';
  }
  return result;
}
async function variant(f, suffix) {
  const input = {...f.input, intent: {...f.input.intent, prompt: f.input.intent.prompt + '\n合成方案 ' + suffix}};
  const prepared = await f.store.operation('reference-patch-task-disclosure', f.id, jointRaw(input));
  const confirmation = {...f.confirmation, taskDisclosureHash: prepared.taskDisclosureHash, taskHash: prepared.taskHash,
    requestHash: prepared.task.requestHash, disclosureHash: prepared.task.disclosure.disclosureHash,
    promptSha256: prepared.task.request.promptSha256, imageCapabilityHash: prepared.task.request.imageCapabilityHash};
  const receipt = await f.store.operation('reference-patch-freeze-task', f.id, jointRaw({...input, confirmation}));
  const send = {...f.send, ...Object.fromEntries(REFERENCE_PATCH_SEND_PINS.map(k => [k, receipt[k]]))};
  return {...f, receipt, send};
}
async function saturatedSources(t) {
  const f = await jointCapsuleFixture(t), sources = [f];
  for (let i = 1; i < 8; i++) sources.push(await variant(f, i));
  // Synthetic fixture only: archive then restore one source so the reader can
  // see nine valid capsules. Production must never evict/adopt a source this way.
  const preserved = path.join(f.dir, 'synthetic-preserved-source');
  await fs.rename(capsule(f), preserved); sources.push(await variant(f, 8));
  await fs.rename(preserved, capsule(f));
  return sources;
}

test('task-owned transport copies ordered original PNG bytes and persists the exact independent SEND without dispatch', async t => {
  const f = await jointCapsuleFixture(t), original = await inventory(capsule(f));
  const input = await prepareFrozenReferenceWorldPatchSendInput(args(f)), manifest = await freeze(f), found = await read(f);
  assert.equal(manifest.format, 'FrozenReferenceWorldPatchTaskImages'); assert.equal(manifest.state, 'images-frozen-not-sent');
  assert.equal(manifest.submissionHash, contextHash(f.send)); assert.equal(manifest.invocationFingerprint, input.invocationFingerprint);
  assert.equal(manifest.manifestHash, f.receipt.manifestHash); assert.deepEqual(manifest.imageHashes, f.pixels.map(hash));
  assert.deepEqual(manifest.files.map(file => file.path), ['send.json','image-0.png','image-1.png']);
  assert.deepEqual(await fs.readFile(path.join(target(f), 'send.json')), jointRaw(f.send));
  assert.equal(manifest.imageBytes, f.pixels.reduce((sum, value) => sum + value.length, 0));
  assert.equal(manifest.bytes, manifest.imageBytes + jointRaw(f.send).length);
  for (const field of ['sourcePixelsReencoded','modelSent','sendingImplemented','liveProviderCapabilityVerified',
    'serverBaselineVerified','canAuthorizePlacement','allowsNewModelCall']) assert.equal(manifest[field], false);
  const {transportHash, ...content} = manifest; assert.equal(transportHash, contextHash(content));
  assert.deepEqual(found.manifest, manifest); assert.equal(found.originalReceiptOnly, true); assert.equal(found.allowsNewModelCall, false);
  for (const [i, file] of found.images.entries()) {assert.equal(path.dirname(file), target(f)); assert.deepEqual(await fs.readFile(file), f.pixels[i]);}
  assert.deepEqual(await inventory(capsule(f)), original); await assert.rejects(fs.stat(path.join(root(f), '_publish.lock')), {code: 'ENOENT'});
  const before = await inventory(f.dir); assert.deepEqual(await freeze(f), manifest); assert.deepEqual(await inventory(f.dir), before);
  assert.equal(JSON.stringify(manifest).includes(f.dir), false);
});

test('every changed SEND pin and legacy confirmation rejects before creating transport files', async t => {
  const f = await jointCapsuleFixture(t), before = await inventory(f.dir);
  for (const key of REFERENCE_PATCH_SEND_PINS) {
    await assert.rejects(freezeReferenceWorldPatchTaskImages({...args(f), send: {...f.send, [key]: 'b'.repeat(64)}}));
  }
  for (const send of [f.receipt, f.confirmation, {...f.send, maximumCalls: 2}, {...f.send, allowWorldWrites: true}]) {
    await assert.rejects(freezeReferenceWorldPatchTaskImages({...args(f), send}));
  }
  for (const capsuleId of [f.id,'../private','a'.repeat(63),'A'.repeat(64),[f.receipt.capsuleId]]) {
    await assert.rejects(freezeReferenceWorldPatchTaskImages({...args(f), capsuleId}), /identity/);
  }
  assert.deepEqual(await inventory(f.dir), before);
});

test('expiry permits only unchanged original-image audit, not materialization or refreshed consent', async t => {
  const f = await jointCapsuleFixture(t), manifest = await freeze(f), before = await inventory(f.dir);
  t.mock.timers.enable({apis: ['Date'], now: f.receipt.recordExpiresAt + 1});
  await assert.rejects(freeze(f), /expired/); assert.deepEqual((await read(f)).manifest, manifest);
  assert.deepEqual(await inventory(f.dir), before);
});

test('expired uncopied sources cannot create a task store', async t => {
  const f = await jointCapsuleFixture(t), before = await inventory(f.dir);
  t.mock.timers.enable({apis: ['Date'], now: f.receipt.recordExpiresAt + 1});
  await assert.rejects(freeze(f), /expired/); assert.deepEqual(await inventory(f.dir), before);
});

test('cancelled or invalid cancellation signals reject before source or file work', async t => {
  const f = await jointCapsuleFixture(t), before = await inventory(f.dir), control = new AbortController(); control.abort();
  for (const signal of [control.signal, {}, true, null]) {
    await assert.rejects(freezeReferenceWorldPatchTaskImages({...args(f), signal}), /cancel/);
    await assert.rejects(readReferenceWorldPatchTaskImages({...args(f), signal}), /cancel/);
  }
  assert.deepEqual(await inventory(f.dir), before);
});

for (const name of ['manifest.json','send.json','image-0.png','image-1.png']) test('corrupt task-owned ' + name + ' is preserved and never overwritten', async t => {
  const f = await jointCapsuleFixture(t); await freeze(f); await fs.appendFile(path.join(target(f), name), ' broken');
  const before = await inventory(f.dir); await assert.rejects(read(f)); await assert.rejects(freeze(f));
  assert.deepEqual(await inventory(f.dir), before);
});

test('source corruption after image freeze invalidates audit and cannot authorize a replacement', async t => {
  const f = await jointCapsuleFixture(t); await freeze(f); await fs.appendFile(path.join(capsule(f), 'image-0.png'), ' broken');
  const before = await inventory(f.dir); await assert.rejects(read(f)); await assert.rejects(freeze(f));
  assert.deepEqual(await inventory(f.dir), before);
});

test('ordered images, accounting, original SEND and authority remain checked even with a recomputed local manifest hash', async t => {
  const f = await jointCapsuleFixture(t), manifest = await freeze(f), file = path.join(target(f), 'manifest.json');
  const changes = [{imageHashes: [...manifest.imageHashes].reverse()}, {bytes: manifest.bytes + 1}, {imageBytes: manifest.imageBytes + 1},
    {files: [...manifest.files].reverse()}, {frozenAt: f.receipt.recordExpiresAt}, {frozenAt: manifest.frozenAt + 100000},
    {modelSent: true}, {canAuthorizePlacement: true}, {allowsNewModelCall: true}, {maximumCalls: 2}, {runtimeHash: 'b'.repeat(64)}];
  for (const change of changes) {
    const {transportHash, ...content} = {...manifest, ...change};
    await fs.writeFile(file, jointRaw({...content, transportHash: contextHash(content)}));
    const before = await inventory(f.dir); await assert.rejects(read(f)); await assert.rejects(freeze(f));
    assert.deepEqual(await inventory(f.dir), before);
  }
});

test('missing or unknown record files are not adopted by idempotent freeze or audit', async t => {
  const f = await jointCapsuleFixture(t); await freeze(f);
  await fs.rename(path.join(target(f), 'manifest.json'), path.join(target(f), 'manifest-preserved.json'));
  const before = await inventory(f.dir); await assert.rejects(read(f)); await assert.rejects(freeze(f));
  assert.deepEqual(await inventory(f.dir), before);
});

test('unknown store contents and unowned stores are preserved, not initialized or evicted', async t => {
  const f = await jointCapsuleFixture(t); await fs.mkdir(root(f)); await fs.writeFile(path.join(root(f), 'unknown.txt'), 'synthetic unknown');
  const before = await inventory(f.dir); await assert.rejects(freeze(f), /Unowned/); assert.deepEqual(await inventory(f.dir), before);
});

test('a dead-looking or malformed publication claim is never taken over', async t => {
  const f = await jointCapsuleFixture(t); await freeze(f); const next = await variant(f, 'next');
  const lock = path.join(root(f), '_publish.lock');
  await fs.writeFile(lock, jointRaw({pid: 0, at: 0, synthetic: true})); const before = await inventory(f.dir);
  await assert.rejects(freeze(next), /pending\/unknown; no takeover/); assert.deepEqual(await inventory(f.dir), before);
});

test('interrupted copy preserves partial record and cannot be resumed, replaced or bypassed by another capsule', async t => {
  const f = await jointCapsuleFixture(t), open = fs.open;
  const mock = t.mock.method(fs, 'open', async (file, ...rest) => {
    if (file === path.join(target(f), 'image-0.png') && rest[0] === 'wx') throw Error('Synthetic interrupted copy');
    return open(file, ...rest);
  });
  await assert.rejects(freeze(f), /Synthetic interrupted copy/); mock.mock.restore();
  await assert.rejects(fs.stat(path.join(target(f), 'manifest.json')), {code: 'ENOENT'});
  const next = await variant(f, 'next'), before = await inventory(f.dir);
  await assert.rejects(freeze(f)); await assert.rejects(freeze(next)); assert.deepEqual(await inventory(f.dir), before);
});

test('cancellation during copying preserves partial pixels and releases only the exact owned claim', async t => {
  const f = await jointCapsuleFixture(t), open = fs.open, control = new AbortController();
  t.mock.method(fs, 'open', async (file, ...rest) => {
    if (file === path.join(target(f), 'image-0.png') && rest[0] === 'wx') control.abort();
    return open(file, ...rest);
  });
  await assert.rejects(freezeReferenceWorldPatchTaskImages({...args(f), signal: control.signal}), /cancelled/);
  assert.deepEqual(await fs.readFile(path.join(target(f), 'image-0.png')), f.pixels[0]);
  await assert.rejects(fs.stat(path.join(target(f), 'manifest.json')), {code: 'ENOENT'});
  await assert.rejects(fs.stat(path.join(root(f), '_publish.lock')), {code: 'ENOENT'});
});

test('expiry during copying retains a partial record without a commit marker or new consent', async t => {
  const f = await jointCapsuleFixture(t), open = fs.open;
  t.mock.method(fs, 'open', async (file, ...rest) => {
    if (file === path.join(target(f), 'image-0.png') && rest[0] === 'wx') t.mock.timers.enable({apis: ['Date'], now: f.receipt.recordExpiresAt + 1});
    return open(file, ...rest);
  });
  await assert.rejects(freeze(f), /expired/); await assert.rejects(fs.stat(path.join(target(f), 'manifest.json')), {code: 'ENOENT'});
  await assert.rejects(fs.stat(path.join(root(f), '_publish.lock')), {code: 'ENOENT'});
});

test('changed publication claim is preserved and prevents a committed record', async t => {
  const f = await jointCapsuleFixture(t), open = fs.open, replacement = jointRaw({synthetic: 'changed claim'});
  t.mock.method(fs, 'open', async (file, ...rest) => {
    if (file === path.join(target(f), 'image-0.png') && rest[0] === 'wx') await fs.writeFile(path.join(root(f), '_publish.lock'), replacement);
    return open(file, ...rest);
  });
  await assert.rejects(freeze(f), /claim changed/); assert.deepEqual(await fs.readFile(path.join(root(f), '_publish.lock')), replacement);
  await assert.rejects(fs.stat(path.join(target(f), 'manifest.json')), {code: 'ENOENT'});
});

test('actual worker termination before original image commit preserves pixels, SEND and unknown claim', {timeout: 15000}, async t => {
  const f = await jointCapsuleFixture(t);
  const worker = new Worker(new URL('../fixtures/reference-world-patch-task-images-process.mjs', import.meta.url), {workerData: args(f)});
  t.after(() => worker.terminate());
  const message = await new Promise((resolve, reject) => {
    worker.once('message', resolve); worker.once('error', reject);
    worker.once('exit', code => reject(Error('Original image commit barrier not reached: ' + code)));
  });
  assert.equal(message.state, 'before-original-image-commit'); assert.equal(message.taskDirectory, target(f));
  const claim = await fs.readFile(path.join(root(f), '_publish.lock'));
  assert.equal(await worker.terminate(), 1, 'Original worker was explicitly terminated, not naturally exited');
  const before = await inventory(f.dir); await assert.rejects(read(f)); await assert.rejects(freeze(f), /pending\/unknown/);
  assert.deepEqual(await inventory(f.dir), before); assert.deepEqual(await fs.readFile(path.join(root(f), '_publish.lock')), claim);
  assert.deepEqual(await fs.readFile(path.join(target(f), 'send.json')), jointRaw(f.send));
  assert.deepEqual(await fs.readFile(path.join(target(f), 'image-0.png')), f.pixels[0]);
  assert.deepEqual(await fs.readFile(path.join(target(f), 'image-1.png')), f.pixels[1]);
  await assert.rejects(fs.stat(path.join(target(f), 'manifest.json')), {code: 'ENOENT'});
});

test('a changed store owner cannot legitimize an existing transport and unknown record files are preserved', async t => {
  const f = await jointCapsuleFixture(t); await freeze(f);
  const marker = path.join(root(f), '_store.json'), original = await fs.readFile(marker), owner = JSON.parse(original);
  await fs.writeFile(marker, jointRaw({...owner, ownerId: randomUUID()}));
  let before = await inventory(f.dir); await assert.rejects(read(f)); await assert.rejects(freeze(f));
  assert.deepEqual(await inventory(f.dir), before);
  await fs.writeFile(marker, original); await fs.writeFile(path.join(target(f), 'unknown.txt'), 'synthetic unknown');
  before = await inventory(f.dir); await assert.rejects(read(f)); await assert.rejects(freeze(f)); assert.deepEqual(await inventory(f.dir), before);
});

test('source pixels changed while copying are detected before publishing the transport', async t => {
  const f = await jointCapsuleFixture(t), open = fs.open;
  t.mock.method(fs, 'open', async (file, ...rest) => {
    if (file === path.join(target(f), 'image-0.png') && rest[0] === 'wx') await fs.appendFile(path.join(capsule(f), 'image-0.png'), ' synthetic corruption');
    return open(file, ...rest);
  });
  await assert.rejects(freeze(f)); await assert.rejects(fs.stat(path.join(target(f), 'manifest.json')), {code: 'ENOENT'});
});

test('hardlinked task pixels and owner marker are rejected without modifying either original', async t => {
  const f = await jointCapsuleFixture(t); await freeze(f);
  for (const name of ['image-0.png','_store.json']) {
    const source = name === '_store.json' ? path.join(root(f), name) : path.join(target(f), name);
    const link = path.join(f.dir, 'synthetic-hardlink-' + name); await fs.link(source, link);
    const before = await inventory(f.dir); await assert.rejects(read(f)); await assert.rejects(freeze(f));
    assert.deepEqual(await inventory(f.dir), before); await fs.unlink(link);
  }
});

test('linked task-store directories cannot redirect materialization', async t => {
  const f = await jointCapsuleFixture(t), other = path.join(f.dir, 'synthetic-other'); await fs.mkdir(other);
  await fs.symlink(other, root(f), process.platform === 'win32' ? 'junction' : 'dir');
  const before = await inventory(f.dir); await assert.rejects(freeze(f), /link\/type/); assert.deepEqual(await inventory(f.dir), before);
});

test('quota inventory audits the saved SEND of each capsule rather than rebuilding from the newest caller', async t => {
  const f = await jointCapsuleFixture(t), next = await variant(f, 'next'); await freeze(f); await freeze(next);
  assert.notEqual(f.send.promptSha256, next.send.promptSha256);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(target(f), 'send.json'))), f.send);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(target(next), 'send.json'))), next.send);
  const third = await variant(f, 'third');
  await fs.writeFile(path.join(target(f), 'send.json'), jointRaw(next.send)); const before = await inventory(f.dir);
  await assert.rejects(freeze(third)); assert.deepEqual(await inventory(f.dir), before);
});

test('different-capsule concurrent publishers cannot exceed the eight-record quota or take over a claim', async t => {
  const sources = await saturatedSources(t), f = sources[0];
  for (const source of sources.slice(0, 7)) await freeze(source);
  const open = fs.open; let unlock, claims = 0;
  const gate = new Promise(resolve => {unlock = resolve;}); t.after(unlock);
  const mock = t.mock.method(fs, 'open', async (file, ...rest) => {
    if (file === path.join(root(f), '_publish.lock') && rest[0] === 'wx') {
      claims++;
      try {return await open(file, ...rest);} finally {if (claims > 1) unlock();}
    }
    if (file === path.join(target(sources[7]), 'image-0.png') && rest[0] === 'wx') await gate;
    return open(file, ...rest);
  });
  const results = await Promise.allSettled([freeze(sources[7]), freeze(sources[8])]); mock.mock.restore();
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /pending\/unknown/);
  const entries = (await fs.readdir(root(f))).filter(name => /^[a-f0-9]{64}$/.test(name));
  assert.equal(entries.length, REFERENCE_PATCH_TASK_IMAGE_LIMITS.records);
  const missing = sources.find(source => !entries.includes(source.receipt.capsuleId)), before = await inventory(f.dir);
  await assert.rejects(freeze(missing), /quota reached/); assert.deepEqual(await inventory(f.dir), before);
  for (const source of sources.filter(source => entries.includes(source.receipt.capsuleId))) await read(source);
});

test('transport module adds no public image-freeze, image-audit, SEND or apply endpoint and invokes no provider', async t => {
  const f = await jointCapsuleFixture(t); await freeze(f); const before = await inventory(root(f)); let calls = 0;
  const adapter = {close() {}, async generate() {calls++; throw Error('No provider permitted');}};
  const service = await startBridge({dataDir: f.dir, adapter, claudeAdapter: adapter, deepseekAdapter: adapter}); t.after(() => service.close());
  const headers = {Authorization: 'Bearer ' + service.connection.token, 'Content-Type': 'application/json'};
  for (const action of ['reference-patch-freeze-images','reference-patch-original-images','reference-patch-send','reference-patch-apply']) {
    const response = await fetch('http://127.0.0.1:' + service.connection.port + '/v1/world-contexts/' + f.id + '/' + action,
      {method: 'POST', headers, body: JSON.stringify(f.send)}); assert.equal(response.status, 404);
  }
  assert.equal(calls, 0); assert.deepEqual(await inventory(root(f)), before);
});
