import {validateContextSnapshot, contextHash} from './context-snapshot.mjs';
import {regionCells} from '../../contracts/world-selection.mjs';

const isAir = state => ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(state);

/** Pure block facts / bounded LOD for a future model-input worker. No semantic
 * guesses (roads/entrances), NBT, URLs, account data or write authority.
 * CPU work is bounded by C's data quota, but must NOT run on a game tick. */
export function summarizeContextSnapshot(value, {cellSize = 4, maximumMaterials = 32, signal} = {}) {
  if (!Number.isSafeInteger(cellSize) || cellSize < 4 || cellSize > 16 || !Number.isSafeInteger(maximumMaterials) || maximumMaterials < 1 || maximumMaterials > 64) throw new Error('Invalid bounded context summary options');
  const snapshot = validateContextSnapshot(value), s = snapshot.selection, c = s.context;
  const width = c.max[0] - c.min[0], length = c.max[2] - c.min[2], height = c.max[1] - c.min[1];
  const cols = Math.ceil(width / cellSize), rows = Math.ceil(length / cellSize), materials = new Map();
  const tiles = Array.from({length: cols * rows}, (_, i) => {
    const gx = i % cols, gz = Math.floor(i / cols), min = [c.min[0] + gx * cellSize, c.min[2] + gz * cellSize];
    const max = [Math.min(c.max[0], min[0] + cellSize), Math.min(c.max[2], min[1] + cellSize)];
    return {min, max, knownColumns: 0, unknownColumns: 0, knownHighestNonAirY: null};
  });
  let knownCells = 0, unknownCells = 0, airCells = 0, blockEntityCells = 0, work = 0;
  for (const chunk of snapshot.chunks) {
    signal?.throwIfAborted();
    const {min, max} = chunk.region, w = max[0] - min[0], l = max[2] - min[2], volume = regionCells(chunk.region);
    if (chunk.coverage === 'unknown') unknownCells += volume; else knownCells += volume;
    // Coverage is exact X/Z intersection, independent of the LOD tile origin.
    for (let z = min[2]; z < max[2]; z++) for (let x = min[0]; x < max[0]; x++) {
      const index = Math.floor((z - c.min[2]) / cellSize) * cols + Math.floor((x - c.min[0]) / cellSize);
      tiles[index][chunk.coverage === 'known' ? 'knownColumns' : 'unknownColumns']++;
    }
    if (chunk.coverage === 'unknown') continue;
    let offset = 0;
    for (const [id, count] of chunk.runs) {
      const entry = chunk.palette[id], end = offset + count;
      materials.set(entry.state, (materials.get(entry.state) ?? 0) + count);
      if (entry.blockEntity) blockEntityCells += count;
      if (isAir(entry.state)) airCells += count;
      else for (let i = offset; i < end; i++) {
        if (!(++work % 4096)) signal?.throwIfAborted();
        const x = min[0] + i % w, z = min[2] + Math.floor(i / w) % l, y = min[1] + Math.floor(i / (w * l));
        const tile = tiles[Math.floor((z - c.min[2]) / cellSize) * cols + Math.floor((x - c.min[0]) / cellSize)];
        if (tile.knownHighestNonAirY === null || y > tile.knownHighestNonAirY) tile.knownHighestNonAirY = y;
      }
      offset = end;
    }
  }
  const ordered = [...materials].sort(([a, n], [b, m]) => m - n || (a < b ? -1 : a > b ? 1 : 0));
  const materialCounts = ordered.slice(0, maximumMaterials).map(([state, cells]) => ({state, cells}));
  const omittedMaterialCells = ordered.slice(maximumMaterials).reduce((n, entry) => n + entry[1], 0);
  const content = {format: 'WorldContextSummary', version: 1, snapshotHash: snapshot.snapshotHash, selectionHash: snapshot.selectionHash,
    context: c, edit: s.edit, protected: s.protected, totalCells: width * height * length, knownCells, unknownCells, knownAirCells: airCells,
    knownNonAirCells: knownCells - airCells, knownBlockEntityCells: blockEntityCells,
    materialCounts, omittedMaterialKinds: Math.max(0, ordered.length - maximumMaterials), omittedMaterialCells,
    heightLod: {cellSize, columns: cols, rows, tiles: tiles.map(t => ({...t, coverage: !t.knownColumns ? 'unknown' : t.unknownColumns ? 'partial' : 'known'}))},
    semantics: 'unclassified-block-facts', canAuthorizePlacement: false,
    limitations: ['LOD does not replace the precise inner-region block baseline.',
      'Partial/unknown tiles do not establish the full height; reported Y is only the highest observed non-air block.',
      'Non-air is not a statement of solidity, support, traversability, road or entrance function.']};
  signal?.throwIfAborted();
  if (Buffer.byteLength(JSON.stringify(content)) > 1048576) throw new Error('Context summary byte quota exceeded');
  return {...content, summaryHash: contextHash(content)};
}
