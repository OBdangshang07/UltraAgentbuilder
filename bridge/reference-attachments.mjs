import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {hash} from '../src/generation/compiler.mjs';
import {safeEvidenceFile} from './native-evidence.mjs';
import {normalizeReferencePng} from './reference-pixels.mjs';
import {REFERENCE_LIMITS as limits, REFERENCE_OWNER, REFERENCE_MODES,
  referenceUpload, referenceAnnotation, referenceConfirmation, REFERENCE_DATA_RULE} from '../contracts/reference-attachments.mjs';

const digest = /^[a-f0-9]{64}$/;
async function owner(directory) {
  const root = path.resolve(directory);
  assert.match(path.basename(root), REFERENCE_OWNER, 'Explicit current task/draft UUID required');
  assert.equal(await fs.realpath(root), root); const stat = await fs.lstat(root);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink()); return {root, ownerId: path.basename(root)};
}
async function immutable(file, bytes) {
  try { await fs.writeFile(file, bytes, {flag: 'wx', mode: 0o600}); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = await fs.lstat(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size === bytes.length);
    assert.ok((await fs.readFile(file)).equals(bytes), 'Reference identity conflict');
  }
}
export function previewReferenceSet(ownerId,upload){
  assert.match(ownerId,REFERENCE_OWNER);referenceUpload(upload);const references=[],images=[];
  let pixels = 0, bytes = 0;
  for (const [i, item] of upload.references.entries()) {
    const image = normalizeReferencePng(Buffer.from(item.png, 'base64'));
    pixels += image.pixels; bytes += image.bytes.length;
    assert.ok(pixels <= limits.pixelsPerSet && bytes <= limits.bytesPerSet, 'Reference set quota exceeded');
    const annotation = referenceAnnotation(item.annotation), record = {file: `image-${i}.png`, sha256: image.sha256,
      width: image.width, height: image.height, bytes: image.bytes.length, annotation};
    references.push({...record, id: hash(record)}); images.push(image.bytes);
  }
  const content = {format: 'UserReferenceSet', version: 1, ownerId, mode: upload.mode, references,
    pixels, bytes, metadataRemoved: true, untrustedData: true, worldCaptured: false, canAuthorizePlacement: false};
  return {manifest:{...content,setHash:hash(content)},images};
}
export async function importReferenceSet(directory, upload) {
  const {root,ownerId}=await owner(directory),{manifest,images}=previewReferenceSet(ownerId,upload),setHash=manifest.setHash;
  const folder = path.join(root, 'reference-sets', setHash);
  for (const dir of [path.dirname(folder), folder]) {
    await fs.mkdir(dir, {recursive: false}).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const stat = await fs.lstat(dir); assert.ok(stat.isDirectory() && !stat.isSymbolicLink()); assert.equal(await fs.realpath(dir), dir);
  }
  for (const [i, image] of images.entries()) await immutable(path.join(folder, `image-${i}.png`), image);
  // Final manifest is committed last. Partial imports are not sendable.
  await immutable(path.join(folder, 'manifest.json'), Buffer.from(JSON.stringify(manifest)));
  return (await readReferenceSet(root, setHash)).manifest;
}
export async function readReferenceSet(directory, setHash) {
  const {root, ownerId} = await owner(directory); assert.match(setHash, digest);
  const prefix = `reference-sets/${setHash}`, manifest = JSON.parse((await safeEvidenceFile(root, prefix + '/manifest.json', 65536)).toString('utf8'));
  const {setHash: saved, ...content} = manifest;
  assert.deepEqual(Object.keys(content).sort(), ['format','version','ownerId','mode','references','pixels','bytes','metadataRemoved','untrustedData','worldCaptured','canAuthorizePlacement'].sort(), 'Unknown reference manifest fields');
  assert.equal(saved, setHash); assert.equal(hash(content), setHash);
  assert.equal(content.format, 'UserReferenceSet'); assert.equal(content.version, 1); assert.equal(content.ownerId, ownerId);
  assert.ok(REFERENCE_MODES.includes(content.mode));
  assert.equal(content.metadataRemoved, true); assert.equal(content.untrustedData, true);
  assert.equal(content.worldCaptured, false); assert.equal(content.canAuthorizePlacement, false);
  assert.ok(Array.isArray(content.references) && content.references.length > 0 && content.references.length <= limits.images);
  let pixels = 0, bytes = 0; const images = [];
  for (const [i, record] of content.references.entries()) {
    assert.deepEqual(Object.keys(record).sort(), ['id','file','sha256','width','height','bytes','annotation'].sort(), 'Unknown reference image fields');
    const {id, ...data} = record; assert.equal(id, hash(data)); assert.equal(record.file, `image-${i}.png`);
    referenceAnnotation(record.annotation);
    const png = await safeEvidenceFile(root, prefix + '/' + record.file, limits.bytesPerImage), decoded = normalizeReferencePng(png);
    assert.equal(hash(png), record.sha256); assert.equal(decoded.sha256, record.sha256, 'Reference is not canonical');
    assert.equal(decoded.width, record.width); assert.equal(decoded.height, record.height); assert.equal(png.length, record.bytes);
    pixels += decoded.pixels; bytes += png.length; images.push(path.join(root, prefix, record.file));
  }
  assert.ok(pixels <= limits.pixelsPerSet && bytes <= limits.bytesPerSet); assert.equal(pixels, content.pixels); assert.equal(bytes, content.bytes);
  return {manifest, images};
}
export async function prepareReferenceModelInput({directory, setHash, requestHash, provider, model, capability, confirmation}) {
  referenceConfirmation(confirmation);
  const reference = await readReferenceSet(directory, setHash);
  for (const [key, value] of Object.entries({ownerId: reference.manifest.ownerId, setHash, requestHash, provider, model}))
    assert.equal(confirmation[key], value, 'Reference confirmation no longer matches selected input');
  assert.equal(capability?.id, model); assert.equal(capability.supportsImages, true, 'Selected model has not advertised image input');
  // Pure preparation: no provider calls, POSTs, world writes or native review.
  return {...reference, rules: REFERENCE_DATA_RULE, sendingAuthorizedForRequest: requestHash,
    additionalModelCalls: 0, canAuthorizePlacement: false};
}
