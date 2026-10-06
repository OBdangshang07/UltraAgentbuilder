import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {jointCapsuleFixture, jointRaw} from '../fixtures/reference-world-patch-capsule-fixture.mjs';
import {WorldContextStore, CONTEXT_STORE_LIMITS} from '../../bridge/world-context-store.mjs';
import {readReferenceWorldPatchTaskImages} from '../../bridge/reference-world-patch-task-images.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {startBridge} from '../../bridge/server.mjs';

const operations = ['reference-patch-freeze-images','reference-patch-original-images'];
const args = f => ({dataDir: f.dir, capsuleId: f.receipt.capsuleId, send: f.send});
const worker = (f, operation = operations[0], payload = jointRaw(f.send)) => f.store.operation(operation, f.receipt.capsuleId, payload);
const root = f => path.join(f.dir, 'reference-world-patch-task-images');
async function inventory(dir) {
  const result = {};
  for (const name of await fs.readdir(dir)) {
    const file = path.join(dir, name), stat = await fs.lstat(file);
    result[name] = stat.isDirectory() && !stat.isSymbolicLink() ? await inventory(file) : stat.isFile() ? hash(await fs.readFile(file)) : 'link';
  }
  return result;
}

test('private bounded worker freezes and audits the same original images and exact SEND, never a provider task', async t => {
  const f = await jointCapsuleFixture(t), first = await worker(f), read = await worker(f, operations[1]);
  assert.deepEqual(read.manifest, first); assert.equal(first.modelSent, false); assert.equal(first.sendingImplemented, false);
  assert.equal(first.allowsNewModelCall, false); assert.equal(first.canAuthorizePlacement, false);
  assert.equal(read.originalReceiptOnly, true); assert.deepEqual(read, await readReferenceWorldPatchTaskImages(args(f)));
  for (const [i, file] of read.images.entries()) assert.deepEqual(await fs.readFile(file), f.pixels[i]);
  const before = await inventory(f.dir); assert.deepEqual(await worker(f), first); assert.deepEqual(await inventory(f.dir), before);
});

test('queued duplicate freezes publish one immutable task record with no retry or extra call', async t => {
  const f = await jointCapsuleFixture(t), results = await Promise.all([worker(f), worker(f)]);
  assert.deepEqual(results[0], results[1]); assert.equal(results[0].modelSent, false);
  const entries = await fs.readdir(root(f)); assert.deepEqual(entries.sort(), ['_store.json',f.receipt.capsuleId].sort());
});

test('archived original images are auditable after context discard without recreating that context store', async t => {
  const f = await jointCapsuleFixture(t), original = await worker(f);
  await f.store.operation('discard', f.id); await f.store.close();
  const contexts = path.join(f.dir, 'world-contexts'); await fs.rename(contexts, path.join(f.dir, 'synthetic-preserved-contexts'));
  const store = new WorldContextStore({dataDir: f.dir}); t.after(() => store.close());
  const before = await inventory(f.dir);
  const read = await store.operation(operations[1], f.receipt.capsuleId, jointRaw(f.send)); assert.deepEqual(read.manifest, original);
  assert.deepEqual(await store.operation(operations[0], f.receipt.capsuleId, jointRaw(f.send)), original);
  await assert.rejects(fs.stat(contexts), {code: 'ENOENT'}); assert.deepEqual(await inventory(f.dir), before);
  assert.equal(read.canAuthorizePlacement, false); assert.equal(read.allowsNewModelCall, false);
});

test('internal image worker byte/type/UTF-8, capsule identity and strict SEND bounds reject without disk changes', async t => {
  const f = await jointCapsuleFixture(t), before = await inventory(f.dir);
  for (const operation of operations) {
    for (const payload of [undefined, '', f.send, Buffer.alloc(0), Buffer.alloc(4097), Buffer.from([0xff]), Buffer.from('{'),
      jointRaw({...f.send, allowsNewModelCall: true}), jointRaw({...f.send, runtimeHash: 'b'.repeat(64)}), jointRaw(f.confirmation)]) {
      // Pass undefined literally; the convenience helper's default would
      // otherwise substitute a valid SEND and fail to exercise this boundary.
      await assert.rejects(f.store.operation(operation, f.receipt.capsuleId, payload));
    }
    for (const id of [f.id,'../private','a'.repeat(63),'A'.repeat(64)]) {
      await assert.rejects(f.store.operation(operation, id, jointRaw(f.send)), /identity/);
    }
    const control = new AbortController(); control.abort();
    await assert.rejects(f.store.operation(operation, f.receipt.capsuleId, jointRaw(f.send), {signal: control.signal}), /cancelled/);
  }
  assert.deepEqual(await inventory(f.dir), before);
  await f.store.close(); for (const operation of operations) await assert.rejects(worker(f, operation), /closed/);
});

test('original audit cannot create an uncopied transport or adopt a partial/unknown record', async t => {
  const f = await jointCapsuleFixture(t), before = await inventory(f.dir);
  await assert.rejects(worker(f, operations[1])); assert.deepEqual(await inventory(f.dir), before);
  await worker(f); const target = path.join(root(f), f.receipt.capsuleId);
  await fs.rename(path.join(target, 'manifest.json'), path.join(target, 'synthetic-preserved-manifest.json'));
  const partial = await inventory(f.dir); for (const operation of operations) await assert.rejects(worker(f, operation));
  assert.deepEqual(await inventory(f.dir), partial);
});

test('worker does not take over or delete a dead-looking publication claim', async t => {
  const f = await jointCapsuleFixture(t); const original = await worker(f);
  await fs.writeFile(path.join(root(f), '_publish.lock'), 'synthetic unknown owner, pid=0'); const before = await inventory(f.dir);
  await assert.rejects(worker(f), /pending\/unknown/); assert.deepEqual(await inventory(f.dir), before);
  assert.deepEqual((await worker(f, operations[1])).manifest, original); assert.deepEqual(await inventory(f.dir), before);
});

test('active cancellation and close stop the original worker without starting an alternative or publishing images', async t => {
  const f = await jointCapsuleFixture(t), before = await inventory(f.dir), control = new AbortController();
  const pending = f.store.operation(operations[0], f.receipt.capsuleId, jointRaw(f.send), {signal: control.signal});
  const rejected = assert.rejects(pending, /cancelled/); assert.ok(f.store.active?.worker); control.abort(); await rejected;
  await f.store.close(); assert.deepEqual(await inventory(f.dir), before);
});

test('worker queue remains bounded and audits do not accumulate a parallel publisher lane', async t => {
  const f = await jointCapsuleFixture(t); await worker(f); const before = await inventory(f.dir);
  const pending = Array.from({length: CONTEXT_STORE_LIMITS.queue + 2}, () => worker(f, operations[1]));
  const results = await Promise.allSettled(pending);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, CONTEXT_STORE_LIMITS.queue + 1);
  const rejected = results.filter(r => r.status === 'rejected'); assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason.message, /queue full/); assert.equal(rejected[0].reason.statusCode, 429);
  assert.deepEqual(await inventory(f.dir), before);
});

for (const name of ['send.json','image-0.png','manifest.json']) test('bounded worker preserves corrupted original task ' + name, async t => {
  const f = await jointCapsuleFixture(t); await worker(f); await fs.appendFile(path.join(root(f), f.receipt.capsuleId, name), ' synthetic corruption');
  const before = await inventory(f.dir); for (const operation of operations) await assert.rejects(worker(f, operation));
  assert.deepEqual(await inventory(f.dir), before);
});

test('bounded worker operations are not HTTP routes, expose no source paths and trigger no model adapter', async t => {
  const f = await jointCapsuleFixture(t); await worker(f); const before = await inventory(root(f)); let calls = 0;
  const adapter = {close() {}, async generate() {calls++; throw Error('No provider permitted');}};
  const service = await startBridge({dataDir: f.dir, adapter, claudeAdapter: adapter, deepseekAdapter: adapter}); t.after(() => service.close());
  const headers = {Authorization: 'Bearer ' + service.connection.token, 'Content-Type': 'application/json'};
  for (const operation of operations) {
    const response = await fetch('http://127.0.0.1:' + service.connection.port + '/v1/world-contexts/' + f.id + '/' + operation,
      {method: 'POST', headers, body: JSON.stringify(f.send)});
    assert.equal(response.status, 404); assert.equal((await response.text()).includes(f.dir), false);
  }
  assert.equal(calls, 0); assert.deepEqual(await inventory(root(f)), before);
});
