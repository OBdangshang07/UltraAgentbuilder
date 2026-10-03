import {contextHash} from '../src/world/context-snapshot.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {worldPatchProposalSchema} from '../contracts/world-patch.mjs';
import {bindFrozenWorldPatchSend} from '../contracts/world-patch-send.mjs';
import {readFrozenWorldPatchTaskSource} from './world-patch-task-capsule.mjs';

// INTERNAL worker result. No snapshot is sent to the HTTP loop, no adapter or
// budget exists here. Exact original model prompt, never a rebuilt substitute.
export async function prepareFrozenWorldPatchSendInput({root, capsuleId, send, originalReceiptOnly = false}) {
  if (typeof originalReceiptOnly !== 'boolean') throw Error('Private original-receipt mode required');
  const {receipt, prepared} = await readFrozenWorldPatchTaskSource({root, capsuleId});
  const binding = bindFrozenWorldPatchSend(receipt, send);
  if (!Number.isSafeInteger(receipt.recordExpiresAt) || !originalReceiptOnly && receipt.recordExpiresAt <= Date.now()) {
    throw Error('Frozen patch capture expired before a new SEND; reread the environment');
  }
  const content = {format: 'FrozenWorldPatchSendInput', version: 1, receipt, send: binding,
    submissionHash: contextHash(binding), intent: prepared.task.request.intent,
    prompt: prepared.task.disclosure.modelPrompt, protocolHash: prepared.task.request.protocolHash,
    promptSha256: prepared.task.request.promptSha256, sourceAuthority: receipt.sourceAuthority,
    invocationFingerprint: hash({prompt: prepared.task.disclosure.modelPrompt, index: 1,
      schema: worldPatchProposalSchema, phase: 'world-patch-design', maximum: 1, images: []}),
    maximumCalls: 1, modelSent: false, serverBaselineVerified: false, canAuthorizePlacement: false};
  return {...content, inputHash: contextHash(content)};
}
