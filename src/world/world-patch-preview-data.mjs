import {WORLD_PATCH_LIMITS} from '../../contracts/world-patch.mjs';
import {exactKeys, WORLD_SELECTION_LIMITS} from '../../contracts/world-selection.mjs';
import {contextHash} from './context-snapshot.mjs';
import {validateWorldPatch} from './world-patch.mjs';

// Independent experimental preview preparation, not part of the in-flight
// Bridge runtime. No server, model, block writer or Minecraft renderer here.
const verified = new WeakSet();
const fields = ['format', 'version', 'policy', 'snapshotHash', 'selectionHash', 'patchHash',
  'world', 'selectionRevision', 'contextRevision', 'coordinateSpace', 'movable',
  'bounds', 'palette', 'sections', 'summary', 'canAuthorizePlacement',
  'serverBaselineVerified', 'physicsVerified', 'worldRendered', 'previewHash'];
const differences = ['added', 'removed', 'replaced'];
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const clone = value => structuredClone(value);
const sectionOrder = (a, b) => a.y - b.y || a.z - b.z || a.x - b.x;
const sectionPoint = (section, index) => [section.x * 16 + index % 16,
  section.y * 16 + Math.floor(index / 256), section.z * 16 + Math.floor(index / 16) % 16];

/** Sparse 16^3 sections, anchored to ORIGINAL world coordinates, not the
 * building-placement origin. A removed block carries BEFORE geometry; a
 * replacement carries both states. Omitted/KEEP cells never become deletions.
 * Run preparation/validation off the game thread when integrated later. */
export function prepareWorldPatchPreview(snapshot, patchValue, {signal} = {}) {
  signal?.throwIfAborted();
  const patch = validateWorldPatch(snapshot, patchValue, {signal});
  const palette = [...new Set(patch.writes.flatMap(w => [w.before, w.after]))].sort();
  if (palette.length > WORLD_SELECTION_LIMITS.paletteStates) throw new Error('Preview palette quota exceeded');
  const paletteIndex = new Map(palette.map((state, i) => [state, i])), sections = new Map();
  for (let i = 0; i < patch.writes.length; i++) {
    if (!(i % 1024)) signal?.throwIfAborted();
    const write = patch.writes[i], [x, y, z] = write.position.map(n => Math.floor(n / 16));
    const key = [x, y, z].join(',');
    let section = sections.get(key);
    if (!section) { section = {x, y, z, rows: []}; sections.set(key, section); }
    const local = write.position.map((n, axis) => n - [x, y, z][axis] * 16);
    const index = local[1] * 256 + local[2] * 16 + local[0];
    section.rows.push([index, paletteIndex.get(write.before), paletteIndex.get(write.after), differences.indexOf(write.difference)]);
  }
  const content = {format: 'WorldPatchPreview', version: 1, policy: 'static-patch-preview-data-v1',
    snapshotHash: patch.snapshotHash, selectionHash: patch.selectionHash, patchHash: patch.patchHash,
    world: clone(patch.world), selectionRevision: patch.selectionRevision, contextRevision: patch.contextRevision,
    coordinateSpace: 'original-world-absolute', movable: false, bounds: clone(patch.summary.bounds),
    palette, sections: [...sections.values()].sort(sectionOrder).map(s => ({...s, rows: s.rows.sort((a, b) => a[0] - b[0])})),
    summary: {writes: patch.writes.length, counts: clone(patch.summary.counts), omittedCells: 'keep',
      explicitKeeps: patch.summary.explicitKeeps},
    canAuthorizePlacement: false, serverBaselineVerified: false, physicsVerified: false, worldRendered: false};
  signal?.throwIfAborted();
  if (Buffer.byteLength(JSON.stringify(content)) + 128 > WORLD_PATCH_LIMITS.bytes) throw new Error('Preview byte quota exceeded');
  const preview = freeze({...content, previewHash: contextHash(content)});
  verified.add(preview); return preview;
}

/** An attacker-rehashed bundle still has to exactly match the original
 * verified patch. No digest-only trust, changed scope or silent rebasing. */
export function validateWorldPatchPreview(snapshot, patchValue, value, {signal} = {}) {
  signal?.throwIfAborted();
  const patch = validateWorldPatch(snapshot, patchValue, {signal});
  if (verified.has(value) && value.patchHash === patch.patchHash && value.snapshotHash === patch.snapshotHash) return value;
  if (Buffer.byteLength(JSON.stringify(value)) > WORLD_PATCH_LIMITS.bytes) throw new Error('Saved preview byte quota exceeded');
  exactKeys(value, fields, 'saved patch preview');
  const rebuilt = prepareWorldPatchPreview(snapshot, patch, {signal});
  if (contextHash(value) !== contextHash(rebuilt)) throw new Error('Saved patch preview integrity mismatch');
  return rebuilt;
}

/** CPU-side view query only. BEFORE/AFTER are the CHANGED cells, never a
 * reconstruction of the whole world. A filtered display is NOT a partial patch
 * or permission to apply just the visible cells. Future MC renderers must keep
 * these fixed coordinates and separately validate fresh server baselines. */
export function queryWorldPatchPreview(snapshot, patchValue, previewValue, options = {}) {
  const {signal, mode = 'changes', minY, maxY, categories = differences} = options;
  for (const key of Object.keys(options)) if (!['signal', 'mode', 'minY', 'maxY', 'categories'].includes(key)) {
    throw new Error('Unknown preview query option; transforms and write authority are unsupported');
  }
  signal?.throwIfAborted();
  if (!['changes', 'before', 'after'].includes(mode)) throw new Error('Unknown preview mode');
  if (!Array.isArray(categories) || categories.some(c => !differences.includes(c)) || new Set(categories).size !== categories.length) {
    throw new Error('Invalid preview difference filter');
  }
  const preview = validateWorldPatchPreview(snapshot, patchValue, previewValue, {signal});
  const low = minY ?? preview.bounds.min[1], high = maxY ?? preview.bounds.max[1];
  if (!Number.isSafeInteger(low) || !Number.isSafeInteger(high) || low < preview.world.minY || high > preview.world.maxY || low >= high) {
    throw new Error('Invalid minimum-inclusive/maximum-exclusive preview layer range');
  }
  const visible = [], counts = {added: 0, removed: 0, replaced: 0}; let inspected = 0;
  for (const section of preview.sections) {
    if (section.y * 16 >= high || (section.y + 1) * 16 <= low) continue;
    for (const [index, beforeIndex, afterIndex, code] of section.rows) {
      if (!(inspected++ % 1024)) signal?.throwIfAborted();
      const position = sectionPoint(section, index), difference = differences[code];
      if (position[1] < low || position[1] >= high || !categories.includes(difference)) continue;
      const before = preview.palette[beforeIndex], after = preview.palette[afterIndex];
      const primitives = mode === 'before' ? (difference === 'added' ? [] : [{state: before, role: 'original'}])
        : mode === 'after' ? (difference === 'removed' ? [] : [{state: after, role: 'proposed'}])
        : difference === 'added' ? [{state: after, role: 'added'}]
        : difference === 'removed' ? [{state: before, role: 'removed'}]
        : [{state: before, role: 'replaced-before'}, {state: after, role: 'replaced-after'}];
      counts[difference]++; visible.push({position, difference, before, after, primitives});
    }
  }
  signal?.throwIfAborted();
  return freeze({format: 'WorldPatchPreviewView', version: 1, previewHash: preview.previewHash,
    patchHash: preview.patchHash, snapshotHash: preview.snapshotHash, selectionHash: preview.selectionHash,
    world: clone(preview.world), selectionRevision: preview.selectionRevision, contextRevision: preview.contextRevision,
    coordinateSpace: preview.coordinateSpace, movable: false, mode, minY: low, maxY: high,
    categories: [...categories], counts, visible, totalPatchWrites: preview.summary.writes,
    changedCellsOnly: true, filteredViewIsApplyScope: false, canAuthorizePlacement: false,
    currentWorldVerified: false, physicsVerified: false, worldRendered: false});
}
