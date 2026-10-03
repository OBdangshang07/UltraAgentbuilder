import {createHash} from 'node:crypto';
import {validateState} from '../generation/block-states.mjs';
import {exactKeys, safeRevision, worldPoint, validateWorldSelection, selectionChunks,
  pointInRegion, regionCells, WORLD_SELECTION_LIMITS as LIMITS} from '../../contracts/world-selection.mjs';

const trusted = new WeakSet(), indexes = new WeakMap();
const stable = value => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}' : JSON.stringify(value);
export const contextHash = value => createHash('sha256').update(stable(value)).digest('hex');
function freeze(value) { if (value && typeof value === 'object') { for (const v of Object.values(value)) freeze(v); Object.freeze(value); } return value; }
const terrain = new Set(['air', 'cave_air', 'void_air', 'dirt', 'coarse_dirt', 'rooted_dirt', 'bedrock', 'obsidian', 'crying_obsidian']);

/** Exact state facts only. Unknown/dynamic/coupled blocks are readable but protected.
 * blockEntity must come from the future authoritative reader, never from an AI. */
export function normalizeSnapshotBlock(value) {
  exactKeys(value, ['state', 'blockEntity'], 'palette entry');
  if (typeof value.state !== 'string' || value.state.length > 512 || typeof value.blockEntity !== 'boolean') throw new Error('Invalid block state fact');
  const match = /^([a-z0-9_.-]+:[a-z0-9_./-]+)(?:\[([a-z0-9_=,.-]+)\])?$/.exec(value.state);
  if (!match) throw new Error('Invalid block state syntax');
  const properties = new Map();
  for (const field of match[2]?.split(',') ?? []) {
    const pair = field.split('=');
    if (pair.length !== 2 || !pair[0] || !pair[1] || properties.has(pair[0])) throw new Error('Invalid or duplicate block property');
    properties.set(pair[0], pair[1]);
  }
  const state = match[1] + (properties.size ? '[' + [...properties].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(p => p.join('=')).join(',') + ']' : '');
  return {state, blockEntity: value.blockEntity};
}

export function snapshotProtection(entry) {
  const {state, blockEntity} = normalizeSnapshotBlock(entry);
  if (blockEntity) return 'block-entity';
  if (!state.startsWith('minecraft:')) return 'unclassified-mod-block';
  if (/^minecraft:(?:water|lava)(?:\[|$)/.test(state) || /\bwaterlogged=true\b/.test(state)) return 'dynamic-state';
  if (/^minecraft:[a-z_]+_(?:door|bed)\[/.test(state)) return 'coupled-block';
  if (terrain.has(state.slice(10))) return null;
  try { validateState(state); return null; } catch { return 'unclassified-vanilla-state'; }
}

function chunksFor(selection, chunks) {
  const expected = selectionChunks(selection);
  if (!Array.isArray(chunks) || chunks.length !== expected.length) throw new Error('Snapshot must cover every intersecting chunk explicitly');
  return chunks.map((c, i) => {
    exactKeys(c, ['x', 'z', 'coverage', 'palette', 'runs'], 'chunk');
    const e = expected[i];
    if (c.x !== e.x || c.z !== e.z || !['known', 'unknown'].includes(c.coverage)) throw new Error('Chunk coordinate/order/coverage mismatch');
    if (!Array.isArray(c.palette) || !Array.isArray(c.runs)) throw new Error('Invalid chunk data');
    if (c.coverage === 'unknown') {
      if (c.palette.length || c.runs.length) throw new Error('Unknown chunk cannot pretend to contain air or block data');
      return {...e, coverage: 'unknown', palette: [], runs: []};
    }
    if (!c.palette.length || c.palette.length > LIMITS.paletteStates) throw new Error('Chunk palette quota exceeded');
    const palette = c.palette.map(normalizeSnapshotBlock), identities = palette.map(contextHash);
    if (new Set(identities).size !== palette.length || new Set(palette.map(p => p.state)).size !== palette.length) throw new Error('Duplicate or contradictory palette state');
    const volume = regionCells(e.region);
    if (!c.runs.length || c.runs.length > volume) throw new Error('Chunk run quota exceeded');
    let total = 0, previous = -1;
    const runs = c.runs.map(run => {
      if (!Array.isArray(run) || run.length !== 2 || !Number.isSafeInteger(run[0]) || run[0] < 0 || run[0] >= palette.length
          || !Number.isSafeInteger(run[1]) || run[1] < 1 || run[1] > volume || run[0] === previous) throw new Error('Invalid/noncanonical chunk run');
      total += run[1]; previous = run[0];
      if (total > volume) throw new Error('Chunk runs exceed exact intersection volume');
      return [...run];
    });
    if (total !== volume) throw new Error('Chunk runs omit cells (omission is not air)');
    if (new Set(runs.map(r => r[0])).size !== palette.length) throw new Error('Unused palette data forbidden');
    return {...e, coverage: 'known', palette, runs};
  });
}

function byteQuota(value) {
  if (Buffer.byteLength(JSON.stringify(value)) > LIMITS.snapshotBytes) throw new Error('Snapshot byte quota exceeded');
}

/** Caller supplies a whole-C change fence. Hash integrity is NOT source authority.
 * No NBT, entities, text, file paths, callbacks or world-write operations exist here. */
export function createContextSnapshot(selection, capture) {
  byteQuota({selection, capture});
  const normalized = validateWorldSelection(selection);
  exactKeys(capture, ['fence', 'chunks'], 'capture'); exactKeys(capture.fence, ['start', 'end'], 'change fence');
  const start = safeRevision(capture.fence.start), end = safeRevision(capture.fence.end);
  if (start !== end) throw new Error('Context changed during capture; no consistent snapshot');
  const chunks = chunksFor(normalized, capture.chunks).map(c => ({...c, chunkHash: contextHash(c)}));
  const content = {format: 'WorldContextSnapshot', version: 1, selection: normalized, selectionHash: contextHash(normalized),
    fence: {start, end}, chunks, cellOrder: 'y-z-x', privacy: 'block-states-only', canAuthorizePlacement: false};
  const snapshot = freeze({...content, snapshotHash: contextHash(content)});
  trusted.add(snapshot); return snapshot;
}

export function validateContextSnapshot(value) {
  if (trusted.has(value)) return value;
  byteQuota(value);
  exactKeys(value, ['format', 'version', 'selection', 'selectionHash', 'fence', 'chunks', 'cellOrder', 'privacy', 'canAuthorizePlacement', 'snapshotHash'], 'snapshot');
  if (value.format !== 'WorldContextSnapshot' || value.version !== 1 || value.cellOrder !== 'y-z-x' || value.privacy !== 'block-states-only' || value.canAuthorizePlacement !== false || !Array.isArray(value.chunks)) throw new Error('Invalid snapshot contract');
  const raw = value.chunks.map(c => {
    exactKeys(c, ['x', 'z', 'region', 'coverage', 'palette', 'runs', 'chunkHash'], 'saved chunk');
    const {region, chunkHash, ...data} = c; return data;
  });
  const rebuilt = createContextSnapshot(value.selection, {fence: value.fence, chunks: raw});
  if (stable(rebuilt) !== stable(value)) throw new Error('Snapshot or chunk integrity mismatch');
  return rebuilt;
}

/** Reads absolute world coordinates, without expanding compressed chunks. */
function indexedSnapshotCell(value, point) {
  const snapshot = validateContextSnapshot(value), p = worldPoint(point), s = snapshot.selection;
  if (!pointInRegion(s.context, p)) throw new Error('Point outside approved read-only context');
  let index = indexes.get(snapshot);
  if (!index) {
    index = new Map(snapshot.chunks.map(c => {
      let end = 0; return [c.x + ',' + c.z, {chunk: c, ends: c.runs.map(r => end += r[1]), protection: c.palette.map(snapshotProtection)}];
    })); indexes.set(snapshot, index);
  }
  const {chunk, ends, protection} = index.get(Math.floor(p[0] / 16) + ',' + Math.floor(p[2] / 16));
  if (chunk.coverage === 'unknown') return {snapshot, point: p, entry: null, protection: 'unknown'};
  const {min, max} = chunk.region, width = max[0] - min[0], length = max[2] - min[2];
  const offset = (p[1] - min[1]) * width * length + (p[2] - min[2]) * width + p[0] - min[0];
  let lo = 0, hi = ends.length - 1;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (ends[mid] > offset) hi = mid; else lo = mid + 1; }
  const entry = chunk.palette[chunk.runs[lo][0]];
  return {snapshot, point: p, entry, protection: protection[chunk.runs[lo][0]]};
}

/** State risk independently of scope; context-only must not hide containers.
 * Facts only: no NBT or permission to modify blocks. */
export function readSnapshotBlockFact(value, point) {
  const {entry, protection} = indexedSnapshotCell(value, point);
  return {coverage: entry ? 'known' : 'unknown', state: entry?.state ?? null,
    blockEntity: entry?.blockEntity ?? null, blockProtection: protection};
}

export function readSnapshotCell(value, point) {
  const {snapshot, point: p, entry, protection} = indexedSnapshotCell(value, point), s = snapshot.selection;
  if (!entry) return {coverage: 'unknown', state: null, protected: true, reason: 'unknown'};
  const reason = s.protected.some(r => pointInRegion(r, p)) ? 'selection-protection'
    : !pointInRegion(s.edit, p) ? 'context-only' : protection;
  return {coverage: 'known', state: entry.state, protected: reason !== null, reason};
}

/** A stale check, not an approval token. The server must independently own facts. */
export function snapshotStaleness(value, current) {
  const snapshot = validateContextSnapshot(value), s = snapshot.selection;
  exactKeys(current, ['worldId', 'dimension', 'selectionRevision', 'contextRevision'], 'current snapshot identity');
  safeRevision(current.selectionRevision); safeRevision(current.contextRevision);
  if (current.worldId !== s.world.worldId || current.dimension !== s.world.dimension) return 'world-changed';
  if (current.selectionRevision !== s.revision) return 'selection-changed';
  return current.contextRevision !== snapshot.fence.end ? 'context-changed' : null;
}
