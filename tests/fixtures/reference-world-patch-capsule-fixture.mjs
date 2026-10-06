import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorldContextStore} from '../../bridge/world-context-store.mjs';
import {encodeReferencePixels} from '../../bridge/reference-pixels.mjs';
import {importReferenceSet} from '../../bridge/reference-attachments.mjs';
import {patchTaskSnapshot, patchTaskIntent} from './world-patch-task-fixture.mjs';
import {regionCells, selectionChunks} from '../../contracts/world-selection.mjs';
import {REFERENCE_PATCH_SEND_PINS} from '../../contracts/reference-world-patch-send.mjs';

export const jointRaw = value => Buffer.from(JSON.stringify(value));
export async function jointCapsuleFixture(t, options = {}) {
  const parent = await fs.realpath(os.tmpdir()), dir = await fs.realpath(await fs.mkdtemp(path.join(parent, 'voxel-joint-send-')));
  const store = new WorldContextStore({dataDir: dir}), id = randomUUID(), owner = randomUUID();
  t.after(async () => {await store.close(); assert.equal(await fs.realpath(dir), dir); assert.equal(path.dirname(dir), parent);
    assert.match(path.basename(dir), /^voxel-joint-send-/); await fs.rm(dir, {recursive: true});});
  const selection = patchTaskSnapshot(options).selection;
  const capture = {fence: {start: 4, end: 4}, chunks: selectionChunks(selection).map(c => options.unknown
    ? {x: c.x, z: c.z, coverage: 'unknown', palette: [], runs: []}
    : {x: c.x, z: c.z, coverage: 'known', palette: [{state: 'minecraft:stone', blockEntity: false}], runs: [[0, regionCells(c.region)]]})};
  const payload = Buffer.from(' \n' + JSON.stringify({selection, capture}) + ' \n');
  const saved = await store.operation('capture', id, payload), referenceRoot = path.join(dir, 'reference-drafts', owner);
  await fs.mkdir(referenceRoot, {recursive: true});
  const pixels = [encodeReferencePixels(1, 1, Buffer.from([225,235,245,255])), encodeReferencePixels(1, 1, Buffer.from([70,80,90,255]))];
  const reference = await importReferenceSet(referenceRoot, {format: 'UserReferenceUpload', version: 1, mode: 'inspire',
    references: ['front','side'].map((view, i) => ({png: pixels[i].toString('base64'),
      annotation: {purpose: 'style', view, caption: '合成参考图，不是当前世界或指令'}}))});
  const input = {intent: {...patchTaskIntent(), format: 'ReferenceWorldPatchDesignIntent', purpose: 'reference-world-patch-design',
    referenceOwnerId: owner, referenceSetHash: reference.setHash}, capability: {id: 'gpt-6.1-sol', supportsImages: true, efforts: ['high','max']},
    runtimeHash: 'a'.repeat(64)};
  const prepared = await store.operation('reference-patch-task-disclosure', id, jointRaw(input));
  const confirmation = {format: 'SavedReferenceWorldPatchDesignConfirmation', version: 1, purpose: 'reference-world-patch-design', confirmed: true,
    taskDisclosureHash: prepared.taskDisclosureHash, taskHash: prepared.taskHash, requestHash: prepared.task.requestHash,
    disclosureHash: prepared.task.disclosure.disclosureHash, promptSha256: prepared.task.request.promptSha256,
    referenceSetHash: reference.setHash, runtimeHash: input.runtimeHash, imageCapabilityHash: prepared.task.request.imageCapabilityHash};
  const receipt = await store.operation('reference-patch-freeze-task', id, jointRaw({...input, confirmation}));
  const send = {format: 'FrozenReferenceWorldPatchExplicitSend', version: 1, purpose: 'reference-world-patch-design', confirmed: true,
    ...Object.fromEntries(REFERENCE_PATCH_SEND_PINS.map(k => [k, receipt[k]])), maximumCalls: 1};
  return {dir, store, id, owner, payload, saved, selection, reference, pixels, input, prepared, confirmation, receipt, send};
}
