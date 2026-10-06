import {contextHash, validateContextSnapshot} from '../src/world/context-snapshot.mjs';
import {exactKeys} from '../contracts/world-selection.mjs';
import {prepareWorldPatchDesignInput} from '../src/world/world-patch-design-input.mjs';
import {prepareWorldPatchDesignTask, confirmWorldPatchDesignTask, WORLD_PATCH_DESIGN_TASK_LIMITS} from '../src/world/world-patch-design-task.mjs';

// Called only on the context worker lane after the original private payload,
// snapshot, summary and ownership record have been independently reverified.
// Pure preparation: no consent registry, provider, account, or write API.
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest = /^[a-f0-9]{64}$/;
export const WORLD_PATCH_TASK_DISCLOSURE_LIMITS = Object.freeze({bytes: WORLD_PATCH_DESIGN_TASK_LIMITS.bytes + 32768});
function fail(message) { throw new Error(message); }

function prepareAt(saved, intent, options, now) {
  const {record, summary} = saved, snapshot = validateContextSnapshot(saved.snapshot);
  if (!record || record.format !== 'SavedWorldContext' || record.version !== 1 || !uuid.test(record.id)
    || !digest.test(record.payloadSha256) || !digest.test(record.recordHash) || record.modelSent !== false
    || record.canAuthorizePlacement !== false || record.sourceAuthority !== 'client-submitted-block-facts-not-a-server-signature'
    || record.privacy !== 'block-states-only' || !Number.isSafeInteger(record.createdAt)
    || !Number.isSafeInteger(record.expiresAt) || record.expiresAt <= record.createdAt || record.expiresAt <= now()) {
    fail('Verified unexpired saved patch context required');
  }
  const s = snapshot.selection, identity = {worldId: s.world.worldId, dimension: s.world.dimension,
    selectionRevision: s.revision, contextRevision: snapshot.fence.end};
  if (record.snapshotHash !== snapshot.snapshotHash || record.selectionHash !== snapshot.selectionHash
    || contextHash(record.identity) !== contextHash(identity)) fail('Patch context snapshot/identity binding rejected');
  const input = prepareWorldPatchDesignInput(snapshot, options);
  if (!summary || contextHash(summary) !== contextHash(input.contextSummary) || record.summaryHash !== input.contextSummary.summaryHash
    || record.totalCells !== input.contextSummary.totalCells || record.knownCells !== input.contextSummary.knownCells
    || record.unknownCells !== input.contextSummary.unknownCells) fail('Patch context summary/coverage binding rejected');
  const task = prepareWorldPatchDesignTask(snapshot, input, intent, options);
  // A queue/computation delay must not turn an expired capture into a task.
  if (record.expiresAt <= now()) fail('Patch context expired while preparing; reread the environment');
  const content = {format: 'SavedWorldPatchTaskDisclosure', version: 1, purpose: 'world-patch-design',
    contextId: record.id, payloadSha256: record.payloadSha256, recordHash: record.recordHash,
    recordExpiresAt: record.expiresAt, snapshotHash: record.snapshotHash, selectionHash: record.selectionHash,
    summaryHash: record.summaryHash, identity, task, taskHash: task.taskHash,
    sourceAuthority: record.sourceAuthority, summaryConsentTransferable: false,
    modelSent: false, sendingImplemented: false, serverBaselineVerified: false, canAuthorizePlacement: false};
  const result = {...content, taskDisclosureHash: contextHash(content)};
  if (Buffer.byteLength(JSON.stringify(result)) > WORLD_PATCH_TASK_DISCLOSURE_LIMITS.bytes) fail('Saved patch disclosure byte quota exceeded; no truncated baseline');
  return result;
}

export function prepareSavedWorldPatchTaskDisclosure(saved, intent, options) {
  return prepareAt(saved, intent, options, Date.now);
}

/** Independently reviewed exact-data artifact, NOT a send token. Rebuild from
 * saved original capture before comparing confirmation; never accept the
 * caller's prepared prompt, snapshot, a P3 receipt or a request-only approval. */
function reviewAt(saved, intent, confirmation, options, now) {
  const prepared = prepareAt(saved, intent, options, now);
  exactKeys(confirmation, ['format', 'version', 'purpose', 'confirmed', 'taskDisclosureHash',
    'taskHash', 'requestHash', 'disclosureHash', 'promptSha256'], 'saved exact patch confirmation');
  if (confirmation.format !== 'SavedWorldPatchDesignConfirmation' || confirmation.version !== 1
    || confirmation.purpose !== 'world-patch-design' || confirmation.confirmed !== true
    || confirmation.taskDisclosureHash !== prepared.taskDisclosureHash || confirmation.taskHash !== prepared.taskHash
    || confirmation.requestHash !== prepared.task.requestHash || confirmation.disclosureHash !== prepared.task.disclosure.disclosureHash
    || confirmation.promptSha256 !== prepared.task.request.promptSha256) fail('Independent confirmation of the exact saved patch disclosure required');
  const input = prepareWorldPatchDesignInput(saved.snapshot, options);
  const taskReview = confirmWorldPatchDesignTask(saved.snapshot, input, prepared.task, {
    format: 'WorldPatchDesignConfirmation', version: 1, purpose: 'world-patch-design', confirmed: true,
    requestHash: confirmation.requestHash, disclosureHash: confirmation.disclosureHash, promptSha256: confirmation.promptSha256,
  }, options);
  if (prepared.recordExpiresAt <= now()) fail('Patch context expired during content review; reread the environment');
  const content = {format: 'SavedWorldPatchDesignReview', version: 1, purpose: 'world-patch-design',
    contextId: prepared.contextId, payloadSha256: prepared.payloadSha256, recordHash: prepared.recordHash,
    recordExpiresAt: prepared.recordExpiresAt, snapshotHash: prepared.snapshotHash, selectionHash: prepared.selectionHash,
    summaryHash: prepared.summaryHash, identity: prepared.identity, taskDisclosureHash: prepared.taskDisclosureHash,
    taskHash: prepared.taskHash, requestHash: prepared.task.requestHash, taskReview, state: 'reviewed-not-sent',
    sourceAuthority: prepared.sourceAuthority, modelSent: false, sendingImplemented: false,
    summaryConsentTransferable: false, serverBaselineVerified: false, canAuthorizePlacement: false};
  return {...content, reviewHash: contextHash(content)};
}

export function reviewSavedWorldPatchTaskDisclosure(saved, intent, confirmation, options) {
  return reviewAt(saved, intent, confirmation, options, Date.now);
}

/** Archival verification at the ORIGINAL freeze time, never a current send
 * permission. The caller must independently verify the private source files
 * and the committed capsule manifest. Expired sources may be audited, not
 * promoted to fresh server baselines or new consent. No HTTP time override. */
export function validateFrozenSavedWorldPatchTaskDisclosure(saved, prepared, frozenAt, options) {
  if (!Number.isSafeInteger(frozenAt) || frozenAt < saved.record?.createdAt || frozenAt > Date.now()) fail('Invalid original patch freeze time');
  const now = () => frozenAt;
  const expected = prepareAt(saved, prepared?.task?.request?.intent, options, now);
  if (contextHash(prepared) !== contextHash(expected)) fail('Frozen patch disclosure no longer matches original source/rules');
  return expected; // Disclosure DATA only; no legacy confirmation or SEND authority.
}

export function validateFrozenSavedWorldPatchTask(saved, prepared, confirmation, review, frozenAt, options) {
  const expected = validateFrozenSavedWorldPatchTaskDisclosure(saved, prepared, frozenAt, options);
  const now = () => frozenAt;
  const expectedReview = reviewAt(saved, expected.task.request.intent, confirmation, options, now);
  if (contextHash(review) !== contextHash(expectedReview)) fail('Frozen patch review no longer matches original source/confirmation');
  return {prepared: expected, review: expectedReview};
}
