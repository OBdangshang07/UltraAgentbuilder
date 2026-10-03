import {validateWorldPatchProposal, comparePatchPoints, WORLD_PATCH_LIMITS} from '../../contracts/world-patch.mjs';
import {pointInRegion, exactKeys} from '../../contracts/world-selection.mjs';
import {validateState, parseState} from '../generation/block-states.mjs';
import {validateContextSnapshot, readSnapshotCell, readSnapshotBlockFact, contextHash, snapshotStaleness} from './context-snapshot.mjs';

const verified = new WeakMap();
const air = state => ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(state);
const key = point => point.join(',');
const directions = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

/** v1 intentionally excludes coupled/support-sensitive/redstone/dynamic blocks.
 * New-building special-block support is NOT permission to edit arbitrary worlds. */
function staticPatchState(state) {
  const restriction = worldPatchStateRestriction(state);
  if (restriction !== null) throw new Error(restriction);
}

/** Shared explanation for model-input catalogs and the unchanged v1 compiler.
 * A null reason concerns the state only, NOT scope, neighbors or write authority. */
export function worldPatchStateRestriction(state) {
  if (air(state)) return null;
  try {
    validateState(state);
    const {id} = parseState(state);
    if (/(?:_door|_trapdoor|_leaves)$/.test(id) || id === 'minecraft:light') return 'Patch v1 needs a separate coupling/support policy for ' + id;
    return null;
  } catch (error) { return error.message; }
}

/** Pure offline compiler: exact W-P changes with original BEFORE facts.
 * This is not a physics simulator or server attestation. Run in a worker when
 * exposed to interactive clients; never compile a whole patch on a game tick. */
export function compileWorldPatch(snapshotValue, proposalValue, {signal} = {}) {
  signal?.throwIfAborted();
  const snapshot = validateContextSnapshot(snapshotValue), selection = snapshot.selection;
  const proposal = validateWorldPatchProposal(proposalValue);
  if (proposal.snapshotHash !== snapshot.snapshotHash || proposal.selectionHash !== snapshot.selectionHash) throw new Error('Patch baseline identity mismatch');
  const writes = [], guards = new Map();
  let accountedBytes = Buffer.byteLength(JSON.stringify(proposal)) + 4096;
  function account(bytes) {
    accountedBytes += bytes;
    if (accountedBytes > WORLD_PATCH_LIMITS.bytes) throw new Error('Compiled world patch byte quota exceeded');
  }
  let explicitKeeps = 0;
  function guard(position, role) {
    if (!pointInRegion(selection.context, position)) throw new Error('Patch requires an explicitly captured neighbor inside C; scope will not be enlarged');
    const cell = readSnapshotBlockFact(snapshot, position);
    if (cell.coverage !== 'known') throw new Error('Patch cannot use an unknown baseline/neighbor');
    const id = key(position), prior = guards.get(id);
    if (!prior) {
      const item = {position: [...position], before: cell.state, blockEntity: cell.blockEntity, roles: [role]};
      account(Buffer.byteLength(JSON.stringify(item)) + 1); guards.set(id, item);
    } else if (!prior.roles.includes(role)) { account(Buffer.byteLength(JSON.stringify(role)) + 1); prior.roles.push(role); }
    return cell;
  }
  for (let i = 0; i < proposal.operations.length; i++) {
    if (!(i % 1024)) signal?.throwIfAborted();
    const item = proposal.operations[i], position = item.position;
    if (!pointInRegion(selection.edit, position)) throw new Error('Patch operation outside approved W');
    const before = readSnapshotCell(snapshot, position);
    if (before.coverage !== 'known') throw new Error('Patch cannot use an unknown baseline');
    if (before.state !== item.before) throw new Error('Patch BEFORE differs from the original snapshot');
    if (item.op === 'keep') { explicitKeeps++; continue; }
    if (before.protected) throw new Error('Patch writes protected baseline: ' + before.reason);
    staticPatchState(before.state);
    const after = item.op === 'clear' ? 'minecraft:air' : item.after;
    if (item.op === 'set' && air(after)) throw new Error('SET air is not an explicit CLEAR operation');
    staticPatchState(after);
    if (air(before.state) && air(after) || before.state === after) throw new Error('No-op write; use KEEP or omit the cell');
    guard(position, 'write');
    for (const offset of directions) {
      const neighbor = position.map((n, axis) => n + offset[axis]);
      const fact = guard(neighbor, 'neighbor');
      // User-protected static neighbors remain readable; hazardous states do not.
      if (fact.blockProtection !== null) throw new Error('Unsafe patch neighbor: ' + fact.blockProtection);
      staticPatchState(fact.state);
      // Stair shape may update adjacent stairs. Until Java enforces update flags
      // and full neighbor closure, do not promise an unchanged outside stair.
      if (parseState(fact.state).id.endsWith('_stairs')) throw new Error('Patch v1 does not yet verify adjacent stair shape updates');
    }
    const write = {position: [...position], before: before.state, after, action: item.op,
      difference: air(before.state) ? 'added' : air(after) ? 'removed' : 'replaced'};
    account(Buffer.byteLength(JSON.stringify(write)) + 1); writes.push(write);
  }
  if (!writes.length) throw new Error('Patch has no explicit changes');
  const sortedGuards = [...guards.values()].sort((a, b) => comparePatchPoints(a.position, b.position));
  for (const item of sortedGuards) item.roles.sort();
  const bounds = {min: [...writes[0].position], max: writes[0].position.map(n => n + 1)};
  const counts = {added: 0, removed: 0, replaced: 0};
  for (const item of writes) {
    counts[item.difference]++;
    item.position.forEach((n, axis) => { bounds.min[axis] = Math.min(bounds.min[axis], n); bounds.max[axis] = Math.max(bounds.max[axis], n + 1); });
  }
  const content = {format: 'WorldPatch', version: 1, policy: 'static-proposal-data-v1',
    snapshotHash: snapshot.snapshotHash, selectionHash: snapshot.selectionHash,
    world: {...selection.world}, selectionRevision: selection.revision, contextRevision: snapshot.fence.end,
    proposal, proposalHash: contextHash(proposal), writes, guards: sortedGuards,
    summary: {writes: writes.length, explicitKeeps, omittedCells: 'keep', counts, bounds},
    canAuthorizePlacement: false, serverBaselineVerified: false, physicsVerified: false};
  signal?.throwIfAborted();
  if (Buffer.byteLength(JSON.stringify(content)) + 128 > WORLD_PATCH_LIMITS.bytes) throw new Error('Compiled world patch byte quota exceeded');
  const result = freeze({...content, patchHash: contextHash(content)});
  verified.set(result, snapshot.snapshotHash); return result;
}

/** Rebuild all saved diff/guard facts, not just a self-reported digest. */
export function validateWorldPatch(snapshotValue, value, options) {
  options?.signal?.throwIfAborted();
  const snapshot = validateContextSnapshot(snapshotValue);
  if (verified.get(value) === snapshot.snapshotHash) return value;
  if (Buffer.byteLength(JSON.stringify(value)) > WORLD_PATCH_LIMITS.bytes) throw new Error('Saved world patch byte quota exceeded');
  exactKeys(value, ['format', 'version', 'policy', 'snapshotHash', 'selectionHash', 'world', 'selectionRevision', 'contextRevision',
    'proposal', 'proposalHash', 'writes', 'guards', 'summary', 'canAuthorizePlacement', 'serverBaselineVerified', 'physicsVerified', 'patchHash'], 'saved world patch');
  const rebuilt = compileWorldPatch(snapshot, value?.proposal, options);
  if (contextHash(rebuilt) !== contextHash(value)) throw new Error('Saved world patch integrity mismatch');
  return rebuilt;
}

/** Read-only comparison against a SECOND precise capture of the SAME selection.
 * Even an unrelated C change refuses the old proposal in v1. Never quietly
 * rebase to the new snapshot, drop conflicts or authorize the remaining cells. */
export function checkWorldPatchBaseline(originalSnapshot, patchValue, currentSnapshotValue, {signal} = {}) {
  const patch = validateWorldPatch(originalSnapshot, patchValue, {signal});
  const current = validateContextSnapshot(currentSnapshotValue), s = current.selection;
  const stale = snapshotStaleness(originalSnapshot, {worldId: s.world.worldId, dimension: s.world.dimension,
    selectionRevision: s.revision, contextRevision: current.fence.end});
  const identityChanged = current.selectionHash !== patch.selectionHash;
  const conflicts = [];
  if (!identityChanged) for (let i = 0; i < patch.guards.length; i++) {
    if (!(i % 1024)) signal?.throwIfAborted();
    const guard = patch.guards[i], actual = readSnapshotBlockFact(current, guard.position);
    if (actual.coverage !== 'known' || actual.state !== guard.before || actual.blockEntity !== guard.blockEntity) conflicts.push({position: [...guard.position],
      expected: {state: guard.before, blockEntity: guard.blockEntity}, actual: {state: actual.state, blockEntity: actual.blockEntity},
      coverage: actual.coverage, roles: [...guard.roles]});
  }
  signal?.throwIfAborted();
  const unchangedSnapshot = current.snapshotHash === patch.snapshotHash;
  return freeze({format: 'WorldPatchBaselineCheck', version: 1, patchHash: patch.patchHash,
    originalSnapshotHash: patch.snapshotHash, currentSnapshotHash: current.snapshotHash,
    result: stale || identityChanged || !unchangedSnapshot || conflicts.length ? 'conflict' : 'unchanged',
    reason: stale ?? (identityChanged ? 'selection-facts-changed' : !unchangedSnapshot ? 'snapshot-facts-changed' : null),
    conflicts, canAuthorizePlacement: false, serverBaselineVerified: false});
}
