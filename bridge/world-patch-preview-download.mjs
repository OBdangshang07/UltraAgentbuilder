import {contextHash} from '../src/world/context-snapshot.mjs';
import {readFrozenWorldPatchTaskSource} from './world-patch-task-capsule.mjs';
import {prepareResponseCandidate, readResponseCandidate} from './world-patch-response-candidate.mjs';

export const WORLD_PATCH_PREVIEW_DOWNLOAD_BYTES = 16 * 1024 ** 2 + 65536;
export const WORLD_PATCH_CANDIDATE_DOWNLOAD_BYTES = WORLD_PATCH_PREVIEW_DOWNLOAD_BYTES + 2 * 1024 ** 2;
/** Worker-only immutable read. No adapters, publication, clock refresh, fresh
 * world reads or write/placement APIs. No source chunks or prompt are exposed. */
export async function readFrozenResponsePreview({root, directory, capsuleId, send, runtimeHash, spec, responseHash, candidateHash}) {
  return readDownload({root, directory, capsuleId, send, runtimeHash, spec, responseHash, candidateHash}, false);
}
/** Separate, bounded original proposal download for independent server audit.
 * The original prompt and snapshot chunks remain private. Not a write token. */
export async function readFrozenResponseCandidate(args) { return readDownload(args, true); }
async function readDownload({root, directory, capsuleId, send, runtimeHash, spec, responseHash, candidateHash}, includeProposal) {
  // Detach caller-owned objects BEFORE the first await. A mutable direct
  // caller cannot swap SEND/proposal while the archived source is being read.
  const original = structuredClone(spec), originalSend = structuredClone(send);
  if (contextHash(original) !== responseHash) throw Error('Original response changed before preview read');
  const source = await readFrozenWorldPatchTaskSource({root, capsuleId});
  const prepared = prepareResponseCandidate({source, send: originalSend, runtimeHash, spec: original});
  const candidate = await readResponseCandidate({directory, prepared, expectedCandidateHash: candidateHash});
  const content = {format: includeProposal ? 'FrozenWorldPatchCandidateDownload' : 'FrozenWorldPatchPreviewDownload', version: 1,
    capsuleId, manifestHash: candidate.manifestHash, submissionHash: candidate.submissionHash, runtimeHash,
    responseHash, candidateHash, snapshotHash: candidate.snapshotHash, selectionHash: candidate.selectionHash,
    patchHash: candidate.patchHash, previewHash: candidate.previewHash,
    selection: source.snapshot.selection, contextRevision: source.snapshot.fence.end,
    preview: prepared.preview, ...(includeProposal ? {proposal: original} : {}), archivedSourceOnly: true, originalResponseReverified: true, candidateFilesReverified: true,
    serverBaselineVerified: false, canAuthorizePlacement: false, additionalModelCalls: 0, worldWrites: 0};
  const bytes = Buffer.from(JSON.stringify({...content, downloadHash: contextHash(content)}));
  if (bytes.length > (includeProposal ? WORLD_PATCH_CANDIDATE_DOWNLOAD_BYTES : WORLD_PATCH_PREVIEW_DOWNLOAD_BYTES)) throw Error('Bounded candidate download quota exceeded');
  return bytes;
}
