import {exactKeys} from '../contracts/world-selection.mjs';
import {contextHash} from '../src/world/context-snapshot.mjs';
import {contextDisclosure} from './world-context-consent.mjs';
import {CONTEXT_ANALYSIS_PROTOCOL, CONTEXT_ANALYSIS_PROTOCOL_HASH} from '../contracts/context-analysis-protocol.mjs';

/** Precise read-only task preparation. No adapter/send/repair/placement API.
 * Edit proposals use a separate future protocol, not a silent analysis fallback. */
export function validateContextTaskIntent(value) {
  exactKeys(value, ['format', 'version', 'purpose', 'agent', 'model', 'effort', 'prompt', 'maximumCalls'], 'context task intent');
  if (value.format !== 'WorldContextTaskIntent' || ![1, 2].includes(value.version) || value.purpose !== 'context-analysis' || value.maximumCalls !== 1) throw new Error('Unsupported read-only context task/version/budget');
  if (!['codex', 'claude', 'deepseek'].includes(value.agent) || typeof value.model !== 'string' || !/^[a-zA-Z0-9._:/-]{1,128}$/.test(value.model)
      || !['default', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value.effort)) throw new Error('Invalid exact context model/effort');
  if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 6000 || value.prompt.includes('\u0000')) throw new Error('Invalid context task prompt');
  // Preserve exact text/whitespace. Confirmation binds bytes/meaning, not a
  // trimmed rewritten prompt. Prompt is untrusted task data, never an opcode.
  return {...value};
}

export function prepareContextTaskDisclosure(saved, input) {
  const intent = validateContextTaskIntent(input), {record} = saved;
  const request = {format: 'WorldContextTask', version: intent.version, contextId: record.id,
    snapshotHash: record.snapshotHash, summaryHash: record.summaryHash, selectionHash: record.selectionHash,
    identity: {...record.identity}, intent,
    ...(intent.version === 2 ? {protocol: structuredClone(CONTEXT_ANALYSIS_PROTOCOL), protocolHash: CONTEXT_ANALYSIS_PROTOCOL_HASH} : {})};
  const requestHash = contextHash(request);
  const disclosure = contextDisclosure(saved, {agent: intent.agent, model: intent.model, requestHash});
  const content = {format: 'WorldContextTaskDisclosure', version: intent.version, request, requestHash,
    disclosure, modelSent: false, canAuthorizePlacement: false, sendingImplemented: false};
  return {...content, taskDisclosureHash: contextHash(content)};
}
