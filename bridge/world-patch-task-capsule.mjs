import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {exactKeys, WORLD_SELECTION_LIMITS} from '../contracts/world-selection.mjs';
import {contextHash, createContextSnapshot, validateContextSnapshot} from '../src/world/context-snapshot.mjs';
import {summarizeContextSnapshot} from '../src/world/context-summary.mjs';
import {prepareSavedWorldPatchTaskDisclosure, reviewSavedWorldPatchTaskDisclosure,
  validateFrozenSavedWorldPatchTask, WORLD_PATCH_TASK_DISCLOSURE_LIMITS} from './world-patch-task-disclosure.mjs';

// Worker-only private archive. This has NO adapter, budget reservation, send
// token, world-write API, automatic deletion, PID takeover or clock refresh.
export const PATCH_CAPSULE_ID = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const WORLD_PATCH_CAPSULE_LIMITS = Object.freeze({records: 8, bytes: 512 * 1024 ** 2});
const maximums = Object.freeze({
  '_owner.json': 2048, 'context-owner.json': 1024, 'context-store.json': 1024,
  'payload.json': WORLD_SELECTION_LIMITS.snapshotBytes, 'record.json': 16384,
  'snapshot.json': WORLD_SELECTION_LIMITS.snapshotBytes, 'summary.json': 1048576,
  'task-disclosure.json': WORLD_PATCH_TASK_DISCLOSURE_LIMITS.bytes,
  'confirmation.json': 4096, 'review.json': 16384,
});
const names = Object.keys(maximums);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (message, statusCode = 409) => { throw Object.assign(new Error(message), {statusCode}); };
const json = bytes => JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
const raw = value => Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));

async function directory(target, create = false) {
  if (create) try { await fs.mkdir(target, {mode: 0o700}); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.resolve(await fs.realpath(target)).toLowerCase() !== path.resolve(target).toLowerCase()) fail('Patch capsule directory link/type rejected; preserved');
}
async function read(target, maximum) {
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maximum
    || path.resolve(await fs.realpath(target)).toLowerCase() !== path.resolve(target).toLowerCase()) fail('Patch capsule file type/link/size rejected; preserved');
  const handle = await fs.open(target, 'r');
  try {
    const opened = await handle.stat();
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size || opened.nlink !== 1) fail('Patch capsule file changed while opening');
    const bytes = Buffer.alloc(stat.size + 1); let total = 0;
    while (total < bytes.length) { const result = await handle.read(bytes, total, bytes.length - total, total); if (!result.bytesRead) break; total += result.bytesRead; }
    const after = await handle.stat(), current = await fs.lstat(target);
    if (total !== stat.size || after.size !== stat.size || after.mtimeMs !== opened.mtimeMs || current.dev !== stat.dev
      || current.ino !== stat.ino || current.isSymbolicLink() || current.nlink !== 1) fail('Patch capsule file changed while reading');
    return bytes.subarray(0, total);
  } finally { await handle.close(); }
}
async function write(target, bytes) {
  const handle = await fs.open(target, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function openStore(root, create) {
  // Resolve/check every ancestor, including the configured data directory.
  // An 8.3 spelling is allowed only after non-link ancestor verification.
  const requested = path.resolve(root); let ancestor = path.parse(requested).root;
  for (const part of path.relative(ancestor, path.dirname(requested)).split(path.sep).filter(Boolean)) {
    ancestor = path.join(ancestor, part); const stat = await fs.lstat(ancestor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Patch capsule parent link/type rejected');
  }
  root = path.join(await fs.realpath(path.dirname(requested)), path.basename(requested));
  await directory(root, create);
  const file = path.join(root, '_store.json'); let store;
  try { store = json(await read(file, 1024)); }
  catch (e) {
    if (e.code !== 'ENOENT' || !create) throw e;
    // Never claim an existing unowned archive or delete its unknown files.
    if ((await fs.readdir(root)).length) fail('Unowned patch capsule archive; preserved');
    const marker = {format: 'WorldPatchCapsuleStore', version: 1, ownerId: randomUUID()};
    try { await write(file, raw(marker)); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    store = json(await read(file, 1024));
  }
  exactKeys(store, ['format', 'version', 'ownerId'], 'patch capsule store');
  if (store.format !== 'WorldPatchCapsuleStore' || store.version !== 1 || !uuid.test(store.ownerId)) fail('Patch capsule store ownership rejected');
  return {root, store};
}
function publicReceipt(manifest) {
  const {ownerId, files, ...content} = manifest;
  // No source snapshot, model prompt, record owner, file path or SEND token.
  return {format: 'FrozenWorldPatchTaskReceipt', version: 1, capsuleId: content.capsuleId,
    manifestHash: content.manifestHash, contextId: content.contextId, frozenAt: content.frozenAt,
    recordExpiresAt: content.recordExpiresAt, recordHash: content.recordHash,
    payloadSha256: content.payloadSha256, snapshotHash: content.snapshotHash, selectionHash: content.selectionHash,
    summaryHash: content.summaryHash, taskDisclosureHash: content.taskDisclosureHash, taskHash: content.taskHash,
    requestHash: content.requestHash, disclosureHash: content.disclosureHash, promptSha256: content.promptSha256,
    confirmationHash: content.confirmationHash, reviewHash: content.reviewHash, recipient: content.recipient,
    maximumCalls: 1, bytes: content.bytes, state: 'frozen-not-sent', sourceAuthority: content.sourceAuthority,
    summaryConsentTransferable: false, modelSent: false, sendingImplemented: false,
    serverBaselineVerified: false, canAuthorizePlacement: false};
}
async function committed(root, store, capsuleId) {
  if (!PATCH_CAPSULE_ID.test(capsuleId)) fail('Invalid patch capsule identity', 400);
  const dir = path.join(root, capsuleId); await directory(dir);
  const entries = await fs.readdir(dir);
  if (entries.length !== names.length + 1 || entries.some(name => !names.includes(name) && name !== 'manifest.json')) fail('Incomplete or unknown patch capsule; preserved, not adopted');
  const manifest = json(await read(path.join(dir, 'manifest.json'), 32768));
  exactKeys(manifest, ['format', 'version', 'ownerId', 'capsuleId', 'contextId', 'frozenAt', 'recordExpiresAt',
    'recordHash', 'payloadSha256', 'snapshotHash', 'selectionHash', 'summaryHash', 'taskDisclosureHash', 'taskHash',
    'requestHash', 'disclosureHash', 'promptSha256', 'confirmationHash', 'reviewHash', 'recipient', 'maximumCalls',
    'bytes', 'files', 'state', 'sourceAuthority', 'summaryConsentTransferable', 'modelSent', 'sendingImplemented',
    'serverBaselineVerified', 'canAuthorizePlacement', 'manifestHash'], 'patch capsule manifest');
  const {manifestHash, ...content} = manifest;
  if (manifest.format !== 'FrozenWorldPatchTaskCapsule' || manifest.version !== 1 || manifest.ownerId !== store.ownerId
    || manifest.capsuleId !== capsuleId || !uuid.test(manifest.contextId) || contextHash(content) !== manifestHash
    || manifest.state !== 'frozen-not-sent' || manifest.maximumCalls !== 1 || manifest.modelSent !== false
    || manifest.sendingImplemented !== false || manifest.canAuthorizePlacement !== false || manifest.serverBaselineVerified !== false
    || manifest.summaryConsentTransferable !== false || manifest.sourceAuthority !== 'client-submitted-block-facts-not-a-server-signature'
    || !Number.isSafeInteger(manifest.frozenAt) || manifest.frozenAt > Date.now()
    || !Number.isSafeInteger(manifest.recordExpiresAt) || manifest.frozenAt >= manifest.recordExpiresAt
    || !Number.isSafeInteger(manifest.bytes) || manifest.bytes < 1 || manifest.bytes > WORLD_PATCH_CAPSULE_LIMITS.bytes
    || !Array.isArray(manifest.files) || manifest.files.length !== names.length) fail('Patch capsule manifest integrity rejected; preserved');
  const sources = {}; let bytes = 0;
  for (const [i, entry] of manifest.files.entries()) {
    exactKeys(entry, ['path', 'bytes', 'sha256'], 'patch capsule file inventory');
    if (entry.path !== names[i] || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > maximums[entry.path]
      || !PATCH_CAPSULE_ID.test(entry.sha256)) fail('Patch capsule file inventory rejected');
    const value = await read(path.join(dir, entry.path), maximums[entry.path]);
    if (value.length !== entry.bytes || sha(value) !== entry.sha256) fail('Patch capsule source hash mismatch; preserved');
    sources[entry.path] = value; bytes += value.length;
  }
  if (bytes !== manifest.bytes) fail('Patch capsule byte accounting rejected');
  const marker = json(sources['_owner.json']);
  exactKeys(marker, ['format', 'version', 'ownerId', 'capsuleId', 'contextId'], 'patch capsule owner');
  if (marker.format !== 'WorldPatchCapsuleOwner' || marker.version !== 1 || marker.ownerId !== store.ownerId
    || marker.capsuleId !== capsuleId || marker.contextId !== manifest.contextId) fail('Patch capsule owner binding rejected');
  return {manifest, sources};
}
function verifyOriginal({manifest, sources}) {
  const record = json(sources['record.json']), sourceOwner = json(sources['context-owner.json']), sourceStore = json(sources['context-store.json']);
  exactKeys(sourceStore, ['format', 'version', 'ownerId'], 'original context store');
  exactKeys(sourceOwner, ['format', 'version', 'ownerId', 'id'], 'original context owner');
  exactKeys(record, ['format', 'version', 'ownerId', 'id', 'createdAt', 'expiresAt', 'payloadSha256', 'payloadBytes',
    'snapshotHash', 'selectionHash', 'summaryHash', 'identity', 'totalCells', 'knownCells', 'unknownCells',
    'sourceAuthority', 'privacy', 'modelSent', 'canAuthorizePlacement', 'recordHash'], 'original context record');
  const {recordHash, ...recordContent} = record;
  if (sourceStore.format !== 'WorldContextStore' || sourceStore.version !== 1 || !uuid.test(sourceStore.ownerId)
    || sourceOwner.format !== 'WorldContextOwner' || sourceOwner.version !== 1 || sourceOwner.ownerId !== sourceStore.ownerId
    || sourceOwner.id !== manifest.contextId || record.ownerId !== sourceOwner.ownerId || record.id !== sourceOwner.id
    || record.format !== 'SavedWorldContext' || record.version !== 1 || contextHash(recordContent) !== recordHash
    || recordHash !== manifest.recordHash || record.expiresAt !== manifest.recordExpiresAt
    || !Number.isSafeInteger(record.createdAt) || record.createdAt > manifest.frozenAt
    || record.expiresAt !== record.createdAt + 24 * 60 * 60 * 1000 || record.modelSent !== false
    || record.canAuthorizePlacement !== false || record.privacy !== 'block-states-only' || record.sourceAuthority !== manifest.sourceAuthority
    || record.payloadBytes !== sources['payload.json'].length || record.payloadSha256 !== sha(sources['payload.json'])
    || record.payloadSha256 !== manifest.payloadSha256) fail('Original frozen context ownership/payload binding rejected');
  const payload = json(sources['payload.json']); exactKeys(payload, ['selection', 'capture'], 'original context payload');
  const rebuilt = createContextSnapshot(payload.selection, payload.capture), snapshot = validateContextSnapshot(json(sources['snapshot.json']));
  if (contextHash(snapshot) !== contextHash(rebuilt) || snapshot.snapshotHash !== record.snapshotHash
    || snapshot.snapshotHash !== manifest.snapshotHash || snapshot.selectionHash !== record.selectionHash
    || snapshot.selectionHash !== manifest.selectionHash) fail('Original frozen snapshot binding rejected');
  const summary = json(sources['summary.json']), computed = summarizeContextSnapshot(snapshot);
  const identity = {worldId: snapshot.selection.world.worldId, dimension: snapshot.selection.world.dimension,
    selectionRevision: snapshot.selection.revision, contextRevision: snapshot.fence.end};
  if (contextHash(summary) !== contextHash(computed) || summary.summaryHash !== record.summaryHash || summary.summaryHash !== manifest.summaryHash
    || contextHash(identity) !== contextHash(record.identity) || record.totalCells !== summary.totalCells
    || record.knownCells !== summary.knownCells || record.unknownCells !== summary.unknownCells) fail('Original frozen summary/identity binding rejected');
  const prepared = json(sources['task-disclosure.json']), confirmation = json(sources['confirmation.json']), review = json(sources['review.json']);
  const {ownerId, ...publicRecord} = record;
  validateFrozenSavedWorldPatchTask({record: publicRecord, snapshot, summary}, prepared, confirmation, review, manifest.frozenAt);
  if (manifest.taskDisclosureHash !== prepared.taskDisclosureHash || manifest.taskHash !== prepared.taskHash
    || manifest.requestHash !== prepared.task.requestHash || manifest.disclosureHash !== prepared.task.disclosure.disclosureHash
    || manifest.promptSha256 !== prepared.task.request.promptSha256 || manifest.confirmationHash !== contextHash(confirmation)
    || manifest.reviewHash !== review.reviewHash || contextHash(manifest.recipient) !== contextHash(prepared.task.disclosure.recipient)
    || manifest.capsuleId !== contextHash({version: 1, contextId: record.id, recordHash, taskDisclosureHash: prepared.taskDisclosureHash,
      confirmationHash: manifest.confirmationHash, reviewHash: review.reviewHash})) fail('Frozen task/confirmation identity rejected');
  return {snapshot, summary, prepared, review};
}

/** Reopen the committed ORIGINAL files, even after source capture expiration
 * or discard. This audit receipt cannot be used as fresh capture/send consent.
 * No public API returns the private capsule contents. */
export async function readFrozenWorldPatchTaskCapsule({root, capsuleId}) {
  const opened = await openStore(root, false), result = await committed(opened.root, opened.store, capsuleId);
  verifyOriginal(result); return publicReceipt(result.manifest);
}

/** INTERNAL worker/runner source access. Never register this result as an HTTP
 * response. Heavy source reconstruction remains on the worker lane. Returning
 * original private data does not reserve a call or attest the current world. */
export async function readFrozenWorldPatchTaskSource({root, capsuleId}) {
  const opened = await openStore(root, false), result = await committed(opened.root, opened.store, capsuleId);
  const original = verifyOriginal(result);
  return {...original, receipt: publicReceipt(result.manifest)};
}

export async function freezeSavedWorldPatchTask({root, saved, intent, confirmation}) {
  const {ownerId, ...record} = saved.record, publicSaved = {record, snapshot: saved.snapshot, summary: saved.summary};
  const prepared = prepareSavedWorldPatchTaskDisclosure(publicSaved, intent);
  const review = reviewSavedWorldPatchTaskDisclosure(publicSaved, intent, confirmation);
  const confirmationHash = contextHash(confirmation), capsuleId = contextHash({version: 1, contextId: record.id,
    recordHash: record.recordHash, taskDisclosureHash: prepared.taskDisclosureHash, confirmationHash, reviewHash: review.reviewHash});
  const opened = await openStore(root, true); root = opened.root; const store = opened.store;
  try {
    await fs.lstat(path.join(root, capsuleId));
    const existing = await committed(root, store, capsuleId); verifyOriginal(existing);
    return publicReceipt(existing.manifest);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Serialize new publications across Bridge processes. Never take a lock
  // over by age/PID, or silently clear a crashed writer's partial archive.
  const lockFile = path.join(root, '_publish.lock'), lockBytes = raw({format: 'WorldPatchCapsulePublication', version: 1,
    ownerId: store.ownerId, capsuleId, publicationId: randomUUID()});
  try { await write(lockFile, lockBytes); }
  catch (error) { if (error.code === 'EEXIST') fail('Patch capsule publication pending/unknown; preserved, no takeover'); throw error; }
  try {
    let count = 0, total = 0;
    for (const name of await fs.readdir(root)) {
      if (['_store.json', '_publish.lock'].includes(name)) continue;
      if (!PATCH_CAPSULE_ID.test(name)) fail('Unknown patch archive entry; preserved');
      const existing = await committed(root, store, name); count++; total += existing.manifest.bytes;
    }
    const marker = {format: 'WorldPatchCapsuleOwner', version: 1, ownerId: store.ownerId, capsuleId, contextId: record.id};
    const values = {'_owner.json': marker, 'context-owner.json': saved.contextOwner,
      'context-store.json': saved.contextStore, 'payload.json': Buffer.from(saved.payload), 'record.json': saved.record,
      'snapshot.json': saved.snapshot, 'summary.json': saved.summary, 'task-disclosure.json': prepared,
      'confirmation.json': confirmation, 'review.json': review};
    const buffers = Object.fromEntries(names.map(name => [name, raw(values[name])])), files = names.map(name => ({path: name, bytes: buffers[name].length, sha256: sha(buffers[name])}));
    if (files.some(f => !f.bytes || f.bytes > maximums[f.path])) fail('Patch capsule source byte quota exceeded', 413);
    const bytes = files.reduce((sum, f) => sum + f.bytes, 0);
    if (count >= WORLD_PATCH_CAPSULE_LIMITS.records || total + bytes > WORLD_PATCH_CAPSULE_LIMITS.bytes) fail('Patch capsule archive quota reached; nothing evicted', 429);
    const frozenAt = Date.now(), content = {format: 'FrozenWorldPatchTaskCapsule', version: 1, ownerId: store.ownerId, capsuleId,
      contextId: record.id, frozenAt, recordExpiresAt: record.expiresAt, recordHash: record.recordHash, payloadSha256: record.payloadSha256,
      snapshotHash: record.snapshotHash, selectionHash: record.selectionHash, summaryHash: record.summaryHash,
      taskDisclosureHash: prepared.taskDisclosureHash, taskHash: prepared.taskHash, requestHash: prepared.task.requestHash,
      disclosureHash: prepared.task.disclosure.disclosureHash, promptSha256: prepared.task.request.promptSha256,
      confirmationHash, reviewHash: review.reviewHash, recipient: prepared.task.disclosure.recipient, maximumCalls: 1,
      bytes, files, state: 'frozen-not-sent', sourceAuthority: record.sourceAuthority, summaryConsentTransferable: false,
      modelSent: false, sendingImplemented: false, serverBaselineVerified: false, canAuthorizePlacement: false};
    const manifest = {...content, manifestHash: contextHash(content)};
    // Independently rebuild before publication; supplied saved objects are NOT
    // an escape hatch around original payload and source ownership checks.
    verifyOriginal({manifest, sources: buffers});
    const dir = path.join(root, capsuleId);
    try { await fs.mkdir(dir, {mode: 0o700}); } catch (error) { if (error.code === 'EEXIST') fail('Concurrent patch capsule exists; preserved, not adopted'); throw error; }
    await directory(dir);
    for (const name of names) await write(path.join(dir, name), buffers[name]);
    if (record.expiresAt <= Date.now()) fail('Patch context expired before publication; incomplete capsule preserved');
    // Last file is the commit marker. Partial writes are NEVER automatically
    // adopted, removed, rewritten, or converted into a dispatch reservation.
    await write(path.join(dir, 'manifest.json'), raw(manifest));
    const result = await committed(root, store, capsuleId);
    return publicReceipt(result.manifest);
  } finally {
    // Release ONLY this exact lock. Interrupted workers leave their claim for
    // explicit future recovery; they never infer process death from a PID.
    const current = await read(lockFile, 2048);
    if (!current.equals(lockBytes)) fail('Patch publication lock changed; preserved');
    await fs.unlink(lockFile);
  }
}
