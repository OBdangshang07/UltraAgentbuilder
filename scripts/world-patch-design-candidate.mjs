import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {WORLD_PATCH_LIMITS} from '../contracts/world-patch.mjs';
import {contextHash} from '../src/world/context-snapshot.mjs';
import {prepareWorldPatchDesignInput, compileWorldPatchDesignResponse} from './world-patch-design-input.mjs';
import {validateWorldPatchDesignTask, validateWorldPatchDesignReview, WORLD_PATCH_DESIGN_TASK_LIMITS} from './world-patch-design-task.mjs';

// Local experimental proposal storage only: not a job, manifest, schematic,
// fresh-server certificate, placement entry point or evidence of AI origin.
const members = ['task.json', 'review.json', 'proposal.json', 'patch.json', 'candidate.json'];
const digest = value => createHash('sha256').update(value).digest('hex');
const memberQuota = name => name === 'task.json' ? WORLD_PATCH_DESIGN_TASK_LIMITS.bytes
  : ['review.json', 'candidate.json'].includes(name) ? 65536 : WORLD_PATCH_LIMITS.bytes;
const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };

/** The stored task and review are rebuilt from the supplied ORIGINAL snapshot.
 * Raw proposal is retained; compiled BEFORE, protection and neighbor guards
 * cannot be adopted from saved compiled fields or from a changed snapshot. */
export function prepareWorldPatchDesignCandidate(snapshot, taskValue, reviewValue, proposalValue, options) {
  const input = prepareWorldPatchDesignInput(snapshot, options);
  const task = validateWorldPatchDesignTask(snapshot, input, taskValue, options);
  const review = validateWorldPatchDesignReview(snapshot, input, task, reviewValue, options);
  if (Buffer.byteLength(JSON.stringify(proposalValue)) > WORLD_PATCH_LIMITS.bytes) throw Error('Patch candidate proposal byte quota exceeded');
  const proposal = structuredClone(proposalValue), patch = compileWorldPatchDesignResponse(snapshot, input, proposal, options);
  const taskBytes = Buffer.from(JSON.stringify(task)), reviewBytes = Buffer.from(JSON.stringify(review));
  const proposalBytes = Buffer.from(JSON.stringify(proposal)), patchBytes = Buffer.from(JSON.stringify(patch));
  const content = {format: 'WorldPatchDesignCandidate', version: 1, kind: 'experimental-unverified-proposal-data',
    snapshotHash: input.snapshotHash, selectionHash: input.selectionHash, designInputHash: input.designInputHash,
    requestHash: task.requestHash, taskHash: task.taskHash, disclosureHash: task.disclosure.disclosureHash,
    reviewHash: review.reviewHash, patchHash: patch.patchHash,
    files: Object.fromEntries([['task.json', taskBytes], ['review.json', reviewBytes], ['proposal.json', proposalBytes], ['patch.json', patchBytes]]
      .map(([name, bytes]) => [name, {bytes: bytes.length, sha256: digest(bytes)}])),
    originalSnapshotRequired: true, externalTaskAndCandidateHashRequired: true,
    coordinateSpace: 'original-world-absolute', movable: false, modelOriginVerified: false,
    modelInvocationRecorded: false, modelSent: false, serverBaselineVerified: false, physicsVerified: false,
    canAuthorizePlacement: false, worldRendered: false, crashDurabilityVerified: false};
  const candidate = {...content, candidateHash: contextHash(content)};
  return freeze({task, review, proposal, patch, candidate});
}

async function physicalDirectory(directory) {
  const full = path.resolve(directory), stat = await fs.lstat(full);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(full) !== full) throw Error('Patch candidate directory must not redirect');
  return full;
}
async function readMember(directory, name) {
  const file = path.join(directory, name), before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size > memberQuota(name) || await fs.realpath(file) !== file) throw Error('Patch candidate member path/type/byte quota rejected');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw Error('Patch candidate member changed before open');
    const bytes = await handle.readFile();
    if (bytes.length > memberQuota(name) || bytes.length !== before.size) throw Error('Patch candidate member grew or changed during read');
    return {bytes, data: JSON.parse(bytes.toString('utf8'))};
  } finally { await handle.close(); }
}
async function writeNewMember(directory, name, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > memberQuota(name)) throw Error('Patch candidate member byte quota exceeded');
  const handle = await fs.open(path.join(directory, name), 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}

/** Only creates a new child of an existing physical parent. No overwrite,
 * cleanup or model resend after an ambiguous write. Metadata is written last.
 * fsync of each file is not represented as crash-atomic directory publication. */
export async function saveNewWorldPatchDesignCandidate(directory, snapshot, task, review, proposal, {signal} = {}) {
  signal?.throwIfAborted();
  const prepared = prepareWorldPatchDesignCandidate(snapshot, task, review, proposal, {signal});
  const full = path.resolve(directory); await physicalDirectory(path.dirname(full));
  signal?.throwIfAborted(); await fs.mkdir(full); await physicalDirectory(full);
  for (const [name, value] of [['task.json', prepared.task], ['review.json', prepared.review],
    ['proposal.json', prepared.proposal], ['patch.json', prepared.patch], ['candidate.json', prepared.candidate]]) {
    signal?.throwIfAborted(); await writeNewMember(full, name, value);
  }
  const restored = await readWorldPatchDesignCandidate(full, snapshot, prepared.task, prepared.candidate.candidateHash, {signal});
  return {...restored, directory: full, additionalModelCalls: 0, worldWrites: 0};
}

/** Require independently retained request AND candidate hash. Merely changing
 * all local metadata hashes cannot adopt a different otherwise legal proposal.
 * Persisted review remains data; it is not a consume-once model/send token. */
export async function readWorldPatchDesignCandidate(directory, snapshot, expectedTaskValue, expectedCandidateHash, {signal} = {}) {
  signal?.throwIfAborted();
  if (typeof expectedCandidateHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedCandidateHash)) throw Error('External original candidate hash required');
  const input = prepareWorldPatchDesignInput(snapshot, {signal}), expectedTask = validateWorldPatchDesignTask(snapshot, input, expectedTaskValue, {signal});
  const full = await physicalDirectory(directory), names = (await fs.readdir(full)).sort();
  if (contextHash(names) !== contextHash([...members].sort())) throw Error('Patch candidate incomplete or contains unexpected members');
  const entries = Object.fromEntries(await Promise.all(members.map(async name => [name, await readMember(full, name)])));
  signal?.throwIfAborted();
  if (contextHash(entries['task.json'].data) !== contextHash(expectedTask)) throw Error('Patch candidate request changed from independent original task');
  const rebuilt = prepareWorldPatchDesignCandidate(snapshot, expectedTask, entries['review.json'].data, entries['proposal.json'].data, {signal});
  if (rebuilt.candidate.candidateHash !== expectedCandidateHash || contextHash(entries['candidate.json'].data) !== contextHash(rebuilt.candidate)
    || contextHash(entries['patch.json'].data) !== contextHash(rebuilt.patch)) throw Error('Patch candidate identity/proposal/compiled integrity mismatch');
  for (const name of members.filter(n => n !== 'candidate.json')) {
    const expected = rebuilt.candidate.files[name], bytes = entries[name].bytes;
    if (bytes.length !== expected.bytes || digest(bytes) !== expected.sha256) throw Error('Patch candidate exact file bytes mismatch');
  }
  signal?.throwIfAborted();
  return {...rebuilt, canAuthorizePlacement: false, modelOriginVerified: false, serverBaselineVerified: false};
}
