import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScene} from '../../src/design/compiler.mjs';
import {inspectStairAccess} from '../../src/design/stair-access.mjs';
import {inspectSceneNavigation} from '../../src/design/navigation-feedback.mjs';
import {basicScene,mass,at} from './fixtures.mjs';

function enclosed({open=true,blockedEdge=false,partial=false}={}){
 const s=basicScene();
 s.components=[mass('main',[1,0,1],[16,20,14],[5,10,15]),mass('core',[4,0,4],[8,19,7],[5,10,15],{allowOverwrite:['main'],roof:false}),
  {id:'openings',kind:'void',at:at([11,1,7]),size:[1,2,blockedEdge?1:2],repeat:{count:4,step:[0,5,0]},allowOverwrite:['core','main']},
  {id:'flights',kind:'stairs',at:at([5,0,5]),size:[6,8,5],host:'core',style:'switchback',rotation:2,width:2,rise:5,material:partial?'oak_stairs':'floor',repeat:{count:3,step:[0,5,0]},allowOverwrite:['main']},
  {id:'doors',kind:'doorway',host:'openings',at:at([11,1,7]),repeat:{count:4,step:[0,5,0]},allowOverwrite:[],face:blockedEdge?'north':'east',width:blockedEdge?1:2,door:'oak_door',hinge:'left',open}];
 s.constraints={interior:true,walkable:true,passages:[0,5,10,15].map(y=>({origin:[2,y+1,2],size:[1,2,1]}))};
 return s;
}

test('common landings recognize paired supported open doors without making doors air or changing geometry',()=>{
 const s=enclosed(),c=compileScene(s),before=c.cells.slice();
 const access=inspectStairAccess(s,c,c.designSources.componentBounds);
 assert.equal(access.length,6);assert.ok(access.every(a=>a.status==='local-opening-found'));
 assert.ok(!c.manifest.scene.diagnostics.some(d=>d.code==='stair-floor-access-unverified'));
 assert.deepEqual(c.cells,before);
});

test('closed doors and an open leaf blocking the crossing edge remain unverified',()=>{
 for(const options of [{open:false},{blockedEdge:true}]){
  const s=enclosed(options),c=compileScene(s);
  assert.ok(c.designSources.stairAccess.every(a=>a.status==='unverified'));
 }
});

test('missing support and missing door halves cannot manufacture a landing connection',()=>{
 for(const mode of ['support','half']){
  const s=enclosed(),c=compileScene(s),{width:w,length:d}=c.manifest.dimensions;
  for(const floor of [0,5,10,15])for(const z of [7,8])c.cells[11+z*w+(floor+(mode==='half'?2:0))*w*d]=0;
  assert.ok(inspectStairAccess(s,c,c.designSources.componentBounds).every(a=>a.status==='unverified'));
 }
});

test('partial flights retain unverified navigation while correctly connected landings are recognized',()=>{
 const s=enclosed({partial:true}),c=compileScene(s),r=inspectSceneNavigation(s,c);
 assert.ok(c.designSources.stairAccess.every(a=>a.status==='local-opening-found'));
 assert.equal(c.manifest.quality.navigation,'unverified');assert.equal(r.canAuthorizePlacement,false);
 assert.equal(r.stairs.localTwoWayPaths,0);assert.equal(r.stairs.unverified,3);
 assert.equal(r.stairs.groups[0].stepCollisionModeled,false);
 assert.equal(r.movementModel.partialStepCollisionModeled,false);assert.equal(r.movementModel.unverifiedIsBlockedProof,false);
 assert.ok(r.issues.filter(i=>i.code==='stair-local-route-unverified').every(i=>i.reason==='partial-step-collision-not-modeled'&&i.provesBlockedRoute===false));
 const full=enclosed(),fullReport=inspectSceneNavigation(full,compileScene(full));
 assert.equal(fullReport.stairs.groups[0].stepCollisionModeled,true);assert.equal(fullReport.stairs.localTwoWayPaths,3);
});
