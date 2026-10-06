import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {jointCapsuleFixture, jointRaw} from '../fixtures/reference-world-patch-capsule-fixture.mjs';
import {freezeReferenceWorldPatchTaskImages, readReferenceWorldPatchTaskImages} from '../../bridge/reference-world-patch-task-images.mjs';
import {prepareReferenceWorldPatchProviderInput, recheckReferenceWorldPatchProviderInput} from '../../bridge/reference-world-patch-provider-input.mjs';
import {prepareFrozenReferenceWorldPatchSendInput} from '../../bridge/reference-world-patch-send-input.mjs';
import {REFERENCE_PATCH_SEND_PINS} from '../../contracts/reference-world-patch-send.mjs';
import {worldPatchProposalSchema} from '../../contracts/world-patch.mjs';
import {assemblyInvocationFingerprint} from '../../bridge/assembly-invocation.mjs';
import {contextHash} from '../../src/world/context-snapshot.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {startBridge} from '../../bridge/server.mjs';

const sourceArgs = f => ({dataDir: f.dir, capsuleId: f.receipt.capsuleId, send: f.send});
const args = f => ({...sourceArgs(f), selected: {agent: f.input.intent.agent, model: f.input.intent.model,
  effort: f.input.intent.effort, runtimeHash: f.input.runtimeHash, capability: structuredClone(f.input.capability)}});
const prepare = f => prepareReferenceWorldPatchProviderInput(args(f));
const transport = f => path.join(f.dir, 'reference-world-patch-task-images', f.receipt.capsuleId);
const capsule = f => path.join(f.dir, 'reference-world-patch-tasks', f.receipt.capsuleId);
async function fixture(t) {
  const f = await jointCapsuleFixture(t); await freezeReferenceWorldPatchTaskImages(sourceArgs(f)); return f;
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

test('joint provider preparation binds exact ordered original pixels/prompt/schema/runtime without dispatch or mutation', async t => {
  const f = await fixture(t), before = await inventory(f.dir), result = await prepare(f);
  const input = await prepareFrozenReferenceWorldPatchSendInput(sourceArgs(f));
  const original = await readReferenceWorldPatchTaskImages(sourceArgs(f));
  assert.equal(result.format, 'FrozenReferenceWorldPatchProviderInput');
  assert.equal(result.mode, 'selected-advertisement-checked-not-dispatched');
  assert.equal(result.prompt, f.prepared.task.disclosure.modelPrompt);
  assert.deepEqual(result.outputSchema, worldPatchProposalSchema);
  assert.deepEqual(result.recipient, f.prepared.task.disclosure.recipient);
  assert.deepEqual(result.selectedAdvertisement, f.prepared.task.disclosure.imageCapability);
  assert.deepEqual(result.referenceInput, input.referenceInput);
  assert.deepEqual(result.images, original.images); assert.deepEqual(result.imageHashes, f.pixels.map(hash));
  assert.equal(result.transportHash, original.manifest.transportHash);
  assert.equal(result.submissionHash, contextHash(f.send)); assert.equal(result.inputHash, input.inputHash);
  assert.equal(result.invocationFingerprint, input.invocationFingerprint);
  assert.equal(result.invocationFingerprint, assemblyInvocationFingerprint(result));
  assert.equal(result.maximumCalls, 1); assert.equal(result.index, 1); assert.equal(result.stageCount, 1);
  assert.equal(result.stageName, 'reference-world-patch-design');
  assert.equal(result.recordExpiresAt, f.receipt.recordExpiresAt);
  for (const key of ['modelSent','sendingImplemented','liveProviderCapabilityVerified',
    'serverBaselineVerified','canAuthorizePlacement','allowsNewModelCall']) assert.equal(result[key], false);
  for (const [i, file] of result.images.entries()) assert.deepEqual(await fs.readFile(file), f.pixels[i]);
  const {preparationHash, images, ...content} = result; assert.equal(preparationHash, contextHash(content));
  assert.equal(JSON.stringify(content).includes(f.dir), false);
  for (const value of [result,result.images,result.imageHashes,result.outputSchema,result.referenceInput,result.selectedAdvertisement,
    result.selectedAdvertisement.advertisedEfforts]) assert.equal(Object.isFrozen(value), true);
  assert.throws(() => result.images.reverse(), TypeError);
  assert.deepEqual(await prepare(f), result);
  assert.deepEqual(await recheckReferenceWorldPatchProviderInput({...args(f), preparationHash}), result);
  assert.deepEqual(await inventory(f.dir), before);
});

test('no reader creates an absent or incomplete transport and original context discard does not recreate it', async t => {
  const f = await jointCapsuleFixture(t), before = await inventory(f.dir);
  await assert.rejects(prepare(f), {code: 'ENOENT'}); assert.deepEqual(await inventory(f.dir), before);
  await freezeReferenceWorldPatchTaskImages(sourceArgs(f)); const ready = await prepare(f);
  await f.store.operation('discard', f.id); await f.store.close();
  const contexts = path.join(f.dir, 'world-contexts'); await fs.rename(contexts, path.join(f.dir, 'synthetic-preserved-contexts'));
  const archived = await inventory(f.dir); assert.deepEqual(await prepare(f), ready);
  await assert.rejects(fs.stat(contexts), {code: 'ENOENT'}); assert.deepEqual(await inventory(f.dir), archived);
  await fs.rename(path.join(transport(f), 'manifest.json'), path.join(transport(f), 'synthetic-preserved-manifest.json'));
  const partial = await inventory(f.dir); await assert.rejects(prepare(f)); assert.deepEqual(await inventory(f.dir), partial);
});

test('recipient/model/effort/runtime and capability advertisement changes invalidate the original SEND', async t => {
  const f = await fixture(t), before = await inventory(f.dir), original = args(f);
  const changes = [{agent: 'claude'}, {model: 'gpt-synthetic-other'}, {effort: 'high'}, {runtimeHash: 'b'.repeat(64)},
    {runtimeHash: [original.selected.runtimeHash]}, {capability: {...f.input.capability, id: 'gpt-synthetic-other'}},
    {capability: {...f.input.capability, supportsImages: false}}, {capability: {...f.input.capability, efforts: ['max','high']}},
    {capability: {...f.input.capability, efforts: ['high']}}, {capability: {...f.input.capability, efforts: ['high','max','ultra']}},
    {capability: {...f.input.capability, efforts: ['max','max']}}, {capability: {...f.input.capability, efforts: [['max']]}},
    {capability: {...f.input.capability, efforts: Array(2)}}, {capability: {...f.input.capability, images: ['caller.png']}},
    {capability: {...f.input.capability, supportsImages: 1}}, {account: 'caller-selected-account'}];
  for (const change of changes) await assert.rejects(prepareReferenceWorldPatchProviderInput({...original, selected: {...original.selected, ...change}}));
  assert.deepEqual(await inventory(f.dir), before);
});

test('caller prompt/schema/images/paths/authority or legacy data never enter the private reader', async t => {
  const f = await fixture(t), original = args(f), before = await inventory(f.dir);
  for (const [key, value] of Object.entries({prompt: 'caller text', outputSchema: {}, images: ['caller.png'],
    imageHashes: [], referenceInput: {}, originalReceiptOnly: true, liveProviderCapabilityVerified: true,
    canAuthorizePlacement: true, maximumCalls: 2, url: 'https://example.invalid/image.png', jobRoot: 'caller-directory'})) {
    await assert.rejects(prepareReferenceWorldPatchProviderInput({...original, [key]: value}), /fields/);
  }
  for (const selected of [undefined, null, [], {...original.selected, paths: ['caller.png']}, f.input.capability]) {
    await assert.rejects(prepareReferenceWorldPatchProviderInput({...original, selected}));
  }
  for (const send of [f.confirmation,f.receipt,{}, {...f.send, maximumCalls: 2}]) {
    await assert.rejects(prepareReferenceWorldPatchProviderInput({...original, send}));
  }
  for (const capsuleId of [f.id,'../private','A'.repeat(64),[f.receipt.capsuleId]]) {
    await assert.rejects(prepareReferenceWorldPatchProviderInput({...original, capsuleId}));
  }
  for (const key of REFERENCE_PATCH_SEND_PINS) {
    await assert.rejects(prepareReferenceWorldPatchProviderInput({...original, send: {...f.send, [key]: 'b'.repeat(64)}}));
  }
  assert.deepEqual(await inventory(f.dir), before);
});

test('recheck cannot promote a digest or submitted packet into consent', async t => {
  const f = await fixture(t), ready = await prepare(f), before = await inventory(f.dir);
  for (const preparationHash of [undefined,null,{},[ready.preparationHash],'A'.repeat(64),'b'.repeat(64)]) {
    await assert.rejects(recheckReferenceWorldPatchProviderInput({...args(f), preparationHash}), /digest|changed/);
  }
  await assert.rejects(recheckReferenceWorldPatchProviderInput({...args(f), preparationHash: ready.preparationHash,
    prompt: ready.prompt}), /fields/);
  assert.deepEqual(await inventory(f.dir), before);
});

test('current expiry forbids provider preparation/recheck although exact original archive remains auditable', async t => {
  const f = await fixture(t), ready = await prepare(f), before = await inventory(f.dir);
  t.mock.timers.enable({apis: ['Date'], now: f.receipt.recordExpiresAt});
  await assert.rejects(prepare(f), /expired/);
  await assert.rejects(recheckReferenceWorldPatchProviderInput({...args(f), preparationHash: ready.preparationHash}), /expired/);
  assert.equal((await readReferenceWorldPatchTaskImages(sourceArgs(f))).manifest.transportHash, ready.transportHash);
  assert.deepEqual(await inventory(f.dir), before);
});

test('cancellation before work or during a final transport read never permits a returned provider packet', async t => {
  const f = await fixture(t), before = await inventory(f.dir), control = new AbortController(); control.abort();
  for (const signal of [control.signal,{},true,null]) await assert.rejects(prepareReferenceWorldPatchProviderInput({...args(f), signal}), /cancel/);
  const active = new AbortController(), open = fs.open; let reads = 0;
  t.mock.method(fs, 'open', async (file, ...rest) => {
    if (file === path.join(transport(f), 'image-0.png') && ++reads === 2) active.abort();
    return open(file, ...rest);
  });
  await assert.rejects(prepareReferenceWorldPatchProviderInput({...args(f), signal: active.signal}), /cancelled/);
  assert.equal(reads, 2); assert.deepEqual(await inventory(f.dir), before);
});

test('expiry occurring in the final checked transport read is rejected without changing original files', async t => {
  const f = await fixture(t), before = await inventory(f.dir), open = fs.open; let reads = 0;
  t.mock.method(fs, 'open', async (file, ...rest) => {
    if (file === path.join(transport(f), 'image-1.png') && ++reads === 2) {
      t.mock.timers.enable({apis: ['Date'], now: f.receipt.recordExpiresAt + 1});
    }
    return open(file, ...rest);
  });
  await assert.rejects(prepare(f), /expired/); assert.equal(reads, 2); assert.deepEqual(await inventory(f.dir), before);
});

for (const [kind, name] of [['transport','send.json'],['transport','image-0.png'],['transport','manifest.json'],
  ['capsule','payload.json'],['capsule','snapshot.json'],['capsule','task-disclosure.json'],['capsule','image-1.png']]) {
  test('corrupt original ' + kind + '/' + name + ' is preserved; no replacement packet', async t => {
    const f = await fixture(t), ready = await prepare(f);
    await fs.appendFile(path.join(kind === 'transport' ? transport(f) : capsule(f), name), ' synthetic corruption');
    const before = await inventory(f.dir); await assert.rejects(prepare(f));
    await assert.rejects(recheckReferenceWorldPatchProviderInput({...args(f), preparationHash: ready.preparationHash}));
    assert.deepEqual(await inventory(f.dir), before);
  });
}

test('a source changed after the first transport read is detected by the final original-source recheck', async t => {
  const f = await fixture(t), open = fs.open; let changed = false;
  t.mock.method(fs, 'open', async (file, ...rest) => {
    if (!changed && file === path.join(transport(f), 'image-1.png')) {
      changed = true; await fs.appendFile(path.join(capsule(f), 'image-0.png'), ' synthetic mutation');
    }
    return open(file, ...rest);
  });
  await assert.rejects(prepare(f)); assert.equal(changed, true);
  assert.match((await fs.readFile(path.join(capsule(f), 'image-0.png'))).toString(), /synthetic mutation$/);
});

test('recomputed manifest hash cannot authorize swapped pixels or provider/world flags', async t => {
  const f = await fixture(t), file = path.join(transport(f), 'manifest.json'), original = JSON.parse(await fs.readFile(file));
  for (const change of [{imageHashes: [...original.imageHashes].reverse()}, {liveProviderCapabilityVerified: true},
    {modelSent: true}, {allowsNewModelCall: true}, {canAuthorizePlacement: true}]) {
    const {transportHash, ...content} = {...original, ...change};
    await fs.writeFile(file, jointRaw({...content, transportHash: contextHash(content)}));
    const before = await inventory(f.dir); await assert.rejects(prepare(f)); assert.deepEqual(await inventory(f.dir), before);
  }
});

test('hardlinks and linked transport directories cannot redirect original picture preparation', async t => {
  const f = await fixture(t), file = path.join(transport(f), 'image-0.png'), link = path.join(f.dir, 'synthetic-hardlink');
  await fs.link(file, link); let before = await inventory(f.dir);
  await assert.rejects(prepare(f)); assert.deepEqual(await inventory(f.dir), before); await fs.unlink(link);
  const original = transport(f), preserved = path.join(f.dir, 'synthetic-preserved-transport');
  await fs.rename(original, preserved); await fs.symlink(preserved, original, process.platform === 'win32' ? 'junction' : 'dir');
  before = await inventory(f.dir); await assert.rejects(prepare(f)); assert.deepEqual(await inventory(f.dir), before);
});

test('provider preparation adds no public endpoint and does not route the joint descriptor into legacy Codex', async t => {
  const f = await fixture(t), before = await inventory(f.dir); let calls = 0;
  const adapter = {close() {}, async generate() {calls++; throw Error('No provider permitted');}};
  const service = await startBridge({dataDir: f.dir, adapter, claudeAdapter: adapter, deepseekAdapter: adapter});
  t.after(() => service.close());
  for (const action of ['reference-patch-provider-input','reference-patch-provider-recheck','reference-patch-send']) {
    const response = await fetch('http://127.0.0.1:' + service.connection.port + '/v1/world-contexts/' + f.id + '/' + action,
      {method: 'POST', headers: {Authorization: 'Bearer ' + service.connection.token, 'Content-Type': 'application/json'}, body: JSON.stringify(f.send)});
    assert.equal(response.status, 404); assert.equal((await response.text()).includes(f.dir), false);
  }
  assert.equal(calls, 0);
  // Bridge may initialize its own data; it must not change the archived task.
  const after = await inventory(f.dir);
  for (const name of ['reference-world-patch-tasks','reference-world-patch-task-images']) assert.deepEqual(after[name], before[name]);
  const {codexImageInput} = await import('../../bridge/codex-image-input.mjs');
  const prepared = await prepare(f);
  await assert.rejects(codexImageInput({images: [], referenceInput: prepared.referenceInput, cwd: f.dir,
    model: {id: f.input.intent.model, supportsImages: true}}));
  assert.equal(calls, 0);
});
