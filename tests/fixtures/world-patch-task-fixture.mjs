import {regionCells, selectionChunks} from '../../contracts/world-selection.mjs';
import {createContextSnapshot} from '../../src/world/context-snapshot.mjs';

export function patchTaskSnapshot({revision = 3, fence = 4, unknown = false, protectedCell = false} = {}) {
  const selection = {format: 'WorldSelection', version: 1,
    world: {worldId: 'patch_task_fixture', dimension: 'minecraft:overworld', minY: -64, maxY: 320}, revision,
    context: {min: [-2, -62, -2], max: [3, -57, 3]}, edit: {min: [-1, -61, -1], max: [2, -58, 2]},
    protected: protectedCell ? [{min: [0, -60, 0], max: [1, -59, 1]}] : []};
  return createContextSnapshot(selection, {fence: {start: fence, end: fence}, chunks: selectionChunks(selection).map(c => unknown
    ? {x: c.x, z: c.z, coverage: 'unknown', palette: [], runs: []}
    : {x: c.x, z: c.z, coverage: 'known', palette: [{state: 'minecraft:stone', blockEntity: false}], runs: [[0, regionCells(c.region)]]})});
}
export function patchTaskIntent(changes = {}) {
  return {format: 'WorldPatchDesignIntent', version: 1, purpose: 'world-patch-design', agent: 'codex',
    model: 'gpt-6.1-sol', effort: 'max', prompt: '  在原选区设计石材与玻璃入口，保留周围环境。  ', maximumCalls: 1, ...changes};
}
export const patchTaskConfirmation = task => ({format: 'WorldPatchDesignConfirmation', version: 1, purpose: 'world-patch-design',
  confirmed: true, requestHash: task.requestHash, disclosureHash: task.disclosure.disclosureHash, promptSha256: task.request.promptSha256});
export const patchTaskProposal = snapshot => ({format: 'WorldPatchProposal', version: 1, snapshotHash: snapshot.snapshotHash,
  selectionHash: snapshot.selectionHash, operations: [{op: 'set', position: [0, -60, 0], before: 'minecraft:stone', after: 'minecraft:glass'}]});
