import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../../src/generation/compiler.mjs';
import {prototypeSurfaceGuidance, BLUEPRINT_SURFACE_RULES, ROLE_SURFACE_RULES} from '../../contracts/scene-prototype-surface-guidance.mjs';
import {assessSceneCheckpoint} from '../../src/design/checkpoint.mjs';
import {checkPackageGeometry} from '../../src/design/assembly-scope.mjs';
import {basicScene, mass, at} from './fixtures.mjs';

// Real compiler/owner checks on hand-authored geometry. Not AI quality evidence.
function fixture() {
  const scene = basicScene('surface-scope');
  scene.constraints = {interior: true, walkable: true, passages: [{origin: [8,1,8], size: [1,2,1]}]};
  scene.components = [mass('tower', [2,0,2], [10,9,10], [4])];
  const room = {id: 'office_base', kind: 'roomZone', host: 'tower', at: at([3,0,3]), size: [3,4,3],
    repeat: {count: 2, step: [0,4,0]}, allowOverwrite: [], use: 'room', purpose: 'Offline surface mechanism fixture',
    floorMaterial: 'floor', boundaries: []};
  const task = {id: 'office', editableComponents: ['office_base'], regions: [{origin: [3,0,3], size: [3,8,3]}], interfaces: []};
  return {scene, room, task};
}

test('surface disclosure binds exact declarations without inventing current cell ownership or broadening a task', () => {
  const {scene,room,task} = fixture(); scene.components.push(room);
  const original = hash({scene,task}), data = prototypeSurfaceGuidance(scene,task);
  assert.equal(data.sourceHash,hash(scene)); assert.equal(data.task,'office');
  assert.deepEqual(data.surfaceSources.map(v => [v.id,v.kind,v.taskOwnsSource]), [['tower','mass',false],['office_base','roomZone',true]]);
  assert.ok(data.surfaceSources.every(v => v.actualCellOwnershipVerified === false));
  assert.equal(data.actualOwnersMustBeInspected,true); assert.equal(data.automaticOwnershipTransfer,false);
  assert.equal(data.authorityExpanded,false); assert.equal(data.canAuthorizePlacement,false);
  assert.equal(hash({scene,task}),original);
});

test('owned namespace is disclosed but never makes the receiving host editable', () => {
  const {scene,room,task} = fixture(); room.id = 'office__room'; task.editableComponents = []; scene.components.push(room);
  assert.deepEqual(prototypeSurfaceGuidance(scene,task).surfaceSources.map(v => [v.id,v.taskOwnsSource]), [['tower',false],['office__room',true]]);
});

test('new room cannot take a protected floor even with the same floor material or explicit overwrite', () => {
  for (const material of ['floor','frame']) {
    const {scene,room,task} = fixture(), original = hash(scene), before = assessSceneCheckpoint(scene);
    task.editableComponents = []; room.id = 'office__room'; room.floorMaterial = material; room.allowOverwrite = ['tower'];
    const candidate = structuredClone(scene); candidate.components.push(room); const after = assessSceneCheckpoint(candidate);
    assert.equal(after.report.geometryPassed,true,after.report.error);
    assert.throws(() => checkPackageGeometry(before.compiled,after.compiled,task,before.report,after.report), /protected component tower/);
    assert.equal(hash(scene),original);
  }
});

test('a preallocated bounded room source can refine both repeated floors without acquiring its tower', () => {
  const {scene,room,task} = fixture(); scene.components.push(room); const original = hash(scene), before = assessSceneCheckpoint(scene);
  assert.equal(before.report.geometryPassed,true,before.report.error);
  const candidate = structuredClone(scene), finish = candidate.components.find(c => c.id === room.id);
  finish.floorMaterial = 'frame'; finish.boundaries = [{face: 'north',material: 'glass',openings: []}];
  const after = assessSceneCheckpoint(candidate); assert.equal(after.report.geometryPassed,true,after.report.error);
  const checked = checkPackageGeometry(before.compiled,after.compiled,task,before.report,after.report);
  assert.equal(checked.scopeVerified,true); assert.ok(checked.changedCells > 0);
  assert.deepEqual(task.editableComponents,['office_base']); assert.equal(hash(scene),original);
});

test('task-owned source still cannot expand past approved regions', () => {
  const {scene,room,task} = fixture(); scene.components.push(room); const before = assessSceneCheckpoint(scene);
  const candidate = structuredClone(scene); candidate.components.at(-1).size[0]++;
  const after = assessSceneCheckpoint(candidate); assert.equal(after.report.geometryPassed,true,after.report.error);
  assert.throws(() => checkPackageGeometry(before.compiled,after.compiled,task,before.report,after.report), /outside approved regions/);
});

test('guidance rejects an unbounded input and states the protected floor and complete expansion responsibilities', () => {
  const {scene,task} = fixture(); assert.throws(() => prototypeSurfaceGuidance({...scene,components:Array(257).fill(scene.components[0])},task));
  assert.throws(() => prototypeSurfaceGuidance(scene,{...task,id:'../outside'}));
  assert.match(BLUEPRINT_SURFACE_RULES,/floor finish AND room clearance/); assert.match(BLUEPRINT_SURFACE_RULES,/every intended expanded floor/);
  assert.match(ROLE_SURFACE_RULES,/unchanged floor materials or unchanged air/); assert.match(ROLE_SURFACE_RULES,/different allowOverwrite/);
});
