import {performance} from 'node:perf_hooks';
import {validateWorldSelection, selectionChunks, regionCells, safeRevision, exactKeys, WORLD_SELECTION_LIMITS} from '../../contracts/world-selection.mjs';
import {createContextSnapshot, normalizeSnapshotBlock} from './context-snapshot.mjs';

/** Trusted read-only source seam for a future authoritative server collector.
 * No scan/load/write capability is obtained from model-supplied data.
 * source.identity() must include a monotonic whole-C contextRevision, advanced
 * for ALL block changes and chunk loading/unloading within the selected C.
 * A scheduler calls step(), never a busy loop on the Minecraft render thread. */
export function createContextReadSession(selection, source, {
  maxCellsPerStep = 4096, maxMillisPerStep = 5, maxRestarts = 2,
  clock = () => performance.now(), signal,
} = {}) {
  const selected = validateWorldSelection(selection), expected = selectionChunks(selected), total = regionCells(selected.context);
  for (const name of ['identity', 'isChunkLoaded', 'readBlock']) if (typeof source?.[name] !== 'function') throw new Error('Missing trusted read-only source method: ' + name);
  if (!Number.isSafeInteger(maxCellsPerStep) || maxCellsPerStep < 1 || maxCellsPerStep > 16384
      || !Number.isFinite(maxMillisPerStep) || maxMillisPerStep <= 0 || maxMillisPerStep > 5
      || !Number.isSafeInteger(maxRestarts) || maxRestarts < 0 || maxRestarts > 2 || typeof clock !== 'function') throw new Error('Invalid bounded context read scheduler');
  let state = 'reading', reason = null, result = null, chunks = [], chunkIndex = 0, cellIndex = 0, visited = 0, processed = 0, restarts = 0, startRevision;
  let stepCount = 0, maxObservedStepMillis = 0, totalReads = 0, active = null, firstFailure = null, lastRevision, estimatedBytes = 0;

  function identity() {
    const value = source.identity();
    exactKeys(value, ['worldId', 'dimension', 'selectionRevision', 'contextRevision'], 'authoritative read identity');
    safeRevision(value.selectionRevision); safeRevision(value.contextRevision);
    if (value.worldId !== selected.world.worldId || value.dimension !== selected.world.dimension || value.selectionRevision !== selected.revision) return null;
    return value.contextRevision;
  }
  function stop(next, why) { state = next; reason = why; chunks = []; active = null; result = null; }
  function restart(revision) {
    if (restarts >= maxRestarts) { stop('unstable', 'context-keeps-changing'); return false; }
    restarts++; state = 'reading'; startRevision = revision; chunks = []; active = null; chunkIndex = 0; cellIndex = 0; processed = 0; visited = 0; estimatedBytes = 0; return true;
  }
  function guard() {
    if (signal?.aborted) { stop('cancelled', 'read-cancelled'); return false; }
    const revision = identity();
    if (revision === null) { stop('stale', 'world-or-selection-changed'); return false; }
    if (lastRevision !== undefined && revision < lastRevision) throw new Error('Whole-context revision counter regressed');
    lastRevision = revision;
    if (startRevision === undefined) startRevision = revision;
    else if (revision !== startRevision) { restart(revision); return false; }
    return true;
  }
  function progress() {
    return {state, reason, processedCells: processed, totalCells: total, readCells: visited, totalReadCalls: totalReads,
      chunksCompleted: chunkIndex, chunksTotal: expected.length, restarts, stepCount, maxObservedStepMillis,
      snapshot: result, canAuthorizePlacement: false};
  }
  function beginChunk(e) {
    active = {x: e.x, z: e.z, coverage: 'known', palette: [], runs: [], paletteIds: new Map()}; cellIndex = 0;
    estimatedBytes += 512;
  }
  function unknownChunk(e) {
    // Any partial reads are discarded, never converted to a complete air chunk.
    processed -= cellIndex; processed += regionCells(e.region);
    chunks.push({x: e.x, z: e.z, coverage: 'unknown', palette: [], runs: []}); chunkIndex++; cellIndex = 0; active = null;
  }
  function record(e) {
    const width = e.region.max[0] - e.region.min[0], length = e.region.max[2] - e.region.min[2];
    const point = [e.region.min[0] + cellIndex % width,
      e.region.min[1] + Math.floor(cellIndex / (width * length)),
      e.region.min[2] + Math.floor(cellIndex / width) % length];
    totalReads++;
    const block = normalizeSnapshotBlock(source.readBlock(point)); visited++;
    let paletteId = active.paletteIds.get(block.state);
    if (paletteId === undefined) {
      if (active.palette.length >= 4096) throw new Error('Chunk palette quota exceeded during read');
      paletteId = active.palette.length; active.palette.push(block); active.paletteIds.set(block.state, paletteId);
      estimatedBytes += Buffer.byteLength(JSON.stringify(block)) + 8;
    } else if (active.palette[paletteId].blockEntity !== block.blockEntity) throw new Error('Contradictory block-entity facts for the same state');
    const last = active.runs.at(-1);
    if (last?.[0] === paletteId) last[1]++; else { active.runs.push([paletteId, 1]); estimatedBytes += 32; }
    if (estimatedBytes > WORLD_SELECTION_LIMITS.snapshotBytes) throw new Error('Snapshot byte quota exceeded during read');
    cellIndex++; processed++;
  }

  return {
    step() {
      if (state !== 'reading') return progress();
      const started = clock(); let work = 0; stepCount++;
      try {
        if (!guard()) return progress();
        while (chunkIndex < expected.length && work < maxCellsPerStep && clock() - started < maxMillisPerStep) {
          if (!guard()) return progress();
          const e = expected[chunkIndex];
          const loaded = source.isChunkLoaded(e.x, e.z);
          if (typeof loaded !== 'boolean') throw new Error('Chunk coverage must be an explicit boolean');
          if (!loaded) { unknownChunk(e); work++; continue; }
          if (!active) beginChunk(e);
          record(e); work++;
          if (cellIndex === regionCells(e.region)) {
            const {paletteIds, ...chunk} = active; chunks.push(chunk); chunkIndex++; cellIndex = 0; active = null;
          }
        }
        if (!guard()) return progress();
        if (chunkIndex === expected.length) {
          // A loaded chunk lost since its last cell is unknown unless the fence
          // changed; a correct source advances the revision and causes a restart.
          for (const c of chunks) if (c.coverage === 'known' && !source.isChunkLoaded(c.x, c.z)) throw new Error('Known chunk unloaded without advancing the change fence');
          if (!guard()) return progress();
          // No full JSON traversal/hash in a scheduled read step. The future
          // game collector must serialize/hash off its tick thread, then fence
          // check again. Pure Node callers invoke finishSnapshot separately.
          state = 'captured'; active = null;
        }
      } catch (error) { firstFailure = error; stop('failed', error.message); }
      finally { maxObservedStepMillis = Math.max(maxObservedStepMillis, clock() - started); }
      return progress();
    },
    finishSnapshot() {
      if (state !== 'captured') return progress();
      try {
        if (!guard()) return progress();
        result = createContextSnapshot(selected, {fence: {start: startRevision, end: startRevision}, chunks});
        if (!guard()) { result = null; return progress(); }
        state = 'ready'; chunks = []; active = null;
      } catch (error) { firstFailure = error; stop('failed', error.message); }
      return progress();
    },
    cancel() { if (['reading', 'captured'].includes(state)) stop('cancelled', 'read-cancelled'); return progress(); },
    status: progress,
    error: () => firstFailure,
  };
}
