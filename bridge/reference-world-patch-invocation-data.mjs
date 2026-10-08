import fs from 'node:fs/promises';
import path from 'node:path';
import {exactKeys} from '../contracts/world-selection.mjs';
import {bindFrozenReferenceWorldPatchSend} from '../contracts/reference-world-patch-send.mjs';
import {bindReferenceWorldPatchInvocation} from '../contracts/reference-world-patch-invocation.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {contextHash} from '../src/world/context-snapshot.mjs';
import {validateWorldPatchOwnerReference} from './world-patch-owner-observation.mjs';
import {readFrozenReferenceWorldPatchTaskSource} from './reference-world-patch-task-capsule.mjs';
import {readReferenceWorldPatchTaskImages} from './reference-world-patch-task-images.mjs';

export const REFERENCE_PATCH_CALL_POLICY = Object.freeze({assembly: {maximumCalls: 1}});
export const REFERENCE_PATCH_RESPONSE_BYTES = 2 * 1024 ** 2;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export async function jointInvocationDirectory(target, create = false) {
  if (create) try {await fs.mkdir(target, {mode: 0o700});} catch (error) {if (error.code !== 'EEXIST') throw error;}
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(target) !== target) throw Error('Joint invocation directory redirected; preserved');
}
export async function jointInvocationBytes(file, maximum) {
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 1 || before.size > maximum
    || await fs.realpath(file) !== file) throw Error('Joint invocation member type/link/quota rejected; preserved');
  const handle = await fs.open(file, 'r');
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1 || opened.size !== before.size)
      throw Error('Joint invocation evidence changed before opening');
    const bytes = await handle.readFile(), after = await handle.stat(), current = await fs.lstat(file);
    if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== opened.mtimeMs
      || after.ctimeMs !== opened.ctimeMs || current.dev !== opened.dev || current.ino !== opened.ino
      || current.isSymbolicLink() || current.nlink !== 1 || current.size !== opened.size
      || current.mtimeMs !== opened.mtimeMs || current.ctimeMs !== opened.ctimeMs || await fs.realpath(file) !== file)
      throw Error('Joint invocation evidence changed while reading');
    return bytes;
  } finally {await handle.close();}
}
export async function readJointInvocationEnvelope(file, maximum = 65536) {
  const envelope = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(await jointInvocationBytes(file, maximum)));
  exactKeys(envelope, ['value','sha256'], 'joint invocation envelope');
  if (!digest(envelope.sha256) || hash(envelope.value) !== envelope.sha256) throw Error('Joint invocation integrity rejected');
  return envelope.value;
}
export async function writeJointInvocationEnvelope(file, value) {
  const handle = await fs.open(file, 'wx', 0o600);
  try {await handle.writeFile(JSON.stringify({value, sha256: hash(value)})); await handle.sync();} finally {await handle.close();}
}

/** Exact sibling invocation directory and original reservation, never a
 * request-supplied source path or a legacy text-patch job. Audit is not SEND. */
export async function readReferencePatchInvocation(directoryValue, runtimeHash) {
  const directory = path.resolve(directoryValue), id = path.basename(directory), root = path.dirname(directory);
  if (!digest(id) || path.basename(root) !== 'reference-world-patch-invocations') throw Error('Independent joint invocation directory required');
  const dataDir = path.dirname(root); let ancestor = path.parse(dataDir).root;
  for (const part of ['', ...path.relative(ancestor, dataDir).split(path.sep).filter(Boolean)]) {
    ancestor = path.join(ancestor, part); await jointInvocationDirectory(ancestor);
  }
  await jointInvocationDirectory(root); await jointInvocationDirectory(directory);
  const value = await readJointInvocationEnvelope(path.join(directory, 'request.json'));
  exactKeys(value, ['format','version','id','send','selected','submissionHash','inputHash','preparationHash',
    'invocationFingerprint','transportHash','imageHashes','runtimeHash','registryRequestHash','registryOwnerReferenceHash',
    'ownerReference','ownerReferenceHash','createdAt','maximumCalls','canAuthorizePlacement'], 'joint invocation request');
  const owner = validateWorldPatchOwnerReference(value.ownerReference, value.ownerReferenceHash);
  if (value.format !== 'FrozenReferenceWorldPatchInvocation' || value.version !== 1 || value.id !== id
    || value.send.capsuleId !== id || value.submissionHash !== contextHash(value.send)
    || value.runtimeHash !== runtimeHash || value.send.runtimeHash !== runtimeHash || owner.directory !== directory
    || ![value.inputHash,value.preparationHash,value.invocationFingerprint,value.transportHash,value.registryRequestHash,value.registryOwnerReferenceHash].every(digest)
    || !Array.isArray(value.imageHashes) || !value.imageHashes.length || value.imageHashes.length > 4 || !value.imageHashes.every(digest)
    || !Number.isSafeInteger(value.createdAt) || value.maximumCalls !== 1 || value.canAuthorizePlacement !== false)
    throw Error('Original joint invocation source/runtime/budget changed');
  if (hash(await jointInvocationBytes(path.join(directory, '_owner.json'), 4096)) !== owner.ownerFileSha256)
    throw Error('Original joint invocation owner changed');
  const reservationDirectory = path.join(dataDir, 'reference-world-patch-design', id);
  await jointInvocationDirectory(path.dirname(reservationDirectory)); await jointInvocationDirectory(reservationDirectory);
  const reservation = await readJointInvocationEnvelope(path.join(reservationDirectory, 'request.json'));
  const registryOwner = validateWorldPatchOwnerReference(reservation.ownerReference, reservation.ownerReferenceHash);
  if (hash(reservation) !== value.registryRequestHash || reservation.ownerReferenceHash !== value.registryOwnerReferenceHash
    || registryOwner.directory !== reservationDirectory || hash(reservation.send) !== hash(value.send)
    || hash(reservation.selected) !== hash(value.selected)
    || ['inputHash','preparationHash','invocationFingerprint','transportHash','runtimeHash'].some(k => reservation[k] !== value[k])
    || hash(reservation.imageHashes) !== hash(value.imageHashes)
    || hash(await jointInvocationBytes(path.join(reservationDirectory, '_owner.json'), 4096)) !== registryOwner.ownerFileSha256)
    throw Error('Original joint reservation changed; no ownership adoption');
  const source = await readFrozenReferenceWorldPatchTaskSource({dataDir, capsuleId: id});
  bindFrozenReferenceWorldPatchSend(source.receipt, value.send);
  if (value.createdAt < source.receipt.frozenAt || value.createdAt >= source.receipt.recordExpiresAt)
    throw Error('Joint invocation was not created within original consent lifetime');
  return {directory, dataDir, value, source};
}

/** Only a write-ahead pending call may supply reference pixels to Codex. The
 * completed original-receipt reader remains separate from fresh SEND expiry. */
export async function readJointCodexReferenceInput({directory, input, model, runtimeHash, originalReceiptOnly = false}) {
  if (typeof originalReceiptOnly !== 'boolean') throw Error('Exact original receipt mode required');
  const saved = await readReferencePatchInvocation(directory, runtimeHash), value = saved.value;
  const binding = bindReferenceWorldPatchInvocation(saved.source.receipt, input);
  if (value.selected.agent !== 'codex' || value.selected.model !== model || value.selected.runtimeHash !== runtimeHash)
    throw Error('Selected joint Codex model/runtime changed');
  const ledger = path.join(saved.directory, 'assembly-journal'); await jointInvocationDirectory(ledger);
  const identity = await readJointInvocationEnvelope(path.join(ledger, 'identity.json'));
  if (hash(identity) !== hash({version: 1, requestHash: value.submissionHash,
    policyHash: hash(REFERENCE_PATCH_CALL_POLICY), runtimeHash, maximumCalls: 1})) throw Error('Joint invocation ledger identity changed');
  const entries = await fs.readdir(ledger);
  if (entries.some(name => /^call-\d+\.json$/.test(name) && name !== 'call-1.json')) throw Error('Joint invocation exceeded original one-call budget');
  const call = await readJointInvocationEnvelope(path.join(ledger, 'call-1.json'), REFERENCE_PATCH_RESPONSE_BYTES + 65536);
  if (call.index !== 1 || call.state !== 'pending' || call.fingerprint !== value.invocationFingerprint
    || (await readJointInvocationEnvelope(path.join(ledger, 'dispatched.json'))).count !== 1)
    throw Error('Exact pending original joint call required; no fresh budget or replay');
  if (originalReceiptOnly && (!call.providerBinding?.turnId || call.providerBinding.model !== model))
    throw Error('Exact original joint provider turn required for observation');
  if (!originalReceiptOnly && saved.source.receipt.recordExpiresAt <= Date.now()) throw Error('Joint capture expired before adapter dispatch');
  const pixels = await readReferenceWorldPatchTaskImages({dataDir: saved.dataDir, capsuleId: value.id, send: value.send});
  if (pixels.manifest.transportHash !== value.transportHash || hash(pixels.manifest.imageHashes) !== hash(value.imageHashes))
    throw Error('Original joint invocation pixels changed');
  if (!originalReceiptOnly && saved.source.receipt.recordExpiresAt <= Date.now()) throw Error('Joint capture expired while checking adapter pixels');
  return {images: pixels.images, referenceBindingHash: contextHash(binding)};
}
