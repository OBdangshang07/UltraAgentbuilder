import test from 'node:test';
import assert from 'node:assert/strict';
import {basicScene,mass,facade,entry,shape,at,once} from './fixtures.mjs';
import {inspectConstruction} from '../../src/design/construction-feedback.mjs';
import {compileScene,inspectPartialConstructionOwnership} from '../../src/design/compiler.mjs';
import {assessSceneCheckpoint} from '../../src/design/checkpoint.mjs';
import {correctionFeedback,assemblyCorrectionInput} from '../../src/design/correction-feedback.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {floorWorldTower} from './floor-components-fixtures.mjs';

function collisions(){
  const s=basicScene();
  s.components=[mass('main',[4,0,4],[20,20,20]),
    facade('windows','main','north',{margin:2,start:[1,2],size:[4,3],count:[2,3],step:[5,5],shade:0}),
    entry('entry','main',{u:14,canopy:0}),
    {id:'walk',kind:'path',at:at([10,0,3]),repeat:once,allowOverwrite:[],size:[1,1,1],material:'floor',clearance:2},
    shape('lamp',[18,3,4],[1,1,1],'lamp',{allowOverwrite:['main']})];
  s.constraints.passages=[{origin:[8,1,8],size:[1,2,1]}];return s;
}

test('one rejected facade no longer hides later path, sill and entry-light conflicts',()=>{
  const s=collisions(),before=hash(s),{report,compiled}=assessSceneCheckpoint(s);
  assert.equal(compiled,undefined);assert.equal(report.geometryPassed,false);assert.equal(hash(s),before);
  assert.match(report.error,/u.start=1 must be >=2/);
  const a=report.supplementalOwnership;
  assert.equal(a.canAuthorizePlacement,false);assert.equal(a.checksComplete,false);assert.equal(a.coveredPhasesComplete,true);
  assert.deepEqual(a.partiallyOmittedComponents,['windows']);assert.equal(a.omissions[0].omittedPanels,3);
  assert.deepEqual(a.conflicts.map(c=>[c.from,c.to]),[['walk','windows'],['lamp','entry']]);
  const [walk,lamp]=a.conflicts;
  assert.deepEqual(walk.point,[10,2,3]);assert.deepEqual(walk.bounds,{min:[10,2,3],max:[10,2,3]});assert.equal(walk.firstWrite.operation,'clear');assert.equal(walk.firstWrite.previous,'solid');
  assert.deepEqual(lamp.point,[18,3,4]);assert.equal(lamp.firstWrite.operation,'set');
  assert.equal(a.cells,undefined);assert.equal(a.manifest,undefined);assert.throws(()=>compileScene(s),/margins/);
  // The audit has not installed implicit clipping/exclusion in source/compiler.
  s.components[1].start[0]=2;assert.throws(()=>compileScene(s),/Ownership conflict/);
});

test('hundreds of repeated errors retain every component and distinguish U from Y edges',()=>{
  const s=basicScene();s.bounds={width:40,height:240,length:40};
  s.components=[mass('main',[4,0,4],[32,224,32])];
  for(let n=0;n<12;n++)s.components.push(facade('window'+n,'main','north',{margin:2,start:[1,1],count:[1,44],step:[0,5],size:[4,3],projection:0,sill:0,shade:0}));
  // Independent upper-end failure in the final component, AFTER 128 raw errors.
  s.components.at(-1).count[1]=45;
  const before=hash(s),raw=inspectConstruction(s),compact=correctionFeedback({sourceHash:before,constructionFeedback:raw,geometryPassed:false,canAuthorizePlacement:false});
  assert.equal(raw.truncated,true);assert.equal(raw.issueCount,529);assert.equal(raw.issueGroups.length,13);assert.equal(raw.groupsTruncated,false);
  assert.equal(new Set(compact.constructionFeedback.issues.map(g=>g.component)).size,12);
  assert.equal(compact.constructionFeedback.truncated,false);assert.equal(compact.constructionFeedback.rawSamplesTruncated,true);
  const upper=compact.constructionFeedback.issues.at(-1);assert.equal(upper.component,'window11');assert.equal(upper.panel.row,44);assert.equal(upper.violations.length,2);
  assert.equal(raw.issueGroups[0].occurrences,44);assert.deepEqual(raw.issueGroups[0].panelIndexRange.rows,[0,43]);
  assert.ok(JSON.stringify(compact).length<JSON.stringify({constructionFeedback:raw}).length/3);
  assert.equal(hash(s),before);assert.equal(raw.issues.length,128);
});

test('group storage and check limits explicitly stay partial, never become a pass',()=>{
  const s=collisions(),raw=inspectConstruction(s,{maxPrimitiveChecks:1,maxIssues:1});
  const compact=correctionFeedback({constructionFeedback:raw});assert.equal(compact.constructionFeedback.checksComplete,false);assert.equal(compact.constructionFeedback.status,'errors');
  // Unknown geometry/material failure remains a failed audit, not empty success.
  s.components.push(shape('invalid',[0,0,0],[1,1,1],'missing_material'));
  const a=inspectPartialConstructionOwnership(s);assert.equal(a.coveredPhasesComplete,false);assert.ok(a.error);assert.equal(a.checksComplete,false);
});

test('all correction stages summarize only feedback and preserve source, scope and authority',()=>{
  const s=collisions(),feedback=assessSceneCheckpoint(s).report;
  const input={previousDraft:s,feedback,contractFeedback:feedback,critique:{rejectedSource:s,feedback}};
  const before=hash(input),next=assemblyCorrectionInput(input);
  assert.equal(hash(input),before);assert.equal(next.previousDraft,s);assert.equal(next.critique.rejectedSource,s);
  for(const r of [next.feedback,next.contractFeedback,next.critique.feedback]){assert.equal(r.canAuthorizePlacement,false);assert.equal(r.geometryPassed,false);assert.equal(r.sourceHash,hash(s));assert.equal(r.constructionFeedback.issues.length,1);}
  assert.deepEqual(assemblyCorrectionInput(next),next);
  assert.deepEqual(correctionFeedback({contract:{valid:false}}),{contract:{valid:false}});
});

test('package repair explicitly separates accepted feedback from the failed candidate without changing either',()=>{
 const input={sourceHash:'accepted',repairBase:{candidateHash:'failed',scene:{marker:'unchanged'},approved:false,canAuthorizePlacement:false},
  feedback:{geometryPassed:true,canAuthorizePlacement:false},critique:{feedback:{geometryPassed:false,error:'Ownership conflict: detail -> pier',constructionFeedback:{status:'passed'}}}};
 const before=hash(input),next=assemblyCorrectionInput(input);
 assert.equal(hash(input),before);assert.equal(Object.keys(next)[0],'repairRequirement');
 assert.equal(next.repairRequirement.status,'rejected-candidate-must-change');assert.equal(next.repairRequirement.acceptedSourceHash,'accepted');assert.equal(next.repairRequirement.candidateHash,'failed');
 assert.equal(next.repairRequirement.error,input.critique.feedback.error);assert.equal(next.repairRequirement.canAuthorizePlacement,false);
 assert.equal(next.feedback.geometryPassed,true);assert.equal(next.critique.feedback.geometryPassed,false);assert.equal(next.repairBase,input.repairBase);
 assert.deepEqual(assemblyCorrectionInput(next),next);
 assert.equal(assemblyCorrectionInput({...input,repairBase:null}).repairRequirement,undefined);
});

test('group-cap overflow is explicit and cannot erase a failed status',()=>{
  const s=basicScene();
  s.modules=[{id:'bounded',parameters:[],size:[2,2,2],nodes:[0,1,2].map(i=>({nodeId:'outside'+i,op:'box',origin:[3,i,0],size:[1,1,1],material:'frame',thickness:1,axis:'x',repeat:once,points:[],blockState:null}))}];
  s.components=Array.from({length:256},(_,i)=>({id:'consumer'+i,kind:'module',at:at([0,0,0]),module:'bounded',values:[],rotation:0,mirror:false,repeat:once,allowOverwrite:[]}));
  const raw=inspectConstruction(s),compact=correctionFeedback({constructionFeedback:raw,geometryPassed:false,canAuthorizePlacement:false});
  assert.equal(raw.issueCount,768);assert.equal(raw.issueGroups.length,512);assert.equal(raw.groupsTruncated,true);
  assert.equal(compact.constructionFeedback.truncated,true);assert.equal(compact.constructionFeedback.status,'errors');
  assert.equal(compact.geometryPassed,false);assert.equal(compact.canAuthorizePlacement,false);
});

test('complete floor arithmetic shares repeated prose but retains all rules, bands and actual conflicts',()=>{
  const s=floorWorldTower(),construction=inspectConstruction(s);
  assert.equal(construction.status,'passed');assert.equal(construction.checksComplete,true);
  const report={sourceHash:hash(s),constructionFeedback:construction,geometryPassed:false,canAuthorizePlacement:false,error:'Actual ownership conflict',diagnostics:[{code:'ownership-conflict',from:'a',to:'b',point:[1,2,3]}],navigationFeedback:{checksComplete:false,issues:[{code:'unverified'}],truncated:true}},before=hash(report),compact=correctionFeedback(report);
  assert.equal(hash(report),before);assert.equal(compact.geometryPassed,false);assert.equal(compact.canAuthorizePlacement,false);
  assert.equal(compact.error,report.error);assert.equal(compact.diagnostics,report.diagnostics);assert.equal(compact.navigationFeedback,report.navigationFeedback);
  assert.equal(compact.constructionFeedback.parametricLayoutFormat,'complete-arithmetic-pass-summaries');
  const a=compact.constructionFeedback.parametricLayouts,b=construction.parametricLayouts;
  assert.deepEqual(a.map(l=>l.component),b.map(l=>l.component));
  for(let i=0;i<a.length;i++){
    assert.deepEqual(a[i].rowBands,b[i].rowBands);assert.deepEqual(a[i].firstFloor,b[i].rows[0]);
    assert.deepEqual(a[i].lastFloor??a[i].firstFloor,b[i].rows.at(-1));assert.equal(a[i].expandedInstanceChecks,b[i].expandedInstanceChecks);
    assert.equal(a[i].canAuthorizePlacement,false);assert.equal(a[i].representativeSamples,undefined);
  }
  assert.deepEqual(correctionFeedback(compact),compact);
  assert.ok(JSON.stringify(compact).length<JSON.stringify(report).length/2);
});

test('incomplete, truncated or erroneous floor evidence never becomes a complete-pass summary',()=>{
  const original=inspectConstruction(floorWorldTower());
  for(const mutate of [c=>c.checksComplete=false,c=>c.status='errors',c=>c.issueCount=1,c=>c.groupsTruncated=true,c=>c.truncated=true,c=>c.issueGroups=[{code:'floor-error',component:'late-floor'}],c=>c.parametricLayouts[0].checksComplete=false]){
    const c=structuredClone(original);mutate(c);const before=hash(c),next=correctionFeedback({constructionFeedback:c}).constructionFeedback;
    assert.equal(hash(c),before);assert.equal(next.parametricLayoutFormat,undefined);assert.deepEqual(next.issues,c.issueGroups);
    assert.deepEqual(next.parametricLayouts[0].rowBands,c.parametricLayouts[0].rowBands);assert.ok(next.parametricLayouts[0].representativeSamples);
  }
});
