import {contextHash} from '../src/world/context-snapshot.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {worldPatchProposalSchema} from '../contracts/world-patch.mjs';
import {bindFrozenReferenceWorldPatchSend} from '../contracts/reference-world-patch-send.mjs';
import {readFrozenReferenceWorldPatchTaskSource} from './reference-world-patch-task-capsule.mjs';
import {assemblyInvocationFingerprint} from './assembly-invocation.mjs';

// PRIVATE bounded-worker data packet only. Never expose the exact prompt or
// source attachment descriptors through HTTP. No provider, reservation, live
// capability check, path lookup, pixel rewrite or world-write authority here.
export async function prepareFrozenReferenceWorldPatchSendInput({dataDir, capsuleId, send, originalReceiptOnly = false}) {
  if (typeof originalReceiptOnly !== 'boolean') throw Error('Private original joint-receipt mode required');
  const source = await readFrozenReferenceWorldPatchTaskSource({dataDir, capsuleId});
  const {receipt, prepared, reference} = source, binding = bindFrozenReferenceWorldPatchSend(receipt, send);
  const audit = originalReceiptOnly;
  if (!audit && receipt.recordExpiresAt <= Date.now()) throw Error('Frozen joint capture expired before a new SEND; reread the environment');
  const request = prepared.task.request, disclosure = prepared.task.disclosure;
  const imageHashes = reference.images.map((bytes, i) => {
    const actual = hash(Buffer.from(bytes));
    if (actual !== reference.manifest.references[i].sha256) throw Error('Original joint picture fingerprint differs');
    return actual;
  });
  const referenceInput = {format: 'FrozenReferenceWorldPatchInvocationBinding', version: 1,
    purpose: 'reference-world-patch-design', capsuleId, manifestHash: receipt.manifestHash,
    taskHash: receipt.taskHash, requestHash: receipt.requestHash, snapshotHash: receipt.snapshotHash,
    selectionHash: receipt.selectionHash, referenceOwnerId: receipt.referenceOwnerId,
    referenceSetHash: receipt.referenceSetHash, runtimeHash: receipt.runtimeHash,
    imageCapabilityHash: receipt.imageCapabilityHash};
  const invocationFingerprint = assemblyInvocationFingerprint({prompt: disclosure.modelPrompt, index: 1,
    outputSchema: worldPatchProposalSchema, stageName: 'reference-world-patch-design', stageCount: 1,
    imageHashes, referenceInput});
  const content = {format: 'FrozenReferenceWorldPatchSendInput', version: 1, purpose: 'reference-world-patch-design',
    mode: audit ? 'original-audit-only' : 'new-send-binding-not-dispatch', receipt, send: binding,
    submissionHash: contextHash(binding), intent: request.intent, prompt: disclosure.modelPrompt,
    protocolHash: request.protocolHash, promptSha256: request.promptSha256, sourceAuthority: receipt.sourceAuthority,
    referenceInput, imageHashes, imageCount: imageHashes.length, invocationFingerprint,
    maximumCalls: 1, modelSent: false, sendingImplemented: false, liveProviderCapabilityVerified: false,
    serverBaselineVerified: false, canAuthorizePlacement: false, allowsNewModelCall: false};
  // Archive processing is bounded but not instantaneous. Check current expiry
  // again before returning a NEW binding; original audit never refreshes it.
  if (!audit && receipt.recordExpiresAt <= Date.now()) throw Error('Frozen joint capture expired while binding SEND');
  return {...content, inputHash: contextHash(content)};
}
