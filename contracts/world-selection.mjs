import {readFileSync} from 'node:fs';
// P3 data-only contract. Both Java and Bridge consume the same bundled quotas.
const quotas=JSON.parse(readFileSync(new URL('./world-selection-limits.json',import.meta.url),'utf8'));
exactKeys(quotas,['version','axes','contextCells','editCells','protectedRegions','chunks','snapshotBytes','paletteStates'],'selection quota contract');
if(quotas.version!==1||!Array.isArray(quotas.axes)||quotas.axes.length!==3||quotas.axes.some(n=>!Number.isSafeInteger(n)||n<1)
  ||Object.entries(quotas).some(([key,value])=>!['version','axes'].includes(key)&&(!Number.isSafeInteger(value)||value<1)))throw new Error('Invalid selection quota contract');
const {version,...limits}=quotas;
export const WORLD_SELECTION_LIMITS = Object.freeze({...limits,axes:Object.freeze([...limits.axes])});

export function exactKeys(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(label + ': expected data object');
  if (Object.keys(value).length !== fields.length || fields.some(k => !Object.hasOwn(value, k))) throw new Error(label + ': unexpected or missing fields');
}

export function safeRevision(value, label = 'revision') {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(label + ': expected nonnegative safe integer');
  return value;
}

export function worldPoint(value, label = 'point') {
  if (!Array.isArray(value) || value.length !== 3 || value.some(n => !Number.isSafeInteger(n))) throw new Error(label + ': expected integer [x,y,z]');
  if (Math.abs(value[0]) > 30000000 || Math.abs(value[2]) > 30000000 || Math.abs(value[1]) > 2048) throw new Error(label + ': outside supported world coordinates');
  return [...value];
}

export function regionContains(outer, inner) {
  return outer.min.every((v, i) => v <= inner.min[i] && outer.max[i] >= inner.max[i]);
}

export function pointInRegion(region, point) {
  return region.min.every((v, i) => point[i] >= v && point[i] < region.max[i]);
}

export const regionCells = region => region.max.reduce((n, v, i) => n * (v - region.min[i]), 1);

function region(value, world, label) {
  exactKeys(value, ['min', 'max'], label);
  const min = worldPoint(value.min, label + '.min'), max = worldPoint(value.max, label + '.max');
  if (min.some((v, i) => max[i] <= v || max[i] - v > WORLD_SELECTION_LIMITS.axes[i])) throw new Error(label + ': empty, inverted or oversized region');
  if (min[1] < world.minY || max[1] > world.maxY) throw new Error(label + ': outside dimension height');
  return {min, max};
}

/** Bounds are minimum-inclusive / maximum-exclusive, including negative chunks. */
export function validateWorldSelection(value) {
  exactKeys(value, ['format', 'version', 'world', 'revision', 'context', 'edit', 'protected'], 'selection');
  if (value.format !== 'WorldSelection' || value.version !== 1) throw new Error('Unsupported world selection version');
  exactKeys(value.world, ['worldId', 'dimension', 'minY', 'maxY'], 'world');
  const world = {...value.world};
  if (typeof world.worldId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(world.worldId)) throw new Error('Invalid opaque world ID (not a path)');
  if (typeof world.dimension !== 'string' || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(world.dimension) || world.dimension.length > 128) throw new Error('Invalid dimension ID');
  if (!Number.isSafeInteger(world.minY) || !Number.isSafeInteger(world.maxY) || world.minY < -2048 || world.maxY > 2048 || world.minY >= world.maxY || world.maxY - world.minY > 1024) throw new Error('Invalid supported dimension height');
  const revision = safeRevision(value.revision), context = region(value.context, world, 'context'), edit = region(value.edit, world, 'edit');
  if (!regionContains(context, edit)) throw new Error('Edit region must be contained in read-only context');
  if (regionCells(context) > WORLD_SELECTION_LIMITS.contextCells || regionCells(edit) > WORLD_SELECTION_LIMITS.editCells) throw new Error('Selection volume quota exceeded');
  if (!Array.isArray(value.protected) || value.protected.length > WORLD_SELECTION_LIMITS.protectedRegions) throw new Error('Protected region quota exceeded');
  const protectedRegions = value.protected.map((p, i) => region(p, world, 'protected[' + i + ']'));
  if (protectedRegions.some(p => !regionContains(context, p))) throw new Error('Protected region outside read-only context');
  protectedRegions.sort((a, b) => { const x = JSON.stringify(a), y = JSON.stringify(b); return x < y ? -1 : x > y ? 1 : 0; });
  if (protectedRegions.some((p, i) => i && JSON.stringify(p) === JSON.stringify(protectedRegions[i - 1]))) throw new Error('Duplicate protected region');
  return {format: 'WorldSelection', version: 1, world, revision, context, edit, protected: protectedRegions};
}

export function selectionCellScope(selection, point) {
  const s = validateWorldSelection(selection), p = worldPoint(point);
  if (!pointInRegion(s.context, p)) return 'outside';
  if (s.protected.some(r => pointInRegion(r, p))) return 'protected';
  return pointInRegion(s.edit, p) ? 'edit' : 'context-only';
}

/** Exact intersections, not permission to load/generate these chunks. */
export function selectionChunks(selection) {
  const {context} = validateWorldSelection(selection), result = [];
  const firstX = Math.floor(context.min[0] / 16), lastX = Math.floor((context.max[0] - 1) / 16);
  const firstZ = Math.floor(context.min[2] / 16), lastZ = Math.floor((context.max[2] - 1) / 16);
  for (let z = firstZ; z <= lastZ; z++) for (let x = firstX; x <= lastX; x++) {
    result.push({x, z, region: {
      min: [Math.max(context.min[0], x * 16), context.min[1], Math.max(context.min[2], z * 16)],
      max: [Math.min(context.max[0], (x + 1) * 16), context.max[1], Math.min(context.max[2], (z + 1) * 16)],
    }});
  }
  if (result.length > WORLD_SELECTION_LIMITS.chunks) throw new Error('Selection chunk quota exceeded');
  return result;
}
