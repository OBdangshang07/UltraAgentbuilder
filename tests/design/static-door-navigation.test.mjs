import test from 'node:test';
import assert from 'node:assert/strict';
import {assessSceneCheckpoint} from '../../src/design/checkpoint.mjs';
import {checkPackageGeometry} from '../../src/design/assembly-scope.mjs';
import {inspectSceneNavigation} from '../../src/design/navigation-feedback.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {basicScene,mass,shape,at,once} from './fixtures.mjs';

function fixture(open=true){
 const s=basicScene('static-door-circulation');s.bounds={width:16,height:6,length:16};s.components=[mass('main',[1,0,1],[14,6,14])];
 s.constraints={interior:true,walkable:true,passages:[{origin:[3,1,6],size:[1,2,1]},{origin:[12,1,6],size:[1,2,1]}]};
 const next=structuredClone(s);
 next.components.push(shape('core__partition',[8,1,2],[1,4,12],'wall',{stage:'structure'}),
  {kind:'void',id:'core__opening',at:at([8,1,6]),size:[1,2,2],repeat:once,allowOverwrite:['core__partition']},
  {kind:'doorway',id:'core__doors',host:'core__opening',at:at([8,1,6]),repeat:once,allowOverwrite:[],face:'east',width:2,door:'oak_door',hinge:'left',open});
 return {s,next,task:{id:'core',editableComponents:[],regions:[{origin:[0,0,0],size:[16,6,16]}]}};
}
test('real paired open doors preserve checked routes without becoming clear passage cells or a fully verified asset',()=>{
 const {s,next,task}=fixture(),sourceHash=hash(next),before=assessSceneCheckpoint(s),after=assessSceneCheckpoint(next);
 assert.equal(after.report.geometryPassed,true,after.report.error);assert.equal(before.report.quality.navigation,'verified');
 assert.equal(after.report.navigationFeedback.passages[1].entryRelation,'reachable');assert.equal(after.report.navigationFeedback.staticOpenDoors.pairedSupportedCells,4);
 assert.equal(checkPackageGeometry(before.compiled,after.compiled,task,before.report,after.report).previouslyCheckedRoutesPreserved,true);
 assert.equal(after.report.quality.navigation,'unverified');assert.equal(after.report.quality.requiresAcknowledgement,true);assert.equal(hash(next),sourceHash);
 assert.equal(after.report.quality.issues.length,1);assert.equal(after.report.quality.issues[0].code,'partial-block-collision');
});
test('closed doors, newly blocked support and a leaf across the route still reject a real regression',()=>{
 for(const mutation of [n=>n.components.at(-1).open=false,n=>n.components.push(shape('core__block',[8,1,6],[1,2,2],'wall',{allowOverwrite:['core__opening','core__doors']}))]){
  const {s,next,task}=fixture();mutation(next);const before=assessSceneCheckpoint(s),after=assessSceneCheckpoint(next);
  assert.equal(after.report.geometryPassed,true,after.report.error);assert.equal(after.report.navigationFeedback.passages[1].entryRelation,'disconnected');
  assert.throws(()=>checkPackageGeometry(before.compiled,after.compiled,task,before.report,after.report),/regressed/);
 }
});
test('limited static door traces never turn exhausted or undeclared evidence into a pass',()=>{
 const {next}=fixture(),{compiled}=assessSceneCheckpoint(next),r=inspectSceneNavigation(next,compiled,{maxVisits:1});
 assert.equal(r.passages[1].entryRelation,'incomplete');assert.equal(r.checksComplete,false);assert.equal(r.visits,1);assert.equal(r.canAuthorizePlacement,false);
});
