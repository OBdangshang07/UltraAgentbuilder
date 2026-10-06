import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../../src/generation/compiler.mjs';
import {prototypeSurfaceGuidance,BLUEPRINT_FACADE_SURFACE_RULES,ROLE_FACADE_SURFACE_RULES} from '../../contracts/scene-prototype-surface-guidance.mjs';
import {assessSceneCheckpoint} from '../../src/design/checkpoint.mjs';
import {checkPackageGeometry} from '../../src/design/assembly-scope.mjs';
import {basicScene,mass} from './fixtures.mjs';

// Authored mechanism probes only; no private model answer or quality image.
function fixture(polygon=false){
 const scene=basicScene('facade-surface-scope');scene.constraints={interior:true,walkable:true,passages:[{origin:[10,1,14],size:[1,2,1]}]};
 const body=mass('body',[3,0,3],[18,18,18],[6,12],{thickness:2});
 if(polygon)Object.assign(body,{kind:'profileMass',points:[[0,0],[18,0],[18,18],[0,18]]});
 const panel={id:'skin',kind:polygon?'edgeFacade':'panelFacade',host:'body',allowOverwrite:[],margin:1,
  start:[2,1],count:[2,2],step:[6,6],size:[4,4],borders:[0,0,0,0],recess:1,
  frame:'frame',glazing:'glass',lattice:false,exclude:[]};
 if(polygon)panel.edge=0;else Object.assign(panel,{face:'north',projection:0,sill:0,shade:0});
 scene.components=[body,panel];
 return {scene,task:{id:'facade',editableComponents:['skin'],regions:[{origin:[3,0,3],size:[18,18,18]}],interfaces:[]}};
}

for(const polygon of [false,true]){
 test((polygon?'polygon':'rectangular')+' disclosure binds exact array/layer declarations, separates host ownership and never aliases caller arrays',()=>{
  const {scene,task}=fixture(polygon),original=hash({scene,task});
  const data=prototypeSurfaceGuidance(scene,task),entry=data.hostedFacadeSources[0];
  assert.equal(data.version,2);assert.equal(data.sourceHash,hash(scene));
  assert.equal(entry.sourceDeclarationHash,hash(scene.components[1]));
  assert.equal(entry.taskOwnsSource,true);assert.equal(entry.taskOwnsHost,false);
  assert.equal(entry.hostKind,polygon?'profileMass':'mass');
  assert.deepEqual(entry.layout.start,[2,1]);assert.deepEqual(entry.layout.size,[4,4]);assert.equal(entry.layout.recess,1);
  assert.equal(entry.actualCellOwnershipVerified,false);assert.equal(entry.hostFitIsNotPackagePermission,true);
  assert.equal(entry.automaticOwnershipTransfer,false);assert.equal(data.canAuthorizePlacement,false);
  entry.layout.start[0]++;assert.equal(hash({scene,task}),original);
  const owned=prototypeSurfaceGuidance(scene,{...task,editableComponents:['skin','body']});
  assert.equal(owned.hostedFacadeSources[0].taskOwnsHost,true);
 });

 test((polygon?'polygon':'rectangular')+' one-block aperture growth may fit the host but cannot seize its protected wall; owned material refinements still pass',()=>{
  const {scene,task}=fixture(polygon),original=hash({scene,task}),before=assessSceneCheckpoint(scene);
  assert.equal(before.report.geometryPassed,true,before.report.error);
  const grown=structuredClone(scene);grown.components[1].size[0]++;grown.components[1].allowOverwrite=['body'];
  const after=assessSceneCheckpoint(grown);assert.equal(after.report.geometryPassed,true,after.report.error);
  assert.throws(()=>checkPackageGeometry(before.compiled,after.compiled,task,before.report,after.report),error=>{
   assert.match(error.message,/protected component body/);assert.ok(error.packageScopeFeedback.conflictCells>0);return true;
  });
  const refined=structuredClone(scene);refined.components[1].glazing='lamp';
  const checked=assessSceneCheckpoint(refined);assert.equal(checked.report.geometryPassed,true,checked.report.error);
  assert.equal(checkPackageGeometry(before.compiled,checked.compiled,task,before.report,checked.report).scopeVerified,true);
  assert.equal(hash({scene,task}),original);
 });
}

test('all hosted facade families disclose original fields, while unrelated module/shape fields cannot become host ownership',()=>{
 const {scene,task}=fixture();const panel=scene.components[1];
 const traditional={...panel,id:'traditional',kind:'facade'};delete traditional.borders;delete traditional.recess;
 const storey={...panel,id:'facade__floor',kind:'storeyFacade',columns:{width:4,gap:2,count:2,align:'start'},floors:{first:0,count:2},insets:[1,1]};
 for(const field of ['start','count','step','size'])delete storey[field];
 scene.components.push(traditional,storey);
 const data=prototypeSurfaceGuidance(scene,task);
 assert.deepEqual(data.hostedFacadeSources.map(c=>[c.id,c.kind,c.taskOwnsSource]),[['skin','panelFacade',true],['traditional','facade',false],['facade__floor','storeyFacade',true]]);
 assert.deepEqual(data.hostedFacadeSources[2].layout.columns,storey.columns);
 assert.deepEqual(data.hostedFacadeSources[2].layout.floors,storey.floors);
 assert.ok(data.hostedFacadeSources.every(c=>c.taskOwnsHost===false));
 assert.match(BLUEPRINT_FACADE_SURFACE_RULES,/actual aperture widths/);
 assert.match(BLUEPRINT_FACADE_SURFACE_RULES,/full intended facade language/);
 assert.match(ROLE_FACADE_SURFACE_RULES,/Owning an opening array does NOT own/);
 assert.match(ROLE_FACADE_SURFACE_RULES,/No automatic clipping/);
});
