import {exactKeys, worldPoint, WORLD_SELECTION_LIMITS} from './world-selection.mjs';
import {normalizeSnapshotBlock} from '../src/world/context-snapshot.mjs';

// Experimental data contract. No HTTP endpoint or Minecraft write authority.
export const WORLD_PATCH_LIMITS = Object.freeze({
  operations: WORLD_SELECTION_LIMITS.editCells,
  bytes: WORLD_SELECTION_LIMITS.snapshotBytes,
});

const freezeSchema = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeSchema(child); Object.freeze(value); } return value; };
const patchPositionSchema = {type: 'array', minItems: 3, maxItems: 3, items: {type: 'integer'}};
const patchStateSchema = {type: 'string', minLength: 1, maxLength: 512};
/** Provider output contract only. Scope, BEFORE, material and neighbor safety
 * still come from compilation against the original captured snapshot. */
export const worldPatchProposalSchema = freezeSchema({type: 'object', additionalProperties: false,
  required: ['format', 'version', 'snapshotHash', 'selectionHash', 'operations'], properties: {
    format: {type: 'string', enum: ['WorldPatchProposal']}, version: {type: 'integer', enum: [1]},
    snapshotHash: {type: 'string', pattern: '^[a-f0-9]{64}$'}, selectionHash: {type: 'string', pattern: '^[a-f0-9]{64}$'},
    operations: {type: 'array', minItems: 1, maxItems: WORLD_PATCH_LIMITS.operations, items: {anyOf: [
      {type: 'object', additionalProperties: false, required: ['op', 'position', 'before', 'after'], properties: {
        op: {type: 'string', enum: ['set']}, position: patchPositionSchema, before: patchStateSchema, after: patchStateSchema}},
      {type: 'object', additionalProperties: false, required: ['op', 'position', 'before'], properties: {
        op: {type: 'string', enum: ['keep', 'clear']}, position: patchPositionSchema, before: patchStateSchema}},
    ]}},
  }});

export function patchHashField(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(label + ': expected SHA256');
  return value;
}

export function comparePatchPoints(a, b) {
  return a[1] - b[1] || a[2] - b[2] || a[0] - b[0];
}

/** AI can propose an exact state change, not a scope, command or permission.
 * Missing positions always mean KEEP. CLEAR must be a separate explicit op. */
export function validateWorldPatchProposal(value) {
  if (Buffer.byteLength(JSON.stringify(value)) > WORLD_PATCH_LIMITS.bytes) throw new Error('World patch byte quota exceeded');
  exactKeys(value, ['format', 'version', 'snapshotHash', 'selectionHash', 'operations'], 'patch proposal');
  if (value.format !== 'WorldPatchProposal' || value.version !== 1) throw new Error('Unsupported world patch proposal version');
  const snapshotHash = patchHashField(value.snapshotHash, 'snapshotHash');
  const selectionHash = patchHashField(value.selectionHash, 'selectionHash');
  if (!Array.isArray(value.operations) || !value.operations.length || value.operations.length > WORLD_PATCH_LIMITS.operations) throw new Error('World patch operation quota exceeded');
  const operations = value.operations.map((item, i) => {
    const label = 'patch operation[' + i + ']';
    exactKeys(item, item?.op === 'set' ? ['op', 'position', 'before', 'after'] : ['op', 'position', 'before'], label);
    if (!['keep', 'clear', 'set'].includes(item.op)) throw new Error('Unknown patch operation');
    const position = worldPoint(item.position, label + '.position');
    const before = normalizeSnapshotBlock({state: item.before, blockEntity: false}).state;
    const result = {op: item.op, position, before};
    if (item.op === 'set') result.after = normalizeSnapshotBlock({state: item.after, blockEntity: false}).state;
    return result;
  }).sort((a, b) => comparePatchPoints(a.position, b.position));
  if (operations.some((item, i) => i && comparePatchPoints(item.position, operations[i - 1].position) === 0)) throw new Error('Duplicate/contradictory patch position');
  return {format: 'WorldPatchProposal', version: 1, snapshotHash, selectionHash, operations};
}
