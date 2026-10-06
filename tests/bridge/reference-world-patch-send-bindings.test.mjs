import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {jointCapsuleFixture, jointRaw} from '../fixtures/reference-world-patch-capsule-fixture.mjs';
import {REFERENCE_PATCH_SEND_PINS, validateFrozenReferenceWorldPatchExplicitSend,
  bindFrozenReferenceWorldPatchSend} from '../../contracts/reference-world-patch-send.mjs';
import {bindFrozenWorldPatchSend} from '../../contracts/world-patch-send.mjs';
import {prepareFrozenReferenceWorldPatchSendInput} from '../../bridge/reference-world-patch-send-input.mjs';
import {readFrozenReferenceWorldPatchTaskSource} from '../../bridge/reference-world-patch-task-capsule.mjs';
import {assemblyInvocationFingerprint} from '../../bridge/assembly-invocation.mjs';
import {worldPatchProposalSchema} from '../../contracts/world-patch.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {contextHash} from '../../src/world/context-snapshot.mjs';
import {startBridge} from '../../bridge/server.mjs';

const prepare = f => prepareFrozenReferenceWorldPatchSendInput({dataDir: f.dir, capsuleId: f.receipt.capsuleId, send: f.send});
const worker = (f, operation = 'reference-patch-send-input') => f.store.operation(operation, f.receipt.capsuleId, jointRaw(f.send));
const capsule = f => path.join(f.dir, 'reference-world-patch-tasks', f.receipt.capsuleId);
async function inventory(dir) {
  const result = {};
  for (const name of await fs.readdir(dir)) {const target = path.join(dir, name), stat = await fs.lstat(target);
    result[name] = stat.isDirectory() && !stat.isSymbolicLink() ? await inventory(target) : stat.isFile() ? hash(await fs.readFile(target)) : 'link';}
  return result;
}

test('private joint SEND input binds exact original pictures, prompt, schema, scope and runtime without dispatching', async t => {
  const f = await jointCapsuleFixture(t), before = await inventory(f.dir), input = await prepare(f);
  assert.equal(input.format, 'FrozenReferenceWorldPatchSendInput'); assert.equal(input.mode, 'new-send-binding-not-dispatch');
  assert.deepEqual(input.receipt, f.receipt); assert.deepEqual(input.send, f.send); assert.equal(input.submissionHash, contextHash(f.send));
  assert.deepEqual(input.intent, f.input.intent); assert.equal(input.prompt, f.prepared.task.disclosure.modelPrompt);
  assert.equal(input.protocolHash, f.prepared.task.request.protocolHash); assert.equal(input.promptSha256, f.prepared.task.request.promptSha256);
  assert.deepEqual(input.imageHashes, f.pixels.map(p => hash(p))); assert.equal(input.imageCount, 2); assert.equal(input.maximumCalls, 1);
  assert.equal(input.referenceInput.snapshotHash, f.saved.record.snapshotHash); assert.equal(input.referenceInput.selectionHash, f.saved.record.selectionHash);
  assert.equal(input.referenceInput.referenceSetHash, f.reference.setHash); assert.equal(input.referenceInput.runtimeHash, f.input.runtimeHash);
  const expected = assemblyInvocationFingerprint({prompt: input.prompt, index: 1, outputSchema: worldPatchProposalSchema,
    stageName: 'reference-world-patch-design', stageCount: 1, imageHashes: input.imageHashes, referenceInput: input.referenceInput});
  assert.equal(input.invocationFingerprint, expected);
  const {inputHash, ...content} = input; assert.equal(inputHash, contextHash(content));
  for (const field of ['modelSent','sendingImplemented','liveProviderCapabilityVerified','serverBaselineVerified','canAuthorizePlacement','allowsNewModelCall']) assert.equal(input[field], false);
  for (const field of ['images','snapshot','payload','apiKey','account','paths','outputTokenLimit','sendToken']) assert.equal(input[field], undefined);
  assert.equal(JSON.stringify(input).includes(f.dir), false);
  assert.deepEqual(await worker(f), input); assert.deepEqual(await worker(f), input); assert.deepEqual(await inventory(f.dir), before);
  assert.equal(Object.isFrozen(validateFrozenReferenceWorldPatchExplicitSend(f.send)), true);
});

for (const key of REFERENCE_PATCH_SEND_PINS) test('changed joint SEND ' + key + ' cannot acquire the frozen original binding', async t => {
  const f = await jointCapsuleFixture(t), before = await inventory(f.dir), send = {...f.send, [key]: 'b'.repeat(64)};
  await assert.rejects(prepareFrozenReferenceWorldPatchSendInput({dataDir: f.dir, capsuleId: f.receipt.capsuleId, send}));
  await assert.rejects(f.store.operation('reference-patch-send-input', f.receipt.capsuleId, jointRaw(send)));
  assert.deepEqual(await inventory(f.dir), before);
});

test('strict new SEND digest types reject coercible arrays, objects, booleans, missing or extra authority', async t => {
  const f = await jointCapsuleFixture(t);
  for (const key of REFERENCE_PATCH_SEND_PINS) {
    for (const value of [[f.send[key]], {toString: () => f.send[key]}, null, false, 1, 'A'.repeat(64)]) {
      assert.throws(() => validateFrozenReferenceWorldPatchExplicitSend({...f.send, [key]: value}));
    }
  }
  for (const value of [f.receipt,f.prepared,f.confirmation,{...f.send, confirmed: false},{...f.send, maximumCalls: 2},
    {...f.send, purpose: 'world-patch-design'},{...f.send, version: 2},{...f.send, model: 'other'},
    {...f.send, images: f.pixels},{...f.send, allowWorldWrites: true},{...f.send, originalReceiptOnly: true}]) {
    assert.throws(() => validateFrozenReferenceWorldPatchExplicitSend(value));
  }
  assert.deepEqual(bindFrozenReferenceWorldPatchSend(f.receipt, f.send), f.send);
});

test('legacy protocol, joint reviewed data and authority-altered receipts are not joint SEND', async t => {
  const f = await jointCapsuleFixture(t);
  const oldPins = ['capsuleId','manifestHash','taskDisclosureHash','taskHash','requestHash','disclosureHash','promptSha256','reviewHash'];
  const legacy = {format: 'FrozenWorldPatchExplicitSend', version: 1, purpose: 'world-patch-design', confirmed: true,
    ...Object.fromEntries(oldPins.map(k => [k, f.send[k]])), maximumCalls: 1};
  assert.throws(() => bindFrozenReferenceWorldPatchSend(f.receipt, legacy)); assert.throws(() => bindFrozenWorldPatchSend(f.receipt, f.send));
  for (const field of ['modelSent','sendingImplemented','serverBaselineVerified','canAuthorizePlacement','summaryConsentTransferable','referenceConsentTransferable']) {
    assert.throws(() => bindFrozenReferenceWorldPatchSend({...f.receipt, [field]: true}, f.send));
  }
  for (const patch of [{format: 'FrozenWorldPatchTaskReceipt'}, {purpose: 'world-patch-design'}, {imageCount: 0}, {imageCount: 5},
    {maximumCalls: 2}, {state: 'sent'}, {sourceAuthority: 'server-signature'}]) assert.throws(() => bindFrozenReferenceWorldPatchSend({...f.receipt, ...patch}, f.send));
});

test('call fingerprint changes with image bytes/order, schema, phase, budget, original source and runtime', async t => {
  const f = await jointCapsuleFixture(t), input = await prepare(f);
  const original = {prompt: input.prompt, index: 1, outputSchema: worldPatchProposalSchema, stageName: 'reference-world-patch-design',
    stageCount: 1, imageHashes: input.imageHashes, referenceInput: input.referenceInput};
  for (const change of [{imageHashes: []}, {imageHashes: [...input.imageHashes].reverse()}, {imageHashes: ['b'.repeat(64), input.imageHashes[1]]},
    {prompt: input.prompt + ' '}, {index: 2}, {outputSchema: {}}, {stageName: 'world-patch-design'}, {stageCount: 2},
    {referenceInput: {...input.referenceInput, snapshotHash: 'b'.repeat(64)}},
    {referenceInput: {...input.referenceInput, selectionHash: 'b'.repeat(64)}},
    {referenceInput: {...input.referenceInput, runtimeHash: 'b'.repeat(64)}}]) {
    assert.notEqual(assemblyInvocationFingerprint({...original, ...change}), input.invocationFingerprint);
  }
  const source = await readFrozenReferenceWorldPatchTaskSource({dataDir: f.dir, capsuleId: f.receipt.capsuleId});
  assert.deepEqual(source.reference.images.map(bytes => hash(Buffer.from(bytes))), input.imageHashes);
});

test('original audit after expiry cannot become a new SEND binding or refreshed world baseline', async t => {
  const f = await jointCapsuleFixture(t), original = await prepare(f), before = await inventory(f.dir);
  t.mock.timers.enable({apis: ['Date'], now: f.receipt.recordExpiresAt + 1000});
  await assert.rejects(prepare(f), /expired before a new SEND/);
  const audit = await prepareFrozenReferenceWorldPatchSendInput({dataDir: f.dir, capsuleId: f.receipt.capsuleId, send: f.send, originalReceiptOnly: true});
  assert.equal(audit.mode, 'original-audit-only'); assert.equal(audit.invocationFingerprint, original.invocationFingerprint);
  assert.equal(audit.allowsNewModelCall, false); assert.equal(audit.serverBaselineVerified, false); assert.equal(audit.canAuthorizePlacement, false);
  assert.equal(audit.receipt.recordExpiresAt, original.receipt.recordExpiresAt); assert.deepEqual(await inventory(f.dir), before);
  for (const value of [1, 'true', null]) await assert.rejects(prepareFrozenReferenceWorldPatchSendInput({dataDir: f.dir,
    capsuleId: f.receipt.capsuleId, send: f.send, originalReceiptOnly: value}), /Private/);
});

test('discarded original sources are not recreated by private binding or original-only audit operations', async t => {
  const f = await jointCapsuleFixture(t), original = await worker(f);
  await f.store.operation('discard', f.id); const root = path.join(f.dir, 'world-contexts'), preserved = path.join(f.dir, 'preserved-store');
  await fs.rename(root, preserved); await f.store.close();
  const {WorldContextStore} = await import('../../bridge/world-context-store.mjs'); const reopened = new WorldContextStore({dataDir: f.dir}); t.after(() => reopened.close());
  assert.deepEqual(await reopened.operation('reference-patch-send-input', f.receipt.capsuleId, jointRaw(f.send)), original);
  const audit = await reopened.operation('reference-patch-original-input', f.receipt.capsuleId, jointRaw(f.send));
  assert.equal(audit.mode, 'original-audit-only'); assert.equal(audit.invocationFingerprint, original.invocationFingerprint);
  await assert.rejects(fs.stat(root), {code: 'ENOENT'});
});

test('unknown block coverage and protection remain original facts, never inferred from a picture', async t => {
  const f = await jointCapsuleFixture(t, {unknown: true, protectedCell: true}), input = await worker(f);
  const source = await readFrozenReferenceWorldPatchTaskSource({dataDir: f.dir, capsuleId: f.receipt.capsuleId});
  assert.equal(source.saved.record.knownCells, 0); assert.equal(source.saved.record.unknownCells, 125);
  assert.deepEqual(source.saved.snapshot.selection.protected, f.selection.protected);
  assert.equal(input.referenceInput.selectionHash, source.saved.snapshot.selectionHash); assert.equal(input.serverBaselineVerified, false);
  assert.equal(input.prompt, source.prepared.task.disclosure.modelPrompt); assert.equal(input.canAuthorizePlacement, false);
});

for (const file of ['manifest.json','image-0.png','reference-manifest.json','payload.json','joint-input.json']) test('private SEND input rejects corrupt archived ' + file, async t => {
  const f = await jointCapsuleFixture(t); await fs.appendFile(path.join(capsule(f), file), ' broken'); const before = await inventory(f.dir);
  await assert.rejects(worker(f)); await assert.rejects(worker(f, 'reference-patch-original-input'));
  assert.deepEqual(await inventory(f.dir), before);
});

test('strict worker input bounds, cancellation and closed lanes reject before source work', async t => {
  const f = await jointCapsuleFixture(t), before = await inventory(f.dir);
  for (const operation of ['reference-patch-send-input','reference-patch-original-input']) {
    for (const value of [Buffer.alloc(0), Buffer.alloc(4097), Buffer.from([0xff]), Buffer.from('{'), jointRaw({...f.send, originalReceiptOnly: true})]) {
      await assert.rejects(f.store.operation(operation, f.receipt.capsuleId, value));
    }
    for (const id of [f.id,'../private','a'.repeat(63),'A'.repeat(64)]) await assert.rejects(f.store.operation(operation, id, jointRaw(f.send)), /identity/);
    const abort = new AbortController(); abort.abort(); await assert.rejects(f.store.operation(operation, f.receipt.capsuleId, jointRaw(f.send), {signal: abort.signal}), /cancelled/);
  }
  await f.store.close(); await assert.rejects(worker(f), /closed/); assert.deepEqual(await inventory(f.dir), before);
});

test('internal binding adds no public input, joint SEND, original-audit or apply route and no provider call', async t => {
  const f = await jointCapsuleFixture(t), before = await inventory(capsule(f)); let calls = 0;
  const adapter = {close() {}, async generate() {calls++; throw Error('No provider permitted');}};
  const service = await startBridge({dataDir: f.dir, adapter, claudeAdapter: adapter, deepseekAdapter: adapter}); t.after(() => service.close());
  const headers = {Authorization: 'Bearer ' + service.connection.token, 'Content-Type': 'application/json'};
  for (const action of ['reference-patch-send-input','reference-patch-original-input','reference-patch-send','reference-patch-apply']) {
    const response = await fetch('http://127.0.0.1:' + service.connection.port + '/v1/world-contexts/' + f.id + '/' + action,
      {method: 'POST', headers, body: JSON.stringify(f.send)}); assert.equal(response.status, 404);
  }
  assert.equal(calls, 0); assert.deepEqual(await inventory(capsule(f)), before); assert.deepEqual(await worker(f), await prepare(f));
});
