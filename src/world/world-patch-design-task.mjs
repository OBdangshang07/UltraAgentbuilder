import {createHash} from 'node:crypto';
import {exactKeys, regionCells} from '../../contracts/world-selection.mjs';
import {contextHash} from './context-snapshot.mjs';
import {prepareWorldPatchDesignInput, validateWorldPatchDesignInput, buildWorldPatchDesignPrompt,
  WORLD_PATCH_DESIGN_LIMITS} from './world-patch-design-input.mjs';

// Data-only preparation/review contract, NOT a live Bridge send endpoint.
// A summary-only P3 confirmation never authorizes exact P4 block disclosure.
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};
// modelPrompt contains serialized input; storing that prompt as JSON escapes
// its quotes once more. Account for the wrapper without truncating its data.
export const WORLD_PATCH_DESIGN_TASK_LIMITS = Object.freeze({bytes: 2 * WORLD_PATCH_DESIGN_LIMITS.bytes + 262144});
export function validateWorldPatchDesignIntent(value) {
  exactKeys(value, ['format', 'version', 'purpose', 'agent', 'model', 'effort', 'prompt', 'maximumCalls'], 'patch design intent');
  if (value.format !== 'WorldPatchDesignIntent' || value.version !== 1 || value.purpose !== 'world-patch-design' || value.maximumCalls !== 1) {
    throw Error('Independent one-call world patch design intent required');
  }
  if (!['codex', 'claude', 'deepseek'].includes(value.agent) || typeof value.model !== 'string'
    || !/^[a-zA-Z0-9._:/-]{1,128}$/.test(value.model) || !['default', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value.effort)) {
    throw Error('Invalid exact patch model/effort');
  }
  if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.includes('\u0000')
    || value.prompt.length > WORLD_PATCH_DESIGN_LIMITS.promptCharacters) throw Error('Invalid exact patch design prompt');
  return freeze({...value});
}

/** Rebuild all disclosure from the original snapshot. Show the exact prompt,
 * including absolute coordinates and opaque world ID, not a privacy summary
 * that omits the newly transmitted per-cell baseline. No accounts or images. */
export function prepareWorldPatchDesignTask(snapshot, inputValue, intentValue, options) {
  const intent = validateWorldPatchDesignIntent(intentValue);
  const input = validateWorldPatchDesignInput(snapshot, inputValue, options);
  const prompt = buildWorldPatchDesignPrompt(snapshot, input, intent.prompt, options);
  const request = {format: 'WorldPatchDesignTask', version: 1, purpose: 'world-patch-design',
    snapshotHash: input.snapshotHash, selectionHash: input.selectionHash, designInputHash: input.designInputHash,
    protocolHash: input.protocolHash, world: input.world, selectionRevision: snapshot.selection.revision,
    contextRevision: input.contextRevision, intent, promptSha256: prompt.promptSha256};
  const requestHash = contextHash(request);
  const disclosureContent = {format: 'WorldPatchDesignDisclosure', version: 1, purpose: 'world-patch-design', requestHash,
    recipient: {agent: intent.agent, model: intent.model, effort: intent.effort}, maximumCalls: 1,
    world: input.world, context: input.context, edit: input.edit, protected: input.protected,
    selectionRevision: request.selectionRevision, contextRevision: request.contextRevision,
    designInputHash: input.designInputHash, protocolHash: input.protocolHash,
    transmittedData: ['exact-user-task-and-rules', 'absolute-context-edit-protection-coordinates',
      'opaque-world-id-dimension-and-revisions', 'whole-W-exact-block-state-and-protection-facts',
      'six-already-captured-adjacent-face-slabs', 'context-material-counts-coverage-and-height-LOD', 'supported-target-state-catalog'],
    excludedData: ['NBT', 'container-items', 'sign-book-text', 'entities', 'save-paths', 'screenshots', 'diagonal-neighbor-cells'],
    cells: {context: regionCells(input.context), edit: regionCells(input.edit),
      exactKnown: input.exactBaseline.knownCells, exactUnknown: input.exactBaseline.unknownCells,
      adjacentFaces: input.exactBaseline.regions.filter(r => r.role === 'read-only-neighbor').map(r => ({face: r.face, region: r.region, cells: r.cells})),
      missingFaces: input.exactBaseline.missingFaces},
    modelPrompt: prompt.prompt, modelPromptUtf8Bytes: Buffer.byteLength(prompt.prompt), promptSha256: prompt.promptSha256,
    sourceAuthority: 'client-captured-block-facts-not-current-server-attestation',
    resultAuthority: 'untrusted-proposal-only-no-world-writes', summaryConsentTransferable: false,
    automaticRetry: false, modelSent: false, sendingImplemented: false, canAuthorizePlacement: false};
  const disclosure = {...disclosureContent, disclosureHash: contextHash(disclosureContent)};
  const content = {format: 'WorldPatchDesignPreparedTask', version: 1, request, requestHash, disclosure,
    modelSent: false, sendingImplemented: false, serverBaselineVerified: false, canAuthorizePlacement: false};
  const prepared = {...content, taskHash: contextHash(content)};
  if (Buffer.byteLength(JSON.stringify(prepared)) > WORLD_PATCH_DESIGN_TASK_LIMITS.bytes) throw Error('Patch task byte quota exceeded; no truncated disclosure');
  return freeze(prepared);
}

export function validateWorldPatchDesignTask(snapshot, input, value, options) {
  // Bound before rebuilding; never interpret a saved object's flags as authority.
  if (!value || Buffer.byteLength(JSON.stringify(value)) > WORLD_PATCH_DESIGN_TASK_LIMITS.bytes) throw Error('Patch task byte quota exceeded');
  const expected = prepareWorldPatchDesignTask(snapshot, input, value.request?.intent, options);
  if (contextHash(value) !== contextHash(expected)) throw Error('Patch task disclosure/request integrity mismatch');
  return expected;
}

/** A review artifact, not a send token. Future dispatch needs a durable budget
 * reservation and consume-once receipt; world writes need separate approval. */
export function confirmWorldPatchDesignTask(snapshot, input, taskValue, confirmation, options) {
  const task = validateWorldPatchDesignTask(snapshot, input, taskValue, options);
  exactKeys(confirmation, ['format', 'version', 'purpose', 'confirmed', 'requestHash', 'disclosureHash', 'promptSha256'], 'patch disclosure confirmation');
  if (confirmation.format !== 'WorldPatchDesignConfirmation' || confirmation.version !== 1 || confirmation.purpose !== 'world-patch-design'
    || confirmation.confirmed !== true || confirmation.requestHash !== task.requestHash
    || confirmation.disclosureHash !== task.disclosure.disclosureHash || confirmation.promptSha256 !== task.request.promptSha256) {
    throw Error('Explicit independent exact patch disclosure confirmation required');
  }
  const content = {format: 'WorldPatchDesignReviewedTask', version: 1, purpose: 'world-patch-design', taskHash: task.taskHash,
    requestHash: task.requestHash, disclosureHash: task.disclosure.disclosureHash, promptSha256: task.request.promptSha256,
    recipient: task.disclosure.recipient, maximumCalls: 1, state: 'reviewed-not-sent',
    sendingImplemented: false, modelSent: false, canAuthorizePlacement: false};
  return freeze({...content, reviewHash: contextHash(content)});
}

export function validateWorldPatchDesignReview(snapshot, input, taskValue, review, options) {
  const task = validateWorldPatchDesignTask(snapshot, input, taskValue, options);
  const expected = confirmWorldPatchDesignTask(snapshot, input, task, {format: 'WorldPatchDesignConfirmation', version: 1,
    purpose: 'world-patch-design', confirmed: true, requestHash: task.requestHash,
    disclosureHash: task.disclosure.disclosureHash, promptSha256: task.request.promptSha256}, options);
  if (contextHash(review) !== contextHash(expected)) throw Error('Patch review does not match the independent exact task');
  return expected;
}

export function prepareWorldPatchDesignTaskFromSnapshot(snapshot, intent, options) {
  return prepareWorldPatchDesignTask(snapshot, prepareWorldPatchDesignInput(snapshot, options), intent, options);
}

export function patchPromptHash(prompt) { return createHash('sha256').update(prompt).digest('hex'); }
