import {exactKeys} from './world-selection.mjs';
import {REFERENCE_OWNER} from './reference-attachments.mjs';

// Canonical data identity only. A checked private source must supply the
// receipt; matching JSON is NOT consume-once consent or a live provider proof.
export const REFERENCE_PATCH_INVOCATION_PINS = Object.freeze(['capsuleId','manifestHash','taskHash','requestHash',
  'snapshotHash','selectionHash','referenceOwnerId','referenceSetHash','runtimeHash','imageCapabilityHash']);
const digests = REFERENCE_PATCH_INVOCATION_PINS.filter(key => key !== 'referenceOwnerId');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const owner = value => typeof value === 'string' && REFERENCE_OWNER.test(value);

export function validateReferenceWorldPatchInvocationBinding(value) {
  exactKeys(value, ['format','version','purpose',...REFERENCE_PATCH_INVOCATION_PINS], 'joint invocation binding');
  if (value.format !== 'FrozenReferenceWorldPatchInvocationBinding' || value.version !== 1
    || value.purpose !== 'reference-world-patch-design' || digests.some(key => !digest(value[key])) || !owner(value.referenceOwnerId)) {
    throw Error('Exact independent joint invocation identity required');
  }
  // Stable field order preserves the existing journal fingerprint, regardless
  // of the submitted JSON's insertion order. No paths/pixels/authority added.
  return Object.freeze({format: value.format, version: value.version, purpose: value.purpose,
    ...Object.fromEntries(REFERENCE_PATCH_INVOCATION_PINS.map(key => [key, value[key]]))});
}

export function referenceWorldPatchInvocationBinding(receipt) {
  if (receipt?.format !== 'FrozenReferenceWorldPatchTaskReceipt' || receipt.version !== 1
    || receipt.purpose !== 'reference-world-patch-design' || receipt.state !== 'frozen-not-sent' || receipt.maximumCalls !== 1
    || !Number.isSafeInteger(receipt.imageCount) || receipt.imageCount < 1 || receipt.imageCount > 4
    || receipt.sourceAuthority !== 'client-submitted-block-facts-not-a-server-signature'
    || ['modelSent','sendingImplemented','serverBaselineVerified','canAuthorizePlacement',
      'summaryConsentTransferable','referenceConsentTransferable'].some(key => receipt[key] !== false)) {
    throw Error('Checked original joint receipt required for invocation identity');
  }
  return validateReferenceWorldPatchInvocationBinding({format: 'FrozenReferenceWorldPatchInvocationBinding', version: 1,
    purpose: 'reference-world-patch-design', ...Object.fromEntries(REFERENCE_PATCH_INVOCATION_PINS.map(key => [key, receipt[key]]))});
}

export function bindReferenceWorldPatchInvocation(receipt, value) {
  const actual = validateReferenceWorldPatchInvocationBinding(value), expected = referenceWorldPatchInvocationBinding(receipt);
  if (REFERENCE_PATCH_INVOCATION_PINS.some(key => actual[key] !== expected[key])) throw Error('Joint invocation differs from original source pins');
  return actual;
}
