import {parentPort, workerData} from 'node:worker_threads';
import {contextHash} from '../src/world/context-snapshot.mjs';
import {prepareWorldPatchDesignInput, compileWorldPatchDesignResponse} from '../src/world/world-patch-design-input.mjs';
import {readFrozenWorldPatchTaskSource} from './world-patch-task-capsule.mjs';
import {bindFrozenWorldPatchSend} from '../contracts/world-patch-send.mjs';
import {prepareResponseCandidate, saveResponseCandidate} from './world-patch-response-candidate.mjs';
import path from 'node:path';

// Private compile lane. No provider, fresh world read, placement or HTTP. The
// archived BEFORE/neighbor facts are reverified, never asserted to be current.
try {
  const {root, capsuleId, send, spec, responseHash, directory, runtimeHash} = workerData;
  if (contextHash(spec) !== responseHash) throw Error('Original patch response hash differs');
  const source = await readFrozenWorldPatchTaskSource({root, capsuleId});
  bindFrozenWorldPatchSend(source.receipt, send);
  const input = prepareWorldPatchDesignInput(source.snapshot);
  let patch;
  try { patch = compileWorldPatchDesignResponse(source.snapshot, input, spec); }
  catch {
    parentPort.postMessage({ok: true, rejected: true, responseHash, capsuleId,
      manifestHash: source.receipt.manifestHash, sourceArchiveReverified: true, canAuthorizePlacement: false});
  }
  if (patch) {
  const prepared = prepareResponseCandidate({source, send, runtimeHash, spec});
  if (prepared.patch.patchHash !== patch.patchHash) throw Error('Candidate reconstruction differs from original compilation');
  const candidate = await saveResponseCandidate({directory: path.join(directory, 'candidate'), prepared});
  parentPort.postMessage({ok: true, result: {format: 'FrozenWorldPatchResponseCheck', version: 2,
    capsuleId, manifestHash: source.receipt.manifestHash, responseHash, patchHash: patch.patchHash,
    snapshotHash: patch.snapshotHash, selectionHash: patch.selectionHash, candidateHash: candidate.candidateHash,
    previewHash: candidate.previewHash, candidateSaved: true,
    result: 'compiled-against-archived-capture', sourceArchiveReverified: true,
    serverBaselineVerified: false, canAuthorizePlacement: false, additionalModelCalls: 0, worldWrites: 0}});
  }
} catch {
  // Untrusted output is retained in its original journal, not echoed as an
  // arbitrary UI error or rewritten to a conforming synthetic proposal.
  parentPort.postMessage({ok: false, error: 'Original response or frozen source failed patch checks'});
}
