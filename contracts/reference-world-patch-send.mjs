import {exactKeys} from './world-selection.mjs';

// A new independent, data-only SEND binding. Not a consent registry, model
// invocation, live provider receipt or permission to write a Minecraft world.
export const REFERENCE_PATCH_SEND_PINS = Object.freeze(['capsuleId','manifestHash','taskDisclosureHash','taskHash',
  'requestHash','disclosureHash','promptSha256','reviewHash','confirmationHash','snapshotHash','selectionHash',
  'referenceSetHash','runtimeHash','imageCapabilityHash']);
const fields = ['format','version','purpose','confirmed',...REFERENCE_PATCH_SEND_PINS,'maximumCalls'];
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function validateFrozenReferenceWorldPatchExplicitSend(value) {
  exactKeys(value, fields, 'independent frozen reference-world-patch SEND');
  if (value.format !== 'FrozenReferenceWorldPatchExplicitSend' || value.version !== 1
    || value.purpose !== 'reference-world-patch-design' || value.confirmed !== true || value.maximumCalls !== 1
    || REFERENCE_PATCH_SEND_PINS.some(key => !digest(value[key]))) {
    throw Error('Independent exact one-call joint SEND required');
  }
  return Object.freeze({...value});
}

// The receipt must first come from the checked PRIVATE capsule reader. This
// equality helper is not an opaque credential authenticating caller JSON.
export function bindFrozenReferenceWorldPatchSend(receipt, value) {
  const send = validateFrozenReferenceWorldPatchExplicitSend(value);
  if (receipt?.format !== 'FrozenReferenceWorldPatchTaskReceipt' || receipt.version !== 1
    || receipt.purpose !== 'reference-world-patch-design' || receipt.state !== 'frozen-not-sent' || receipt.maximumCalls !== 1
    || !Number.isSafeInteger(receipt.imageCount) || receipt.imageCount < 1 || receipt.imageCount > 4
    || receipt.sourceAuthority !== 'client-submitted-block-facts-not-a-server-signature'
    || ['modelSent','sendingImplemented','serverBaselineVerified','canAuthorizePlacement',
      'summaryConsentTransferable','referenceConsentTransferable'].some(key => receipt[key] !== false)
    || REFERENCE_PATCH_SEND_PINS.some(key => !digest(receipt[key]) || receipt[key] !== send[key])) {
    throw Error('Original joint frozen task and exact independent SEND pins differ');
  }
  return send;
}
