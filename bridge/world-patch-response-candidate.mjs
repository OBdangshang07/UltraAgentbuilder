import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {contextHash} from '../src/world/context-snapshot.mjs';
import {prepareWorldPatchDesignInput, compileWorldPatchDesignResponse} from '../src/world/world-patch-design-input.mjs';
import {prepareWorldPatchPreview} from '../src/world/world-patch-preview-data.mjs';
import {bindFrozenWorldPatchSend} from '../contracts/world-patch-send.mjs';
import {bindFrozenReferenceWorldPatchSend} from '../contracts/reference-world-patch-send.mjs';

// Private, worker-owned proposal artifact. Never a building bundle, schematic,
// fresh-server BEFORE certificate, placement token or world transaction.
const members = ['proposal.json', 'patch.json', 'preview.json', 'candidate.json'];
const limits = {'proposal.json': 2 * 1024 ** 2, 'patch.json': 16 * 1024 ** 2, 'preview.json': 16 * 1024 ** 2, 'candidate.json': 65536};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bytesOf = value => Buffer.from(JSON.stringify(value));
const fail = message => {throw Object.assign(Error(message), {statusCode: 409});};
async function physical(directory) {
  const full = path.resolve(directory), stat = await fs.lstat(full);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(full) !== full) fail('Response candidate directory redirected; preserved');
  return full;
}
async function read(file, maximum) {
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximum || await fs.realpath(file) !== file) fail('Response candidate member type/link/size rejected');
  const handle = await fs.open(file, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) fail('Response candidate changed before open');
    const bytes = await handle.readFile(), after = await handle.stat(), current = await fs.lstat(file);
    if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== opened.mtimeMs
      || !current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || current.dev !== opened.dev || current.ino !== opened.ino) fail('Response candidate changed while reading');
    return bytes;
  } finally {await handle.close();}
}
async function write(file, bytes) {
  const handle = await fs.open(file, 'wx', 0o600);
  try {await handle.writeFile(bytes); await handle.sync();} finally {await handle.close();}
}

/** MUST be supplied the independently verified frozen source and original
 * saved response. Rebuild every compiled/preview byte; local hashes alone
 * cannot adopt an alternate proposal, baseline, SEND or runtime. */
export function prepareResponseCandidate({source, send, runtimeHash, spec}) {
  if (source.receipt?.format === 'FrozenReferenceWorldPatchTaskReceipt') bindFrozenReferenceWorldPatchSend(source.receipt, send);
  else bindFrozenWorldPatchSend(source.receipt, send);
  if (!/^[a-f0-9]{64}$/.test(runtimeHash ?? '')) fail('Original response runtime hash required');
  const proposal = structuredClone(spec), input = prepareWorldPatchDesignInput(source.snapshot);
  const patch = compileWorldPatchDesignResponse(source.snapshot, input, proposal);
  const preview = prepareWorldPatchPreview(source.snapshot, patch);
  const buffers = {'proposal.json': bytesOf(proposal), 'patch.json': bytesOf(patch), 'preview.json': bytesOf(preview)};
  const content = {format: 'FrozenWorldPatchResponseCandidate', version: 1, kind: 'archived-original-response-data',
    capsuleId: source.receipt.capsuleId, manifestHash: source.receipt.manifestHash, submissionHash: contextHash(send),
    runtimeHash, responseHash: contextHash(proposal), snapshotHash: patch.snapshotHash, selectionHash: patch.selectionHash,
    patchHash: patch.patchHash, previewHash: preview.previewHash,
    files: Object.keys(buffers).map(name => ({path: name, bytes: buffers[name].length, sha256: sha(buffers[name])})),
    coordinateSpace: 'original-world-absolute', movable: false, originalResponseRequired: true, sourceArchiveReverified: true,
    serverBaselineVerified: false, canAuthorizePlacement: false, modelOriginVerified: false, worldRendered: false,
    crashAtomicPublication: false, additionalModelCalls: 0, worldWrites: 0};
  const candidate = {...content, candidateHash: contextHash(content)};
  buffers['candidate.json'] = bytesOf(candidate);
  for (const name of members) if (!buffers[name].length || buffers[name].length > limits[name]) fail('Response candidate member byte quota exceeded');
  return {candidate, patch, preview, buffers};
}

export async function readResponseCandidate({directory, prepared, expectedCandidateHash}) {
  if (!/^[a-f0-9]{64}$/.test(expectedCandidateHash ?? '') || expectedCandidateHash !== prepared.candidate.candidateHash) fail('Original candidate hash required; no rebase');
  const full = await physical(directory), names = (await fs.readdir(full)).sort();
  if (contextHash(names) !== contextHash([...members].sort())) fail('Response candidate incomplete or has unknown files; preserved');
  for (const name of members) {
    const bytes = await read(path.join(full, name), limits[name]);
    if (!bytes.equals(prepared.buffers[name])) fail('Response candidate differs from rebuilt original response');
  }
  return prepared.candidate;
}

/** Synchronous-file durability is not claimed to be crash-atomic publication.
 * A complete artifact may be re-read only against independently rebuilt bytes.
 * Partial directories and crashed publication claims are never cleared/adopted. */
export async function saveResponseCandidate({directory, prepared}) {
  const full = path.resolve(directory), parent = await physical(path.dirname(full)), claimFile = path.join(parent, '_candidate-publication.json');
  const claim = bytesOf({format: 'FrozenPatchCandidatePublication', version: 1, id: randomUUID(), candidateHash: prepared.candidate.candidateHash});
  await write(claimFile, claim);
  try {
    try {
      await fs.lstat(full);
      return await readResponseCandidate({directory: full, prepared, expectedCandidateHash: prepared.candidate.candidateHash});
    } catch (error) {if (error.code !== 'ENOENT') throw error;}
    await fs.mkdir(full, {mode: 0o700}); await physical(full);
    // Metadata written LAST, never supplied by the model.
    for (const name of members) await write(path.join(full, name), prepared.buffers[name]);
    return await readResponseCandidate({directory: full, prepared, expectedCandidateHash: prepared.candidate.candidateHash});
  } finally {
    if (!(await read(claimFile, 2048)).equals(claim)) fail('Response publication claim changed; preserved');
    await fs.unlink(claimFile);
  }
}
