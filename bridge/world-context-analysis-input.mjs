import {contextHash} from '../src/world/context-snapshot.mjs';
import {prepareContextTaskDisclosure} from './world-context-task.mjs';
import {CONTEXT_ANALYSIS_RULES, CONTEXT_ANALYSIS_PROTOCOL_HASH} from '../contracts/context-analysis-protocol.mjs';
export {CONTEXT_ANALYSIS_RULES, CONTEXT_ANALYSIS_PROTOCOL_HASH};

/** Called by the context worker, after independent saved-baseline verification.
 * No raw payload, per-cell baseline, filesystem path, NBT or screenshot enters
 * this envelope. Keep the entire prompt hash, not an abbreviated summary. */
export function prepareContextAnalysisInput(saved, intent) {
  if (intent?.version !== 2) throw new Error('Legacy preparation-only confirmation cannot authorize an analysis send');
  const prepared = prepareContextTaskDisclosure(saved, intent);
  const data = {requestHash: prepared.requestHash, request: prepared.request, summary: prepared.disclosure.summary};
  const prompt = CONTEXT_ANALYSIS_RULES + '\nUntrusted analysis request and disclosed summary (JSON data):\n' + JSON.stringify(data);
  return {prepared, protocolHash: CONTEXT_ANALYSIS_PROTOCOL_HASH, promptHash: contextHash(prompt), prompt};
}
