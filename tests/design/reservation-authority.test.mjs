import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyReservationAuthority} from '../../src/design/reservation-authority.mjs';
import {assessSceneCheckpoint} from '../../src/design/checkpoint.mjs';
import {applyPackageEdit} from '../../contracts/scene-assembly.schema.mjs';
import {basicScene, mass, shape, at} from './fixtures.mjs';

function fixture() {
  const scene = basicScene('reservation-authority-offline');
  scene.components = [mass('host', [4, 0, 6], [12, 10, 12]), shape('front', [5, 1, 7], [1, 2, 1]), shape('foreign', [6, 1, 7], [1, 2, 1])];
  scene.reservations = [{id: 'core-capacity', at: at([1, 1, 1], 'host'), size: [3, 3, 3], allowedComponents: ['front', 'foreign']}];
  scene.constraints.passages = [{origin: [10, 1, 14], size: [1, 2, 1]}];
  const task = {id: 'typical', name: 'Offline scope fixture', purpose: 'Text ownership does not grant reservation authority', dependsOn: [],
    editableComponents: ['front'], interfaces: [], regions: [{origin: [4, 0, 6], size: [12, 10, 12]}]};
  const edit = {format: 'SceneDraftEdit', version: 1, sourceHash: hash(scene), components: {put: [], remove: []}, modules: {put: [], remove: []},
    palette: {put: [], remove: []}, reservations: {put: [], remove: []}, design: null, featureBindings: null, constraints: null};
  return {scene, task, edit};
}

test('reservation summary uses compiler-resolved anchors and exact task-owned allowlists without mutation', () => {
  const {scene, task} = fixture(), before = hash({scene, task}), result = assemblyReservationAuthority(scene, task);
  assert.equal(result.sourceHash, hash(scene)); assert.equal(result.taskHash, hash(task));
  const {authorityHash, ...data} = result; assert.equal(authorityHash, hash(data));
  assert.equal(result.reservationsFrozen, true); assert.equal(result.reservationsPutRemoveAllowed, false); assert.equal(result.scopeExpanded, false);
  assert.deepEqual(result.reservations[0], {id: 'core-capacity', origin: [5, 1, 7], size: [3, 3, 3], intersectsTaskRegions: true,
    allowedComponents: ['front', 'foreign'], permittedTaskOwnedSources: ['front'], permittedButForeignSources: ['foreign'], newNamespacedSolidsAllowedByDefault: false});
  result.reservations[0].allowedComponents.push('typical__fake'); assert.equal(hash({scene, task}), before);
});

test('an authorized existing producer can be refined, but new namespaced solids STILL fail reservation checks', () => {
  const {scene, task, edit} = fixture(), original = hash(scene);
  const baseline = assessSceneCheckpoint(scene); assert.equal(baseline.report.geometryPassed, true, baseline.report.error);
  edit.components.put = [{...structuredClone(scene.components[1]), material: 'wall'}];
  const refined = applyPackageEdit(scene, edit, task).scene;
  assert.equal(assessSceneCheckpoint(refined).report.geometryPassed, true);
  const unauthorized = structuredClone(edit); unauthorized.components.put = [shape('typical__new', [7, 1, 7], [1, 2, 1])];
  const rejected = assessSceneCheckpoint(applyPackageEdit(scene, unauthorized, task).scene);
  assert.equal(rejected.report.geometryPassed, false);
  assert.ok(rejected.report.diagnostics.some(d => d.code === 'reservation' && d.from === 'core-capacity' && d.to === 'typical__new'));
  assert.equal(hash(scene), original);
});

test('purpose, region, namespace or overwrite cannot amend a frozen reservation', () => {
  const {scene, task, edit} = fixture();
  edit.reservations.put = [{...structuredClone(scene.reservations[0]), allowedComponents: ['front', 'foreign', 'typical__new']}];
  edit.components.put = [shape('typical__new', [7, 1, 7], [1, 2, 1], 'frame', {allowOverwrite: ['host', 'foreign']})];
  assert.throws(() => applyPackageEdit(scene, edit, task), /cannot change global design, interfaces, reservations/);
  const foreign = fixture(); foreign.edit.components.put = [{...structuredClone(scene.components[2]), material: 'wall'}];
  assert.throws(() => applyPackageEdit(foreign.scene, foreign.edit, foreign.task), /outside package ownership/);
});

test('outside reservations and bad source references are disclosed, not silently repaired or omitted', () => {
  const {scene, task} = fixture(); task.regions = [{origin: [20, 0, 20], size: [2, 2, 2]}];
  assert.equal(assemblyReservationAuthority(scene, task).reservations[0].intersectsTaskRegions, false);
  scene.reservations[0].allowedComponents.push('future');
  assert.throws(() => assemblyReservationAuthority(scene, task), /Unknown component/);
});
