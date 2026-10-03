import {exactKeys} from './world-selection.mjs';
import {CONTEXT_ANALYSIS_PROTOCOL} from './context-analysis-protocol.mjs';

const hashes = ['requestHash', 'snapshotHash', 'summaryHash'];
const sections = ['observations', 'inferences', 'unknowns', 'recommendations'];
export const CONTEXT_ANALYSIS_LIMITS = Object.freeze({bytes: 128 * 1024, items: 32, text: 2000});
// This is prose data, not a patch/command/placement contract. Claims remain
// unverified even after structural validation succeeds.
export const contextAnalysisSchema = CONTEXT_ANALYSIS_PROTOCOL.schema;

export function validateContextAnalysis(value, request) {
  if (Buffer.byteLength(JSON.stringify(value) ?? '') > CONTEXT_ANALYSIS_LIMITS.bytes) throw new Error('Context analysis byte quota exceeded');
  exactKeys(value, ['format', 'version', ...hashes, ...sections], 'context analysis');
  if (value.format !== 'WorldContextAnalysis' || value.version !== 1) throw new Error('Unsupported context analysis version');
  for (const key of hashes) {
    const expected = key === 'requestHash' ? request.requestHash : request.request[key];
    if (typeof value[key] !== 'string' || !/^[a-f0-9]{64}$/.test(value[key]) || value[key] !== expected) throw new Error('Context analysis baseline/request changed');
  }
  for (const key of sections) {
    if (!Array.isArray(value[key]) || value[key].length > CONTEXT_ANALYSIS_LIMITS.items
        || value[key].some(text => typeof text !== 'string' || !text.trim() || text.length > CONTEXT_ANALYSIS_LIMITS.text || text.includes('\u0000'))) throw new Error('Invalid bounded analysis prose');
  }
  return structuredClone(value);
}
