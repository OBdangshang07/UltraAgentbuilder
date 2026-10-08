import path from 'node:path';
import fs from 'node:fs/promises';
import {parentPort, workerData} from 'node:worker_threads';
import {hash} from '../src/generation/compiler.mjs';
import {contextHash} from '../src/world/context-snapshot.mjs';
import {REFERENCE_PATCH_CALL_POLICY, REFERENCE_PATCH_RESPONSE_BYTES,
  readJointInvocationEnvelope, readReferencePatchInvocation} from './reference-world-patch-invocation-data.mjs';
import {prepareResponseCandidate, readResponseCandidate} from './world-patch-response-candidate.mjs';
import {WORLD_PATCH_CANDIDATE_DOWNLOAD_BYTES, WORLD_PATCH_PREVIEW_DOWNLOAD_BYTES} from './world-patch-preview-download.mjs';

// Read-only original joint invocation, never a legacy text SEND or caller path
// to an arbitrary response. No model, compilation substitute or world API.
try {
  const {directory, runtimeHash, candidateHash, responseHash, downloadKind} = workerData;
  if (!['preview','candidate'].includes(downloadKind)) throw Error('Exact joint download kind required');
  const original = await readReferencePatchInvocation(directory, runtimeHash), value = original.value;
  const ledger = path.join(directory, 'assembly-journal');
  if ((await fs.readdir(ledger)).some(name => /^call-\d+\.json$/.test(name) && name !== 'call-1.json'))
    throw Error('Original one-call joint budget differs');
  const identity = await readJointInvocationEnvelope(path.join(ledger, 'identity.json'));
  if (hash(identity) !== hash({version:1, requestHash:value.submissionHash,
    policyHash:hash(REFERENCE_PATCH_CALL_POLICY), runtimeHash, maximumCalls:1})
    || (await readJointInvocationEnvelope(path.join(ledger, 'dispatched.json'))).count !== 1)
    throw Error('Joint original ledger differs');
  const call = await readJointInvocationEnvelope(path.join(ledger, 'call-1.json'), REFERENCE_PATCH_RESPONSE_BYTES + 65536);
  if (call.index !== 1 || call.state !== 'response' || call.fingerprint !== value.invocationFingerprint
    || contextHash(call.response.spec) !== responseHash) throw Error('Exact original completed joint response required');
  const source = {receipt:original.source.receipt, snapshot:original.source.saved.snapshot};
  const prepared = prepareResponseCandidate({source, send:value.send, runtimeHash, spec:call.response.spec});
  const candidate = await readResponseCandidate({directory:path.join(directory,'candidate'), prepared, expectedCandidateHash:candidateHash});
  const content = {format:downloadKind === 'candidate' ? 'FrozenReferenceWorldPatchCandidateDownload' : 'FrozenReferenceWorldPatchPreviewDownload',
    version:1, purpose:'reference-world-patch-design', capsuleId:value.id, manifestHash:candidate.manifestHash,
    submissionHash:value.submissionHash, runtimeHash, responseHash, candidateHash,
    referenceSetHash:source.receipt.referenceSetHash, imageCapabilityHash:source.receipt.imageCapabilityHash,
    snapshotHash:candidate.snapshotHash, selectionHash:candidate.selectionHash, patchHash:candidate.patchHash, previewHash:candidate.previewHash,
    selection:source.snapshot.selection, contextRevision:source.snapshot.fence.end, preview:prepared.preview,
    ...(downloadKind === 'candidate' ? {proposal:call.response.spec} : {}), archivedSourceOnly:true,
    originalResponseReverified:true, candidateFilesReverified:true, serverBaselineVerified:false,
    canAuthorizePlacement:false, additionalModelCalls:0, worldWrites:0};
  const bytes = Buffer.from(JSON.stringify({...content, downloadHash:contextHash(content)}));
  if (bytes.length > (downloadKind === 'candidate' ? WORLD_PATCH_CANDIDATE_DOWNLOAD_BYTES : WORLD_PATCH_PREVIEW_DOWNLOAD_BYTES))
    throw Error('Original joint download quota');
  parentPort.postMessage({ok:true, bytes});
} catch {parentPort.postMessage({ok:false, error:'Original joint response, source or candidate failed read-only verification'});}
