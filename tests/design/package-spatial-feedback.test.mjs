import test from 'node:test';
import assert from 'node:assert/strict';
import {basicScene,mass,shape} from './fixtures.mjs';
import {assessSceneCheckpoint} from '../../src/design/checkpoint.mjs';
import {packageSpatialFeedback} from '../../src/design/package-spatial-feedback.mjs';
import {hash} from '../../src/generation/compiler.mjs';

function fixture(){
 const scene=basicScene();scene.components=[mass('host',[4,0,4],[12,10,12]),shape('planter',[3,0,3],[1,2,1],'wall')];
 scene.constraints.passages=[{origin:[6,1,6],size:[1,2,1]}];
 const base=assessSceneCheckpoint(scene).compiled,proposal=structuredClone(scene);
 proposal.components.push(shape('detail__pier',[3,0,3],[1,8,1],'frame'));
 const {compiled,report}=assessSceneCheckpoint(proposal);
 return {scene,proposal,base,compiled,report,task:{id:'detail',editableComponents:[],regions:[{origin:[0,0,0],size:[20,12,20]}]}};
}
const cell=(e,g,y,snapshot,x,z)=>{
 const row=g.layers.find(l=>l.y===y)[snapshot][z-g.z[0]].flatMap(([id,n])=>Array(n).fill(id));
 return e.legend[row[x-g.x[0]]];
};

test('bounded spatial witnesses expose both hidden receiver and pending producer without moving either',()=>{
 const f=fixture(),before=hash({source:f.scene,candidate:f.proposal,cells:f.compiled.binary,owners:f.compiled.sourceOwners});
 assert.equal(f.report.geometryPassed,false);
 const e=packageSpatialFeedback(f.base,f.compiled,f.task,f.report),g=e.groups[0];
 assert.equal(e.canAuthorizePlacement,false);assert.equal(e.checksComplete,false);assert.equal(e.geometryChanged,false);
 assert.equal(e.candidateSourceHash,hash(f.proposal));assert.equal(e.acceptedSourceHash,hash(f.scene));
 assert.equal(cell(e,g,0,'accepted',3,3).owner,'planter');assert.equal(cell(e,g,0,'candidate',3,3).owner,'detail__pier');
 assert.equal(cell(e,g,1,'accepted',4,4).owner,'host');assert.equal(cell(e,g,1,'accepted',4,4).mask,'set');
 assert.equal(cell(e,g,1,'accepted',0,0).mask,'keep');
 assert.deepEqual(g.producerBoundsSamples[0].origin,[3,0,3]);assert.ok(g.layers.some(l=>l.y===7));
 assert.equal(hash({source:f.scene,candidate:f.proposal,cells:f.compiled.binary,owners:f.compiled.sourceOwners}),before);
});

test('sampling limits and repeated instance omissions are explicit and never a pass',()=>{
 const f=fixture();f.compiled.designSources.componentBounds.detail__pier=Array.from({length:20},(_,i)=>({origin:[3+i,0,3],size:[1,8,1]}));
 f.report.diagnostics=Array.from({length:100},()=>({...f.report.diagnostics.find(d=>d.severity==='blocked')}));
 const e=packageSpatialFeedback(f.base,f.compiled,f.task,f.report);
 assert.equal(e.totalConflictGroups,100);assert.equal(e.groups.length,4);assert.equal(e.groupsTruncated,true);assert.ok(e.sampledCells<=4096);
 assert.equal(e.groups[0].producerInstanceCount,20);assert.equal(e.groups[0].producerBoundsTruncated,true);
 for(const g of e.groups)for(const l of g.layers)for(const key of ['accepted','candidate']){
  assert.equal(l[key].length,g.z[1]-g.z[0]+1);
  for(const row of l[key])assert.equal(row.reduce((n,r)=>n+r[1],0),g.x[1]-g.x[0]+1);
 }
});

test('region conflicts get spatial evidence; absent conflicts and mismatched identities cannot imply clearance',()=>{
 const f=fixture();f.report.diagnostics=[];
 assert.equal(packageSpatialFeedback(f.base,f.compiled,f.task,f.report),null);
 f.report.packageScopeFeedback={groups:[{code:'outside-region',after:'detail__pier',before:null,samples:[[3,0,3]]}]};
 assert.equal(packageSpatialFeedback(f.base,f.compiled,f.task,f.report).groups[0].code,'outside-region');
 assert.throws(()=>packageSpatialFeedback(f.base,f.compiled,f.task,{...f.report,sourceHash:'0'.repeat(64)}),/identity/);
 f.base.manifest.diagnosticOnly=false;assert.throws(()=>packageSpatialFeedback(f.base,f.compiled,f.task,f.report),/identity/);
});
