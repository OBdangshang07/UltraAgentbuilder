import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {exactKeys} from '../contracts/world-selection.mjs';
import {REFERENCE_LIMITS, REFERENCE_OWNER} from '../contracts/reference-attachments.mjs';
import {contextHash} from '../src/world/context-snapshot.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {prepareFrozenReferenceWorldPatchSendInput} from './reference-world-patch-send-input.mjs';
import {readFrozenReferenceWorldPatchTaskSource} from './reference-world-patch-task-capsule.mjs';

// PRIVATE local materialization only: no provider, invocation reservation,
// public route or world authority. A dispatcher still owes consume-once SEND.
export const REFERENCE_PATCH_TASK_IMAGE_LIMITS = Object.freeze({records: 8, bytes: 256 * 1024 ** 2});
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const raw = value => Buffer.from(JSON.stringify(value));
const fail = message => {throw Error(message + '; original files preserved');};
function checkpoint(signal) {
  if (signal !== undefined && !(signal instanceof AbortSignal)) fail('Private image cancellation signal required');
  if (signal?.aborted) fail('Joint image operation cancelled');
}
async function directory(target, create = false) {
  if (create) try {await fs.mkdir(target, {mode: 0o700});} catch (e) {if (e.code !== 'EEXIST') throw e;}
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(target) !== target) fail('Joint image directory link/type rejected');
}
async function bytes(file, maximum) {
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 1 || before.size > maximum
    || await fs.realpath(file) !== file) fail('Joint image file type/link/quota rejected');
  const handle = await fs.open(file, 'r');
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1 || opened.size !== before.size
      || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) fail('Joint image changed while opening');
    const value = Buffer.alloc(before.size + 1); let total = 0;
    while (total < value.length) {
      const result = await handle.read(value, total, value.length - total, total);
      if (!result.bytesRead) break; total += result.bytesRead;
    }
    const after = await handle.stat(), current = await fs.lstat(file);
    if (total !== before.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
      || current.dev !== opened.dev || current.ino !== opened.ino || current.nlink !== 1 || current.size !== opened.size
      || current.mtimeMs !== opened.mtimeMs || current.ctimeMs !== opened.ctimeMs || current.isSymbolicLink()
      || await fs.realpath(file) !== file) fail('Joint image changed while reading');
    return value.subarray(0, total);
  } finally {await handle.close();}
}
const json = async (file, maximum) => JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(await bytes(file, maximum)));
async function write(file, value) {
  const handle = await fs.open(file, 'wx', 0o600);
  try {await handle.writeFile(value); await handle.sync();} finally {await handle.close();}
}
async function store(dataDir, create = false) {
  dataDir = path.resolve(dataDir); let ancestor = path.parse(dataDir).root;
  for (const part of ['', ...path.relative(ancestor, dataDir).split(path.sep).filter(Boolean)]) {
    ancestor = path.join(ancestor, part); await directory(ancestor);
  }
  const root = path.join(dataDir, 'reference-world-patch-task-images'); await directory(root, create);
  const marker = path.join(root, '_store.json'); let ownerBytes;
  try {ownerBytes = await bytes(marker, 2048);} catch (e) {
    if (e.code !== 'ENOENT' || !create) throw e;
    if ((await fs.readdir(root)).length) fail('Unowned joint image store');
    try {await write(marker, raw({format: 'ReferenceWorldPatchTaskImageStore', version: 1, ownerId: randomUUID()}));}
    catch (error) {if (error.code !== 'EEXIST') throw error;}
    ownerBytes = await bytes(marker, 2048);
  }
  const owner = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(ownerBytes));
  exactKeys(owner, ['format','version','ownerId'], 'joint image store');
  if (owner.format !== 'ReferenceWorldPatchTaskImageStore' || owner.version !== 1
    || typeof owner.ownerId !== 'string' || !REFERENCE_OWNER.test(owner.ownerId)) fail('Joint image store identity changed');
  return {root, ownerId: owner.ownerId, ownerHash: hash(ownerBytes)};
}
async function verifyStore(opened) {
  await directory(opened.root);
  const marker = await bytes(path.join(opened.root, '_store.json'), 2048);
  if (hash(marker) !== opened.ownerHash) fail('Joint image store owner changed');
}
function pins(input) {
  return {capsuleId: input.receipt.capsuleId, manifestHash: input.receipt.manifestHash,
    submissionHash: input.submissionHash, invocationFingerprint: input.invocationFingerprint,
    referenceSetHash: input.receipt.referenceSetHash, runtimeHash: input.receipt.runtimeHash,
    snapshotHash: input.receipt.snapshotHash, selectionHash: input.receipt.selectionHash,
    imageCapabilityHash: input.receipt.imageCapabilityHash, imageHashes: input.imageHashes,
    sourceAuthority: input.sourceAuthority, maximumCalls: 1};
}
async function original(dataDir, capsuleId, send, audit) {
  if (!digest(capsuleId)) fail('Invalid joint image capsule identity');
  const input = await prepareFrozenReferenceWorldPatchSendInput({dataDir, capsuleId, send, originalReceiptOnly: audit});
  const source = await readFrozenReferenceWorldPatchTaskSource({dataDir, capsuleId});
  if (contextHash(source.receipt) !== contextHash(input.receipt)
    || contextHash(source.reference.images.map(image => hash(Buffer.from(image)))) !== contextHash(input.imageHashes)) fail('Joint original picture sources changed');
  return {input, source};
}
async function committed(opened, input) {
  await verifyStore(opened);
  const target = path.join(opened.root, input.receipt.capsuleId); await directory(target);
  const manifest = await json(path.join(target, 'manifest.json'), 65536), {transportHash, ...content} = manifest;
  const expected = {format: 'FrozenReferenceWorldPatchTaskImages', version: 1, ownerId: opened.ownerId,
    ...pins(input), frozenAt: manifest.frozenAt, files: manifest.files, bytes: manifest.bytes, imageBytes: manifest.imageBytes,
    state: 'images-frozen-not-sent', sourcePixelsReencoded: false, modelSent: false, sendingImplemented: false,
    liveProviderCapabilityVerified: false, serverBaselineVerified: false, canAuthorizePlacement: false, allowsNewModelCall: false};
  if (contextHash(content) !== contextHash(expected) || transportHash !== contextHash(expected)
    || !Number.isSafeInteger(manifest.frozenAt) || manifest.frozenAt < input.receipt.frozenAt || manifest.frozenAt > Date.now()
    || manifest.frozenAt >= input.receipt.recordExpiresAt || !Array.isArray(manifest.files)
    || manifest.files.length !== input.imageCount + 1) fail('Joint task image manifest identity/authority changed');
  const names = ['send.json', ...input.imageHashes.map((_, i) => 'image-' + i + '.png')], entries = await fs.readdir(target);
  if (entries.length !== names.length + 1 || entries.some(name => name !== 'manifest.json' && !names.includes(name))) fail('Unknown/incomplete joint task image inventory');
  const images = []; let total = 0, imageBytes = 0;
  for (const [index, file] of manifest.files.entries()) {
    exactKeys(file, ['path','bytes','sha256'], 'joint task image inventory');
    const maximum = index === 0 ? 4096 : REFERENCE_LIMITS.bytesPerImage;
    if (file.path !== names[index] || !digest(file.sha256) || !Number.isSafeInteger(file.bytes)
      || file.bytes < 1 || file.bytes > maximum) fail('Joint task image order/source identity changed');
    const full = path.join(target, file.path), value = await bytes(full, maximum);
    if (value.length !== file.bytes || hash(value) !== file.sha256) fail('Joint task original bytes changed');
    if (index === 0) {
      const saved = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(value));
      // Audit the actual immutable original SEND, never reconstruct from a
      // receipt or from a different caller's confirmation.
      if (contextHash(saved) !== input.submissionHash || !value.equals(raw(input.send))) fail('Joint original task SEND changed');
    } else {
      if (file.sha256 !== input.imageHashes[index - 1]) fail('Joint task original pixel fingerprint changed');
      images.push(full); imageBytes += value.length;
    }
    total += value.length;
  }
  if (total !== manifest.bytes || imageBytes !== manifest.imageBytes || imageBytes > REFERENCE_LIMITS.bytesPerSet) fail('Joint task image byte accounting changed');
  await verifyStore(opened);
  return {manifest, images};
}

/** Freeze original canonical pixels in a distinct task-owned transport. A
 * partial record/unknown publication is never adopted, replaced or resumed. */
export async function freezeReferenceWorldPatchTaskImages({dataDir, capsuleId, send, signal}) {
  checkpoint(signal);
  const {input, source} = await original(dataDir, capsuleId, send, false);
  checkpoint(signal);
  const opened = await store(dataDir, true), lockFile = path.join(opened.root, '_publish.lock');
  const lockBytes = raw({format: 'ReferenceWorldPatchTaskImagePublication', version: 1,
    ownerId: opened.ownerId, capsuleId, publicationId: randomUUID()});
  // Serialize quota inspection AND publication across different capsules.
  // Unknown claims (even apparently old/dead ones) never gain a takeover path.
  try {await write(lockFile, lockBytes);} catch (e) {
    if (e.code === 'EEXIST') fail('Joint image publication pending/unknown; no takeover'); throw e;
  }
  const verifyClaim = async () => {
    await verifyStore(opened);
    if (!(await bytes(lockFile, 2048)).equals(lockBytes)) fail('Joint image publication claim changed; no takeover');
  };
  try {
    checkpoint(signal); await verifyClaim();
    const target = path.join(opened.root, capsuleId);
    let exists = false; try {await fs.lstat(target); exists = true;} catch (e) {if (e.code !== 'ENOENT') throw e;}
    if (exists) {
      const found = await committed(opened, input); checkpoint(signal);
      if (input.receipt.recordExpiresAt <= Date.now()) fail('Joint capture expired before new image binding');
      return found.manifest;
    }
    let count = 0, total = 0;
    const names = await fs.readdir(opened.root);
    if (names.length > REFERENCE_PATCH_TASK_IMAGE_LIMITS.records + 2) fail('Joint task image record quota reached');
    for (const entry of names) {
      if (['_store.json','_publish.lock'].includes(entry)) continue;
      checkpoint(signal);
      if (!digest(entry)) fail('Unknown joint task image store entry');
      await directory(path.join(opened.root, entry));
      const savedSend = await json(path.join(opened.root, entry, 'send.json'), 4096);
      const old = await original(dataDir, entry, savedSend, true);
      const saved = await committed(opened, old.input); count++; total += saved.manifest.bytes;
    }
    const sendBytes = raw(input.send), imageBytes = source.reference.images.reduce((sum, b) => sum + b.length, 0);
    if (sendBytes.length > 4096 || count >= REFERENCE_PATCH_TASK_IMAGE_LIMITS.records
      || total + sendBytes.length + imageBytes > REFERENCE_PATCH_TASK_IMAGE_LIMITS.bytes) fail('Joint task image quota reached; nothing evicted');
    checkpoint(signal); await verifyClaim();
    if (input.receipt.recordExpiresAt <= Date.now()) fail('Joint capture expired before image materialization');
    await fs.mkdir(target, {mode: 0o700}); await directory(target);
    const frozenAt = Date.now(), files = [];
    const values = [['send.json', sendBytes], ...source.reference.images.map((image, i) => ['image-' + i + '.png', Buffer.from(image)])];
    for (const [index, [name, value]] of values.entries()) {
      checkpoint(signal); await verifyClaim(); await directory(target);
      if (index > 0 && hash(value) !== input.imageHashes[index - 1]) fail('Joint original pixel fingerprint changed');
      await write(path.join(target, name), value); files.push({path: name, bytes: value.length, sha256: hash(value)});
    }
    checkpoint(signal); await verifyClaim(); await directory(target);
    if (input.receipt.recordExpiresAt <= Date.now()) fail('Joint capture expired while copying task images');
    const finalSource = await original(dataDir, capsuleId, input.send, false);
    if (contextHash(finalSource.input.receipt) !== contextHash(input.receipt)
      || finalSource.input.invocationFingerprint !== input.invocationFingerprint) fail('Joint source changed while copying task images');
    checkpoint(signal); await verifyClaim(); await directory(target);
    const content = {format: 'FrozenReferenceWorldPatchTaskImages', version: 1, ownerId: opened.ownerId,
      ...pins(input), frozenAt, files, bytes: sendBytes.length + imageBytes, imageBytes,
      state: 'images-frozen-not-sent', sourcePixelsReencoded: false, modelSent: false, sendingImplemented: false,
      liveProviderCapabilityVerified: false, serverBaselineVerified: false, canAuthorizePlacement: false, allowsNewModelCall: false};
    await write(path.join(target, 'manifest.json'), raw({...content, transportHash: contextHash(content)})); // commit LAST
    const result = await committed(opened, input); checkpoint(signal);
    if (input.receipt.recordExpiresAt <= Date.now()) fail('Joint capture expired while checking published task images');
    return result.manifest;
  } finally {
    await verifyClaim();
    await fs.unlink(lockFile); // this exact verified own claim only; never age/PID takeover
  }
}

/** PRIVATE original-only audit. Paths must never be exposed by public HTTP.
 * After-expiry audit does not refresh consent or allow a new model call. */
export async function readReferenceWorldPatchTaskImages({dataDir, capsuleId, send, signal}) {
  checkpoint(signal);
  const {input} = await original(dataDir, capsuleId, send, true);
  const found = await committed(await store(dataDir), input); checkpoint(signal);
  return {...found, originalReceiptOnly: true, allowsNewModelCall: false, canAuthorizePlacement: false};
}
