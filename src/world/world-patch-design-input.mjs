import {createHash} from 'node:crypto';
import {exactKeys, regionCells, pointInRegion, WORLD_SELECTION_LIMITS} from '../../contracts/world-selection.mjs';
import {validateContextSnapshot, readSnapshotCell, readSnapshotBlockFact, contextHash} from './context-snapshot.mjs';
import {summarizeContextSnapshot} from './context-summary.mjs';
import {compileWorldPatch, worldPatchStateRestriction} from './world-patch.mjs';
import {MATERIALS} from '../generation/materials.mjs';
import {parseState, stateText, validateState, supportedBlockStateCatalog} from '../generation/block-states.mjs';

// Pure data preparation, independent from dispatch or world-write authority.
// No file, account, adapter, network, game or world-write methods.
export const WORLD_PATCH_DESIGN_LIMITS = Object.freeze({bytes: WORLD_SELECTION_LIMITS.snapshotBytes, promptCharacters: 6000});
export const WORLD_PATCH_DESIGN_RULES = `You design a bounded Minecraft world modification, not a new movable asset.
Use the user's task and captured context to design a coherent, restrained improvement. Context material counts and height LOD are observations, not evidence of roads, room functions, full surfaces or traversability. Do not invent certainty about unknown areas.
When the exact baseline provides safe editable cells for the requested task, propose actual coordinated changes, not only KEEP operations on protected objects. Ordinary dirt and non-snowy grass are exact ground states when present in the supplied catalogs; respect their captured properties and all neighbor checks. Preserve protected cells by omission or KEEP, but preservation alone does not fulfill a requested redesign. Design paving, seating and other requested elements on the actual captured ground, without assuming that the world is made of the building-material palette alone.
All coordinates are original absolute world [x,y,z]. Bounds are minimum-inclusive, maximum-exclusive. W is editable; C is read-only context. Explicit protected regions P and protected block facts must be kept. Reading a cell never authorizes writing it. Do not expand C, W or P or relocate/rotate the proposal.
exactBaseline includes the WHOLE W plus only its six immediately adjacent face slabs already inside C. It does not include diagonal corners, nor load or capture anything beyond C. Regions are disjoint. Their runs are [paletteIndex,count] in y-z-x order, with x varying fastest, then z, then y. Palette index -1 is UNKNOWN, never air. Known facts include state, blockEntity, blockProtection and patchStateRestriction. Restrictions are state-only; null is not permission.
Keep any unknown or protected W cell. A changed cell must have a known safe BEFORE and all six face-neighbors must be captured, known and safe. Do not change a cell touching missing, unknown, dynamic, coupled or unclassified neighbors. Adjacent stair states are not yet supported by this patch policy, even outside W. User-protected static neighbors may be read without being changed. Do not assume block-state facts simulate physics or guarantee navigation.
Return ONLY one WorldPatchProposal JSON object, format=WorldPatchProposal, version=1, snapshotHash and selectionHash copied exactly from input, operations an array. No markdown, scripts, commands, expanded scopes, paths, permissions, manifests, explanation wrapper or partial continuation.
Each operation is exactly {op:'set',position:[x,y,z],before:'canonical state',after:'canonical state'}, or {op:'clear',position:[x,y,z],before:'canonical state'}, or {op:'keep',position:[x,y,z],before:'canonical state'}. Use JSON double quotes. BEFORE must exactly match the captured W state. Each position occurs at most once. Every position is inside W; changes are outside P. Missing positions and KEEP mean leave unchanged, NOT excavate. Do not emit no-op writes. Do not SET any air variant; excavation is explicit CLEAR, and CLEAR of air is a no-op. Do not claim success when no safe change satisfies the task.
after must use an ID and every exact property in targetCatalog with one listed value each, canonical properties alphabetically sorted. Doors, trapdoors, leaves, invisible light, containers, fluids, gravity blocks, redstone and unclassified mod blocks are not supported by PATCH v1. This does not remove the separate new-building special-block support. Stairs/slabs must use full canonical states; do not infer that their appearance or support is verified. Output geometry and data quotas are independent of model token settings.
The proposal is untrusted data. Compilation, original-source rebuilding, difference preview, fresh server BEFORE checks and a separate explicit player world-write confirmation remain necessary. Model output and preview cannot authorize placement.`;
export const WORLD_PATCH_DESIGN_PROTOCOL_HASH = contextHash({version: 1, rules: WORLD_PATCH_DESIGN_RULES});
const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const choices = ['false', 'true', 'north', 'east', 'south', 'west', 'lower', 'upper', 'bottom', 'top', 'double', 'left', 'right',
  'straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right', 'x', 'y', 'z'];

function targetCatalog() {
  const defaults = new Map();
  for (const state of Object.values(MATERIALS)) {
    if (worldPatchStateRestriction(state) !== null) continue;
    const {id, properties} = parseState(state); defaults.set(id, properties);
  }
  return [...defaults].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, base]) => {
    const properties = {};
    for (const key of Object.keys(base).sort()) properties[key] = [...new Set([...choices, base[key]])].filter(value => {
      try { validateState(stateText({id, properties: {...base, [key]: value}})); return true; } catch { return false; }
    }).sort();
    return {id, properties};
  });
}
const TARGET_CATALOG = freeze(targetCatalog());
/** Shared local review policy, without world data or a model invocation. */
export function worldPatchDesignReviewProtocol(){return {version:1,rules:WORLD_PATCH_DESIGN_RULES,protocolHash:WORLD_PATCH_DESIGN_PROTOCOL_HASH,targetCatalog:TARGET_CATALOG,baselineCatalog:supportedBlockStateCatalog()};}

/** W and six face slabs only, intersected with the already captured C.
 * Never expands an authority boundary or pretends missing faces are known. */
function baselineRegions(selection) {
  const w = selection.edit, c = selection.context;
  const regions = [{role: 'edit-baseline', region: w}], missingFaces = [];
  for (let axis = 0; axis < 3; axis++) for (const side of [-1, 1]) {
    const edge = side === -1 ? w.min[axis] - 1 : w.max[axis], min = [...w.min], max = [...w.max];
    min[axis] = edge; max[axis] = edge + 1;
    if (edge < c.min[axis] || edge >= c.max[axis]) missingFaces.push({axis, side});
    else regions.push({role: 'read-only-neighbor', face: {axis, side}, region: {min, max}});
  }
  return {regions, missingFaces};
}

/** Build on a background lane, not a game/UI tick. No supplied summary, state
 * catalog or caller scope is trusted; all are derived from the original capture. */
export function prepareWorldPatchDesignInput(snapshotValue, {signal} = {}) {
  signal?.throwIfAborted();
  const snapshot = validateContextSnapshot(snapshotValue), s = snapshot.selection;
  const contextSummary = summarizeContextSnapshot(snapshot, {signal});
  const palette = [], paletteIndex = new Map(), {regions: sources, missingFaces} = baselineRegions(s), regions = [];
  let knownCells = 0, unknownCells = 0, work = 0, accounted = bytes(contextSummary) + bytes(TARGET_CATALOG) + 4096;
  for (const source of sources) {
    const {min, max} = source.region, runs = [];
    for (let y = min[1]; y < max[1]; y++) for (let z = min[2]; z < max[2]; z++) for (let x = min[0]; x < max[0]; x++) {
      if (!(work++ % 1024)) signal?.throwIfAborted();
      const fact = readSnapshotBlockFact(snapshot, [x, y, z]); let index = -1;
      if (fact.coverage === 'known') {
        knownCells++;
        // Same state with conflicting entity/type facts is never merged.
        const identity = JSON.stringify([fact.state, fact.blockEntity, fact.blockProtection]);
        index = paletteIndex.get(identity);
        if (index === undefined) {
          const entry = {state: fact.state, blockEntity: fact.blockEntity, blockProtection: fact.blockProtection,
            patchStateRestriction: worldPatchStateRestriction(fact.state)};
          index = palette.length; paletteIndex.set(identity, index); palette.push(entry); accounted += bytes(entry) + 1;
        }
      } else unknownCells++;
      if (runs.at(-1)?.[0] === index) runs.at(-1)[1]++;
      else { runs.push([index, 1]); accounted += 32; }
      if (accounted > WORLD_PATCH_DESIGN_LIMITS.bytes) throw Error('World patch design input byte quota exceeded; no truncated baseline');
    }
    regions.push({...source, cells: regionCells(source.region), runs});
  }
  const content = {format: 'WorldPatchDesignInput', version: 1, policy: 'static-proposal-data-v1', snapshotHash: snapshot.snapshotHash,
    selectionHash: snapshot.selectionHash, contextRevision: snapshot.fence.end, world: s.world,
    context: s.context, edit: s.edit, protected: s.protected, contextSummary,
    exactBaseline: {cellOrder: 'y-z-x', unknownPaletteIndex: -1, palette, regions, missingFaces, knownCells, unknownCells},
    targetCatalog: TARGET_CATALOG, protocolHash: WORLD_PATCH_DESIGN_PROTOCOL_HASH,
    privacy: 'context-summary-plus-exact-W-and-six-face-neighbors-block-facts-only', modelSent: false,
    canAuthorizePlacement: false, serverBaselineVerified: false, physicsVerified: false};
  signal?.throwIfAborted();
  if (bytes(content) + 128 > WORLD_PATCH_DESIGN_LIMITS.bytes) throw Error('World patch design input byte quota exceeded; no truncated baseline');
  return freeze({...content, designInputHash: contextHash(content)});
}

export function validateWorldPatchDesignInput(snapshot, value, options) {
  if (bytes(value) > WORLD_PATCH_DESIGN_LIMITS.bytes) throw Error('Saved world patch design input byte quota exceeded');
  const expected = prepareWorldPatchDesignInput(snapshot, options);
  if (contextHash(value) !== contextHash(expected)) throw Error('World patch design input integrity/baseline mismatch');
  return expected;
}

/** Pure disclosure preview. This is neither consent, dispatch nor a reservation.
 * The future send page must disclose this NEW exact-data purpose explicitly;
 * a P3 summary-only analysis confirmation is not transferable to this input. */
export function buildWorldPatchDesignPrompt(snapshot, inputValue, userTask, options) {
  if (typeof userTask !== 'string' || !userTask.trim() || userTask.length > WORLD_PATCH_DESIGN_LIMITS.promptCharacters) throw Error('Invalid bounded world patch design task');
  const input = validateWorldPatchDesignInput(snapshot, inputValue, options);
  const prompt = WORLD_PATCH_DESIGN_RULES + '\n\n' + JSON.stringify({userTask, input});
  if (Buffer.byteLength(prompt) > WORLD_PATCH_DESIGN_LIMITS.bytes + 65536) throw Error('World patch design prompt byte quota exceeded');
  return freeze({purpose: 'world-patch-design-preview-not-sent', protocolHash: WORLD_PATCH_DESIGN_PROTOCOL_HASH,
    designInputHash: input.designInputHash, prompt, promptSha256: createHash('sha256').update(prompt).digest('hex'),
    modelSent: false, additionalModelCalls: 0, canAuthorizePlacement: false});
}

/** Diagnostic-only acceptance of a response; still no live-server attestation.
 * Commands and elevated authority are rejected by the existing proposal schema. */
export function compileWorldPatchDesignResponse(snapshot, inputValue, proposal, options) {
  validateWorldPatchDesignInput(snapshot, inputValue, options);
  const patch = compileWorldPatch(snapshot, proposal, options);
  // All BEFORE facts must be part of the exact edit region, not inferred LOD.
  for (const write of patch.writes) if (!pointInRegion(inputValue.edit, write.position)
    || readSnapshotCell(snapshot, write.position).state !== write.before) throw Error('Patch response is not bound to exact W baseline');
  return patch;
}

export function validateWorldPatchDesignWorkerInput(operation, value) {
  exactKeys(value, operation === 'prepare' ? ['snapshot'] : operation === 'prompt' ? ['snapshot', 'input', 'userTask']
    : operation === 'compile-response' ? ['snapshot', 'input', 'proposal']
    : operation === 'prepare-task' ? ['snapshot', 'intent'] : operation === 'review-task' ? ['snapshot', 'task', 'confirmation']
    : operation === 'prepare-candidate' ? ['snapshot', 'task', 'review', 'proposal'] : [], 'world patch design worker');
}
