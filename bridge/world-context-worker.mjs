import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {workerData, parentPort} from 'node:worker_threads';
import {exactKeys} from '../contracts/world-selection.mjs';
import {contextHash, createContextSnapshot, validateContextSnapshot} from '../src/world/context-snapshot.mjs';
import {summarizeContextSnapshot} from '../src/world/context-summary.mjs';
import {contextDisclosure} from './world-context-consent.mjs';
import {prepareContextTaskDisclosure} from './world-context-task.mjs';
import {prepareContextAnalysisInput} from './world-context-analysis-input.mjs';
import {prepareSavedWorldPatchTaskDisclosure, reviewSavedWorldPatchTaskDisclosure} from './world-patch-task-disclosure.mjs';
import {freezeSavedWorldPatchTask, readFrozenWorldPatchTaskCapsule} from './world-patch-task-capsule.mjs';
import {prepareFrozenWorldPatchSendInput} from './world-patch-send-input.mjs';

const {operation, id, payload, limits} = workerData;
const requestedRoot = workerData.root;
const jointPreparation = ['reference-patch-task-disclosure', 'reference-patch-review-task', 'reference-patch-freeze-task'].includes(operation);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const pending = /^\.pending-([a-f0-9-]{36})-([a-f0-9-]{36})$/;
const files = ['_owner.json', 'payload.json', 'snapshot.json', 'summary.json', 'record.json'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), {statusCode}); };
async function directory(target, create = false) {
  if (create) try { await fs.mkdir(target, {mode: 0o700}); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.resolve(await fs.realpath(target)).toLowerCase() !== path.resolve(target).toLowerCase()) fail('Context directory must be private and not a link');
}
async function read(target, maximum) {
  const stat = await fs.lstat(target); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) fail('Context file type/size quota rejected');
  const handle = await fs.open(target, 'r');
  try { const bytes = Buffer.alloc(Math.min(stat.size + 1, maximum + 1)); let total = 0;
    while (total < bytes.length) { const {bytesRead} = await handle.read(bytes, total, bytes.length - total, total); if (!bytesRead) break; total += bytesRead; }
    if (total !== stat.size || total > maximum || (await handle.stat()).size !== stat.size) fail('Context file changed or exceeded quota'); return bytes.subarray(0, total); }
  finally { await handle.close(); }
}
async function json(target, maximum) { return JSON.parse(await read(target, maximum)); }
async function write(target, value) { const handle = await fs.open(target, 'wx', 0o600);
  try { await handle.writeFile(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); } }
// Legitimate Windows 8.3 aliases are not directory links. Check EVERY existing
// ancestor without following links, THEN use a canonical parent. A junction
// anywhere in the path still fails; API input never supplies a filesystem path.
const requestedParent = path.resolve(path.dirname(requestedRoot));
let ancestor = path.parse(requestedParent).root;
await directory(ancestor);
for (const part of path.relative(ancestor, requestedParent).split(path.sep).filter(Boolean)) {
  ancestor = path.join(ancestor, part);
  const stat = await fs.lstat(ancestor);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Context parent directory link forbidden');
}
const canonicalParent = await fs.realpath(requestedParent), root = path.join(canonicalParent, path.basename(requestedRoot));
await directory(canonicalParent);
let owner;
if (!['reference-patch-frozen-task','reference-patch-send-input','reference-patch-original-input','reference-patch-freeze-images','reference-patch-original-images','reference-patch-provider-input','reference-patch-provider-recheck','reference-patch-invocation-metadata'].includes(operation)) {
  await directory(root, !jointPreparation);
  try { owner = await json(path.join(root, '_store.json'), 1024); }
  catch (e) { if (e.code !== 'ENOENT' || jointPreparation) throw e; owner = {format: 'WorldContextStore', version: 1, ownerId: randomUUID()}; await write(path.join(root, '_store.json'), owner); }
  exactKeys(owner, ['format', 'version', 'ownerId'], 'store owner');
  if (owner.format !== 'WorldContextStore' || owner.version !== 1 || !uuid.test(owner.ownerId)) fail('Invalid context store ownership');
}

async function owned(name) {
  const match = pending.exec(name), contextId = match ? match[1] : name;
  if (!uuid.test(contextId) || match && !uuid.test(match[2])) fail('Unknown directory in context store; preserved');
  const dir = path.join(root, name); await directory(dir);
  const marker = await json(path.join(dir, '_owner.json'), 1024);
  exactKeys(marker, ['format', 'version', 'ownerId', 'id'], 'context owner');
  if (marker.format !== 'WorldContextOwner' || marker.version !== 1 || marker.ownerId !== owner.ownerId || marker.id !== contextId) fail('Context owner mismatch; preserved');
  const entries = await fs.readdir(dir);
  if (entries.some(file => !files.includes(file))) fail('Unexpected context file; preserved');
  let bytes = 0; for (const file of entries) { const stat = await fs.lstat(path.join(dir, file)); if (!stat.isFile() || stat.isSymbolicLink()) fail('Unsafe context entry; preserved'); bytes += stat.size; }
  return {dir, contextId, bytes, entries};
}
async function remove(name) {
  const target = await owned(name);
  // Fixed, verified owned files only. Never recursive-delete a supplied path.
  for (const file of target.entries) await fs.unlink(path.join(target.dir, file)); await fs.rmdir(target.dir);
}
async function recordAt(name) {
  const target = await owned(name), record = await json(path.join(target.dir, 'record.json'), 16384);
  exactKeys(record, ['format', 'version', 'ownerId', 'id', 'createdAt', 'expiresAt', 'payloadSha256', 'payloadBytes', 'snapshotHash', 'selectionHash', 'summaryHash', 'identity',
    'totalCells', 'knownCells', 'unknownCells', 'sourceAuthority', 'privacy', 'modelSent', 'canAuthorizePlacement', 'recordHash'], 'saved context record');
  const {recordHash, ...content} = record;
  if (record.format !== 'SavedWorldContext' || record.version !== 1 || record.ownerId !== owner.ownerId || record.id !== target.contextId
      || record.modelSent !== false || record.canAuthorizePlacement !== false || contextHash(content) !== recordHash
      || record.sourceAuthority !== 'client-submitted-block-facts-not-a-server-signature' || record.privacy !== 'block-states-only'
      || !Number.isSafeInteger(record.createdAt) || !Number.isSafeInteger(record.expiresAt) || record.expiresAt !== record.createdAt + limits.lifetimeMs) fail('Saved context record integrity rejected');
  return {...target, record};
}
async function verify(id) {
  let saved; try { saved = await recordAt(id); } catch (e) { if (e.code === 'ENOENT') fail('Context record not found', 404); throw e; }
  const {record, dir} = saved;
  if (record.expiresAt <= Date.now()) fail('Context record expired; reread the current environment', 409);
  const raw = await read(path.join(dir, 'payload.json'), limits.inputBytes);
  if (raw.length !== record.payloadBytes || sha(raw) !== record.payloadSha256) fail('Saved context payload integrity rejected');
  const input = JSON.parse(raw); exactKeys(input, ['selection', 'capture'], 'context payload');
  const rebuilt = createContextSnapshot(input.selection, input.capture);
  const snapshot = validateContextSnapshot(await json(path.join(dir, 'snapshot.json'), limits.inputBytes));
  if (snapshot.snapshotHash !== rebuilt.snapshotHash || snapshot.snapshotHash !== record.snapshotHash || snapshot.selectionHash !== record.selectionHash) fail('Saved snapshot identity rejected');
  const summary = await json(path.join(dir, 'summary.json'), 1048576), computed = summarizeContextSnapshot(snapshot);
  if (contextHash(summary) !== contextHash(computed) || computed.summaryHash !== record.summaryHash) fail('Saved context summary integrity rejected');
  const identity = {worldId: snapshot.selection.world.worldId, dimension: snapshot.selection.world.dimension,
    selectionRevision: snapshot.selection.revision, contextRevision: snapshot.fence.end};
  if (contextHash(identity) !== contextHash(record.identity) || contextHash(snapshot.selection) !== record.selectionHash) fail('Saved context identity binding rejected');
  if (record.totalCells !== computed.totalCells || record.knownCells !== computed.knownCells || record.unknownCells !== computed.unknownCells) fail('Saved context coverage binding rejected');
  return {record, summary, snapshot, payload: raw, contextStore: owner,
    contextOwner: await json(path.join(dir, '_owner.json'), 1024)};
}
async function inventory() {
  const kept = [];
  for (const name of await fs.readdir(root)) {
    if (name === '_store.json') continue;
    if (pending.test(name)) { await remove(name); continue; }
    const entry = await recordAt(name);
    if (entry.record.expiresAt <= Date.now()) await remove(name); else kept.push(entry);
  }
  return kept;
}
function publicRecord(record) { const {ownerId, ...result} = record; return result; }
async function run() {
  const capsuleRoot = path.join(canonicalParent, 'world-patch-tasks');
  if (operation === 'reference-patch-invocation-metadata') {
    // PRIVATE bounded status audit. Full original snapshot/image rebuilding
    // stays on this worker; HTTP receives neither source chunks nor pixels.
    const bytes = Buffer.from(payload);
    if (!bytes.length || bytes.length > 128) fail('Joint invocation metadata quota', 413);
    const value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
    exactKeys(value, ['runtimeHash'], 'internal joint metadata binding');
    if (!/^[a-f0-9]{64}$/.test(value.runtimeHash ?? '')) fail('Exact joint runtime identity required');
    const dir = path.join(canonicalParent, 'reference-world-patch-invocations', id);
    try {await fs.lstat(dir);} catch (error) {if (error.code === 'ENOENT') return null; throw error;}
    const {readReferencePatchInvocation} = await import('./reference-world-patch-invocation-data.mjs');
    const saved = await readReferencePatchInvocation(dir, value.runtimeHash);
    return {directory:saved.directory, value:saved.value, source:{receipt:saved.source.receipt}};
  }
  if (['reference-patch-provider-input','reference-patch-provider-recheck'].includes(operation)) {
    // PRIVATE local preparation, not a provider dispatch. Use the same bounded
    // lane for source/pixel revalidation; do not initialize a missing store.
    const bytes = Buffer.from(payload);
    if (!bytes.length || bytes.length > 4096) fail('Joint provider preparation quota exceeded', 413);
    const value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    const rechecking = operation === 'reference-patch-provider-recheck';
    exactKeys(value, rechecking ? ['send','selected','preparationHash'] : ['send','selected'], 'private joint provider preparation');
    const {prepareReferenceWorldPatchProviderInput, recheckReferenceWorldPatchProviderInput} = await import('./reference-world-patch-provider-input.mjs');
    const input = {dataDir: canonicalParent, capsuleId: id, ...value};
    return rechecking ? recheckReferenceWorldPatchProviderInput(input) : prepareReferenceWorldPatchProviderInput(input);
  }
  if (operation === 'reference-patch-frozen-task') {
    const {readFrozenReferenceWorldPatchTaskCapsule} = await import('./reference-world-patch-task-capsule.mjs');
    return readFrozenReferenceWorldPatchTaskCapsule({dataDir: canonicalParent, capsuleId: id});
  }
  if (['reference-patch-send-input','reference-patch-original-input'].includes(operation)) {
    const bytes = Buffer.from(payload); if (!bytes.length || bytes.length > 4096) fail('Joint SEND binding quota exceeded', 413);
    const send = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    const {prepareFrozenReferenceWorldPatchSendInput} = await import('./reference-world-patch-send-input.mjs');
    return prepareFrozenReferenceWorldPatchSendInput({dataDir: canonicalParent, capsuleId: id, send,
      originalReceiptOnly: operation === 'reference-patch-original-input'});
  }
  if (['reference-patch-freeze-images','reference-patch-original-images'].includes(operation)) {
    // Internal bounded local work only, not an HTTP action or a dispatcher.
    // Termination preserves unknown claims/partial files; no takeover/retry.
    const bytes = Buffer.from(payload); if (!bytes.length || bytes.length > 4096) fail('Joint image SEND binding quota exceeded', 413);
    const send = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    const {freezeReferenceWorldPatchTaskImages, readReferenceWorldPatchTaskImages} = await import('./reference-world-patch-task-images.mjs');
    const input = {dataDir: canonicalParent, capsuleId: id, send};
    return operation === 'reference-patch-freeze-images' ? freezeReferenceWorldPatchTaskImages(input) : readReferenceWorldPatchTaskImages(input);
  }
  if (operation === 'reference-patch-freeze-task') {
    const bytes = Buffer.from(payload); if (!bytes.length || bytes.length > 32768) fail('Joint freeze binding quota exceeded', 413);
    const value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    exactKeys(value, ['intent','capability','runtimeHash','confirmation'], 'joint original capsule freeze');
    const {confirmation, ...input} = value;
    const {freezeReferenceWorldPatchTask} = await import('./reference-world-patch-task-capsule.mjs');
    return freezeReferenceWorldPatchTask({dataDir: canonicalParent, contextId: id, input, confirmation});
  }
  if (['reference-patch-task-disclosure', 'reference-patch-review-task'].includes(operation)) {
    // Internal preparation only. This branch adds no HTTP route, adapter,
    // reservation, capsule publication or world write; freeze is separate.
    // Capabilities here are bound advertisements, not provider receipts.
    const bytes = Buffer.from(payload);
    if (!bytes.length || bytes.length > 32768) fail('Joint context task binding quota exceeded', 413);
    const input = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    const reviewing = operation === 'reference-patch-review-task';
    exactKeys(input, reviewing ? ['intent','capability','runtimeHash','confirmation'] : ['intent','capability','runtimeHash'], 'joint stored preparation input');
    const {readReferenceWorldPatchPreparationSource} = await import('./reference-world-patch-source.mjs');
    const {prepareSavedReferenceWorldPatchTaskDisclosure, reviewSavedReferenceWorldPatchTaskDisclosure} = await import('./reference-world-patch-task-disclosure.mjs');
    const source = await readReferenceWorldPatchPreparationSource({dataDir: canonicalParent, contextId: id, intent: input.intent});
    const bound = {intent: input.intent, capability: input.capability, runtimeHash: input.runtimeHash, reference: source.reference};
    return reviewing ? reviewSavedReferenceWorldPatchTaskDisclosure(source.saved, bound, input.confirmation)
      : prepareSavedReferenceWorldPatchTaskDisclosure(source.saved, bound);
  }
  if (['patch-send-input', 'patch-original-input'].includes(operation)) {
    const bytes = Buffer.from(payload);
    if (!bytes.length || bytes.length > 4096) fail('Patch SEND byte quota exceeded', 413);
    const send = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    return prepareFrozenWorldPatchSendInput({root: capsuleRoot, capsuleId: id, send,
      originalReceiptOnly: operation === 'patch-original-input'});
  }
  if (operation === 'patch-frozen-task') {
    try { return await readFrozenWorldPatchTaskCapsule({root: capsuleRoot, capsuleId: id}); }
    catch (error) { if (error.code === 'ENOENT') fail('Frozen patch task not found', 404); throw error; }
  }
  if (operation === 'get') { const result = await verify(id); return {record: publicRecord(result.record), summary: result.summary}; }
  if (['disclosure', 'task-disclosure', 'analysis-input', 'patch-task-disclosure', 'patch-review-task', 'patch-freeze-task'].includes(operation)) {
    const bytes = Buffer.from(payload); if (!bytes.length || bytes.length > (operation === 'disclosure' ? 4096 : 32768)) fail('Context task binding quota exceeded', 413);
    const saved = await verify(id);
    const task = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)), publicSaved = {record: publicRecord(saved.record), summary: saved.summary};
    if (operation === 'patch-task-disclosure') return prepareSavedWorldPatchTaskDisclosure({...publicSaved, snapshot: saved.snapshot}, task);
    if (operation === 'patch-review-task') {
      exactKeys(task, ['intent', 'confirmation'], 'independent saved patch content review');
      return reviewSavedWorldPatchTaskDisclosure({...publicSaved, snapshot: saved.snapshot}, task.intent, task.confirmation);
    }
    if (operation === 'patch-freeze-task') {
      exactKeys(task, ['intent', 'confirmation'], 'independent saved patch task freeze');
      return freezeSavedWorldPatchTask({root: capsuleRoot, saved, intent: task.intent, confirmation: task.confirmation});
    }
    return operation === 'disclosure' ? contextDisclosure(publicSaved, task) : operation === 'analysis-input' ? prepareContextAnalysisInput(publicSaved, task) : prepareContextTaskDisclosure(publicSaved, task);
  }
  if (operation === 'discard') {
    try { await remove(id); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return {id, discarded: true, modelSent: false, canAuthorizePlacement: false};
  }
  if (operation !== 'capture') fail('Unsupported context operation');
  const raw = Buffer.from(payload); if (raw.length > limits.inputBytes) fail('Context payload quota exceeded', 413);
  const input = JSON.parse(raw); exactKeys(input, ['selection', 'capture'], 'context payload');
  const snapshot = createContextSnapshot(input.selection, input.capture), summary = summarizeContextSnapshot(snapshot);
  try { await fs.lstat(path.join(root, id));
    const existing = await verify(id); if (existing.record.payloadSha256 !== sha(raw)) fail('Capture ID reused with different input', 409);
    return {record: publicRecord(existing.record), summary: existing.summary};
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const entries = await inventory(), snapshotBytes = Buffer.from(JSON.stringify(snapshot)), summaryBytes = Buffer.from(JSON.stringify(summary));
  if (snapshotBytes.length > limits.inputBytes || summaryBytes.length > 1048576) fail('Normalized context/summary byte quota exceeded', 413);
  const createdAt = Date.now(), content = {format: 'SavedWorldContext', version: 1, ownerId: owner.ownerId, id,
    createdAt, expiresAt: createdAt + limits.lifetimeMs, payloadSha256: sha(raw), payloadBytes: raw.length,
    snapshotHash: snapshot.snapshotHash, selectionHash: snapshot.selectionHash, summaryHash: summary.summaryHash,
    identity: {worldId: snapshot.selection.world.worldId, dimension: snapshot.selection.world.dimension, selectionRevision: snapshot.selection.revision, contextRevision: snapshot.fence.end},
    totalCells: summary.totalCells, knownCells: summary.knownCells, unknownCells: summary.unknownCells,
    sourceAuthority: 'client-submitted-block-facts-not-a-server-signature', privacy: 'block-states-only', modelSent: false, canAuthorizePlacement: false};
  const record = {...content, recordHash: contextHash(content)}, marker = {format: 'WorldContextOwner', version: 1, ownerId: owner.ownerId, id};
  const bytes = raw.length + snapshotBytes.length + summaryBytes.length + Buffer.byteLength(JSON.stringify(record)) + Buffer.byteLength(JSON.stringify(marker));
  if (entries.length >= limits.records || entries.reduce((n, entry) => n + entry.bytes, bytes) > limits.bytes) fail('Local context storage quota reached; explicitly discard an old snapshot', 429);
  const name = '.pending-' + id + '-' + randomUUID(), dir = path.join(root, name); await directory(dir, true);
  try {
    await write(path.join(dir, '_owner.json'), marker); await write(path.join(dir, 'payload.json'), raw);
    await write(path.join(dir, 'snapshot.json'), snapshotBytes); await write(path.join(dir, 'summary.json'), summaryBytes);
    await write(path.join(dir, 'record.json'), record); await fs.rename(dir, path.join(root, id));
  } catch (e) { await remove(name).catch(() => {}); throw e; }
  return {record: publicRecord(record), summary};
}
try { parentPort.postMessage({ok: true, result: await run()}); }
catch (error) { parentPort.postMessage({ok: false, error: error.message, statusCode: error.statusCode ?? 400}); }
