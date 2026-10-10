import {readFileSync} from 'node:fs';
import {exactKeys} from './world-selection.mjs';

// Fixed bundled resource policy, never provider tokens, caller overrides or
// permission to apply an individual part. Java consumes the exact same JSON.
const fields=['version','operationsPerPart','patchBytes','proposalBytes','previewBytes','candidateBytes',
  'downloadBytes','partBytes','partEnvelopeBytes','metadataBytes','recordsBytes'];
export function validateWorldAssemblyLimits(value) {
  exactKeys(value,fields,'world assembly quota contract');
  const mib=1024**2;
  if(value.version!==1 || value.operationsPerPart!==8192
    || fields.some(k=>!Number.isSafeInteger(value[k])||value[k]<1)
    || value.patchBytes>256*mib || value.candidateBytes>320*mib || value.downloadBytes>384*mib
    || value.proposalBytes>64*mib || value.previewBytes>64*mib || value.partBytes>16*mib
    || value.partEnvelopeBytes>40*mib || value.metadataBytes>2*mib || value.recordsBytes>2*mib
    || value.patchBytes<value.partBytes || value.candidateBytes<value.patchBytes || value.downloadBytes<value.candidateBytes
    || value.partEnvelopeBytes<value.partBytes || value.proposalBytes<value.partBytes || value.previewBytes<value.partBytes)
    throw Error('Invalid bounded world assembly quota contract');
  const {version,...limits}=value;return Object.freeze(limits);
}
export const WORLD_ASSEMBLY_LIMITS=validateWorldAssemblyLimits(JSON.parse(
  readFileSync(new URL('./world-assembly-limits.json',import.meta.url),'utf8')));
