import {exactKeys} from '../contracts/world-selection.mjs';
import {worldPatchProposalSchema} from '../contracts/world-patch.mjs';
import {contextHash} from '../src/world/context-snapshot.mjs';
import {prepareSavedReferenceWorldPatchTaskDisclosure} from './reference-world-patch-task-disclosure.mjs';
import {readFrozenReferenceWorldPatchTaskSource} from './reference-world-patch-task-capsule.mjs';
import {prepareFrozenReferenceWorldPatchSendInput} from './reference-world-patch-send-input.mjs';
import {readReferenceWorldPatchTaskImages} from './reference-world-patch-task-images.mjs';
import {assemblyInvocationFingerprint} from './assembly-invocation.mjs';

// PRIVATE bounded-worker preparation only. selected is an advertisement read
// by a future adapter, NOT proof of a live provider. No registry/reservation,
// endpoint, provider call, account lookup, pixel copying or world authority.
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const optionKeys = (value, fields, label) => exactKeys(value,
  [...fields, ...(value && Object.hasOwn(value, 'signal') ? ['signal'] : [])], label);
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
function checkpoint(signal) {
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw Error('Private provider-input cancellation signal required');
  if (signal?.aborted) throw Error('Joint provider-input preparation cancelled; original files preserved');
}
function selection(value, intent, runtimeHash) {
  exactKeys(value, ['agent','model','effort','runtimeHash','capability'], 'selected joint provider advertisement');
  exactKeys(value.capability, ['id','supportsImages','efforts'], 'selected joint image capability');
  if (value.agent !== intent.agent || value.model !== intent.model || value.effort !== intent.effort
    || !digest(value.runtimeHash) || value.runtimeHash !== runtimeHash) {
    throw Error('Selected joint recipient/effort/runtime differs from the original SEND');
  }
  // The existing preparation validates exact image/effort advertising and
  // binds advertised effort ORDER. Never infer images from a model name.
  return structuredClone(value);
}

/** Rebuild a prospective adapter packet from original checked local sources.
 * dataDir is internally supplied, never a request path. The caller cannot
 * supply prompt/schema/image paths/URLs, change pixels or refresh expiry. */
export async function prepareReferenceWorldPatchProviderInput(options) {
  optionKeys(options, ['dataDir','capsuleId','send','selected'], 'private joint provider input');
  const {dataDir, capsuleId, send, signal} = options;
  checkpoint(signal);
  const input = await prepareFrozenReferenceWorldPatchSendInput({dataDir, capsuleId, send});
  checkpoint(signal);
  const source = await readFrozenReferenceWorldPatchTaskSource({dataDir, capsuleId});
  if (contextHash(source.receipt) !== contextHash(input.receipt)) throw Error('Original joint provider source changed');
  const selected = selection(options.selected, input.intent, input.receipt.runtimeHash);
  const prepared = prepareSavedReferenceWorldPatchTaskDisclosure(source.saved, {
    intent: source.input.intent, reference: source.reference,
    capability: selected.capability, runtimeHash: selected.runtimeHash,
  });
  if (prepared.taskDisclosureHash !== input.receipt.taskDisclosureHash
    || contextHash(prepared) !== contextHash(source.prepared)
    || prepared.task.request.imageCapabilityHash !== input.receipt.imageCapabilityHash) {
    throw Error('Selected image/effort advertisement changed; new independent SEND required');
  }
  checkpoint(signal);
  // Only an already committed exact transport can be read. Missing/partial
  // data is not materialized, adopted, repaired or substituted by this reader.
  const images = await readReferenceWorldPatchTaskImages({dataDir, capsuleId, send, signal});
  const index = 1, stageName = 'reference-world-patch-design', stageCount = 1;
  const invocationFingerprint = assemblyInvocationFingerprint({prompt: input.prompt, index,
    outputSchema: worldPatchProposalSchema, stageName, stageCount,
    imageHashes: images.manifest.imageHashes, referenceInput: input.referenceInput});
  if (invocationFingerprint !== input.invocationFingerprint
    || images.manifest.submissionHash !== input.submissionHash
    || images.manifest.manifestHash !== input.receipt.manifestHash) throw Error('Joint provider invocation/picture identity differs');
  // Recheck both source and transport after the bounded rebuild. An adapter
  // still needs a NEW recheck immediately at its actual persistent turn start.
  const finalInput = await prepareFrozenReferenceWorldPatchSendInput({dataDir, capsuleId, send});
  const finalImages = await readReferenceWorldPatchTaskImages({dataDir, capsuleId, send, signal});
  if (finalInput.inputHash !== input.inputHash || finalImages.manifest.transportHash !== images.manifest.transportHash
    || contextHash(finalImages.images) !== contextHash(images.images)) throw Error('Joint provider sources changed during preparation');
  checkpoint(signal);
  if (input.receipt.recordExpiresAt <= Date.now()) throw Error('Joint capture expired before provider preparation finished');
  const content = {
    format: 'FrozenReferenceWorldPatchProviderInput', version: 1, purpose: stageName,
    mode: 'selected-advertisement-checked-not-dispatched', capsuleId,
    manifestHash: input.receipt.manifestHash, inputHash: input.inputHash,
    submissionHash: input.submissionHash, transportHash: images.manifest.transportHash,
    recordExpiresAt: input.receipt.recordExpiresAt, sourceAuthority: input.sourceAuthority,
    recipient: prepared.task.disclosure.recipient,
    selectedAdvertisement: prepared.task.disclosure.imageCapability,
    prompt: input.prompt, outputSchema: worldPatchProposalSchema,
    referenceInput: input.referenceInput, imageHashes: input.imageHashes,
    index, stageName, stageCount, invocationFingerprint, maximumCalls: 1,
    modelSent: false, sendingImplemented: false, liveProviderCapabilityVerified: false,
    serverBaselineVerified: false, canAuthorizePlacement: false, allowsNewModelCall: false,
  };
  // Pixel CONTENT/order, not machine-specific filenames, bind preparation.
  // Private paths are rebuilt each time; never accept a caller's edited packet.
  return freeze({...structuredClone(content), images: [...images.images], preparationHash: contextHash(content)});
}

/** Private read-only equality check. A digest is not a consent token. Always
 * returns a freshly checked packet, never trusts a submitted prompt or path. */
export async function recheckReferenceWorldPatchProviderInput(options) {
  optionKeys(options, ['dataDir','capsuleId','send','selected','preparationHash'], 'private joint provider recheck');
  const {preparationHash, ...input} = options;
  if (!digest(preparationHash)) throw Error('Exact original joint provider preparation digest required');
  const result = await prepareReferenceWorldPatchProviderInput(input);
  if (result.preparationHash !== preparationHash) throw Error('Original joint provider preparation changed');
  return result;
}
