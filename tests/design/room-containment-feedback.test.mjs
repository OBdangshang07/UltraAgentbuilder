import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRoomZone} from '../../src/design/room-zone.mjs';
import {profileFootprint} from '../../src/design/profile.mjs';
import {inspectConstruction} from '../../src/design/construction-feedback.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {basicScene,mass,at,once} from './fixtures.mjs';
import {storeyRoom} from './floor-components-fixtures.mjs';

function fixture(){
 const scene=basicScene('containment-feedback');scene.bounds={width:64,height:224,length:64};scene.constraints={interior:false,walkable:false,passages:[]};
 const host={...mass('tower',[11,112,11],[42,88,42],[4,8,12]),kind:'profileMass',thickness:2,points:[[5,0],[37,0],[42,5],[42,37],[37,42],[21,42],[21,38],[5,38],[0,33],[0,5]]};
 const room={kind:'roomZone',id:'office',host:'tower',at:at([13,112,20]),repeat:once,allowOverwrite:[],size:[4,4,24],use:'room',purpose:'Offline polygon containment case',floorMaterial:'floor',boundaries:[]};
 scene.components=[host,room];return {scene,host,room};
}
test('polygon room evidence identifies the first actual wall cell in both frames without changing the proposal',()=>{
 const {scene,host,room}=fixture(),before=hash(scene),r={origin:host.at.offset,size:host.size,profile:profileFootprint(42,42,host.points,2)};
 assert.throws(()=>validateRoomZone(room,host,r,room.at.offset),error=>{
  const e=error.roomZoneFeedback;assert.equal(e.rule,'host-interior');assert.equal(e.host,'tower');assert.deepEqual(e.localOrigin,[2,0,9]);
  assert.equal(e.firstInvalidCell.classification,'host-wall');const [x,z]=e.firstInvalidCell.local;
  assert.equal(r.profile.mask[x+z*42],1);assert.deepEqual(e.firstInvalidCell.world,[x+11,112,z+11]);
  assert.equal(e.canAuthorizePlacement,false);assert.equal(e.geometryChanged,false);return true;
 });
 const report=inspectConstruction(scene),e=report.issues.find(i=>i.component==='office').roomZoneFeedback;
 assert.ok(e.firstInvalidCell);assert.equal(hash(scene),before);
});
test('floor-linked rooms preserve polygon containment details across the floor-layout wrapper',()=>{
 const {scene}=fixture();scene.components[1]=storeyRoom('office','tower',{offset:[2,9],footprint:[4,24],floors:{source:'tower',first:0,count:3}});
 const before=hash(scene),report=inspectConstruction(scene),e=report.issues.find(i=>i.component==='office').layoutFeedback;
 assert.equal(e.rule,'room-interface');assert.equal(e.row,0);assert.equal(e.roomZoneFeedback.host,'tower');
 assert.equal(e.roomZoneFeedback.hostPoints.length,10);assert.ok(e.roomZoneFeedback.firstInvalidCell);assert.equal(hash(scene),before);
});
test('rectangular containment reports exact bounds without inventing a polygon or repair',()=>{
 const {scene,host,room}=fixture();host.kind='mass';delete host.points;room.at.offset[0]=11;
 const report=inspectConstruction(scene),e=report.issues.find(i=>i.component==='office').roomZoneFeedback;
 assert.equal(e.hostPoints,null);assert.equal(e.firstInvalidCell,null);assert.deepEqual(e.boundingInteriorXZ,{min:[2,2],endExclusive:[40,40]});
});
