import {hash, LIMITS} from '../generation/compiler.mjs';
import {parseState, stateText, validateState, supportedBlockStateCatalog} from '../generation/block-states.mjs';
import {validateContextSnapshot, readSnapshotCell, readSnapshotBlockFact, contextHash} from './context-snapshot.mjs';
import {worldPatchStateRestriction} from './world-patch.mjs';
import {pointInRegion} from '../../contracts/world-selection.mjs';
import {WORLD_ASSEMBLY_LIMITS} from '../../contracts/world-assembly-limits.mjs';
import {ASSEMBLY_COUPLING_POLICY} from '../../contracts/assembly-coupling-policy.mjs';

// An independently versioned READ-ONLY analysis, not WorldPatch v1, a new
// candidate format or a placement capability. Nothing calls this from SEND.
export const ASSEMBLY_COUPLING_ANALYSIS_POLICY = 'whole-native-new-door-analysis-v1';
const directions = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]];
const air = state => ['minecraft:air','minecraft:cave_air','minecraft:void_air'].includes(state);
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};

// Explicit 1.20.1 upper-face whitelist. New materials do NOT automatically
// acquire support semantics. Native shape tests check every admitted variant;
// a server must still check the actual final state before any future write.
const fullCubes = new Set(ASSEMBLY_COUPLING_POLICY.fullUpperFaceIds);

/** Conservative data claim about the UP face only, never generic "solid".
 * This policy does not admit air, doors or trapdoors as supports. A false value
 * is conservative, not a claim that every Vanilla UP shape is partial. */
export function assemblyUpperFaceSupport(state) {
  try {
    validateState(state);
    const {id, properties:p} = parseState(state);
    return fullCubes.has(id) || id.endsWith('_slab') && ['top','double'].includes(p.type)
      || id.endsWith('_stairs') && p.half === 'top';
  } catch { return false; }
}

/** All finite supported variants for an independent Vanilla shape oracle.
 * Deliberately includes negative cases; callers cannot supply an allowlist. */
export function assemblySupportStateCases() {
  const cases = ['minecraft:air','minecraft:cave_air','minecraft:void_air'];
  for (const {id,properties} of supportedBlockStateCatalog()) {
    let variants = [{}];
    for (const [key,choices] of Object.entries(properties)) variants = variants.flatMap(p => choices.map(value => ({...p,[key]:value})));
    cases.push(...variants.map(properties => stateText({id,properties})));
  }
  return cases.map(state => ({state, fullUpperFace:assemblyUpperFaceSupport(state)}));
}

function nativeInput(snapshot, native, signal) {
  const manifest = native?.manifest ? structuredClone(native.manifest) : null;
  const {assetHash,...metadata} = manifest ?? {};
  if (!manifest || Object.hasOwn(manifest,'diagnosticOnly') && manifest.diagnosticOnly !== false || hash(metadata) !== assetHash || !(native?.binary instanceof Uint8Array))
    throw Error('Exact eligible native asset required for coupling analysis; no diagnostic assets');
  const {width:w,height:h,length:d} = manifest.dimensions ?? {}, edit = snapshot.selection.edit;
  if (![w,h,d].every(n => Number.isSafeInteger(n) && n > 0) || w > LIMITS.width || h > LIMITS.height || d > LIMITS.length
    || w*h*d > LIMITS.cells || [w,h,d].some((n,axis) => n > edit.max[axis]-edit.min[axis]) || native.binary.byteLength !== w*h*d*2)
    throw Error('Coupling analysis native dimensions exceed original W; no clipping or relocation');
  // Bound allocations first, then own the bytes before inspecting them.
  const bytes = Buffer.from(native.binary);
  if (hash(bytes) !== manifest.cellsHash) throw Error('Coupling analysis native cells hash mismatch');
  const palette = manifest.palette;
  if (!Array.isArray(palette) || palette.length < 2 || palette.length > 256 || palette.some(state=>typeof state!=='string'||!state.length||state.length>512)
    || palette[0] !== '@keep' || palette[1] !== 'minecraft:air')
    throw Error('Coupling analysis requires exact native KEEP/CLEAR palette');
  const used = new Set(); let sets = 0, clears = 0;
  for (let i = 0; i < w*h*d; i++) {
    if (!(i % 1024)) signal?.throwIfAborted();
    const n = bytes.readUInt16LE(i*2);
    if (n >= palette.length) throw Error('Coupling analysis native palette index outside original asset');
    if (n >= 2) { sets++; used.add(n); } else if (n === 1) clears++;
  }
  if (sets !== manifest.setCount || clears !== manifest.clearCount) throw Error('Coupling analysis native set/clear counts mismatch');
  const states = new Map();
  for (const n of used) {
    const text = palette[n]; validateState(text); const state = parseState(text);
    if (stateText(state) !== text || air(text)) throw Error('Coupling analysis requires canonical non-air SET states');
    if (state.id.endsWith('_leaves') || state.id === 'minecraft:light') throw Error('Coupling analysis does not resolve leaves or light states');
    states.set(n,state);
  }
  return {manifest,bytes,palette,states,w,h,d};
}

/** Check the COMPLETE native AFTER against the original captured BEFORE.
 * Parts are never input or grouping boundaries. Old coupled BEFORE blocks and
 * unsafe neighbors remain protected; this does not implement group-aware P2
 * edits, Java application, scheduling, journals, rollback or server physics. */
export function analyzeAssemblyCoupling(snapshotValue, native, {signal} = {}) {
  signal?.throwIfAborted();
  const snapshot = validateContextSnapshot(snapshotValue), s = snapshot.selection;
  const {manifest,bytes,palette,states,w,h,d} = nativeInput(snapshot,native,signal), plane = w*d;
  const origin = s.edit.min, volume = w*h*d, groups = [];
  const counts = {door:0,trapdoor:0,stairs:0,slab:0,static:0}, beforeStates = new Set();
  let operationCount = 0, baselineReads = 0, accountedBytes = 4096;
  const position = i => [i % w,Math.floor(i/plane),Math.floor(i/w) % d].map((n,axis) => n+origin[axis]);
  function baseline(point) {
    if (!pointInRegion(s.context,point)) throw Error('Coupling analysis requires captured six-neighbor closure inside C; no scope enlargement');
    const fact = readSnapshotBlockFact(snapshot,point); baselineReads++;
    if (fact.coverage !== 'known') throw Error('Coupling analysis cannot use UNKNOWN baseline or neighbor');
    return fact;
  }
  function staticBefore(state) {
    if (!beforeStates.has(state)) {
      const reason = worldPatchStateRestriction(state);
      if (reason) throw Error('Coupling analysis retains protected/static BEFORE policy: ' + reason);
      beforeStates.add(state);
    }
  }
  function guard(point, neighbor = false) {
    const fact = baseline(point);
    if (fact.blockProtection !== null) throw Error('Coupling analysis unsafe BEFORE/neighbor: ' + fact.blockProtection);
    staticBefore(fact.state);
    if (neighbor && parseState(fact.state).id.endsWith('_stairs')) throw Error('Coupling analysis retains adjacent BEFORE stair protection');
    return fact;
  }
  // First check ALL changes and the captured six-neighbor closure, before any
  // group result. An explicit no-op has the same KEEP semantics as old lowering.
  for (let i = 0; i < volume; i++) {
    if (!(i % 1024)) signal?.throwIfAborted();
    const n = bytes.readUInt16LE(i*2); if (!n) continue;
    const point = position(i), before = baseline(point), after = palette[n];
    if (n >= 2) {
      const {id} = states.get(n);
      counts[id.endsWith('_door')?'door':id.endsWith('_trapdoor')?'trapdoor':id.endsWith('_stairs')?'stairs':id.endsWith('_slab')?'slab':'static']++;
    }
    if (before.state === after || n === 1 && air(before.state)) continue;
    const scoped = readSnapshotCell(snapshot,point);
    if (scoped.protected) throw Error('Coupling analysis writes protected BEFORE: ' + scoped.reason);
    guard(point);
    for (const offset of directions) guard(point.map((n,axis) => n+offset[axis]),true);
    operationCount++;
  }
  if (!operationCount) throw Error('Coupling analysis has no explicit world changes');
  for (let i = 0; i < volume; i++) {
    if (!(i % 1024)) signal?.throwIfAborted();
    const a = states.get(bytes.readUInt16LE(i*2));
    if (!a?.id.endsWith('_door')) continue;
    const lower = a.properties.half === 'lower', other = i+(lower?plane:-plane), y = Math.floor(i/plane);
    const b = y+(lower?1:-1) < 0 || y+(lower?1:-1) >= h ? null : states.get(bytes.readUInt16LE(other*2));
    if (!b || b.id !== a.id || b.properties.half !== (lower?'upper':'lower')
      || ['facing','hinge','open','powered'].some(key => a.properties[key] !== b.properties[key]))
      throw Error('Coupling analysis door needs both explicit matching native halves at ' + position(i).join(','));
    if (!lower) continue;
    const below = position(i).map((n,axis) => n-(axis===1?1:0));
    const supportIndex = y ? bytes.readUInt16LE((i-plane)*2) : 0;
    const supportState = supportIndex ? palette[supportIndex] : baseline(below).state;
    if (!assemblyUpperFaceSupport(supportState)) throw Error('Coupling analysis door lacks final full upper-face support at ' + below.join(','));
    const group = {kind:'door-pair',indices:[i,other],positions:[position(i),position(other)],
      states:[palette[bytes.readUInt16LE(i*2)],palette[bytes.readUInt16LE(other*2)]],
      support:{position:below,state:supportState,source:supportIndex?'native-after':'snapshot-keep'}};
    accountedBytes += Buffer.byteLength(JSON.stringify(group))+1;
    if (accountedBytes > WORLD_ASSEMBLY_LIMITS.proposalBytes) throw Error('Coupling analysis report byte quota; no partial report');
    groups.push(group);
  }
  signal?.throwIfAborted();
  const content = {format:'AssemblyCouplingAnalysis',version:1,policy:ASSEMBLY_COUPLING_ANALYSIS_POLICY,
    snapshotHash:snapshot.snapshotHash,selectionHash:snapshot.selectionHash,assetHash:manifest.assetHash,cellsHash:manifest.cellsHash,
    origin:[...origin],dimensions:{width:w,height:h,length:d},operationCount,baselineReads,counts,groups,
    omittedCells:'keep',groupScope:'complete-native-not-parts',existingCoupledBeforeWritesAllowed:false,
    trapdoorSupport:'no-attachment-requirement-vanilla-1.20.1',
    dataSupportChecked:true,serverBaselineVerified:false,physicsVerified:false,
    applicationIntegrated:false,canAuthorizePlacement:false,worldWrites:0};
  return freeze({...content,analysisHash:contextHash(content)});
}

/** Rebuild from original inputs. A hash or a saved report cannot grant trust. */
export function validateAssemblyCouplingAnalysis(snapshot, native, value, options) {
  const rebuilt = analyzeAssemblyCoupling(snapshot,native,options);
  if (contextHash(rebuilt) !== contextHash(value)) throw Error('Saved coupling analysis differs from whole original inputs');
  return rebuilt;
}
