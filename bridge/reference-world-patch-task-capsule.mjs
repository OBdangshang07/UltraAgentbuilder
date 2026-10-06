import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {exactKeys} from '../contracts/world-selection.mjs';
import {REFERENCE_LIMITS, REFERENCE_OWNER} from '../contracts/reference-attachments.mjs';
import {contextHash} from '../src/world/context-snapshot.mjs';
import {prepareSavedWorldPatchTaskDisclosure, WORLD_PATCH_TASK_DISCLOSURE_LIMITS} from './world-patch-task-disclosure.mjs';
import {readReferenceWorldPatchPreparationSource, rebuildReferenceWorldPatchContextSource,
  REFERENCE_PATCH_CONTEXT_FILE_LIMITS} from './reference-world-patch-source.mjs';
import {prepareSavedReferenceWorldPatchTaskDisclosure, reviewSavedReferenceWorldPatchTaskDisclosure,
  validateFrozenSavedReferenceWorldPatchTask, SAVED_REFERENCE_PATCH_LIMITS} from './reference-world-patch-task-disclosure.mjs';

// INTERNAL worker-only immutable archive, not a SEND endpoint/token, provider
// capability receipt or world authority. No automatic deletion/lock takeover.
export const REFERENCE_PATCH_CAPSULE_ID = /^[a-f0-9]{64}$/;
export const REFERENCE_PATCH_CAPSULE_LIMITS = Object.freeze({records: 8, bytes: 512 * 1024 ** 2});
const digest = value => typeof value === 'string' && REFERENCE_PATCH_CAPSULE_ID.test(value);
const uuid = value => typeof value === 'string' && REFERENCE_OWNER.test(value);
const fixed = Object.freeze({'_owner.json': 2048, ...REFERENCE_PATCH_CONTEXT_FILE_LIMITS,
  'reference-manifest.json': 65536, 'joint-input.json': 32768,
  'base-disclosure.json': WORLD_PATCH_TASK_DISCLOSURE_LIMITS.bytes,
  'task-disclosure.json': SAVED_REFERENCE_PATCH_LIMITS.bytes, 'confirmation.json': 4096, 'review.json': 16384});
const imageNames = count => Array.from({length: count}, (_, i) => `image-${i}.png`);
const inventoryNames = count => [...Object.keys(fixed), ...imageNames(count)];
const maximum = name => fixed[name] ?? (/^image-[0-3]\.png$/.test(name) ? REFERENCE_LIMITS.bytesPerImage : 0);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const raw = value => value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(JSON.stringify(value));
const json = bytes => JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
const fail = (message, statusCode = 409) => {throw Object.assign(Error(message), {statusCode});};
async function directory(target, create = false) {
  if (create) try {await fs.mkdir(target, {mode: 0o700});} catch (e) {if (e.code !== 'EEXIST') throw e;}
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.resolve(await fs.realpath(target)).toLowerCase() !== path.resolve(target).toLowerCase()) fail('Joint capsule directory link/type rejected; preserved');
}
async function read(target, max) {
  const stat = await fs.lstat(target);
  if (!max || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > max
    || path.resolve(await fs.realpath(target)).toLowerCase() !== path.resolve(target).toLowerCase()) fail('Joint capsule file link/type/size rejected; preserved');
  const handle = await fs.open(target, 'r');
  try {
    const opened = await handle.stat();
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.nlink !== 1 || opened.size !== stat.size
      || opened.mtimeMs !== stat.mtimeMs || opened.ctimeMs !== stat.ctimeMs) fail('Joint capsule source changed while opening');
    const bytes = Buffer.alloc(stat.size + 1); let total = 0;
    while (total < bytes.length) {const result = await handle.read(bytes, total, bytes.length - total, total); if (!result.bytesRead) break; total += result.bytesRead;}
    const after = await handle.stat(), current = await fs.lstat(target);
    if (total !== stat.size || after.size !== stat.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
      || current.dev !== stat.dev || current.ino !== stat.ino || current.nlink !== 1 || current.size !== stat.size || current.isSymbolicLink()
      || current.mtimeMs !== opened.mtimeMs || current.ctimeMs !== opened.ctimeMs
      || path.resolve(await fs.realpath(target)).toLowerCase() !== path.resolve(target).toLowerCase()) fail('Joint capsule source changed while reading');
    return bytes.subarray(0, total);
  } finally {await handle.close();}
}
async function write(target, bytes) {
  const handle = await fs.open(target, 'wx', 0o600);
  try {await handle.writeFile(bytes); await handle.sync();} finally {await handle.close();}
}
async function openStore(dataDir, create = false) {
  dataDir = path.resolve(dataDir); let ancestor = path.parse(dataDir).root;
  for (const part of ['', ...path.relative(ancestor, dataDir).split(path.sep).filter(Boolean)]) {
    ancestor = path.join(ancestor, part); const stat = await fs.lstat(ancestor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Joint capsule data-directory link/type rejected');
  }
  const root = path.join(await fs.realpath(dataDir), 'reference-world-patch-tasks'); await directory(root, create);
  const file = path.join(root, '_store.json'); let store;
  try {store = json(await read(file, 1024));} catch (e) {
    if (e.code !== 'ENOENT' || !create) throw e;
    if ((await fs.readdir(root)).length) fail('Unowned joint capsule archive; preserved');
    try {await write(file, raw({format: 'ReferenceWorldPatchCapsuleStore', version: 1, ownerId: randomUUID()}));}
    catch (error) {if (error.code !== 'EEXIST') throw error;}
    store = json(await read(file, 1024));
  }
  exactKeys(store, ['format','version','ownerId'], 'joint capsule store');
  if (store.format !== 'ReferenceWorldPatchCapsuleStore' || store.version !== 1 || !uuid(store.ownerId)) fail('Joint capsule store ownership rejected');
  return {root, store};
}
function receipt(manifest) {
  const {ownerId, files, format, manifestHash, ...content} = manifest;
  // No paths, prompts, raw facts/pixels, archive-owner ID or transferable token.
  return {format: 'FrozenReferenceWorldPatchTaskReceipt', ...content, manifestHash};
}
async function committed(root, store, capsuleId) {
  if (!digest(capsuleId)) fail('Invalid joint capsule identity', 400);
  const dir = path.join(root, capsuleId); await directory(dir);
  const manifest = json(await read(path.join(dir, 'manifest.json'), 65536));
  exactKeys(manifest, ['format','version','purpose','ownerId','capsuleId','contextId','frozenAt','recordExpiresAt',
    'recordHash','payloadSha256','snapshotHash','selectionHash','summaryHash','taskDisclosureHash','taskHash','requestHash',
    'disclosureHash','promptSha256','confirmationHash','reviewHash','referenceOwnerId','referenceSetHash','runtimeHash',
    'imageCapabilityHash','recipient','maximumCalls','imageCount','bytes','files','state','sourceAuthority',
    'summaryConsentTransferable','referenceConsentTransferable','modelSent','sendingImplemented','serverBaselineVerified',
    'canAuthorizePlacement','manifestHash'], 'joint capsule manifest');
  const {manifestHash, ...content} = manifest;
  if (manifest.format !== 'FrozenReferenceWorldPatchTaskCapsule' || manifest.version !== 1 || manifest.purpose !== 'reference-world-patch-design'
    || manifest.ownerId !== store.ownerId || manifest.capsuleId !== capsuleId || !uuid(manifest.contextId) || !uuid(manifest.referenceOwnerId)
    || contextHash(content) !== manifestHash || manifest.state !== 'frozen-not-sent' || manifest.maximumCalls !== 1
    || ['summaryConsentTransferable','referenceConsentTransferable','modelSent','sendingImplemented','serverBaselineVerified','canAuthorizePlacement'].some(k => manifest[k] !== false)
    || manifest.sourceAuthority !== 'client-submitted-block-facts-not-a-server-signature'
    || !Number.isSafeInteger(manifest.frozenAt) || manifest.frozenAt < 0 || manifest.frozenAt > Date.now()
    || !Number.isSafeInteger(manifest.recordExpiresAt) || manifest.recordExpiresAt <= manifest.frozenAt
    || !Number.isSafeInteger(manifest.imageCount) || manifest.imageCount < 1 || manifest.imageCount > REFERENCE_LIMITS.images
    || !Number.isSafeInteger(manifest.bytes) || manifest.bytes < 1 || manifest.bytes > REFERENCE_PATCH_CAPSULE_LIMITS.bytes) fail('Joint capsule manifest integrity rejected; preserved');
  const names = inventoryNames(manifest.imageCount), entries = await fs.readdir(dir);
  if (entries.length !== names.length + 1 || entries.some(n => n !== 'manifest.json' && !names.includes(n))
    || !Array.isArray(manifest.files) || manifest.files.length !== names.length) fail('Incomplete/unknown joint capsule; preserved, not adopted');
  const sources = {}; let bytes = 0, pixelsBytes = 0;
  for (const [i, entry] of manifest.files.entries()) {
    exactKeys(entry, ['path','bytes','sha256'], 'joint capsule inventory');
    if (entry.path !== names[i] || !digest(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1
      || entry.bytes > maximum(entry.path)) fail('Joint capsule inventory identity/quota rejected');
    if (entry.path.startsWith('image-')) {pixelsBytes += entry.bytes; if (pixelsBytes > REFERENCE_LIMITS.bytesPerSet) fail('Joint capsule picture quota');}
    const value = await read(path.join(dir, entry.path), maximum(entry.path));
    if (value.length !== entry.bytes || sha(value) !== entry.sha256) fail('Joint capsule original source hash mismatch');
    sources[entry.path] = value; bytes += value.length;
  }
  if (bytes !== manifest.bytes) fail('Joint capsule byte accounting mismatch');
  const marker = json(sources['_owner.json']); exactKeys(marker, ['format','version','ownerId','capsuleId','contextId'], 'joint capsule owner');
  if (marker.format !== 'ReferenceWorldPatchCapsuleOwner' || marker.version !== 1 || marker.ownerId !== store.ownerId
    || marker.capsuleId !== capsuleId || marker.contextId !== manifest.contextId) fail('Joint capsule owner identity mismatch');
  return {manifest, sources, dir};
}
function verifyOriginal({manifest, sources}) {
  const contextFiles = Object.fromEntries(Object.keys(REFERENCE_PATCH_CONTEXT_FILE_LIMITS).map(n => [n, sources[n]]));
  const saved = rebuildReferenceWorldPatchContextSource(contextFiles, manifest.contextId, manifest.frozenAt);
  const reference = {manifest: json(sources['reference-manifest.json']), images: imageNames(manifest.imageCount).map(n => sources[n])};
  const input = json(sources['joint-input.json']); exactKeys(input, ['intent','capability','runtimeHash'], 'frozen joint input');
  const prepared = json(sources['task-disclosure.json']), confirmation = json(sources['confirmation.json']), review = json(sources['review.json']);
  const base = json(sources['base-disclosure.json']);
  validateFrozenSavedReferenceWorldPatchTask(saved, {...input, reference}, prepared, confirmation, review, manifest.frozenAt, base);
  for (const k of ['recordExpiresAt','recordHash','payloadSha256','snapshotHash','selectionHash','summaryHash','taskDisclosureHash','taskHash']) {
    const expected = k === 'recordExpiresAt' ? saved.record.expiresAt : k in prepared ? prepared[k] : saved.record[k];
    if (manifest[k] !== expected) fail('Original joint capsule ' + k + ' mismatch');
  }
  for (const k of ['requestHash','promptSha256','referenceOwnerId','referenceSetHash','runtimeHash','imageCapabilityHash']) {
    const expected = k === 'requestHash' ? prepared.task.requestHash : prepared.task.request[k];
    if (manifest[k] !== expected) fail('Original joint capsule task identity mismatch');
  }
  if (manifest.disclosureHash !== prepared.task.disclosure.disclosureHash || manifest.confirmationHash !== contextHash(confirmation)
    || manifest.reviewHash !== review.reviewHash || contextHash(manifest.recipient) !== contextHash(prepared.task.disclosure.recipient)
    || reference.manifest.references.length !== manifest.imageCount || manifest.capsuleId !== contextHash({version: 1,
      purpose: manifest.purpose, contextId: saved.record.id, recordHash: saved.record.recordHash,
      taskDisclosureHash: prepared.taskDisclosureHash, confirmationHash: contextHash(confirmation), reviewHash: review.reviewHash})) fail('Original joint capsule confirmation binding mismatch');
  return {saved, reference, input, prepared, confirmation, review, baseDisclosure: base};
}

/** Audit only: original files remain verifiable after source expiration/discard.
 * A receipt cannot authorize a fresh model call or server baseline. */
export async function readFrozenReferenceWorldPatchTaskCapsule({dataDir, capsuleId}) {
  const opened = await openStore(dataDir), result = await committed(opened.root, opened.store, capsuleId);
  verifyOriginal(result); return receipt(result.manifest);
}
/** PRIVATE worker/runner source access; never expose as an HTTP response. */
export async function readFrozenReferenceWorldPatchTaskSource({dataDir, capsuleId}) {
  const opened = await openStore(dataDir), result = await committed(opened.root, opened.store, capsuleId);
  return {...verifyOriginal(result), receipt: receipt(result.manifest)};
}
export async function freezeReferenceWorldPatchTask({dataDir, contextId, input, confirmation}) {
  exactKeys(input, ['intent','capability','runtimeHash'], 'joint capsule preparation input');
  const source = await readReferenceWorldPatchPreparationSource({dataDir, contextId, intent: input.intent});
  const bound = {...input, reference: source.reference}, prepared = prepareSavedReferenceWorldPatchTaskDisclosure(source.saved, bound);
  const review = reviewSavedReferenceWorldPatchTaskDisclosure(source.saved, bound, confirmation);
  const legacyIntent = {format: 'WorldPatchDesignIntent', version: 1, purpose: 'world-patch-design',
    agent: input.intent.agent, model: input.intent.model, effort: input.intent.effort, prompt: input.intent.prompt, maximumCalls: 1};
  const base = prepareSavedWorldPatchTaskDisclosure(source.saved, legacyIntent);
  // Keep only the exact bound advertisement, never caller account/path hints.
  const capability = prepared.task.disclosure.imageCapability;
  const jointInput = {intent: input.intent, capability: {id: capability.model, supportsImages: true, efforts: capability.advertisedEfforts}, runtimeHash: input.runtimeHash};
  const confirmationHash = contextHash(confirmation), capsuleId = contextHash({version: 1, purpose: 'reference-world-patch-design',
    contextId, recordHash: source.saved.record.recordHash, taskDisclosureHash: prepared.taskDisclosureHash, confirmationHash, reviewHash: review.reviewHash});
  const opened = await openStore(dataDir, true), {root, store} = opened;
  let exists = false; try {await fs.lstat(path.join(root, capsuleId)); exists = true;} catch (e) {if (e.code !== 'ENOENT') throw e;}
  if (exists) {const old = await committed(root, store, capsuleId); verifyOriginal(old); return receipt(old.manifest);}
  const lockFile = path.join(root, '_publish.lock'), lockBytes = raw({format: 'ReferenceWorldPatchCapsulePublication', version: 1,
    ownerId: store.ownerId, capsuleId, publicationId: randomUUID()});
  try {await write(lockFile, lockBytes);} catch (e) {if (e.code === 'EEXIST') fail('Joint publication pending/unknown; preserved, no takeover'); throw e;}
  try {
    let count = 0, total = 0;
    for (const name of await fs.readdir(root)) {
      if (['_store.json','_publish.lock'].includes(name)) continue;
      if (!digest(name)) fail('Unknown joint archive entry; preserved');
      const existing = await committed(root, store, name); verifyOriginal(existing);
      count++; total += existing.manifest.bytes;
    }
    const imageCount = source.reference.images.length, names = inventoryNames(imageCount);
    const values = {'_owner.json': raw({format: 'ReferenceWorldPatchCapsuleOwner', version: 1, ownerId: store.ownerId, capsuleId, contextId}),
      ...source.contextFiles, 'reference-manifest.json': source.referenceManifestBytes, 'joint-input.json': raw(jointInput),
      'base-disclosure.json': raw(base), 'task-disclosure.json': raw(prepared), 'confirmation.json': raw(confirmation), 'review.json': raw(review)};
    source.reference.images.forEach((image, i) => {values[`image-${i}.png`] = raw(image);});
    const files = names.map(name => ({path: name, bytes: values[name].length, sha256: sha(values[name])}));
    const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
    if (files.some(file => file.bytes < 1 || file.bytes > maximum(file.path))) fail('Joint capsule source byte quota', 413);
    if (count >= REFERENCE_PATCH_CAPSULE_LIMITS.records || total + bytes > REFERENCE_PATCH_CAPSULE_LIMITS.bytes) fail('Joint capsule quota reached; nothing evicted', 429);
    const frozenAt = Date.now(), record = source.saved.record;
    const content = {format: 'FrozenReferenceWorldPatchTaskCapsule', version: 1, purpose: 'reference-world-patch-design',
      ownerId: store.ownerId, capsuleId, contextId, frozenAt, recordExpiresAt: record.expiresAt, recordHash: record.recordHash,
      payloadSha256: record.payloadSha256, snapshotHash: record.snapshotHash, selectionHash: record.selectionHash, summaryHash: record.summaryHash,
      taskDisclosureHash: prepared.taskDisclosureHash, taskHash: prepared.taskHash, requestHash: prepared.task.requestHash,
      disclosureHash: prepared.task.disclosure.disclosureHash, promptSha256: prepared.task.request.promptSha256, confirmationHash,
      reviewHash: review.reviewHash, referenceOwnerId: input.intent.referenceOwnerId, referenceSetHash: input.intent.referenceSetHash,
      runtimeHash: input.runtimeHash, imageCapabilityHash: prepared.task.request.imageCapabilityHash, recipient: prepared.task.disclosure.recipient,
      maximumCalls: 1, imageCount, bytes, files, state: 'frozen-not-sent', sourceAuthority: record.sourceAuthority,
      summaryConsentTransferable: false, referenceConsentTransferable: false, modelSent: false, sendingImplemented: false,
      serverBaselineVerified: false, canAuthorizePlacement: false};
    const manifest = {...content, manifestHash: contextHash(content)}; verifyOriginal({manifest, sources: values});
    const dir = path.join(root, capsuleId); await fs.mkdir(dir, {mode: 0o700}); await directory(dir);
    for (const name of names) await write(path.join(dir, name), values[name]);
    if (record.expiresAt <= Date.now()) fail('Joint source expired before publication; incomplete archive preserved');
    await write(path.join(dir, 'manifest.json'), raw(manifest)); // commit marker LAST
    const result = await committed(root, store, capsuleId); verifyOriginal(result); return receipt(result.manifest);
  } finally {
    const current = await read(lockFile, 2048);
    if (!current.equals(lockBytes)) fail('Joint publication lock changed; preserved');
    await fs.unlink(lockFile); // only this verified exact claim; never PID/age takeover
  }
}
