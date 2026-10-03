import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../../src/generation/compiler.mjs';
import {compileScene} from '../../src/design/compiler.mjs';
import {applySceneDraftEdit,sceneDraftEditSchema} from '../../contracts/scene-draft-edit.schema.mjs';
import {assessSceneCheckpoint} from '../../src/design/checkpoint.mjs';
import {courtyard,worldHighrise,shape,instanceStudy} from './fixtures.mjs';

export function emptyEdit(scene){return {format:'SceneDraftEdit',version:1,sourceHash:hash(scene),components:{put:[],remove:[]},modules:{put:[],remove:[]},palette:{put:[],remove:[]},reservations:{put:[],remove:[]},design:null,featureBindings:null,constraints:null};}
export function layout(){const s=courtyard();s.constraints.passages=[{origin:[18,2,9],size:[1,2,1]}];return s;}

test('draft edits bind the latest source hash and preserve fixed fields/source bytes',()=>{
 const scene=layout(),before=JSON.stringify(scene),edit=emptyEdit(scene),replacement=structuredClone(scene.components.find(c=>c.id==='pergola'));replacement.material='wall';
 edit.components.put=[replacement,shape('extra',[0,0,0],[1,1,1])];edit.components.remove=['planter'];
 const next=applySceneDraftEdit(scene,edit);assert.equal(JSON.stringify(scene),before);assert.equal(next.scene.components[0].id,scene.components[0].id);
 assert.deepEqual(next.changes.components,{added:['extra'],changed:['pergola'],removed:['planter']});assert.equal(next.sourceHash,hash(next.scene));
 assert.throws(()=>applySceneDraftEdit(next.scene,edit),/hash/);
 for(const key of ['id','seed','bounds','format','version'])assert.deepEqual(next.scene[key],scene[key]);
});
test('shared-template draft editing rechecks every consumer, including a distant rotated array',()=>{
 const s=worldHighrise(),module=structuredClone(instanceStudy().modules[0]);s.modules=[structuredClone(module)];
 const [a,b]=structuredClone(instanceStudy().components);a.at.offset=[15,1,12];a.repeat={count:1,step:[0,0,0]};b.at.offset=[23,6,23];b.repeat={count:1,step:[0,0,0]};b.rotation=1;s.components.push(a,b);
 assert.equal(assessSceneCheckpoint(s).report.geometryPassed,true);
 const edit=emptyEdit(s);module.size=[12,4,5];module.nodes[0].size=[11,1,2];edit.modules.put=[module];const next=applySceneDraftEdit(s,edit).scene;
 const result=assessSceneCheckpoint(next);assert.equal(result.report.geometryPassed,false);assert.ok(result.report.constructionFeedback.issues.some(issue=>issue.component==='otherDesks'));
 assert.deepEqual(next.components,s.components);assert.equal(s.modules[0].size[0],4);
});
test('draft editing never accepts ambiguous removes, unknown fields or closing functionality',()=>{
 const scene=layout();
 for(const mutate of [e=>e.bounds={width:1,height:1,length:1},e=>e.components.remove=['missing'],e=>e.components.remove=['pergola','pergola'],e=>{e.components.put=[scene.components[0]];e.components.remove=['main'];},e=>e.components.put=[scene.components[0],scene.components[0]],e=>e.constraints={interior:false,walkable:true,passages:[]}]){
  const e=emptyEdit(scene);mutate(e);assert.throws(()=>applySceneDraftEdit(scene,e));
 }
});
test('all draft changes are data validated, including referenced module values and palette entries',()=>{
 const scene=layout(),edit=emptyEdit(scene);edit.palette.put=[{role:'unknownMaterial',material:'execute_code'}];assert.throws(()=>applySceneDraftEdit(scene,edit),/invalid choice/);
 edit.palette.put=[];edit.components.put=[{...scene.components[0],arbitraryCode:'process.exit()'}];assert.throws(()=>applySceneDraftEdit(scene,edit),/unknown field/);
 assert.equal(sceneDraftEditSchema.properties.format.enum[0],'SceneDraftEdit');assert.ok(sceneDraftEditSchema.$defs.component.anyOf.length>10);
});
test('checkpoint reports actual geometry but every intermediate manifest remains diagnostic-only',()=>{
 const s=worldHighrise(),before=JSON.stringify(s),c=compileScene(s),{report,compiled}=assessSceneCheckpoint(s,{minimumHeight:224});
 assert.equal(report.geometryPassed,true);assert.equal(report.occupiedBounds.size[1],224);assert.equal(report.canAuthorizePlacement,false);
 assert.equal(compiled.manifest.diagnosticOnly,true);assert.equal(compiled.manifest.checkpointOnly,true);assert.ok(compiled.binary.equals(c.binary));assert.notEqual(compiled.manifest.assetHash,c.manifest.assetHash);
 assert.equal(JSON.stringify(s),before);
});
test('checkpoint cannot turn a shortened prototype or disabled intent into passed geometry',()=>{
 assert.equal(assessSceneCheckpoint(layout(),{minimumHeight:224}).report.geometryPassed,false);
 const s=layout();s.constraints.walkable=false;assert.equal(assessSceneCheckpoint(s).report.geometryPassed,false);
 s.constraints.walkable=true;s.constraints.passages=[];assert.equal(assessSceneCheckpoint(s).report.geometryPassed,false);
 const r=assessSceneCheckpoint(worldHighrise(),{maximumBounds:{width:16,height:224,length:32}}).report;assert.equal(r.geometryPassed,false);assert.match(r.error,/boundary/);
});
test('ownership errors, static bounds and schema failures remain failures with precise feedback',()=>{
 const s=layout();s.components.push(shape('collision',[2,1,1],[1,1,1],'wall'));
 const r=assessSceneCheckpoint(s);assert.equal(r.report.geometryPassed,false);assert.match(r.report.error,/Ownership/);assert.equal(r.compiled.manifest.diagnosticOnly,true);
 s.components.at(-1).at.offset=[400,0,0];const bad=assessSceneCheckpoint(s);assert.equal(bad.report.schemaValid,false);assert.equal(bad.compiled,undefined);
});
test('unused materials and palette index/order changes cannot impersonate geometric refinement',()=>{
 const s=layout(),before=assessSceneCheckpoint(s);assert.equal(before.report.geometryPassed,true);
 s.palette.push({role:'unusedAccent',material:'red'});s.palette.reverse();
 const after=assessSceneCheckpoint(s);assert.equal(after.report.geometryPassed,true);assert.equal(before.report.geometryHash,after.report.geometryHash);
 s.palette.find(p=>p.role==='wall').material='red';assert.notEqual(assessSceneCheckpoint(s).report.geometryHash,before.report.geometryHash);
});
