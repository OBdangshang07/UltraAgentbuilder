import {exactKeys} from '../contracts/world-selection.mjs';
import {contextHash} from '../src/world/context-snapshot.mjs';
import {prepareSavedWorldPatchTaskDisclosure, validateFrozenSavedWorldPatchTaskDisclosure} from './world-patch-task-disclosure.mjs';
import {prepareReferenceWorldPatchDesignTask, confirmReferenceWorldPatchDesignTask,
  REFERENCE_WORLD_PATCH_TASK_LIMITS} from '../src/world/reference-world-patch-design-task.mjs';

// Worker-only data binding after independent original-source verification.
// This is NOT an opaque source credential, consent registry, SEND or world API.
export const SAVED_REFERENCE_PATCH_LIMITS = Object.freeze({bytes: REFERENCE_WORLD_PATCH_TASK_LIMITS.bytes + 32768});
const purpose = 'reference-world-patch-design';
const fail = message => {throw Error(message);};
function originalTaskInput(saved, input) {
  return {snapshot: saved.snapshot, reference: input.reference, intent: input.intent,
    capability: input.capability, runtimeHash: input.runtimeHash};
}
function prepareAt(saved, input, options, now, originalBase) {
  exactKeys(input, ['intent','reference','capability','runtimeHash'], 'saved joint patch preparation');
  const intent = input.intent;
  const base = originalBase ?? prepareSavedWorldPatchTaskDisclosure(saved, {format: 'WorldPatchDesignIntent', version: 1,
    purpose: 'world-patch-design', agent: intent?.agent, model: intent?.model, effort: intent?.effort,
    prompt: intent?.prompt, maximumCalls: intent?.maximumCalls}, options);
  const task = prepareReferenceWorldPatchDesignTask(originalTaskInput(saved, input), options);
  if (task.request.baseTaskHash !== base.taskHash) fail('Joint original saved baseline differs');
  if (base.recordExpiresAt <= now()) fail('Joint context expired during preparation; reread the environment');
  const content = {format: 'SavedReferenceWorldPatchTaskDisclosure', version: 1, purpose,
    contextId: base.contextId, payloadSha256: base.payloadSha256, recordHash: base.recordHash,
    recordExpiresAt: base.recordExpiresAt, snapshotHash: base.snapshotHash, selectionHash: base.selectionHash,
    summaryHash: base.summaryHash, identity: base.identity, task, taskHash: task.taskHash,
    sourceAuthority: base.sourceAuthority, summaryConsentTransferable: false, referenceConsentTransferable: false,
    modelSent: false, sendingImplemented: false, serverBaselineVerified: false, canAuthorizePlacement: false};
  const result = {...content, taskDisclosureHash: contextHash(content)};
  if (Buffer.byteLength(JSON.stringify(result)) > SAVED_REFERENCE_PATCH_LIMITS.bytes) fail('Saved joint disclosure byte quota; no baseline truncation');
  return result;
}

export function prepareSavedReferenceWorldPatchTaskDisclosure(saved, input, options) {
  return prepareAt(saved, input, options, Date.now);
}

function reviewAt(saved, input, confirmation, options, now, originalBase) {
  const prepared = prepareAt(saved, input, options, now, originalBase);
  exactKeys(confirmation, ['format','version','purpose','confirmed','taskDisclosureHash','taskHash',
    'requestHash','disclosureHash','promptSha256','referenceSetHash','runtimeHash','imageCapabilityHash'], 'saved joint confirmation');
  if (confirmation.format !== 'SavedReferenceWorldPatchDesignConfirmation' || confirmation.version !== 1
    || confirmation.purpose !== purpose || confirmation.confirmed !== true
    || confirmation.taskDisclosureHash !== prepared.taskDisclosureHash || confirmation.taskHash !== prepared.taskHash
    || confirmation.requestHash !== prepared.task.requestHash || confirmation.disclosureHash !== prepared.task.disclosure.disclosureHash
    || ['promptSha256','referenceSetHash','runtimeHash','imageCapabilityHash'].some(k => confirmation[k] !== prepared.task.request[k])) {
    fail('New confirmation of original saved context, exact pictures and joint recipient required');
  }
  const taskReview = confirmReferenceWorldPatchDesignTask(originalTaskInput(saved, input), prepared.task, {
    format: 'ReferenceWorldPatchDesignConfirmation', version: 1, purpose, confirmed: true,
    requestHash: confirmation.requestHash, disclosureHash: confirmation.disclosureHash,
    promptSha256: confirmation.promptSha256, referenceSetHash: confirmation.referenceSetHash,
    runtimeHash: confirmation.runtimeHash, imageCapabilityHash: confirmation.imageCapabilityHash}, options);
  if (prepared.recordExpiresAt <= now()) fail('Joint context expired during review; reread the environment');
  const content = {format: 'SavedReferenceWorldPatchDesignReview', version: 1, purpose,
    contextId: prepared.contextId, payloadSha256: prepared.payloadSha256, recordHash: prepared.recordHash,
    recordExpiresAt: prepared.recordExpiresAt, snapshotHash: prepared.snapshotHash, selectionHash: prepared.selectionHash,
    summaryHash: prepared.summaryHash, identity: prepared.identity, taskDisclosureHash: prepared.taskDisclosureHash,
    taskHash: prepared.taskHash, requestHash: prepared.task.requestHash, taskReview, state: 'reviewed-not-sent',
    sourceAuthority: prepared.sourceAuthority, summaryConsentTransferable: false, referenceConsentTransferable: false,
    modelSent: false, sendingImplemented: false, serverBaselineVerified: false, canAuthorizePlacement: false};
  return {...content, reviewHash: contextHash(content)};
}

export function reviewSavedReferenceWorldPatchTaskDisclosure(saved, input, confirmation, options) {
  return reviewAt(saved, input, confirmation, options, Date.now);
}

// Archive-only verification at the checked ORIGINAL freeze time. This rebuilds
// data, not fresh consent; current preparation/review still always uses Date.now.
// A joint capsule stores the original text-baseline DISCLOSURE, never a forged
// legacy confirmation/review that could be promoted to the text SEND protocol.
export function validateFrozenSavedReferenceWorldPatchTask(saved, input, prepared, confirmation, review, frozenAt, baseDisclosure, options) {
  const base = validateFrozenSavedWorldPatchTaskDisclosure(saved, baseDisclosure, frozenAt, options), now = () => frozenAt;
  const expected = prepareAt(saved, input, options, now, base);
  if (contextHash(prepared) !== contextHash(expected)) fail('Original frozen joint disclosure mismatch');
  const expectedReview = reviewAt(saved, input, confirmation, options, now, base);
  if (contextHash(review) !== contextHash(expectedReview)) fail('Original frozen joint review mismatch');
  return {prepared: expected, review: expectedReview};
}
