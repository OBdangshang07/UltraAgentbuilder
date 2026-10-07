import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {jointCapsuleFixture, jointRaw} from '../fixtures/reference-world-patch-capsule-fixture.mjs';
import {WorldContextStore, CONTEXT_STORE_LIMITS} from '../../bridge/world-context-store.mjs';
import {freezeReferenceWorldPatchTaskImages} from '../../bridge/reference-world-patch-task-images.mjs';
import {prepareReferenceWorldPatchProviderInput} from '../../bridge/reference-world-patch-provider-input.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {startBridge} from '../../bridge/server.mjs';

// Authored pixels/block facts only. Workers below are local JS test workers,
// not model agents, transports or an installed Minecraft instance.
const operations = ['reference-patch-provider-input', 'reference-patch-provider-recheck'];
const selected = f => ({agent: f.input.intent.agent, model: f.input.intent.model, effort: f.input.intent.effort,
  runtimeHash: f.input.runtimeHash, capability: structuredClone(f.input.capability)});
const binding = f => ({send: f.send, selected: selected(f)});
const args = f => ({dataDir: f.dir, capsuleId: f.receipt.capsuleId, ...binding(f)});
const worker = (f, operation = operations[0], value = binding(f)) => f.store.operation(operation, f.receipt.capsuleId, jointRaw(value));
async function fixture(t) {
  const f = await jointCapsuleFixture(t);
  await freezeReferenceWorldPatchTaskImages({dataDir: f.dir, capsuleId: f.receipt.capsuleId, send: f.send});
  return f;
}
async function inventory(dir) {
  const result = {};
  for (const name of await fs.readdir(dir)) {
    const file = path.join(dir, name), stat = await fs.lstat(file);
    result[name] = stat.isDirectory() && !stat.isSymbolicLink() ? await inventory(file)
      : stat.isFile() ? hash(await fs.readFile(file)) : 'link';
  }
  return result;
}

test('bounded provider worker/recheck returns the exact original frozen private packet without writes or dispatch', async t => {
  const f = await fixture(t), before = await inventory(f.dir), direct = await prepareReferenceWorldPatchProviderInput(args(f));
  const result = await worker(f);
  assert.deepEqual(result, direct);
  assert.deepEqual(await worker(f, operations[1], {...binding(f), preparationHash: result.preparationHash}), direct);
  assert.equal(result.maximumCalls, 1);
  for (const key of ['modelSent','sendingImplemented','liveProviderCapabilityVerified','serverBaselineVerified','canAuthorizePlacement','allowsNewModelCall']) assert.equal(result[key], false);
  for (const value of [result,result.images,result.imageHashes,result.referenceInput,result.outputSchema,
    result.selectedAdvertisement,result.selectedAdvertisement.advertisedEfforts]) assert.equal(Object.isFrozen(value), true);
  assert.throws(() => result.images.reverse(), TypeError);
  for (const [i, file] of result.images.entries()) assert.deepEqual(await fs.readFile(file), f.pixels[i]);
  assert.deepEqual(await inventory(f.dir), before);
});

test('worker preparation/recheck after capture discard does not recreate the old context store', async t => {
  const f = await fixture(t), expected = await worker(f);
  await f.store.operation('discard', f.id); await f.store.close();
  const contexts = path.join(f.dir, 'world-contexts'); await fs.rename(contexts, path.join(f.dir, 'synthetic-preserved-contexts'));
  f.store = new WorldContextStore({dataDir: f.dir}); t.after(() => f.store.close());
  const before = await inventory(f.dir);
  assert.deepEqual(await worker(f), expected);
  assert.deepEqual(await worker(f, operations[1], {...binding(f), preparationHash: expected.preparationHash}), expected);
  await assert.rejects(fs.stat(contexts), {code: 'ENOENT'}); assert.deepEqual(await inventory(f.dir), before);
});

test('private worker rejects byte/type/UTF-8, capsule identity and recheck digest errors without mutation', async t => {
  const f = await fixture(t), before = await inventory(f.dir), prepared = await worker(f);
  for (const operation of operations) {
    for (const payload of [undefined,'',{},Buffer.alloc(0),Buffer.alloc(4097),Buffer.from([0xff]),Buffer.from('{'),
      jointRaw(f.send),jointRaw({...binding(f), dataDir: f.dir}),jointRaw({...binding(f), capsuleId: f.receipt.capsuleId}),
      jointRaw({...binding(f), preparationHash: 'b'.repeat(64)}),jointRaw({...binding(f), allowsNewModelCall: true})]) {
      await assert.rejects(f.store.operation(operation, f.receipt.capsuleId, payload));
    }
    for (const id of [f.id,'../private','a'.repeat(63),'A'.repeat(64),[f.receipt.capsuleId]]) {
      await assert.rejects(f.store.operation(operation, id, jointRaw(binding(f))), /identity/);
    }
    const control = new AbortController(); control.abort();
    await assert.rejects(f.store.operation(operation, f.receipt.capsuleId, jointRaw(binding(f)), {signal: control.signal}), /cancelled/);
  }
  for (const preparationHash of [undefined,null,{},[prepared.preparationHash],'b'.repeat(64)]) {
    await assert.rejects(worker(f, operations[1], {...binding(f), preparationHash}));
  }
  assert.deepEqual(await inventory(f.dir), before);
});

test('a current selected recipient/image/effort/runtime change rejects both worker preparation and recheck', async t => {
  const f = await fixture(t), prepared = await worker(f), before = await inventory(f.dir);
  for (const change of [{agent: 'claude'},{model: 'gpt-synthetic-other'},{effort: 'high'},{runtimeHash: 'b'.repeat(64)},
    {capability: {...f.input.capability, supportsImages: false}}, {capability: {...f.input.capability, efforts: ['max','high']}},
    {account: 'synthetic-caller-account'}]) {
    const value = {...binding(f), selected: {...selected(f), ...change}};
    await assert.rejects(worker(f, operations[0], value));
    await assert.rejects(worker(f, operations[1], {...value, preparationHash: prepared.preparationHash}));
  }
  assert.deepEqual(await inventory(f.dir), before);
});

test('provider worker cannot create missing transport or adopt partial/unknown original data', async t => {
  const f = await jointCapsuleFixture(t), before = await inventory(f.dir);
  await assert.rejects(worker(f)); assert.deepEqual(await inventory(f.dir), before);
  await freezeReferenceWorldPatchTaskImages({dataDir: f.dir, capsuleId: f.receipt.capsuleId, send: f.send});
  const prepared = await worker(f), transport = path.join(f.dir, 'reference-world-patch-task-images', f.receipt.capsuleId);
  await fs.rename(path.join(transport, 'manifest.json'), path.join(transport, 'synthetic-preserved-manifest.json'));
  const partial = await inventory(f.dir);
  await assert.rejects(worker(f));
  await assert.rejects(worker(f, operations[1], {...binding(f), preparationHash: prepared.preparationHash}));
  assert.deepEqual(await inventory(f.dir), partial);
});

test('the bounded worker enforces current expiry although the capsule and pictures remain preserved', async t => {
  const f = await fixture(t), prepared = await worker(f), before = await inventory(f.dir);
  // A labelled test worker sets its own clock before loading the exact normal
  // worker entry. The production operation accepts no clock/path override.
  for (const operation of operations) {
    const w = new Worker("Date.now = () => require('node:worker_threads').workerData.syntheticNow; import(require('node:worker_threads').workerData.entry);", {
      eval: true, workerData: {syntheticNow: f.receipt.recordExpiresAt, entry: new URL('../../bridge/world-context-worker.mjs', import.meta.url).href,
        root: path.join(f.dir, 'world-contexts'), operation, id: f.receipt.capsuleId,
        payload: jointRaw(operation === operations[0] ? binding(f) : {...binding(f), preparationHash: prepared.preparationHash}), limits: CONTEXT_STORE_LIMITS},
      resourceLimits: {maxOldGenerationSizeMb: 512, stackSizeMb: 4},
    });
    const message = await new Promise((resolve, reject) => {w.once('message', resolve); w.once('error', reject);
      w.once('exit', code => {if (code) reject(Error('Synthetic expiry worker exited ' + code));});});
    assert.equal(message.ok, false); assert.match(message.error, /expired/); await w.terminate();
  }
  assert.deepEqual(await inventory(f.dir), before);
});

test('active abort/close stops private preparation without an alternative worker, write or model call', async t => {
  const f = await fixture(t), before = await inventory(f.dir), control = new AbortController();
  const pending = f.store.operation(operations[0], f.receipt.capsuleId, jointRaw(binding(f)), {signal: control.signal});
  const rejected = assert.rejects(pending, /cancelled/); assert.ok(f.store.active?.worker); control.abort(); await rejected;
  await f.store.close(); assert.deepEqual(await inventory(f.dir), before);
  for (const operation of operations) await assert.rejects(worker(f, operation), /closed/);
});

test('queued preparation stays on the existing single bounded lane and duplicates do not write or reserve', async t => {
  const f = await fixture(t), before = await inventory(f.dir), expected = await worker(f);
  // A delivered packet is not a worker-exit receipt. Wait for the same
  // already-terminating reader before asserting the exact empty-lane quota.
  await f.store.active?.worker?.terminate(); assert.equal(f.store.active, null);
  const results = await Promise.allSettled(Array.from({length: CONTEXT_STORE_LIMITS.queue + 2}, () => worker(f)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, CONTEXT_STORE_LIMITS.queue + 1);
  for (const result of results.filter(r => r.status === 'fulfilled')) assert.deepEqual(result.value, expected);
  const rejected = results.filter(r => r.status === 'rejected'); assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.statusCode, 429); assert.match(rejected[0].reason.message, /queue full/);
  assert.deepEqual(await inventory(f.dir), before);
});

for (const [kind, name] of [['reference-world-patch-task-images','send.json'],['reference-world-patch-task-images','image-0.png'],
  ['reference-world-patch-task-images','manifest.json'],['reference-world-patch-tasks','payload.json']]) {
  test('bounded provider worker preserves corrupted original ' + kind + '/' + name, async t => {
    const f = await fixture(t), prepared = await worker(f);
    await fs.appendFile(path.join(f.dir, kind, f.receipt.capsuleId, name), ' synthetic corruption');
    const before = await inventory(f.dir); await assert.rejects(worker(f));
    await assert.rejects(worker(f, operations[1], {...binding(f), preparationHash: prepared.preparationHash}));
    assert.deepEqual(await inventory(f.dir), before);
  });
}

test('the provider worker refuses linked/hardlinked transport sources and does not repair them', async t => {
  const f = await fixture(t), prepared = await worker(f);
  const transport = path.join(f.dir, 'reference-world-patch-task-images', f.receipt.capsuleId), extra = path.join(f.dir, 'synthetic-link');
  await fs.link(path.join(transport, 'image-0.png'), extra); let before = await inventory(f.dir);
  await assert.rejects(worker(f)); assert.deepEqual(await inventory(f.dir), before); await fs.unlink(extra);
  const preserved = path.join(f.dir, 'synthetic-preserved-images'); await fs.rename(transport, preserved);
  await fs.symlink(preserved, transport, process.platform === 'win32' ? 'junction' : 'dir'); before = await inventory(f.dir);
  await assert.rejects(worker(f));
  await assert.rejects(worker(f, operations[1], {...binding(f), preparationHash: prepared.preparationHash}));
  assert.deepEqual(await inventory(f.dir), before);
});

test('internal provider-worker packet is not exposed by any HTTP route and never reaches a legacy adapter', async t => {
  const f = await fixture(t), before = await inventory(path.join(f.dir, 'reference-world-patch-tasks')); let calls = 0;
  const adapter = {close() {}, async generate() {calls++; throw Error('No provider permitted');}};
  const service = await startBridge({dataDir: f.dir, adapter, claudeAdapter: adapter, deepseekAdapter: adapter}); t.after(() => service.close());
  const headers = {Authorization: 'Bearer ' + service.connection.token, 'Content-Type': 'application/json'};
  for (const operation of [...operations, 'reference-patch-send']) {
    const response = await fetch('http://127.0.0.1:' + service.connection.port + '/v1/world-contexts/' + f.id + '/' + operation,
      {method: 'POST', headers, body: JSON.stringify(binding(f))});
    assert.equal(response.status, 404); assert.equal((await response.text()).includes(f.dir), false);
  }
  assert.equal(calls, 0); assert.deepEqual(await inventory(path.join(f.dir, 'reference-world-patch-tasks')), before);
  const {codexImageInput} = await import('../../bridge/codex-image-input.mjs'), packet = await worker(f);
  await assert.rejects(codexImageInput({images: packet.images, referenceInput: packet.referenceInput, cwd: f.dir,
    model: {id: f.input.intent.model, supportsImages: true}}));
  assert.equal(calls, 0);
});
