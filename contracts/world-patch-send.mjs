import {exactKeys} from './world-selection.mjs';
const digest = /^[a-f0-9]{64}$/;
const fields = ['format', 'version', 'purpose', 'confirmed', 'capsuleId', 'manifestHash', 'taskDisclosureHash',
  'taskHash', 'requestHash', 'disclosureHash', 'promptSha256', 'reviewHash', 'maximumCalls'];
const pins = ['capsuleId', 'manifestHash', 'taskDisclosureHash', 'taskHash', 'requestHash', 'disclosureHash', 'promptSha256', 'reviewHash'];

/** Independent SEND, not a reused disclosure review or a world-write consent.
 * Stable exact binding makes duplicate/lost POST outcomes recover by original
 * capsule identity without authorizing another generation. */
export function validateFrozenWorldPatchExplicitSend(value) {
  exactKeys(value, fields, 'independent frozen patch SEND');
  if (value.format !== 'FrozenWorldPatchExplicitSend' || value.version !== 1 || value.purpose !== 'world-patch-design'
    || value.confirmed !== true || value.maximumCalls !== 1 || pins.some(key => !digest.test(value[key]))) {
    throw Error('Independent exact one-call frozen patch SEND required');
  }
  return Object.freeze({...value});
}
export function bindFrozenWorldPatchSend(receipt, value) {
  const send = validateFrozenWorldPatchExplicitSend(value);
  if (receipt?.format !== 'FrozenWorldPatchTaskReceipt' || receipt.version !== 1 || receipt.state !== 'frozen-not-sent'
    || receipt.modelSent !== false || receipt.canAuthorizePlacement !== false || pins.some(key => send[key] !== receipt[key])) {
    throw Error('Original frozen task and exact SEND pins differ');
  }
  return send;
}
