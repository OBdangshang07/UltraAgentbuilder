import {makeBeforeCheckFixtures} from './world-patch-before-fixtures.mjs';
import {createContextSnapshot, readSnapshotBlockFact, contextHash} from '../src/world/context-snapshot.mjs';
import {compileWorldPatch} from '../src/world/world-patch.mjs';
import {prepareWorldPatchPreview} from '../src/world/world-patch-preview-data.mjs';
import {worldPatchDesignReviewProtocol} from '../src/world/world-patch-design-input.mjs';

/** Small FREE cross-language compiler examples, not template architecture. */
export function makePatchSafetyFixtures() {
  const bases = makeBeforeCheckFixtures().cases, valid = [], invalid = [];
  const snapshotOf = b => createContextSnapshot(b.selection, b.capture);
  const proposal = (b, operations) => ({format: 'WorldPatchProposal', version: 1, snapshotHash: b.snapshotHash, selectionHash: b.selectionHash, operations});
  const set = (position, after = 'minecraft:glass', before = 'minecraft:stone') => ({op: 'set', position, before, after});
  function changedBase(base, position, state, blockEntity = false) {
    const original = snapshotOf(base), capture = {fence: {start: 9, end: 9}, chunks: original.chunks.map(c => {
      if (c.coverage === 'unknown') return {x: c.x, z: c.z, coverage: 'unknown', palette: [], runs: []};
      const palette = [], ids = new Map(), runs = [];
      for (let y = c.region.min[1]; y < c.region.max[1]; y++) for (let z = c.region.min[2]; z < c.region.max[2]; z++) for (let x = c.region.min[0]; x < c.region.max[0]; x++) {
        const actual = readSnapshotBlockFact(original, [x, y, z]);
        const fact = position.join(',') === [x, y, z].join(',') ? {state, blockEntity} : {state: actual.state, blockEntity: actual.blockEntity};
        const identity = JSON.stringify(fact);let id = ids.get(identity);if (id === undefined) {id = palette.length;ids.set(identity, id);palette.push(fact);}
        const previous = runs.at(-1);if (previous?.[0] === id) previous[1]++;else runs.push([id, 1]);
      }
      return {x: c.x, z: c.z, coverage: 'known', palette, runs};
    })};
    const snapshot = createContextSnapshot(base.selection, capture);
    return {...base, capture, snapshotHash: snapshot.snapshotHash, selectionHash: snapshot.selectionHash};
  }
  function accept(name, base, operations) {
    const raw = proposal(base, operations), snapshot = snapshotOf(base), patch = compileWorldPatch(snapshot, raw);
    valid.push({name, selection: base.selection, capture: base.capture, raw, responseHash: contextHash(raw), patch, preview: prepareWorldPatchPreview(snapshot, patch)});
  }
  function reject(name, base, raw) {
    let reason;try {compileWorldPatch(snapshotOf(base), raw);} catch (error) {reason = error.message;}
    if (!reason) throw new Error('Unsafe fixture unexpectedly accepted: ' + name);
    invalid.push({name, selection: base.selection, capture: base.capture, raw, reason});
  }
  accept('single-replacement', bases[0], [set([0, 0, 0])]);
  accept('unknown-kept-outside-explicit-changes', bases[1], [set([0, 0, 0])]);
  accept('clear-set-and-protected-keep', bases[0], [{op: 'keep', position: [-2, -1, -1], before: 'minecraft:stone'},
    {op: 'clear', position: [1, 0, 0], before: 'minecraft:stone'}, set([0, 0, 0])]);
  const air = changedBase(bases[0], [0, 0, 0], 'minecraft:cave_air');accept('explicit-air-addition', air, [set([0, 0, 0], 'minecraft:glass', 'minecraft:cave_air')]);
  accept('canonical-special-state', bases[0], [set([0, 0, 0], 'minecraft:oak_stairs[waterlogged=false,shape=inner_left,half=top,facing=east]')]);
  const grass = changedBase(changedBase(bases[0], [0, 0, 0], 'minecraft:grass_block[snowy=false]'), [0, -1, 0], 'minecraft:dirt');
  accept('ordinary-grass-paving-above-dirt', grass, [set([0, 0, 0], 'minecraft:smooth_stone', 'minecraft:grass_block[snowy=false]')]);
  const bench = changedBase(changedBase(bases[0], [0, 0, 0], 'minecraft:air'), [0, -1, 0], 'minecraft:grass_block[snowy=false]');
  accept('ordinary-grass-neighbor-bench', bench, [set([0, 0, 0], 'minecraft:quartz_block', 'minecraft:air')]);
  for (const [name, operations] of [
    ['outside-W', [set([-3, 0, 0])]], ['protected-write', [set([-2, -1, -1])]],
    ['changed-BEFORE', [set([0, 0, 0], 'minecraft:glass', 'minecraft:air')]], ['SET-air-not-CLEAR', [set([0, 0, 0], 'minecraft:air')]],
    ['no-op', [set([0, 0, 0], 'minecraft:stone')]], ['duplicate-coordinate', [set([0, 0, 0]), set([0, 0, 0])]],
    ['fractional-coordinate', [set([0.5, 0, 0])]], ['keep-only', [{op: 'keep', position: [0, 0, 0], before: 'minecraft:stone'}]],
    ['missing-stair-properties', [set([0, 0, 0], 'minecraft:oak_stairs[facing=east]')]],
    ['waterlogged-stair', [set([0, 0, 0], 'minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=true]')]],
    ['gravity-target', [set([0, 0, 0], 'minecraft:sand')]], ['unknown-mod-target', [set([0, 0, 0], 'testmod:wall')]],
    ['door-target', [set([0, 0, 0], 'minecraft:oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]')]],
    ['trapdoor-target', [set([0, 0, 0], 'minecraft:oak_trapdoor[facing=north,half=bottom,open=false,powered=false,waterlogged=false]')]],
    ['light-target', [set([0, 0, 0], 'minecraft:light[level=15]')]],
  ]) reject(name, bases[0], proposal(bases[0], operations));
  reject('unknown-write', bases[1], proposal(bases[1], [set([17, 0, 0])]));
  reject('clear-air-no-op', air, proposal(air, [{op: 'clear', position: [0, 0, 0], before: 'minecraft:cave_air'}]));
  reject('unexpected-command', bases[0], {...proposal(bases[0], [set([0, 0, 0])]), command: '/fill'});
  for (const [name, state, entity] of [
    ['fluid-neighbor', 'minecraft:water[level=0]', false], ['entity-neighbor', 'minecraft:chest[facing=north,type=single,waterlogged=false]', true],
    ['stair-neighbor', 'minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]', false],
    ['coupled-neighbor', 'minecraft:oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]', false],
    ['mod-neighbor', 'testmod:wall', false], ['unclassified-neighbor', 'minecraft:stone[unknown=true]', false],
    ['snowy-grass-unverified-neighbor', 'minecraft:grass_block[snowy=true]', false],
  ]) {
    const base = changedBase(bases[0], [1, 0, 0], state, entity);reject(name, base, proposal(base, [set([0, 0, 0])]));
  }
  const boundary = structuredClone(bases[0]);boundary.selection.edit = structuredClone(boundary.selection.context);
  const bounded = snapshotOf(boundary);boundary.snapshotHash = bounded.snapshotHash;boundary.selectionHash = bounded.selectionHash;
  reject('missing-captured-neighbor', boundary, proposal(boundary, [set([-4, 0, 0])]));
  const localProtocol = worldPatchDesignReviewProtocol(), catalogStates = [], catalogGlassBase=changedBase(bases[0],[0,0,0],'minecraft:glass');
  for (const row of localProtocol.targetCatalog) {
    const properties=Object.entries(row.properties);const visit=(index,values)=>{
      if(index===properties.length){const state=row.id+(values.length?'['+values.join(',')+']':'');
        const base=state==='minecraft:stone'?catalogGlassBase:bases[0],before=state==='minecraft:stone'?'minecraft:glass':'minecraft:stone';
        const patch=compileWorldPatch(snapshotOf(base),proposal(base,[set([0,0,0],state,before)]));catalogStates.push({state,before,patchHash:patch.patchHash});return;}
      const [key,choices]=properties[index];for(const value of choices)visit(index+1,[...values,key+'='+value]);
    };visit(0,[]);
  }
  return {format: 'ServerPatchSafetyFixtures', version: 1, realModelCalls: 0, worldWrites: 0, valid, invalid, localProtocol, catalogStates,
    catalogGlassBase:{selection:catalogGlassBase.selection,capture:catalogGlassBase.capture}};
}
