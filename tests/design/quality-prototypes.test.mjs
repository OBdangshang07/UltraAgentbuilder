import test from 'node:test';import assert from 'node:assert/strict';
import {hash} from '../../src/generation/compiler.mjs';
import {prototypeEvidence,nativeViewsForScene,QUALITY_STRATEGIES} from '../../src/design/quality-prototypes.mjs';
import {coordinatedScope,applyCoordinatedEdit} from '../../contracts/scene-coordinated-edit.mjs';
import {applyPackageEdit} from '../../contracts/scene-assembly.schema.mjs';
import {assemblyPlan,packageEdit} from './assembly-fixtures.mjs';
import {floorWorldTower} from './floor-components-fixtures.mjs';
import {instanceStudy,panelWorldHighrise,entry,basicScene,mass,facade} from './fixtures.mjs';
import {profileMass,chamfer} from './profile-fixtures.mjs';
import {edgeFacade} from './space-fixtures.mjs';
import {MATERIALS} from '../../src/generation/materials.mjs';
import {compileScene} from '../../src/design/compiler.mjs';
import {nativeViewsForQualityV3} from '../../src/design/quality-v3-evidence.mjs';

test('v3 focuses actual floor footprints and facade corners without modifying geometry or v2 cameras',()=>{
 const scene=panelWorldHighrise(),before=hash(scene),old=nativeViewsForScene(scene,'ultra');scene.bounds.width=64;scene.bounds.length=64;
 const widened=hash(scene),views=nativeViewsForQualityV3(scene,'ultra');assert.equal(hash(scene),widened);
 const floor=views.find(v=>v.purpose==='typical-floor');assert.ok(floor.max[0]<64);assert.match(floor.framing,/footprints/);
 const detail=views.find(v=>v.purpose==='facade-detail');assert.ok(detail.max[0]-detail.min[0]<=23);assert.match(detail.framing,/Partial elevation/);
 for(const v of views)assert.ok(v.min.every((n,i)=>n>=0&&v.max[i]>n&&v.max[i]<=[64,224,64][i]));
 scene.bounds.width=32;scene.bounds.length=32;assert.equal(hash(scene),before);assert.deepEqual(nativeViewsForScene(scene,'ultra'),old);
});
test('v3 facade detail selects the tower band instead of collapsing onto the first short podium roof',()=>{
 const scene=panelWorldHighrise();scene.bounds.width=64;
 const podium={...structuredClone(scene.components[0]),id:'podium',at:{relativeTo:null,anchor:'min',offset:[34,0,2]},size:[28,32,28],levels:[16]};
 const lobby={...structuredClone(scene.components.find(c=>c.id==='panel_north')),id:'podium_lobby',host:'podium',count:[2,1],size:[9,14],step:[12,16],exclude:[]};
 scene.components.unshift(podium,lobby);
 const before=hash(scene),v2=nativeViewsForScene(scene,'ultra'),views=nativeViewsForQualityV3(scene,'ultra'),detail=views.find(v=>v.purpose==='facade-detail');
 assert.match(detail.framing,/host main for facade panel_north/);assert.equal(detail.max[1]-detail.min[1],12);assert.ok(detail.min[1]>32);
 assert.equal(hash(scene),before);assert.deepEqual(nativeViewsForScene(scene,'ultra'),v2);
});
test('v3 facade detail retains the whole available panel band when the only facade is far below the typical floor',()=>{
 const scene=panelWorldHighrise();scene.components=scene.components.filter(c=>c.kind!=='panelFacade'||c.id==='panel_north');
 const facade=scene.components.find(c=>c.id==='panel_north');facade.count=[2,1];facade.exclude=[];
 const before=hash(scene),detail=nativeViewsForQualityV3(scene,'ultra').find(v=>v.purpose==='facade-detail');
 assert.deepEqual([detail.min[1],detail.max[1]],[1,5]);assert.equal(hash(scene),before);
});
function profileCameraScene(edge=0,reverse=false){
 const scene=basicScene('profile-camera-test');scene.bounds={width:64,height:224,length:64};scene.constraints={interior:false,walkable:false,passages:[]};
 const points=chamfer(32,32,8);if(reverse)points.reverse();
 scene.components=[mass('podium',[40,0,4],[20,20,20]),facade('podium_front','podium','north'),
  profileMass('tower',[4,0,4],[32,224,32],points,Array.from({length:44},(_,i)=>(i+1)*5),{thickness:2}),
  edgeFacade('tower_panels','tower',edge,{start:[edge%2?2:3,1],count:[1,44]})];
 return scene;
}
test('v3 profile tower detail supersedes the low podium for cardinal and angled edges in either winding',()=>{
 for(const reverse of [false,true])for(let edge=0;edge<8;edge++){
  const scene=profileCameraScene(edge,reverse),before=hash(scene),v2=nativeViewsForScene(scene,'ultra');
  const views=nativeViewsForQualityV3(scene,'ultra'),detail=views.find(v=>v.purpose==='facade-detail');
  assert.match(detail.framing,/host tower for facade tower_panels/);assert.ok(detail.min[1]>20);assert.equal(detail.max[1]-detail.min[1],12);
  const points=scene.components.find(c=>c.id==='tower').points,a=points[edge],b=points[(edge+1)%points.length];
  const outward=[(a[0]+b[0])/2-16,(a[1]+b[1])/2-16],angle=detail.yaw*Math.PI/180;
  assert.ok((-Math.sin(angle)*outward[0]+Math.cos(angle)*outward[1])/Math.hypot(...outward)>.7);
  assert.ok(detail.max[0]-detail.min[0]<=30&&detail.max[2]-detail.min[2]<=30);
  for(const view of views)assert.ok(view.min.every((n,i)=>Number.isSafeInteger(n)&&n>=0&&Number.isSafeInteger(view.max[i])&&view.max[i]>n&&view.max[i]<=[64,224,64][i]));
  assert.equal(hash(scene),before);assert.deepEqual(nativeViewsForScene(scene,'ultra'),v2);
 }
});
test('v3 concave profile facade camera faces into the courtyard rather than through the solid wing',()=>{
 const scene=profileCameraScene(3),tower=scene.components.find(c=>c.id==='tower');
 tower.points=[[0,0],[32,0],[32,32],[22,32],[22,10],[10,10],[10,32],[0,32]];
 const before=hash(scene),detail=nativeViewsForQualityV3(scene,'ultra').find(v=>v.purpose==='facade-detail'),angle=detail.yaw*Math.PI/180;
 assert.match(detail.framing,/profile edge 3/);assert.ok(Math.sin(angle)>.7,'court-facing edge has a westward outward normal');
 assert.ok(detail.min[0]<26&&detail.max[0]>26);assert.equal(hash(scene),before);
});
test('v3 profile facade crop follows surviving emitted bays and retains a short actual height band',()=>{
 const scene=profileCameraScene(),panels=scene.components.find(c=>c.id==='tower_panels');
 scene.components=scene.components.filter(c=>!['podium','podium_front'].includes(c.id));
 panels.count=[2,1];panels.exclude=[[0,0]];
 const before=hash(scene),detail=nativeViewsForQualityV3(scene,'ultra').find(v=>v.purpose==='facade-detail');
 assert.deepEqual([detail.min[1],detail.max[1]],[1,5]);assert.ok(detail.min[0]<=24&&detail.max[0]>24);assert.ok(detail.min[2]<=4&&detail.max[2]>4);
 assert.equal(hash(scene),before);
});
function compositeDoorScene(rotation=0){
 const scene=panelWorldHighrise();
 scene.modules=[{id:'portal_parts',parameters:[],size:[4,2,1],nodes:Array.from({length:4},(_,x)=>({nodeId:'leaf_'+x,op:'door',origin:[x,0,0],size:[1,2,1],material:'door',thickness:1,axis:'x',repeat:{count:1,step:[0,0,0]},points:[],blockState:{facing:'north',half:'lower',hinge:x%2?'right':'left',open:true,shape:null,axis:null,type:null}}))}];
 scene.components.push({kind:'module',id:'unnamed_portal',module:'portal_parts',values:[],at:{relativeTo:null,anchor:'min',offset:rotation?[0,1,14]:[14,1,0]},repeat:{count:2,step:[0,100,0]},rotation,mirror:true,allowOverwrite:[]});
 scene.constraints.passages=[{origin:rotation?[3,1,15]:[15,1,3],size:[1,2,1]}];return scene;
}
test('v3 frames real composite doors near the entry checkpoint without relying on an entry component or changing source',()=>{
 const scene=compositeDoorScene(),before=hash(scene),old=nativeViewsForScene(scene,'ultra'),view=nativeViewsForQualityV3(scene,'ultra').find(v=>v.purpose==='entry');
 assert.match(view.framing,/Door group unnamed_portal/);assert.match(view.framing,/not certified/);
 assert.deepEqual(view.min,[4,0,0]);assert.deepEqual(view.max,[28,8,10]);assert.equal(view.yaw,160);
 assert.equal(hash(scene),before);assert.deepEqual(nativeViewsForScene(scene,'ultra'),old);
});
test('v3 composite-door framing uses lowered world orientation and selects the nearby repeated floor',()=>{
 const scene=compositeDoorScene(1),view=nativeViewsForQualityV3(scene,'ultra').find(v=>v.purpose==='entry');
 assert.equal(view.yaw,250);assert.deepEqual(view.min,[0,0,4]);assert.deepEqual(view.max,[10,8,28]);
});
test('v3 entry and facade cameras look from the exterior side in native GL coordinates for all compass faces',()=>{
 // Inverse(Rx(pitch)*Ry(yaw)) applied to camera +Z: horizontal direction
 // is (-sin(yaw),cos(yaw)). Positive normal dot proves the outward side.
 const normal={north:[0,-1],east:[1,0],south:[0,1],west:[-1,0]};
 const outward=(view,face)=>{const r=view.yaw*Math.PI/180,n=normal[face];assert.ok(-Math.sin(r)*n[0]+Math.cos(r)*n[1]>.7,face+' must face actual exterior');};
 for(const face of Object.keys(normal)){
  const scene=panelWorldHighrise();scene.components=scene.components.filter(c=>c.kind!=='panelFacade'||c.id==='panel_north');
  scene.components.find(c=>c.id==='panel_north').face=face;scene.components.push(entry('portal','main',{face,u:10}));
  const before=hash(scene),old=nativeViewsForScene(scene,'ultra'),views=nativeViewsForQualityV3(scene,'ultra');
  outward(views.find(v=>v.purpose==='facade-detail'),face);outward(views.find(v=>v.purpose==='entry'),face);
  assert.equal(hash(scene),before);assert.deepEqual(nativeViewsForScene(scene,'ultra'),old);
  const composite=compositeDoorScene();for(const node of composite.modules[0].nodes)node.blockState.facing=face;
  // This composite fixture is mirrored in X: east and west exchange sides.
  const transformed={east:'west',west:'east'}[face]??face;
  outward(nativeViewsForQualityV3(composite,'ultra').find(v=>v.purpose==='entry'),transformed);
 }
});
test('v3 section views the exposed positive-X cut rather than the retained outer west wall',()=>{
 const scene=panelWorldHighrise(),before=hash(scene),old=nativeViewsForScene(scene,'ultra');
 const view=nativeViewsForQualityV3(scene,'ultra').find(v=>v.purpose==='section'),prior=old.find(v=>v.purpose==='section');
 assert.ok(-Math.sin(view.yaw*Math.PI/180)>0);assert.match(view.framing,/positive-X cut side/);
 assert.deepEqual(view.min,prior.min);assert.deepEqual(view.max,prior.max);
 assert.equal(hash(scene),before);assert.deepEqual(nativeViewsForScene(scene,'ultra'),old);
});
test('v3 leaves the broad entry camera unchanged when no actual door cells can anchor it',()=>{
 const scene=panelWorldHighrise(),old=nativeViewsForScene(scene,'ultra').find(v=>v.purpose==='entry');
 assert.deepEqual(nativeViewsForQualityV3(scene,'ultra').find(v=>v.purpose==='entry'),old);
});
test('v3 special-floor camera covers an authored sky/atrium band instead of an earlier generic public room',()=>{
 const scene=panelWorldHighrise();
 for(const [id,y,purpose] of [['public_room',10,'Public meeting room'],['upper_room',150,'Sky atrium overlook']])scene.components.push({kind:'roomZone',id,host:'main',at:{relativeTo:'main',anchor:'min',offset:[1,y,1]},size:[6,4,6],repeat:{count:1,step:[0,0,0]},allowOverwrite:[],use:'room',purpose,floorMaterial:'floor',boundaries:[]});
 const before=hash(scene),old=nativeViewsForScene(scene,'ultra'),view=nativeViewsForQualityV3(scene,'ultra').find(v=>v.purpose==='special-floor');
 assert.equal(old.find(v=>v.purpose==='special-floor').min[1],10);assert.deepEqual([view.min[1],view.max[1]],[150,154]);
 assert.match(view.framing,/upper_room/);assert.match(view.framing,/not verified/);assert.equal(hash(scene),before);assert.deepEqual(nativeViewsForScene(scene,'ultra'),old);
});
test('native section reframes a right-offset building and leaves ordinary sample cameras byte-identical',()=>{
 const scene=assemblyPlan().scene;scene.bounds.width=64;scene.components[0].at.offset[0]=40;scene.constraints.passages[0].origin[0]=42;
 compileScene(scene,{navigationPolicy:'review'});
 const old=nativeViewsForScene(scene,'ultra'),occupied={min:[40,0,2],max:[51,9,13]},next=nativeViewsForScene(scene,'ultra',occupied);
 const section=next.find(v=>v.purpose==='section');assert.ok(old.find(v=>v.purpose==='section').max[0]<=occupied.min[0]);
 assert.deepEqual(section.min,[40,0,2]);assert.deepEqual(section.max,[46,10,14]);assert.match(section.framing,/representative/);
 assert.deepEqual(next.filter(v=>v.purpose!=='section'),old.filter(v=>v.purpose!=='section'));
 const ordinary=assemblyPlan().scene;assert.deepEqual(nativeViewsForScene(ordinary,'ultra',{min:[2,0,2],max:[13,9,13]}),nativeViewsForScene(ordinary,'ultra'));
 assert.throws(()=>nativeViewsForScene(scene,'ultra',{min:[-1,0,0],max:[1,1,1]}),/occupied bounds/);
});
test('quality v2 exposes opaque concrete behind nominal glazing without banning intentional opaque materials',()=>{
 const scene=assemblyPlan().scene;scene.palette.push({role:'glazing',material:'light_gray'},{role:'glassFrame',material:'stone'});
 const evidence=prototypeEvidence(scene,'ultra');assert.equal(evidence.materialEvidence.find(p=>p.role==='glazing').blockState,'minecraft:light_gray_concrete');
 assert.deepEqual(evidence.warnings.filter(w=>w.code==='named-glazing-is-not-glass').map(w=>w.role),['glazing']);
 scene.palette.find(p=>p.role==='glazing').material='light_gray_glass';
 assert.ok(!prototypeEvidence(scene,'ultra').warnings.some(w=>w.code==='named-glazing-is-not-glass'));
 assert.equal(MATERIALS.light_gray_glass,'minecraft:light_gray_stained_glass');assert.equal(MATERIALS.light_blue,'minecraft:light_blue_concrete');
 assert.equal(MATERIALS.blue_glass,'minecraft:light_blue_stained_glass');assert.equal(MATERIALS.blue_stained_glass,'minecraft:blue_stained_glass');
});
test('quality prototypes bind source and first/last repeated floors without aesthetic score or hidden rescaling',()=>{
 const scene=floorWorldTower(),before=hash(scene),e=prototypeEvidence(scene,'ultra');
 assert.equal(e.sourceHash,before);assert.equal(hash(scene),before);assert.equal(e.aestheticQualityVerified,false);assert.equal(e.canAuthorizePlacement,false);
 assert.ok(e.rooms.length>0);assert.equal(e.groups.find(c=>c.id==='officeZone').instances,44);
 assert.ok(nativeViewsForScene(scene,'ultra').some(v=>v.purpose==='facade-detail'&&v.max[1]-v.min[1]<=12));
 const reps=e.groups.find(c=>c.id==='officeZone').representative;assert.equal(reps[0].instance,0);assert.equal(reps.at(-1).instance,43);
 for(const tier of Object.keys(QUALITY_STRATEGIES)){const views=nativeViewsForScene(scene,tier);assert.equal(views.length,QUALITY_STRATEGIES[tier].nativeViews);assert.ok(views.some(v=>v.purpose==='section'));assert.ok(views.some(v=>v.purpose==='typical-floor'));for(const v of views)assert.ok(v.min.every((n,i)=>n>=0&&v.max[i]>n&&v.max[i]<=[32,224,32][i]));}
});
test('coordinated edit may update only the explicit package union and preserves all global constraints',()=>{
 const plan=assemblyPlan();let scene=plan.scene;
 for(const task of plan.packages)scene=applyPackageEdit(scene,packageEdit({previousDraft:scene,task}),task).scene;
 const review={task:'exterior',summary:'Coordinate material fixture',issues:[{task:'exterior'},{task:'interior'}]},scope=coordinatedScope(plan,scene,review);
 const edit=packageEdit({previousDraft:scene,task:plan.packages[0]});edit.components.put.push({...scene.components.find(c=>c.id==='interior__detail'),material:'wall'});
 assert.throws(()=>applyPackageEdit(scene,edit,plan.packages[0]),/ownership/);
 const response={...edit,format:'SceneCoordinatedEdit',scopeHash:scope.scopeHash};
 const next=applyCoordinatedEdit(plan,scene,scope,response).scene;assert.equal(next.components.find(c=>c.id==='interior__detail').material,'wall');assert.deepEqual(next.constraints,scene.constraints);
 assert.throws(()=>applyCoordinatedEdit(plan,scene,scope,{...response,scopeHash:'0'.repeat(64)}));
 assert.throws(()=>applyCoordinatedEdit(plan,scene,scope,{...response,components:{put:[{...scene.components[0],material:'glass'}],remove:[]}}),/ownership/);
 assert.throws(()=>applyCoordinatedEdit(plan,scene,scope,{...response,constraints:scene.constraints}),/global/);
 const narrow=coordinatedScope(plan,scene,{...review,issues:[{task:'exterior'}]});assert.throws(()=>applyCoordinatedEdit(plan,scene,narrow,{...response,scopeHash:narrow.scopeHash}),/ownership/);
});
test('coordinated modules require all consumers explicitly selected; changed geometry still needs independent scope inspection',()=>{
 const scene=instanceStudy(),plan={...assemblyPlan(),scene,packages:[{...assemblyPlan().packages[0],editableComponents:['desks']},{...assemblyPlan().packages[1],editableComponents:['otherDesks']}]};
 const review={task:'exterior',summary:'Shared module fixture',issues:[{task:'exterior'}]},scope=coordinatedScope(plan,scene,review);
 const response={...packageEdit({previousDraft:scene,task:plan.packages[0]}),format:'SceneCoordinatedEdit',scopeHash:scope.scopeHash,components:{put:[],remove:[]},modules:{put:[{...scene.modules[0],nodes:scene.modules[0].nodes.map(n=>({...n,material:'wall'}))}],remove:[]}};
 assert.throws(()=>applyCoordinatedEdit(plan,scene,scope,response),/Shared module/);
 const all=coordinatedScope(plan,scene,{...review,issues:[{task:'exterior'},{task:'interior'}]});assert.doesNotThrow(()=>applyCoordinatedEdit(plan,scene,all,{...response,scopeHash:all.scopeHash}));
});
