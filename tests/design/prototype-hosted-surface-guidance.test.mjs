import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../../src/generation/compiler.mjs';
import {prototypeSurfaceGuidance,BLUEPRINT_SURFACE_RULES,ROLE_SURFACE_RULES} from '../../contracts/scene-prototype-surface-guidance.mjs';
import {assessSceneCheckpoint} from '../../src/design/checkpoint.mjs';
import {checkPackageGeometry} from '../../src/design/assembly-scope.mjs';
import {basicScene,mass} from './fixtures.mjs';

// Synthetic data and real compiler scope checks, not model or design evidence.
function fixture(){
  const scene=basicScene('hosted-surface-scope');
  scene.constraints={interior:true,walkable:true,passages:[{origin:[8,1,8],size:[1,2,1]}]};
  scene.components=[mass('tower',[2,0,2],[10,9,10],[4])];
  scene.components.push({id:'bay',kind:'panelFacade',host:'tower',allowOverwrite:[],face:'north',margin:1,start:[1,1],
    count:[1,1],step:[0,0],size:[4,3],borders:[1,1,1,1],recess:0,frame:'frame',glazing:'glass',
    lattice:false,projection:0,sill:0,shade:0,exclude:[]});
  return {scene,task:{id:'skin',editableComponents:['bay'],regions:[{origin:[2,0,2],size:[10,9,10]}],interfaces:[]}};
}
test('hosted source and its host declaration are disclosed independently without any authority transfer',()=>{
  const {scene,task}=fixture(),before=hash({scene,task}),r=prototypeSurfaceGuidance(scene,task);
  assert.equal(r.version,2);assert.deepEqual(r.hostedSources,[{id:'bay',kind:'panelFacade',host:'tower',taskOwnsSource:true,
    taskOwnsHostDeclaration:false,actualCellOwnershipVerified:false}]);
  assert.equal(r.hostedSourceOwnershipIsNotWholeHostOwnership,true);assert.equal(r.ownershipOnlyChangesStillChecked,true);
  assert.equal(r.automaticOwnershipTransfer,false);assert.equal(r.authorityExpanded,false);assert.equal(r.canAuthorizePlacement,false);
  assert.equal(hash({scene,task}),before);
});
test('all facade and portal declaration families are disclosed, not promoted to verified native owners',()=>{
  const kinds=['facade','panelFacade','edgeFacade','storeyFacade','entry','storeyOpening'];
  const scene={components:[{id:'host',kind:'mass',floorMaterial:'floor'},...kinds.map((kind,i)=>({id:'skin__s'+i,kind,host:'host'})),{id:'other',kind:'shape'}]};
  const r=prototypeSurfaceGuidance(scene,{id:'skin',editableComponents:[]});
  assert.deepEqual(r.hostedSources.map(s=>s.kind),kinds);assert.ok(r.hostedSources.every(s=>s.taskOwnsSource&&!s.taskOwnsHostDeclaration&&!s.actualCellOwnershipVerified));
  assert.equal(r.surfaceSources.length,1);assert.equal(r.actualOwnersMustBeInspected,true);assert.equal(r.regionsStillRequired,true);
});
test('declared host ownership remains a declaration rather than a cell-map certificate',()=>{
  const {scene,task}=fixture();task.editableComponents.push('tower');const r=prototypeSurfaceGuidance(scene,task);
  assert.equal(r.hostedSources[0].taskOwnsHostDeclaration,true);assert.equal(r.hostedSources[0].actualCellOwnershipVerified,false);
  assert.equal(r.guidanceOnly,true);assert.equal(r.canAuthorizePlacement,false);
});
test('a larger hosted aperture cannot claim protected host piers even with implicit scene host permission',()=>{
  const {scene,task}=fixture(),before=assessSceneCheckpoint(scene);assert.equal(before.report.geometryPassed,true,before.report.error);
  const candidate=structuredClone(scene);candidate.components[1].size[0]++;
  const after=assessSceneCheckpoint(candidate);assert.equal(after.report.geometryPassed,true,after.report.error);
  assert.throws(()=>checkPackageGeometry(before.compiled,after.compiled,task,before.report,after.report),/protected component tower/);
});
test('identical block materials still do not transfer frozen host ownership',()=>{
  const {scene,task}=fixture();scene.components[1].frame=scene.components[0].material;scene.components[1].glazing=scene.components[0].material;
  const before=assessSceneCheckpoint(scene),candidate=structuredClone(scene);candidate.components[1].size[0]++;
  const after=assessSceneCheckpoint(candidate);assert.equal(before.report.geometryPassed,true,before.report.error);assert.equal(after.report.geometryPassed,true,after.report.error);
  assert.deepEqual(after.compiled.cells,before.compiled.cells);
  assert.throws(()=>checkPackageGeometry(before.compiled,after.compiled,task,before.report,after.report),/protected component tower/);
});
test('guidance retains bounded validation and explicit all-instance, pre-freeze design responsibilities',()=>{
  const {scene,task}=fixture();assert.throws(()=>prototypeSurfaceGuidance({...scene,components:Array(257).fill(scene.components[0])},task));
  assert.throws(()=>prototypeSurfaceGuidance(scene,{...task,id:'../host'}));
  assert.match(BLUEPRINT_SURFACE_RULES,/FACADE AND ENTRY RESPONSIBILITIES BEFORE FREEZE/);
  assert.match(BLUEPRINT_SURFACE_RULES,/every intended expanded instance/);
  assert.match(ROLE_SURFACE_RULES,/Even identical visible block materials can change ownership/);
  assert.match(ROLE_SURFACE_RULES,/do not omit the required facade\/entry study/);
});
