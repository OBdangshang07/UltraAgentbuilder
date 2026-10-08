import path from 'node:path';
import {parentPort, workerData} from 'node:worker_threads';
import {contextHash} from '../src/world/context-snapshot.mjs';
import {readReferencePatchInvocation} from './reference-world-patch-invocation-data.mjs';
import {prepareWorldPatchDesignInput, compileWorldPatchDesignResponse} from '../src/world/world-patch-design-input.mjs';
import {prepareResponseCandidate, saveResponseCandidate} from './world-patch-response-candidate.mjs';

// Original archived facts + proposal only. No provider or current-world reads.
try {
  const {directory, runtimeHash, spec, responseHash} = workerData;
  if (contextHash(spec) !== responseHash) throw Error('Original joint response hash differs');
  const original = await readReferencePatchInvocation(directory, runtimeHash);
  const source = {receipt: original.source.receipt, snapshot: original.source.saved.snapshot};
  const input = prepareWorldPatchDesignInput(source.snapshot);
  let patch;
  try {patch = compileWorldPatchDesignResponse(source.snapshot, input, spec);}
  catch {parentPort.postMessage({ok: true, rejected: true, responseHash, capsuleId: original.value.id,
    manifestHash: source.receipt.manifestHash, sourceArchiveReverified: true, canAuthorizePlacement: false});}
  if (patch) {
    const prepared = prepareResponseCandidate({source, send: original.value.send, runtimeHash, spec});
    if (prepared.patch.patchHash !== patch.patchHash) throw Error('Joint candidate reconstruction differs');
    const candidate = await saveResponseCandidate({directory: path.join(directory, 'candidate'), prepared});
    parentPort.postMessage({ok: true, result: {format: 'FrozenReferenceWorldPatchResponseCheck', version: 1,
      capsuleId: original.value.id, manifestHash: source.receipt.manifestHash, responseHash,
      snapshotHash: patch.snapshotHash, selectionHash: patch.selectionHash, patchHash: patch.patchHash,
      candidateHash: candidate.candidateHash, previewHash: candidate.previewHash,
      candidateSaved: true, sourceArchiveReverified: true, serverBaselineVerified: false,
      canAuthorizePlacement: false, additionalModelCalls: 0, worldWrites: 0}});
  }
} catch {parentPort.postMessage({ok: false, error: 'Original joint source or response failed local checks'});}
