import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {exactKeys} from '../contracts/world-selection.mjs';
import {validateFrozenReferenceWorldPatchExplicitSend, bindFrozenReferenceWorldPatchSend} from '../contracts/reference-world-patch-send.mjs';
import {contextHash} from '../src/world/context-snapshot.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {assemblyRuntimeIdentity} from './assembly-durability.mjs';
import {createWorldPatchOwnerReference, validateWorldPatchOwnerReference} from './world-patch-owner-observation.mjs';

// Internal consume-once SEND registry. This owns a prospective joint job, not
// a provider invocation: no adapter, journal.invoke, HTTP or world writer is
// reachable here. A future runner must reserve its call BEFORE dispatch and
// bind the actual selected capability, original turn and pixel receipt.
export const REFERENCE_PATCH_JOB_LIMITS = Object.freeze({records: 8, envelopeBytes: 65536, bindingBytes: 4096});
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = (message, statusCode = 409) => Object.assign(Error(message + '; original evidence preserved'), {statusCode});
const raw = value => Buffer.from(JSON.stringify(value));
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
async function directory(target, create = false) {
  if (create) try {await fs.mkdir(target, {mode: 0o700});} catch (error) {if (error.code !== 'EEXIST') throw error;}
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(target) !== target) throw fail('Joint job directory redirected');
}
async function checkedBytes(file, maximum) {
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 1 || before.size > maximum
    || await fs.realpath(file) !== file) throw fail('Joint job evidence type/link/size rejected');
  const handle = await fs.open(file, 'r');
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1 || opened.size !== before.size
      || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) throw fail('Joint job evidence changed before opening');
    const buffer = Buffer.alloc(before.size + 1); let total = 0;
    while (total < buffer.length) {
      const {bytesRead} = await handle.read(buffer, total, buffer.length - total, total);
      if (!bytesRead) break; total += bytesRead;
    }
    const after = await handle.stat(), current = await fs.lstat(file);
    if (total !== before.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
      || current.dev !== opened.dev || current.ino !== opened.ino || current.nlink !== 1 || current.isSymbolicLink()
      || current.size !== opened.size || current.mtimeMs !== opened.mtimeMs || current.ctimeMs !== opened.ctimeMs
      || await fs.realpath(file) !== file) throw fail('Joint job evidence changed while reading');
    return buffer.subarray(0, total);
  } finally {await handle.close();}
}
async function checked(file, maximum = REFERENCE_PATCH_JOB_LIMITS.envelopeBytes) {
  const envelope = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(await checkedBytes(file, maximum)));
  exactKeys(envelope, ['value','sha256'], 'joint job envelope');
  if (!digest(envelope.sha256) || hash(envelope.value) !== envelope.sha256) throw fail('Joint job integrity rejected');
  return envelope.value;
}
async function immutable(file, value) {
  const handle = await fs.open(file, 'wx', 0o600);
  try {await handle.writeFile(raw({value, sha256: hash(value)})); await handle.sync();} finally {await handle.close();}
}
function advertisement(value, send, recipient) {
  exactKeys(value, ['agent','model','effort','runtimeHash','capability'], 'joint selected advertisement');
  exactKeys(value.capability, ['id','supportsImages','efforts'], 'joint selected image advertisement');
  if (!digest(value.runtimeHash) || value.runtimeHash !== send.runtimeHash || value.capability.id !== value.model
    || value.capability.supportsImages !== true || !Array.isArray(value.capability.efforts)
    || !value.capability.efforts.length || value.capability.efforts.some(e => typeof e !== 'string')
    || new Set(value.capability.efforts).size !== value.capability.efforts.length
    || recipient && ['agent','model','effort'].some(key => value[key] !== recipient[key])) throw fail('Joint selected recipient/runtime/image advertisement changed');
  return structuredClone(value);
}

/** Internal dataDir and context lane only. Request data cannot supply paths,
 * prompt, accounts, a runtime identity, clock or model/world authority. */
export async function createReferenceWorldPatchJobRegistry(options) {
  exactKeys(options, ['dataDir','contexts'], 'internal joint job registry');
  const {contexts} = options;
  if (typeof contexts?.operation !== 'function') throw fail('Original bounded context lane required', 400);
  let parent = path.resolve(options.dataDir), ancestor = path.parse(parent).root;
  await directory(ancestor);
  for (const part of path.relative(ancestor, parent).split(path.sep).filter(Boolean)) {
    ancestor = path.join(ancestor, part); await directory(ancestor);
  }
  parent = await fs.realpath(parent);
  if (contexts.root !== path.join(parent, 'world-contexts')) throw fail('Joint registry must use this data directory\'s original context lane', 400);
  const root = path.join(parent, 'reference-world-patch-design'); await directory(root, true);
  const runtimeHash = await assemblyRuntimeIdentity(), pending = new Map(), owned = new Map();
  let closed = false;
  const jobDir = id => {if (!digest(id)) throw fail('Exact joint capsule identity required', 400); return path.join(root, id);};
  const checkpoint = signal => {if (closed || signal?.aborted) throw fail('Joint reservation closed/cancelled; no dispatch', 503);};
  const requireCurrentRuntime = async () => {
    if (await assemblyRuntimeIdentity() !== runtimeHash) throw fail('Original joint registry runtime changed; no replacement runtime');
  };
  async function metadata(id) {
    await directory(root); const dir = jobDir(id);
    try {await directory(dir);} catch (error) {if (error.code === 'ENOENT') return null; throw error;}
    // A directory created before the write-once request commit still consumes
    // this SEND. Never delete it, issue another owner or create a second job.
    const value = await checked(path.join(dir, 'request.json'));
    const files = await fs.readdir(dir);
    if (files.length !== 2 || files.some(file => !['_owner.json','request.json'].includes(file))) {
      throw fail('Unknown joint job state; reservation history cannot assert a provider outcome');
    }
    exactKeys(value, ['format','version','id','send','receipt','selected','submissionHash','inputHash','preparationHash',
      'invocationFingerprint','transportHash','imageHashes','runtimeHash','ownerReference','ownerReferenceHash','reservedAt',
      'state','maximumCalls','modelSent','liveProviderCapabilityVerified','canAuthorizePlacement'], 'original joint job');
    bindFrozenReferenceWorldPatchSend(value.receipt, value.send);
    advertisement(value.selected, value.send, value.receipt.recipient);
    const owner = validateWorldPatchOwnerReference(value.ownerReference, value.ownerReferenceHash);
    if (value.format !== 'SavedFrozenReferenceWorldPatchJob' || value.version !== 1 || value.id !== id || value.send.capsuleId !== id
      || value.submissionHash !== contextHash(value.send) || value.runtimeHash !== runtimeHash || value.send.runtimeHash !== runtimeHash
      || ![value.inputHash,value.preparationHash,value.invocationFingerprint,value.transportHash].every(digest)
      || !Array.isArray(value.imageHashes) || value.imageHashes.length !== value.receipt.imageCount || !value.imageHashes.every(digest)
      || owner.directory !== dir || !Number.isSafeInteger(value.reservedAt) || value.reservedAt < value.receipt.frozenAt
      || value.reservedAt >= value.receipt.recordExpiresAt || value.state !== 'send-consumed-not-dispatched'
      || value.maximumCalls !== 1 || value.modelSent !== false || value.liveProviderCapabilityVerified !== false
      || value.canAuthorizePlacement !== false) throw fail('Original joint job source/runtime/budget pins differ');
    await checked(path.join(dir, '_owner.json'), 4096);
    if (hash(await checkedBytes(path.join(dir, '_owner.json'), 4096)) !== owner.ownerFileSha256) throw fail('Original joint owner evidence changed');
    return {dir, value};
  }
  function publicStatus(saved) {
    const value = saved.value;
    return freeze({format: 'FrozenReferenceWorldPatchJobReservation', version: 1, id: value.id,
      capsuleId: value.id, manifestHash: value.receipt.manifestHash, submissionHash: value.submissionHash,
      runtimeHash, recipient: structuredClone(value.receipt.recipient), state: value.state,
      sendConsumed: true, invocationFingerprint: value.invocationFingerprint, transportHash: value.transportHash,
      imageHashes: [...value.imageHashes], callsReserved: 0, maximumCalls: 1, automaticRetries: 0,
      originalProcessReferenceSaved: true, sourceArchiveCurrentlyReverified: false,
      modelSent: false, sendingImplemented: false, liveProviderCapabilityVerified: false,
      serverBaselineVerified: false, canAuthorizePlacement: false, allowsNewModelCall: false, worldWrites: 0});
  }
  async function get(id) {const saved = await metadata(id); return saved ? publicStatus(saved) : null;}
  async function same(saved, send, selected) {
    if (saved.value.submissionHash !== contextHash(send) || contextHash(saved.value.selected) !== contextHash(selected)) {
      throw fail('Existing independent joint SEND or selected advertisement differs');
    }
    return publicStatus(saved);
  }
  async function reserveOriginal(send, selected, signal) {
    checkpoint(signal);
    const old = await metadata(send.capsuleId); if (old) return same(old, send, selected);
    await requireCurrentRuntime(); checkpoint(signal);
    const payload = raw({send, selected});
    if (payload.length > REFERENCE_PATCH_JOB_LIMITS.bindingBytes) throw fail('Joint registry binding envelope exceeds quota', 413);
    const packet = await contexts.operation('reference-patch-provider-input', send.capsuleId, payload, {signal});
    checkpoint(signal);
    if (packet.capsuleId !== send.capsuleId || packet.submissionHash !== contextHash(send)
      || packet.selectedAdvertisement.runtimeHash !== runtimeHash || selected.runtimeHash !== runtimeHash) throw fail('Joint SEND is frozen for another installed runtime');
    const receipt = await contexts.operation('reference-patch-frozen-task', send.capsuleId, undefined, {signal});
    bindFrozenReferenceWorldPatchSend(receipt, send);
    // Serialize quota + new job publication across registry instances. Only
    // this exact successfully written claim is removed. Unknown/partial claims
    // are preserved; lock age, a timeout or a PID alone never permit takeover.
    const lockFile = path.join(root, '_reserve.lock'), claim = {format: 'ReferenceWorldPatchReservationClaim', version: 1,
      id: randomUUID(), capsuleId: send.capsuleId, submissionHash: packet.submissionHash, runtimeHash, pid: process.pid};
    await directory(root); checkpoint(signal);
    try {await immutable(lockFile, claim);} catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const duplicate = await metadata(send.capsuleId);
      if (duplicate) return same(duplicate, send, selected);
      throw fail('Joint reservation in progress/unknown; no takeover or new job');
    }
    const verifyClaim = async () => {
      await directory(root);
      if (contextHash(await checked(lockFile, 4096)) !== contextHash(claim)) throw fail('Original joint reservation claim changed');
    };
    try {
      checkpoint(signal); await verifyClaim();
      const duplicate = await metadata(send.capsuleId); if (duplicate) return same(duplicate, send, selected);
      const names = (await fs.readdir(root)).filter(name => name !== '_reserve.lock');
      if (names.some(name => !digest(name))) throw fail('Unknown joint job history entry; nothing evicted');
      for (const name of names) await metadata(name);
      if (names.length >= REFERENCE_PATCH_JOB_LIMITS.records) throw fail('Joint job history quota; nothing evicted', 429);
      await contexts.operation('reference-patch-provider-recheck', send.capsuleId,
        raw({send, selected, preparationHash: packet.preparationHash}), {signal});
      checkpoint(signal); await verifyClaim();
      if (receipt.recordExpiresAt <= Date.now()) throw fail('Joint capture expired before reservation');
      const dir = jobDir(send.capsuleId); await fs.mkdir(dir, {mode: 0o700}); await directory(dir);
      const owner = await createWorldPatchOwnerReference({directory: dir});
      // Process observation can take time. Recheck the ORIGINAL source and
      // pixels before committing, not a cached packet or caller-made digest.
      await contexts.operation('reference-patch-provider-recheck', send.capsuleId,
        raw({send, selected, preparationHash: packet.preparationHash}), {signal});
      checkpoint(signal); await verifyClaim(); await directory(dir);
      await requireCurrentRuntime(); checkpoint(signal);
      if (receipt.recordExpiresAt <= Date.now()) throw fail('Joint capture expired while reserving');
      const value = {format: 'SavedFrozenReferenceWorldPatchJob', version: 1, id: send.capsuleId,
        send, receipt, selected, submissionHash: packet.submissionHash, inputHash: packet.inputHash,
        preparationHash: packet.preparationHash, invocationFingerprint: packet.invocationFingerprint,
        transportHash: packet.transportHash, imageHashes: [...packet.imageHashes], runtimeHash,
        ownerReference: owner.reference, ownerReferenceHash: owner.referenceHash, reservedAt: Date.now(),
        state: 'send-consumed-not-dispatched', maximumCalls: 1, modelSent: false,
        liveProviderCapabilityVerified: false, canAuthorizePlacement: false};
      await immutable(path.join(dir, 'request.json'), value); // commit LAST
      owned.set(value.id, owner.referenceHash);
      const saved = await metadata(value.id); checkpoint(signal); return publicStatus(saved);
    } finally {
      await verifyClaim(); await fs.unlink(lockFile); // narrow, exact OWN claim only
    }
  }
  async function reserve(value) {
    exactKeys(value, ['send','selected'], 'independent joint registry SEND');
    const send = validateFrozenReferenceWorldPatchExplicitSend(value.send), selected = advertisement(value.selected, send), id = send.capsuleId;
    checkpoint();
    const existing = pending.get(id);
    if (existing) {
      await existing.promise;
      const saved = await metadata(id); if (!saved) throw fail('Original joint reservation missing');
      return same(saved, send, selected);
    }
    if (pending.size) throw fail('Joint reservation lane busy; no dispatch', 429);
    const controller = new AbortController(), item = {controller, promise: null};
    item.promise = reserveOriginal(send, selected, controller.signal); pending.set(id, item);
    try {return await item.promise;} finally {if (pending.get(id) === item) pending.delete(id);}
  }
  // A private packet is rebuilt only for this live registry's EXACT original
  // owner. Reading it never invokes or reserves a model call. Reopening or a
  // duplicate request cannot obtain dispatch ownership from persisted JSON.
  async function readOwnedInput(id) {
    checkpoint();
    const saved = await metadata(id);
    if (!saved || owned.get(id) !== saved.value.ownerReferenceHash) throw fail('Exact live original joint owner required; no ownership adoption');
    const value = saved.value;
    if (value.receipt.recordExpiresAt <= Date.now()) throw fail('Joint capture expired before owned provider preparation');
    await requireCurrentRuntime(); checkpoint();
    const packet = await contexts.operation('reference-patch-provider-recheck', id,
      raw({send: value.send, selected: value.selected, preparationHash: value.preparationHash}));
    checkpoint();
    await requireCurrentRuntime(); checkpoint();
    if (value.receipt.recordExpiresAt <= Date.now()) throw fail('Joint capture expired during owned provider preparation');
    if (packet.inputHash !== value.inputHash || packet.invocationFingerprint !== value.invocationFingerprint
      || packet.transportHash !== value.transportHash || contextHash(packet.imageHashes) !== contextHash(value.imageHashes)) throw fail('Original joint packet changed');
    return packet;
  }
  return {runtimeHash, reserve, get, readOwnedInput, busy: () => pending.size > 0,
    async close() {closed = true; for (const item of pending.values()) item.controller.abort();
      await Promise.allSettled([...pending.values()].map(item => item.promise)); owned.clear();}};
}
