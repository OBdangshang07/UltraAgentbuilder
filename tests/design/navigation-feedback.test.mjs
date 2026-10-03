import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScene} from '../../src/design/compiler.mjs';
import {inspectSceneNavigation} from '../../src/design/navigation-feedback.mjs';
import {assessSceneCheckpoint} from '../../src/design/checkpoint.mjs';
import {walkingGrid} from '../../src/generation/walking-grid.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {fourMetreWorldTower,basicScene,mass,at,shape} from './fixtures.mjs';
import {transformPoint} from '../../src/generation/groups.mjs';

function flights(rotation=0,style='switchback'){
 const s=basicScene('navigation-feedback');s.bounds={width:24,height:30,length:24};
 const local=[style==='straight'?6:4,7,5],size=rotation%2?[5,7,local[0]]:local;
 s.components=[mass('main',[1,0,1],[22,30,22],[4,8,12,16,20,24]),{id:'flights',kind:'stairs',host:'main',at:at([6,0,6]),size,style,rotation,width:2,rise:4,material:'floor',repeat:{count:6,step:[0,4,0]},allowOverwrite:[]}];
 s.constraints.passages=[0,4,8,12,16,20,24].map(y=>({origin:[3,y+1,3],size:[1,2,1]}));return s;
}
for(const rotation of [0,1,2,3])for(const style of ['straight','switchback'])test(`independent local stair traces use real cells: ${style} rotation ${rotation}`,()=>{
 const s=flights(rotation,style),c=compileScene(s),r=inspectSceneNavigation(s,c);
 assert.equal(r.stairs.checked,6);assert.equal(r.stairs.localTwoWayPaths,6);assert.equal(r.stairs.unverified,0);assert.equal(r.canAuthorizePlacement,false);assert.equal(r.checksComplete,true);
});
test('224 metre full-height engineering tower reports every actual stair instance without changing source, quality or cells',()=>{
 const s=fourMetreWorldTower(),c=compileScene(s,{navigationPolicy:'strict'}),before=hash({s,manifest:c.manifest,cells:[...c.cells]});
 const r=inspectSceneNavigation(s,c);assert.equal(r.stairs.checked,54);assert.equal(r.stairs.localTwoWayPaths,54);assert.equal(r.stairs.groups[1].checkedLowerFloors.at(-1),216);
 assert.equal(r.passages.filter(p=>p.entryRelation==='reachable').length,55);assert.equal(r.checksComplete,true);
 assert.equal(hash({s,manifest:c.manifest,cells:[...c.cells]}),before);
});
test('bad first entry never suppresses later floor observations or a low stair ceiling',()=>{
 const s=flights();s.constraints.passages.unshift({origin:[0,1,0],size:[1,2,1]});
 s.components.push(shape('oldLowCeiling',[8,6,9],[1,1,2],'floor',{allowOverwrite:['flights']}));
 const c=compileScene(s),r=inspectSceneNavigation(s,c);
 assert.equal(c.manifest.quality.navigation,'unverified');assert.equal(r.entry.startValid,false);assert.equal(r.passages[1].standable,1);
 assert.equal(r.passages[1].entryRelation,'entry-unverified');assert.ok(r.stairs.unverified>0);assert.ok(r.stairs.localTwoWayPaths>0);
 const problem=r.issues.find(i=>i.code==='stair-local-route-unverified');assert.equal(problem.lowerFloor,0);assert.equal(problem.upFound,false);assert.equal(problem.downFound,true);
 assert.equal(r.canAuthorizePlacement,false);assert.equal(assessSceneCheckpoint(s).report.navigationFeedback.stairs.unverified,r.stairs.unverified);
});
test('partial steps remain unverified even when the lower and upper landings stand clear',()=>{
 const s=flights();s.components[1].material='oak_stairs';const c=compileScene(s),r=inspectSceneNavigation(s,c);
 assert.equal(r.stairs.localTwoWayPaths,0);assert.equal(r.stairs.unverified,6);assert.equal(c.manifest.quality.navigation,'unverified');
});
test('declared passage footprints and full clearance are inspected, not just the first origin',()=>{
 const s=flights();s.constraints.passages=[{origin:[3,1,3],size:[2,3,2]}];s.components.push(shape('overhead',[4,3,4],[1,1,1],'wall'));
 const r=inspectSceneNavigation(s,compileScene(s));assert.equal(r.passages[0].checked,4);assert.equal(r.passages[0].standable,4);assert.equal(r.passages[0].clearanceObstructions,1);assert.equal(r.probeCellsChecked,12);
 assert.ok(r.issues.some(i=>i.code==='passage-unverified'));assert.equal(r.canAuthorizePlacement,false);
});
test('exhausted traversal/stair/probe budgets explicitly leave unchecked results unknown',()=>{
 const s=flights(),c=compileScene(s);
 const short=inspectSceneNavigation(s,c,{maxVisits:1,maxProbeCells:1});assert.equal(short.checksComplete,false);assert.equal(short.visits,1);assert.equal(short.passages[0].entryRelation,'incomplete');assert.equal(short.stairs.skipped,6);
 const sampled=inspectSceneNavigation(s,c,{maxStairs:1});assert.equal(sampled.checksComplete,false);assert.equal(sampled.stairs.checked,1);assert.equal(sampled.stairs.skipped,5);
 for(const options of [{maxVisits:Infinity},{maxVisits:0},{maxIssues:0},{maxStairs:10000},{maxProbeCells:-1}])assert.throws(()=>inspectSceneNavigation(s,c,options),/budget/);
 s.seed++;assert.throws(()=>inspectSceneNavigation(s,c),/source mismatch/);
});
test('truncated failures still retain exact counts and never appear complete/pass',()=>{
 const s=flights();s.constraints.passages.unshift({origin:[0,1,0],size:[1,2,1]});s.components[1].material='oak_stairs';
 const r=inspectSceneNavigation(s,compileScene(s),{maxIssues:1});assert.equal(r.truncated,true);assert.equal(r.issues.length,1);assert.ok(r.issueCount>1);assert.equal(r.stairs.unverified,6);
});
test('bounded graph does not route around a broken stair through an outside path',()=>{
 const s=flights(),c=compileScene(s),grid=walkingGrid({cells:c.cells,palette:c.manifest.palette,...c.manifest.dimensions});
 const box=c.designSources.componentBounds.flights[0],local=s.components[1].size;
 const origin=transformPoint([0,1,0],local,0,false).map((v,i)=>v+box.origin[i]);const r=grid.trace(origin,{region:box});
 assert.equal(r.has([3,1,3]),false);assert.equal(r.has(origin),true);assert.equal(r.complete,true);
 assert.throws(()=>grid.trace(origin,{region:{origin:[-1,0,0],size:[1,1,1]}}),/region/);
});
