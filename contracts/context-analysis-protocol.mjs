import {readFileSync} from 'node:fs';
import {contextHash} from '../src/world/context-snapshot.mjs';

function freeze(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
// The same source contract is packaged as a Java resource. Do not accept rules
// advertised by a remote response just because it rehashes itself consistently.
export const CONTEXT_ANALYSIS_PROTOCOL = freeze(JSON.parse(readFileSync(new URL('./context-analysis-protocol.json', import.meta.url), 'utf8')));
export const CONTEXT_ANALYSIS_RULES = CONTEXT_ANALYSIS_PROTOCOL.rules;
export const CONTEXT_ANALYSIS_PROTOCOL_HASH = contextHash(CONTEXT_ANALYSIS_PROTOCOL);
