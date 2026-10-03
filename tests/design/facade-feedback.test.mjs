import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectConstruction} from '../../src/design/construction-feedback.mjs';
import {assessSceneCheckpoint} from '../../src/design/checkpoint.mjs';
import {compileScene,inspectPreFacadeOwnership} from '../../src/design/compiler.mjs';
import {basicScene,mass,facade,shape} from './fixtures.mjs';
import {hash} from '../../src/generation/compiler.mjs';

function study(){
 const s=basicScene();s.bounds={width:64,height:240,length:64};
 s.components=[mass('wingB',[46,16,12],[14,80,20],Array.from({length:19},(_,i)=>(i+1)*4)),
  ...['south','north','east'].map(face=>({...facade('wingB_'+face,'wingB',face,{start:[1,1],count:[1,20],step:[0,4],size:[face==='east'?18:12,3],projection:0,sill:0,shade:0}),kind:'panelFacade',borders:[0,0,0,1],recess:0})),
  ...[18,39].map((x,i)=>shape('pier'+i,[x,216,12],[3,8,3],'wall',{stage:'structure',repeat:{count:2,step:[0,0,21]}})),
  ...[12,33].map((z,i)=>shape('ring'+i,[18,222,z],[24,2,3],'frame',{stage:'structure'}))];
 s.constraints.passages=[{origin:[48,17,14],size:[1,2,1]}];return s;
}
test('reports all three top-row errors and independent crown ownership before any repair or asset',()=>{
 const s=study(),before=hash(s),{report:r,compiled}=assessSceneCheckpoint(s);
 assert.equal(r.geometryPassed,false);assert.equal(compiled,undefined);assert.equal(hash(s),before);
 assert.deepEqual(r.constructionFeedback.issues.map(i=>i.component),['wingB_south','wingB_north','wingB_east']);
 for(const i of r.constructionFeedback.issues){assert.equal(i.panel.row,19);assert.deepEqual(i.panelRange.y,[77,80]);assert.equal(i.roofLayer,79);}
 const extra=r.supplementalOwnership;assert.equal(extra.sourceHash,before);assert.equal(extra.canAuthorizePlacement,false);assert.equal(extra.checksComplete,false);
 assert.equal(extra.coveredPhasesComplete,true);assert.equal(extra.conflicts.length,4);assert.ok(extra.conflicts.every(i=>i.count===18));assert.equal(extra.manifest,undefined);assert.equal(extra.cells,undefined);
 assert.ok(extra.partiallyOmittedComponents.includes('wingB_south'));assert.throws(()=>compileScene(s),/roof/);
});
test('excluded top rows and corrected panels do not hide remaining exact ownership conflicts',()=>{
 const s=study();for(const c of s.components.filter(c=>c.kind==='panelFacade'))c.exclude=[[0,19]];
 assert.equal(inspectConstruction(s).status,'passed');const {report:r,compiled}=assessSceneCheckpoint(s);
 assert.equal(r.geometryPassed,false);assert.match(r.error,/Ownership/);assert.equal(r.diagnostics.filter(d=>d.code==='ownership').length,4);assert.equal(compiled.manifest.diagnosticOnly,true);
});
test('panel feedback uses bounded work and issue storage and rejects invalid layout without cropping',()=>{
 const s=study(),r=inspectConstruction(s,{maxIssues:1});assert.equal(r.issues.length,1);assert.equal(r.issueCount,3);assert.equal(r.truncated,true);
 const limited=inspectConstruction(s,{maxPrimitiveChecks:1});assert.equal(limited.status,'incomplete');assert.equal(limited.checksComplete,false);assert.equal(limited.primitiveChecks,1);
 s.components[1].borders=[4,4,4,4];assert.ok(inspectConstruction(s).issues.some(i=>i.code==='facade-invalid'));
});
test('floor-edge cuts are explicit review feedback, retaining legacy compilation semantics',()=>{
 const s=basicScene();s.components=[mass('main',[4,0,4],[20,20,20],[6]),facade('window','main','north',{start:[2,4],count:[1,1],size:[4,5],projection:0,sill:0,shade:0})];
 s.constraints={interior:false,walkable:false,passages:[]};const r=inspectConstruction(s);
 assert.equal(r.status,'review');assert.equal(r.blockingIssueCount,0);assert.deepEqual(r.issues[0].floors,[6]);assert.equal(r.issues[0].severity,'review');assert.doesNotThrow(()=>compileScene(s));
});
test('all four projection directions match strict compiler bounds, not host-box assumptions',()=>{
 for(const [face,origin] of [['north',[4,0,0]],['south',[4,0,12]],['west',[0,0,4]],['east',[16,0,4]]]){
  const s=basicScene();s.constraints={interior:false,walkable:false,passages:[]};s.components=[mass('main',origin,[20,20,20]),facade('window','main',face,{count:[1,1],projection:1,sill:0,shade:0})];
  assert.ok(inspectConstruction(s).issues.some(i=>i.code==='facade-projection-bounds'));assert.throws(()=>compileScene(s),/outside scene/);
 }
});
test('supplemental ownership failure remains unknown and never repairs invalid early geometry',()=>{
 const s=study();s.components[0].size[1]=400;const r=inspectPreFacadeOwnership(s);assert.equal(r.coveredPhasesComplete,false);assert.equal(r.checksComplete,false);assert.ok(r.error);assert.equal(r.manifest,undefined);
});
