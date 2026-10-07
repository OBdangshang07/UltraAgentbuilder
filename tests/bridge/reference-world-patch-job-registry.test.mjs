import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {jointCapsuleFixture, jointRaw} from '../fixtures/reference-world-patch-capsule-fixture.mjs';
import {createReferenceWorldPatchJobRegistry, REFERENCE_PATCH_JOB_LIMITS} from '../../bridge/reference-world-patch-job-registry.mjs';
import {assemblyRuntimeIdentity} from '../../bridge/assembly-durability.mjs';
import {freezeReferenceWorldPatchTaskImages} from '../../bridge/reference-world-patch-task-images.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {contextHash} from '../../src/world/context-snapshot.mjs';
import {REFERENCE_PATCH_SEND_PINS} from '../../contracts/reference-world-patch-send.mjs';
import {startBridge} from '../../bridge/server.mjs';

// Authored block facts and pixels only. No provider, player world or account.
const runtimeHash = await assemblyRuntimeIdentity();
const selection = f => ({agent: f.input.intent.agent, model: f.input.intent.model, effort: f.input.intent.effort,
  runtimeHash: f.input.runtimeHash, capability: structuredClone(f.input.capability)});
const request = f => ({send: f.send, selected: selection(f)});
const jobDir = f => path.join(f.dir, 'reference-world-patch-design', f.receipt.capsuleId);
async function fixture(t, options = {}) {
  const f = await jointCapsuleFixture(t, {runtimeHash, ...options});
  await freezeReferenceWorldPatchTaskImages({dataDir: f.dir, capsuleId: f.receipt.capsuleId, send: f.send});
  f.open = async (contexts = f.store) => {
    const registry = await createReferenceWorldPatchJobRegistry({dataDir: f.dir, contexts});
    t.after(() => registry.close()); return registry;
  };
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
const load = async file => JSON.parse(await fs.readFile(file, 'utf8')).value;
const rewrite = (file, value) => fs.writeFile(file, JSON.stringify({value, sha256: hash(value)}));

test('joint SEND is consumed once with exact live owner/pixel pins but no model-call or world authority', async t => {
  const f = await fixture(t), registry = await f.open(), original = await inventory(path.join(f.dir, 'reference-world-patch-tasks'));
  assert.equal(await registry.get('b'.repeat(64)), null);
  const saved = await registry.reserve(request(f));
  assert.equal(saved.id, f.receipt.capsuleId); assert.equal(saved.state, 'send-consumed-not-dispatched');
  assert.equal(saved.sendConsumed, true); assert.equal(saved.callsReserved, 0); assert.equal(saved.maximumCalls, 1);
  assert.equal(saved.runtimeHash, runtimeHash); assert.equal(saved.originalProcessReferenceSaved, true);
  for (const key of ['modelSent','sendingImplemented','liveProviderCapabilityVerified','serverBaselineVerified','canAuthorizePlacement','allowsNewModelCall']) assert.equal(saved[key], false);
  assert.equal(saved.worldWrites, 0); assert.equal(saved.automaticRetries, 0);
  assert.equal(Object.isFrozen(saved), true); assert.equal(Object.isFrozen(saved.imageHashes), true);
  assert.doesNotMatch(JSON.stringify(saved), /modelPrompt|image-0\.png|ownerReference|executablePathHash/);
  assert.equal(JSON.stringify(saved).includes(f.dir), false);
  const record = await load(path.join(jobDir(f), 'request.json'));
  assert.deepEqual(record.send, f.send); assert.equal(record.ownerReference.observation.process.pid, process.pid);
  assert.equal(record.ownerReference.directory, jobDir(f)); assert.equal(record.submissionHash, contextHash(f.send));
  const packet = await registry.readOwnedInput(saved.id);
  assert.equal(packet.invocationFingerprint, saved.invocationFingerprint); assert.deepEqual(packet.imageHashes, saved.imageHashes);
  for (const [i, file] of packet.images.entries()) assert.deepEqual(await fs.readFile(file), f.pixels[i]);
  await assert.rejects(fs.stat(path.join(jobDir(f), 'assembly-journal')), {code: 'ENOENT'});
  assert.deepEqual(await registry.reserve(request(f)), saved);
  assert.deepEqual(await inventory(path.join(f.dir, 'reference-world-patch-tasks')), original);
});

test('concurrent duplicates share the original record; reopening cannot obtain dispatch ownership', async t => {
  const f = await fixture(t), registry = await f.open();
  const replies = await Promise.all(Array.from({length: 4}, () => registry.reserve(request(f))));
  replies.forEach(reply => assert.deepEqual(reply, replies[0])); assert.equal(registry.busy(), false);
  const before = await inventory(f.dir); await registry.close();
  const reopened = await f.open(); assert.deepEqual(await reopened.reserve(request(f)), replies[0]);
  await assert.rejects(reopened.readOwnedInput(f.receipt.capsuleId), /original joint owner/);
  assert.deepEqual(await inventory(f.dir), before);
});

test('independent registry instances reuse a committed job but only the original instance owns its input', async t => {
  const f = await fixture(t), first = await f.open(), second = await f.open();
  const expected = await first.reserve(request(f)); assert.deepEqual(await second.reserve(request(f)), expected);
  await assert.rejects(second.readOwnedInput(f.receipt.capsuleId), /ownership adoption/);
  assert.equal((await first.readOwnedInput(f.receipt.capsuleId)).capsuleId, expected.id);
});

test('all altered SEND pins, authority/budget injection and selected advertisement changes are rejected', async t => {
  const f = await fixture(t), registry = await f.open(), before = await inventory(f.dir);
  for (const pin of REFERENCE_PATCH_SEND_PINS) await assert.rejects(registry.reserve({...request(f), send: {...f.send, [pin]: 'b'.repeat(64)}}));
  for (const send of [f.receipt, f.prepared, {...f.send, maximumCalls: 2}, {...f.send, confirmed: false},
    {...f.send, canAuthorizePlacement: true}, {...f.send, format: 'FrozenWorldPatchExplicitSend'}]) {
    await assert.rejects(registry.reserve({...request(f), send}));
  }
  for (const change of [{agent: 'claude'}, {model: 'synthetic-other'}, {effort: 'high'}, {runtimeHash: 'b'.repeat(64)},
    {capability: {...f.input.capability, supportsImages: false}}, {capability: {...f.input.capability, efforts: ['max','high']}},
    {account: 'not-allowed'}]) await assert.rejects(registry.reserve({...request(f), selected: {...selection(f), ...change}}));
  for (const key of ['prompt','schema','dataDir','clock','signal','maximumCalls','allowNewModelCall']) {
    await assert.rejects(registry.reserve({...request(f), [key]: 'caller-injection'}));
  }
  assert.deepEqual(await inventory(f.dir), before);
});

test('a runtime advertised in a valid old capsule cannot be adopted by a different installed runtime', async t => {
  const f = await fixture(t, {runtimeHash: 'a'.repeat(64)}), registry = await f.open(), before = await inventory(f.dir);
  await assert.rejects(registry.reserve(request(f)), /another installed runtime/);
  assert.deepEqual(await inventory(f.dir), before);
});

test('existing exact SEND cannot silently change recipient or pins on duplicates, including in-flight duplicates', async t => {
  const f = await fixture(t), registry = await f.open();
  const pending = registry.reserve(request(f));
  const changed = assert.rejects(registry.reserve({...request(f), selected: {...selection(f), effort: 'high'}}), /differs/);
  await pending; await changed;
  await assert.rejects(registry.reserve({...request(f), send: {...f.send, promptSha256: 'b'.repeat(64)}}), /differs/);
  await assert.rejects(registry.reserve({...request(f), selected: {...selection(f), effort: 'high'}}), /differs/);
});

test('retained reservations survive expiry as history, but expiry cannot authorize a new owned provider packet', async t => {
  const f = await fixture(t), registry = await f.open(), expected = await registry.reserve(request(f)), before = await inventory(f.dir);
  t.mock.timers.enable({apis: ['Date'], now: f.receipt.recordExpiresAt});
  assert.deepEqual(await registry.get(f.receipt.capsuleId), expected);
  assert.deepEqual(await registry.reserve(request(f)), expected);
  // The bounded worker has its own real clock; use the checked parent gate as
  // well. It must not refresh expiry or create another reservation.
  await assert.rejects(registry.readOwnedInput(f.receipt.capsuleId), /expired/);
  assert.deepEqual(await inventory(f.dir), before);
});

test('expiry at new reservation blocks publication even though its original capsule can still be audited', async t => {
  const f = await fixture(t), registry = await f.open(), before = await inventory(f.dir);
  t.mock.timers.enable({apis: ['Date'], now: f.receipt.recordExpiresAt});
  await assert.rejects(registry.reserve(request(f)), /expired/);
  assert.deepEqual(await inventory(f.dir), before);
});

test('capture discard keeps original frozen inputs usable without recreating the discarded context', async t => {
  const f = await fixture(t), registry = await f.open();
  await f.store.operation('discard', f.id); const before = await inventory(path.join(f.dir, 'world-contexts'));
  await registry.reserve(request(f)); await registry.readOwnedInput(f.receipt.capsuleId);
  assert.deepEqual(await inventory(path.join(f.dir, 'world-contexts')), before);
});

test('partial original job or unknown cross-instance reservation claim is preserved rather than replaced', async t => {
  const f = await fixture(t), registry = await f.open();
  const root = path.dirname(jobDir(f)), lock = path.join(root, '_reserve.lock');
  await fs.writeFile(lock, 'synthetic partial claim', {flag: 'wx'}); let before = await inventory(f.dir);
  await assert.rejects(registry.reserve(request(f)), /unknown/); assert.deepEqual(await inventory(f.dir), before);
  await fs.unlink(lock); // fixture-owned synthetic corruption, not recovery
  await fs.mkdir(jobDir(f)); await fs.writeFile(path.join(jobDir(f), 'synthetic-remnant'), 'preserve me');
  before = await inventory(f.dir); await assert.rejects(registry.reserve(request(f)));
  await assert.rejects(registry.get(f.receipt.capsuleId)); assert.deepEqual(await inventory(f.dir), before);
});

for (const [kind, name] of [['reference-world-patch-task-images','image-0.png'], ['reference-world-patch-tasks','payload.json']]) {
  test('original source corruption is neither reserved nor repaired: ' + kind + '/' + name, async t => {
    const f = await fixture(t), registry = await f.open();
    await fs.appendFile(path.join(f.dir, kind, f.receipt.capsuleId, name), ' synthetic corruption');
    const before = await inventory(f.dir); await assert.rejects(registry.reserve(request(f))); assert.deepEqual(await inventory(f.dir), before);
  });
}

test('record and owner hardlinks, pin corruption and redirected job directories do not grant ownership', async t => {
  const f = await fixture(t), registry = await f.open(); await registry.reserve(request(f));
  const file = path.join(jobDir(f), 'request.json'), extra = path.join(f.dir, 'synthetic-hardlink');
  await fs.link(file, extra); let before = await inventory(f.dir);
  await assert.rejects(registry.get(f.receipt.capsuleId)); assert.deepEqual(await inventory(f.dir), before); await fs.unlink(extra);
  const original = await load(file); await rewrite(file, {...original, transportHash: 'b'.repeat(64)});
  await assert.rejects(registry.readOwnedInput(f.receipt.capsuleId), /packet changed/);
  await rewrite(file, original); await fs.link(path.join(jobDir(f), '_owner.json'), extra); before = await inventory(f.dir);
  await assert.rejects(registry.get(f.receipt.capsuleId)); assert.deepEqual(await inventory(f.dir), before); await fs.unlink(extra);
  const preserved = path.join(f.dir, 'synthetic-preserved-job'); await fs.rename(jobDir(f), preserved);
  await fs.symlink(preserved, jobDir(f), process.platform === 'win32' ? 'junction' : 'dir'); before = await inventory(f.dir);
  await assert.rejects(registry.get(f.receipt.capsuleId)); assert.deepEqual(await inventory(f.dir), before);
});

test('a later disk runtime change forbids owned input even when the selected model advertisement stays unchanged', async t => {
  const f = await fixture(t), registry = await f.open(); await registry.reserve(request(f)); const before = await inventory(f.dir);
  const original = fs.readFile, runtimeFile = new URL('../../bridge/reference-world-patch-job-registry.mjs', import.meta.url).href;
  // Authored runtime-identity read corruption inside THIS test process only;
  // no actual source/runtime file is edited and the context worker stays real.
  t.mock.method(fs, 'readFile', async function (file, ...args) {
    if (file instanceof URL && file.href === runtimeFile) return Buffer.from('labelled synthetic runtime change');
    return original.call(fs, file, ...args);
  });
  await assert.rejects(registry.readOwnedInput(f.receipt.capsuleId), /runtime changed/);
  assert.deepEqual(await inventory(f.dir), before);
});

test('unknown files in a consumed job cannot be reported as an unspent model outcome or adopted', async t => {
  const f = await fixture(t), registry = await f.open(); await registry.reserve(request(f));
  await fs.mkdir(path.join(jobDir(f), 'assembly-journal')); const before = await inventory(f.dir);
  await assert.rejects(registry.get(f.receipt.capsuleId), /Unknown joint job state/);
  await assert.rejects(registry.reserve(request(f))); await assert.rejects(registry.readOwnedInput(f.receipt.capsuleId));
  assert.deepEqual(await inventory(f.dir), before);
});

test('close cancels original private preparation; no fallback ownership or dispatch remains', async t => {
  const f = await fixture(t), registry = await f.open(), before = await inventory(f.dir);
  const pending = registry.reserve(request(f)), rejected = assert.rejects(pending, /closed|cancelled/);
  await registry.close(); await rejected; assert.equal(registry.busy(), false);
  await assert.rejects(registry.reserve(request(f)), /closed/); await assert.rejects(registry.readOwnedInput(f.receipt.capsuleId), /closed/);
  assert.deepEqual(await inventory(f.dir), before);
});

test('cross-process claim serializes publication and a stopped original publisher cannot be adopted', async t => {
  const f = await fixture(t), registry = await f.open();
  const child = fork(fileURLToPath(new URL('../fixtures/reference-world-patch-registry-process.mjs', import.meta.url)), [], {
    execArgv: [], windowsHide: true, stdio: ['ignore','pipe','pipe','ipc'],
  });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({code, signal})));
  t.after(async () => {if (child.exitCode === null && child.signalCode === null) child.kill(); await exited;});
  const message = new Promise((resolve, reject) => {child.once('message', resolve); child.once('error', reject);
    child.once('exit', () => reject(Error('Synthetic publisher exited before its original commit checkpoint')));});
  child.send({dataDir: f.dir, request: request(f)}); const state = await message;
  assert.equal(state.state, 'before-original-request-commit');
  assert.equal(child.exitCode, null); assert.equal(child.signalCode, null); assert.equal(process.kill(child.pid, 0), true);
  let before = await inventory(f.dir); await assert.rejects(registry.reserve(request(f))); assert.deepEqual(await inventory(f.dir), before);
  assert.ok(child.kill()); await exited; before = await inventory(f.dir);
  await assert.rejects(registry.reserve(request(f))); await assert.rejects(registry.get(f.receipt.capsuleId));
  assert.deepEqual(await inventory(f.dir), before);
});

test('history quota and unknown entries cannot trigger eviction or a new alternate job identity', async t => {
  const f = await fixture(t), registry = await f.open(), root = path.dirname(jobDir(f));
  await fs.writeFile(path.join(root, 'synthetic-unknown'), 'preserve me'); const before = await inventory(f.dir);
  await assert.rejects(registry.reserve(request(f)), /Unknown/); assert.deepEqual(await inventory(f.dir), before);
  assert.equal(REFERENCE_PATCH_JOB_LIMITS.records, 8); assert.equal(REFERENCE_PATCH_JOB_LIMITS.bindingBytes, 4096);
});

test('eight coherent synthetic history records enforce the real registry quota without evicting or publishing a ninth', async t => {
  const f = await fixture(t), registry = await f.open(); await registry.reserve(request(f));
  // A SECOND real capsule/transport in this authored-data fixture is the fresh
  // prospective SEND. The seven history entries below are explicitly synthetic
  // metadata, not provider receipts, accepted sources or dispatch ownership.
  const input = {...f.input, intent: {...f.input.intent, prompt: f.input.intent.prompt + '\n另一个合成任务'}};
  const prepared = await f.store.operation('reference-patch-task-disclosure', f.id, jointRaw(input));
  const confirmation = {format: 'SavedReferenceWorldPatchDesignConfirmation', version: 1, purpose: 'reference-world-patch-design', confirmed: true,
    taskDisclosureHash: prepared.taskDisclosureHash, taskHash: prepared.taskHash, requestHash: prepared.task.requestHash,
    disclosureHash: prepared.task.disclosure.disclosureHash, promptSha256: prepared.task.request.promptSha256,
    referenceSetHash: f.reference.setHash, runtimeHash, imageCapabilityHash: prepared.task.request.imageCapabilityHash};
  const receipt = await f.store.operation('reference-patch-freeze-task', f.id, jointRaw({...input, confirmation}));
  const send = {...f.send, ...Object.fromEntries(REFERENCE_PATCH_SEND_PINS.map(key => [key, receipt[key]]))};
  await freezeReferenceWorldPatchTaskImages({dataDir: f.dir, capsuleId: receipt.capsuleId, send});
  const original = await load(path.join(jobDir(f), 'request.json')), ownerBytes = await fs.readFile(path.join(jobDir(f), '_owner.json'));
  for (let i = 0; i < REFERENCE_PATCH_JOB_LIMITS.records - 1; i++) {
    const id = hash('labelled-synthetic-registry-history-' + i), dir = path.join(path.dirname(jobDir(f)), id);
    await fs.mkdir(dir); const value = structuredClone(original);
    value.id = id; value.send.capsuleId = id; value.receipt.capsuleId = id; value.submissionHash = contextHash(value.send);
    value.ownerReference.directory = dir; value.ownerReferenceHash = hash(value.ownerReference);
    await fs.writeFile(path.join(dir, '_owner.json'), ownerBytes, {flag: 'wx'}); await rewrite(path.join(dir, 'request.json'), value);
  }
  const before = await inventory(f.dir);
  await assert.rejects(registry.reserve({send, selected: selection(f)}), error => error.statusCode === 429 && /history quota/.test(error.message));
  assert.deepEqual(await inventory(f.dir), before); assert.equal(await registry.get(receipt.capsuleId), null);
});

test('registry construction accepts no caller identity overrides and cannot pair an unrelated context lane', async t => {
  const f = await fixture(t);
  for (const key of ['runtimeHash','owner','clock','maximumCalls','adapterFor']) {
    await assert.rejects(createReferenceWorldPatchJobRegistry({dataDir: f.dir, contexts: f.store, [key]: 'injected'}));
  }
  await assert.rejects(createReferenceWorldPatchJobRegistry({dataDir: f.dir, contexts: {root: f.dir, operation() {assert.fail('Unrelated lane must not run');}}}), /original context lane/);
  const registry = await f.open();
  for (const id of [undefined, ['a'.repeat(64)], '../private', 'A'.repeat(64)]) await assert.rejects(registry.get(id), /identity/);
});

test('joint registry is not reachable from legacy text patch or reference HTTP handlers', async t => {
  const f = await fixture(t), registry = await f.open(); await registry.reserve(request(f)); const before = await inventory(jobDir(f));
  let calls = 0; const adapter = {close() {}, async generate() {calls++; assert.fail('No model permitted');}};
  const service = await startBridge({dataDir: f.dir, adapter, claudeAdapter: adapter, deepseekAdapter: adapter}); t.after(() => service.close());
  const headers = {Authorization: 'Bearer ' + service.connection.token, 'Content-Type': 'application/json'};
  for (const endpoint of ['/v1/reference-world-patch-design', '/v1/world-contexts/' + f.id + '/reference-patch-send']) {
    const response = await fetch('http://127.0.0.1:' + service.connection.port + endpoint, {method: 'POST', headers, body: JSON.stringify(request(f))});
    assert.equal(response.status, 404); assert.equal((await response.text()).includes(f.dir), false);
  }
  assert.equal(calls, 0); assert.deepEqual(await inventory(jobDir(f)), before);
});
