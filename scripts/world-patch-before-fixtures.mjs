import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {selectionChunks, regionCells} from '../contracts/world-selection.mjs';
import {createContextSnapshot, readSnapshotBlockFact} from '../src/world/context-snapshot.mjs';
import {compileWorldPatch} from '../src/world/world-patch.mjs';
import {prepareWorldPatchPreview} from '../src/world/world-patch-preview-data.mjs';

/** Tiny, actual Node-contract fixtures for Java BEFORE tests. No Bridge,
 * adapters, account discovery, Minecraft, NBT, model calls or world writes. */
export function makeBeforeCheckFixtures() {
  const cases = [];
  for (const name of ['uniform', 'mixed-unknown']) {
    const mixed = name === 'mixed-unknown';
    const selection = {format: 'WorldSelection', version: 1,
      world: {worldId: 'before_fixture', dimension: 'minecraft:overworld', minY: -64, maxY: 320}, revision: 7,
      context: {min: [-4, -4, -4], max: [mixed ? 20 : 4, 4, 4]},
      edit: {min: [-2, -1, -1], max: [mixed ? 18 : 2, 1, 1]},
      protected: [{min: [-2, -1, -1], max: [-1, 0, 0]}]};
    const capture = {fence: {start: 9, end: 9}, chunks: selectionChunks(selection).map(c => {
      if (mixed && c.x === 1) return {x: c.x, z: c.z, coverage: 'unknown', palette: [], runs: []};
      const palette = [], indexes = new Map(), runs = [];
      for (let y = c.region.min[1]; y < c.region.max[1]; y++)
        for (let z = c.region.min[2]; z < c.region.max[2]; z++)
          for (let x = c.region.min[0]; x < c.region.max[0]; x++) {
            const fact = mixed && x === 2 && y === 0 && z === 0
              ? {state: 'minecraft:oak_stairs[waterlogged=false,shape=straight,half=top,facing=north]', blockEntity: false}
              : mixed && x === 3 && y === 0 && z === 0
                ? {state: 'minecraft:chest[facing=north,type=single,waterlogged=false]', blockEntity: true}
                : {state: 'minecraft:stone', blockEntity: false};
            const identity = JSON.stringify(fact);let id = indexes.get(identity);
            if (id === undefined) {id = palette.length;indexes.set(identity, id);palette.push(fact);}
            const last = runs.at(-1);if (last?.[0] === id) last[1]++;else runs.push([id, 1]);
          }
      assert.equal(runs.reduce((n, r) => n + r[1], 0), regionCells(c.region));
      return {x: c.x, z: c.z, coverage: 'known', palette, runs};
    })};
    const snapshot = createContextSnapshot(selection, capture);
    const patch = compileWorldPatch(snapshot, {format: 'WorldPatchProposal', version: 1,
      snapshotHash: snapshot.snapshotHash, selectionHash: snapshot.selectionHash,
      operations: [{op: 'set', position: [0, 0, 0], before: 'minecraft:stone', after: 'minecraft:glass'}]});
    const preview = prepareWorldPatchPreview(snapshot, patch);
    const points = [[0, 0, 0], [-2, -1, -1], [2, 0, 0], [3, 0, 0], ...(mixed ? [[17, 0, 0]] : [])];
    cases.push({name, selection, capture, snapshotHash: snapshot.snapshotHash, selectionHash: snapshot.selectionHash,
      contextRevision: 9, preview, facts: points.map(position => ({position, fact: readSnapshotBlockFact(snapshot, position)}))});
  }
  return {format: 'ServerBeforeCheckFixtures', version: 1, realModelCalls: 0, worldWrites: 0, cases};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2);
  const project = fileURLToPath(new URL('../', import.meta.url));
  const output = path.join(project, 'mod/build/test-fixtures/world-patch-before.json');
  const value = makeBeforeCheckFixtures();await fs.mkdir(path.dirname(output), {recursive: true});
  await fs.writeFile(output, JSON.stringify(value));
  console.log(JSON.stringify({result: 'fixture-generation-passed', output, cases: value.cases.length,
    bytes: Buffer.byteLength(JSON.stringify(value)), realModelCalls: 0, worldWrites: 0, javaTestsRun: false}));
}
