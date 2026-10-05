import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {exactKeys, WORLD_SELECTION_LIMITS} from '../contracts/world-selection.mjs';
import {REFERENCE_OWNER, REFERENCE_LIMITS} from '../contracts/reference-attachments.mjs';
import {createContextSnapshot, validateContextSnapshot, contextHash} from '../src/world/context-snapshot.mjs';
import {summarizeContextSnapshot} from '../src/world/context-summary.mjs';
import {assertReferenceDraftWritable} from './reference-archive.mjs';

// INTERNAL read-only source helper. Never return this private value over HTTP.
// Fixed stored IDs only; no caller paths, uploads, URLs, accounts or write API.
const digest = /^[a-f0-9]{64}$/;
const uuid = value => typeof value === 'string' && REFERENCE_OWNER.test(value);
const fail = message => {throw Error(message);};
const decode = bytes => JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function canonicalDirectory(target) {
  target = path.resolve(target); let ancestor = path.parse(target).root;
  for (const part of ['', ...path.relative(ancestor, target).split(path.sep).filter(Boolean)]) {
    ancestor = path.join(ancestor, part); const stat = await fs.lstat(ancestor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Joint source directory link/type forbidden; preserved');
  }
  return fs.realpath(target);
}
async function read(target, maximum) {
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > maximum
    || path.resolve(await fs.realpath(target)).toLowerCase() !== path.resolve(target).toLowerCase()) {
    fail('Joint source file link/type/size rejected; preserved');
  }
  const handle = await fs.open(target, 'r');
  try {
    const opened = await handle.stat();
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size || opened.nlink !== 1
      || opened.mtimeMs !== stat.mtimeMs || opened.ctimeMs !== stat.ctimeMs) fail('Joint source changed while opening');
    const bytes = Buffer.alloc(stat.size + 1); let total = 0;
    while (total < bytes.length) {const result = await handle.read(bytes, total, bytes.length - total, total); if (!result.bytesRead) break; total += result.bytesRead;}
    const after = await handle.stat(), current = await fs.lstat(target);
    if (total !== stat.size || after.size !== stat.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
      || current.dev !== stat.dev || current.ino !== stat.ino || current.size !== stat.size || current.nlink !== 1
      || current.isSymbolicLink() || current.mtimeMs !== opened.mtimeMs || current.ctimeMs !== opened.ctimeMs
      || path.resolve(await fs.realpath(target)).toLowerCase() !== path.resolve(target).toLowerCase()) {
      fail('Joint source changed while reading; preserved');
    }
    return bytes.subarray(0, total);
  } finally {await handle.close();}
}
async function json(target, maximum) {return decode(await read(target, maximum));}

export async function readReferenceWorldPatchPreparationSource({dataDir, contextId, intent}) {
  if (!uuid(contextId) || !uuid(intent?.referenceOwnerId) || typeof intent.referenceSetHash !== 'string'
    || !digest.test(intent.referenceSetHash)) fail('Exact stored joint context/reference identities required');
  dataDir = await canonicalDirectory(dataDir);
  const contextRoot = await canonicalDirectory(path.join(dataDir, 'world-contexts'));
  const folder = await canonicalDirectory(path.join(contextRoot, contextId));
  const maxima = {'_owner.json': 1024, 'payload.json': WORLD_SELECTION_LIMITS.snapshotBytes,
    'snapshot.json': WORLD_SELECTION_LIMITS.snapshotBytes, 'summary.json': 1048576, 'record.json': 16384};
  const entries = await fs.readdir(folder);
  if (entries.length !== Object.keys(maxima).length || entries.some(name => !Object.hasOwn(maxima, name))) fail('Incomplete/unknown original joint context files; preserved');
  const store = await json(path.join(contextRoot, '_store.json'), 1024);
  const marker = await json(path.join(folder, '_owner.json'), maxima['_owner.json']);
  const record = await json(path.join(folder, 'record.json'), maxima['record.json']);
  exactKeys(store, ['format','version','ownerId'], 'joint original context store');
  exactKeys(marker, ['format','version','ownerId','id'], 'joint original context owner');
  exactKeys(record, ['format','version','ownerId','id','createdAt','expiresAt','payloadSha256','payloadBytes',
    'snapshotHash','selectionHash','summaryHash','identity','totalCells','knownCells','unknownCells',
    'sourceAuthority','privacy','modelSent','canAuthorizePlacement','recordHash'], 'joint original context record');
  const {recordHash, ...recordContent} = record;
  if (store.format !== 'WorldContextStore' || store.version !== 1 || !uuid(store.ownerId)
    || marker.format !== 'WorldContextOwner' || marker.version !== 1 || marker.ownerId !== store.ownerId || marker.id !== contextId
    || record.format !== 'SavedWorldContext' || record.version !== 1 || record.ownerId !== store.ownerId || record.id !== contextId
    || contextHash(recordContent) !== recordHash || !Number.isSafeInteger(record.createdAt) || record.createdAt < 0
    || record.createdAt > Date.now() || record.expiresAt !== record.createdAt + 24 * 60 * 60 * 1000
    || record.modelSent !== false || record.canAuthorizePlacement !== false
    || record.sourceAuthority !== 'client-submitted-block-facts-not-a-server-signature' || record.privacy !== 'block-states-only') {
    fail('Original joint context ownership/record binding rejected');
  }
  if (record.expiresAt <= Date.now()) fail('Joint original context expired; reread the environment');
  const payloadBytes = await read(path.join(folder, 'payload.json'), maxima['payload.json']);
  if (payloadBytes.length !== record.payloadBytes || sha(payloadBytes) !== record.payloadSha256) fail('Original joint context payload mismatch');
  const payload = decode(payloadBytes); exactKeys(payload, ['selection','capture'], 'joint original context payload');
  const rebuilt = createContextSnapshot(payload.selection, payload.capture);
  const snapshot = validateContextSnapshot(await json(path.join(folder, 'snapshot.json'), maxima['snapshot.json']));
  if (contextHash(snapshot) !== contextHash(rebuilt) || snapshot.snapshotHash !== record.snapshotHash
    || snapshot.selectionHash !== record.selectionHash) fail('Original joint context snapshot mismatch');
  const summary = await json(path.join(folder, 'summary.json'), maxima['summary.json']), computed = summarizeContextSnapshot(snapshot);
  const identity = {worldId: snapshot.selection.world.worldId, dimension: snapshot.selection.world.dimension,
    selectionRevision: snapshot.selection.revision, contextRevision: snapshot.fence.end};
  if (contextHash(summary) !== contextHash(computed) || summary.summaryHash !== record.summaryHash
    || contextHash(identity) !== contextHash(record.identity) || record.totalCells !== summary.totalCells
    || record.knownCells !== summary.knownCells || record.unknownCells !== summary.unknownCells) fail('Original joint context identity/summary mismatch');

  await assertReferenceDraftWritable(dataDir, intent.referenceOwnerId);
  const referenceRoot = await canonicalDirectory(path.join(dataDir, 'reference-drafts', intent.referenceOwnerId));
  const setFolder = await canonicalDirectory(path.join(referenceRoot, 'reference-sets', intent.referenceSetHash));
  const manifest = await json(path.join(setFolder, 'manifest.json'), 65536);
  if (!Array.isArray(manifest.references) || manifest.references.length < 1 || manifest.references.length > REFERENCE_LIMITS.images) fail('Bounded original joint reference manifest required');
  const expectedNames = ['manifest.json', ...manifest.references.map((_, i) => `image-${i}.png`)];
  const referenceEntries = await fs.readdir(setFolder);
  if (referenceEntries.length !== expectedNames.length || referenceEntries.some(name => !expectedNames.includes(name))) fail('Incomplete/unknown joint reference files; preserved');
  const images = []; let imageBytes = 0;
  for (let i = 0; i < manifest.references.length; i++) {
    const image = await read(path.join(setFolder, `image-${i}.png`), Math.min(REFERENCE_LIMITS.bytesPerImage, REFERENCE_LIMITS.bytesPerSet - imageBytes));
    imageBytes += image.length; images.push(image);
  }
  // The joint preparation redecodes these exact bytes and checks the complete
  // canonical manifest, IDs, quotas, annotations and selected set/owner hash.
  if (record.expiresAt <= Date.now()) fail('Joint original context expired during source reading');
  const {ownerId, ...publicRecord} = record;
  return {saved: {record: publicRecord, snapshot, summary}, reference: {manifest, images}};
}
