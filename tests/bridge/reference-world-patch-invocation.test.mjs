import test from 'node:test';
import assert from 'node:assert/strict';
import {jointCapsuleFixture} from '../fixtures/reference-world-patch-capsule-fixture.mjs';
import {REFERENCE_PATCH_INVOCATION_PINS, referenceWorldPatchInvocationBinding,
  validateReferenceWorldPatchInvocationBinding, bindReferenceWorldPatchInvocation} from '../../contracts/reference-world-patch-invocation.mjs';
import {prepareFrozenReferenceWorldPatchSendInput} from '../../bridge/reference-world-patch-send-input.mjs';
import {assemblyInvocationFingerprint} from '../../bridge/assembly-invocation.mjs';
import {worldPatchProposalSchema} from '../../contracts/world-patch.mjs';

test('exact joint descriptor retains the original canonical bytes and journal fingerprint without granting dispatch', async t => {
  const f = await jointCapsuleFixture(t), r = f.receipt;
  const original = {format: 'FrozenReferenceWorldPatchInvocationBinding', version: 1, purpose: 'reference-world-patch-design',
    capsuleId: r.capsuleId, manifestHash: r.manifestHash, taskHash: r.taskHash, requestHash: r.requestHash,
    snapshotHash: r.snapshotHash, selectionHash: r.selectionHash, referenceOwnerId: r.referenceOwnerId,
    referenceSetHash: r.referenceSetHash, runtimeHash: r.runtimeHash, imageCapabilityHash: r.imageCapabilityHash};
  const canonical = referenceWorldPatchInvocationBinding(r), reversed = Object.fromEntries(Object.entries(original).reverse());
  assert.equal(JSON.stringify(canonical), JSON.stringify(original)); assert.equal(Object.isFrozen(canonical), true);
  assert.equal(JSON.stringify(validateReferenceWorldPatchInvocationBinding(reversed)), JSON.stringify(original));
  assert.deepEqual(bindReferenceWorldPatchInvocation(r, reversed), original);
  const input = await prepareFrozenReferenceWorldPatchSendInput({dataDir: f.dir, capsuleId: r.capsuleId, send: f.send});
  assert.deepEqual(input.referenceInput, original);
  const fingerprint = assemblyInvocationFingerprint({prompt: input.prompt, index: 1, outputSchema: worldPatchProposalSchema,
    stageName: 'reference-world-patch-design', stageCount: 1, imageHashes: input.imageHashes, referenceInput: original});
  assert.equal(input.invocationFingerprint, fingerprint);
  for (const field of ['modelSent','sendingImplemented','allowsNewModelCall','canAuthorizePlacement','serverBaselineVerified']) assert.equal(input[field], false);
  for (const field of ['paths','images','maximumCalls','confirmed','canAuthorizePlacement','modelSent']) assert.equal(canonical[field], undefined);
});

test('all descriptor source pins reject coercible or malformed values and cannot borrow another original', async t => {
  const f = await jointCapsuleFixture(t), descriptor = referenceWorldPatchInvocationBinding(f.receipt);
  for (const key of REFERENCE_PATCH_INVOCATION_PINS) {
    // Always include an uppercase letter, even if a random owner ID happens
    // to contain only digits; malformed-input checks must not be probabilistic.
    for (const value of [[descriptor[key]], {toString: () => descriptor[key]}, null, true, 1, 'A' + descriptor[key].slice(1)]) {
      assert.throws(() => validateReferenceWorldPatchInvocationBinding({...descriptor, [key]: value}));
    }
    const changed = {...descriptor, [key]: key === 'referenceOwnerId' ? '11111111-2222-3333-4444-555555555555' : 'b'.repeat(64)};
    assert.throws(() => bindReferenceWorldPatchInvocation(f.receipt, changed), /original source pins/);
  }
});

test('legacy reference, text patch, consent, raw pictures and extra authority are not joint invocation descriptors', async t => {
  const f = await jointCapsuleFixture(t), descriptor = referenceWorldPatchInvocationBinding(f.receipt);
  for (const value of [f.receipt, f.send, f.confirmation, {format: 'JobReferenceInput', version: 1, ownerId: f.owner, bindingHash: 'a'.repeat(64)},
    {...descriptor, format: 'FrozenWorldPatchInvocationBinding'}, {...descriptor, purpose: 'world-patch-design'}, {...descriptor, version: 2},
    {...descriptor, images: f.pixels}, {...descriptor, allowsNewModelCall: true}, {...descriptor, path: '../private'},
    {...descriptor, maximumCalls: 1}, {...descriptor, model: f.input.intent.model}]) {
    assert.throws(() => validateReferenceWorldPatchInvocationBinding(value));
  }
  for (const field of ['modelSent','sendingImplemented','serverBaselineVerified','canAuthorizePlacement','summaryConsentTransferable','referenceConsentTransferable']) {
    assert.throws(() => referenceWorldPatchInvocationBinding({...f.receipt, [field]: true}), /Checked original/);
  }
  for (const change of [{format: 'FrozenWorldPatchTaskReceipt'}, {purpose: 'world-patch-design'}, {maximumCalls: 2},
    {state: 'sent'}, {imageCount: 0}, {imageCount: 5}, {sourceAuthority: 'server-signature'}]) {
    assert.throws(() => referenceWorldPatchInvocationBinding({...f.receipt, ...change}), /Checked original/);
  }
});
