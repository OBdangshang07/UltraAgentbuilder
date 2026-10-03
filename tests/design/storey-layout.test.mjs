import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validateScene} from '../../contracts/scene-spec.schema.mjs';
import {compileScene,lowerScene} from '../../src/design/compiler.mjs';
import {inspectConstruction} from '../../src/design/construction-feedback.mjs';
import {expandStoreyFacade} from '../../src/design/storey-layout.mjs';
import {reviseScene,affectedComponents} from '../../src/design/revision.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {readNativeBundle} from '../../src/generation/bundle.mjs';
import {architectureEvidence} from '../../src/design/architecture-evidence.mjs';
import {correctionFeedback} from '../../src/design/correction-feedback.mjs';
import {shape} from './fixtures.mjs';
import {storeyStudy,storeyWorldTower} from './storey-layout-fixtures.mjs';

const expand=s=>expandStoreyFacade(s.components[1],s.components[0],{origin:[7,0,7],size:[26,22,26]},[40,24,40]);
const state=(c,x,y,z)=>c.manifest.palette[c.cells[x+z*c.manifest.dimensions.width+y*c.manifest.dimensions.width*c.manifest.dimensions.length]];

for(const face of ['north','south','east','west'])test(`floor-derived ${face} panels equal explicit bands including transfer and top floors`,()=>{
  const s=storeyStudy(face),before=JSON.stringify(s),a=compileScene(s),explicit=structuredClone(s);
  // Independent arithmetic: 4 bays width4/gap2 between 2-cell margins;
  // slabs0,5,10,16 and roof21 give panel heights4,4,5,4.
  explicit.components.splice(1,1,...[1,6,11,17].map((y,i)=>({id:'manual'+i,kind:'panelFacade',host:'main',face,allowOverwrite:[],margin:2,
    start:[2,y],count:[4,1],step:[6,0],size:[4,[4,4,5,4][i]],borders:[0,0,0,0],recess:0,frame:'frame',glazing:'glass',lattice:false,projection:0,sill:0,shade:0,exclude:[]})));
  assert.deepEqual(a.binary,compileScene(explicit).binary);assert.equal(JSON.stringify(s),before);
  const e=a.designSources.parametricLayouts[0];assert.equal(e.expandedPanelChecks,16);assert.equal(e.checksComplete,true);assert.equal(e.canAuthorizePlacement,false);
  assert.deepEqual(e.rows.map(r=>r.height),[4,4,5,4]);assert.deepEqual([...new Set(e.representatives.map(p=>p.row))],[0,1,2,3]);
  assert.deepEqual(inspectConstruction(s).parametricLayouts,a.designSources.parametricLayouts);
  assert.deepEqual(a.designSources.dependencies.panels,['main']);assert.ok(Object.values(a.designSources.nodeSources).some(n=>n.layoutSource?.firstRow===2));
});

test('count and alignment semantics are exact and never silently capped',()=>{
  for(const [align,start] of [['start',2],['center',8],['end',14]]){
    const s=storeyStudy('south',{columns:{width:4,gap:2,count:2,align}});assert.equal(expand(s).evidence.columns.start,start);
  }
  const s=storeyStudy();s.components[1].columns.count=5;assert.throws(()=>compileScene(s),/nothing was clipped/);
  const r=inspectConstruction(s);assert.equal(r.issueCount,1);assert.equal(r.issueGroups[0].layoutFeedback.rule,'columns');assert.equal(r.issueGroups[0].occurrences,1);
  s.components[0].size=[130,22,20];s.bounds={width:144,height:24,length:40};s.components[1].columns={width:1,gap:0,count:'fit',align:'start'};
  assert.throws(()=>compileScene(s),/64-column/);
});

test('exclusions preserve the selected row indices across nonuniform bands',()=>{
  const s=storeyStudy('north',{exclude:[[0,0],[3,2],[1,3]]}),c=compileScene(s);
  assert.equal(state(c,9,1,7),'minecraft:sandstone');assert.equal(state(c,27,11,7),'minecraft:sandstone');assert.equal(state(c,15,17,7),'minecraft:sandstone');
  assert.equal(state(c,9,6,7),'minecraft:glass');assert.equal(c.designSources.parametricLayouts[0].expandedPanelChecks,13);
  const partial=storeyStudy('south',{floors:{first:2,count:2},exclude:[[0,0]]});assert.deepEqual(expand(partial).evidence.rows.map(r=>r.floorIndex),[2,3]);
  s.components[1].exclude=[[4,0]];assert.throws(()=>compileScene(s),/outside the derived/);
  s.components[1].exclude=Array.from({length:4},(_,col)=>Array.from({length:4},(_,row)=>[col,row])).flat();assert.throws(()=>compileScene(s),/all panels are excluded/);
});

test('schema rejects arithmetic/code and mixed hosted field families',()=>{
  for(const modify of [c=>c.at={},c=>c.repeat={},c=>c.start=[2,1],c=>c.count=[2,4],c=>c.columns.count='2+2',c=>c.columns.width=-1,c=>c.floors.count=100,c=>c.insets=[1.5,0]]){
    const s=storeyStudy();modify(s.components[1]);assert.throws(()=>validateScene(s));
  }
});

test('invalid representative/exception geometry fails without mutating source or ignoring full-scene conflicts',()=>{
  for(const modify of [s=>s.components[1].insets=[0,0],s=>s.components[1].borders=[0,0,3,1],s=>s.components[1].floors={first:2,count:3},s=>s.components[1].recess=1,
    s=>{s.components[0].at.offset[2]=0;s.components[1].borders=[1,1,0,0];s.components[1].projection=1;},
    s=>{s.components[0].levels=[5,10,20];s.components[1].exclude=[[0,3],[1,3],[2,3],[3,3]];}]){
    const s=storeyStudy();modify(s);const before=hash(s);assert.throws(()=>compileScene(s));assert.equal(hash(s),before);
  }
  const s=storeyStudy();s.components.push(shape('protected',[9,1,7],[4,4,1],'frame',{stage:'structure',allowOverwrite:['main']}));
  assert.equal(inspectConstruction(s).status,'passed');assert.throws(()=>compileScene(s),/Ownership conflict: panels -> protected/);
});

test('layout preflight respects diagnostic work budgets and never calls skipped evidence complete',()=>{
  const s=storeyStudy(),r=inspectConstruction(s,{maxPrimitiveChecks:1});assert.equal(r.checksComplete,false);assert.deepEqual(r.skippedComponents,['panels']);assert.equal(r.status,'incomplete');assert.equal(r.parametricLayouts,undefined);
});

test('local revisions retain saved source identity, permissions and dependency closure',()=>{
  const s=storeyStudy(),base=compileScene(s),replacement={...s.components[1],glazing:'blue_glass'};
  const scope={components:['panels'],protectedComponents:['main'],regions:base.designSources.componentBounds.panels,shared:'instance'};
  const patch={baseHash:base.manifest.assetHash,replaceComponents:[replacement],removeComponents:[],replaceModules:[],replaceInstances:[]};
  const revised=reviseScene(s,patch,scope,{baseCompiled:base});assert.ok(revised.revision.changedCells>0);assert.equal(revised.compiled.scene.components[1].kind,'storeyFacade');
  replacement.columns={width:5,gap:0,count:4,align:'start'};assert.throws(()=>reviseScene(s,patch,scope,{baseCompiled:base}),/protected|outside approved/i);
  assert.deepEqual(affectedComponents(s,['main']),['main','panels']);assert.equal(hash(base.scene),hash(s));
});

test('224-high layout remains compact, uses real top height and survives native bundle roundtrip',async()=>{
  const s=storeyWorldTower(),c=compileScene(s,{navigationPolicy:'strict'}),e=c.designSources.parametricLayouts[0];
  assert.equal(c.manifest.dimensions.height,224);assert.equal(c.manifest.quality.navigation,'verified');assert.equal(e.rows.length,44);assert.equal(e.rows.at(-1).height,7);
  assert.ok(c.spec.nodes.filter(n=>c.designSources.nodeSources[n.nodeId]?.component==='panels').length<32);
  assert.equal(c.designSources.parametricLayouts[0].expandedPanelChecks,176);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-storey-bundle-'));
  for(const [name,value] of Object.entries({manifest:c.manifest,spec:c.spec,scene:c.scene,'design-sources':c.designSources}))await fs.writeFile(path.join(dir,name+'.json'),JSON.stringify(value,null,2));
  const owners=Buffer.alloc(c.sourceOwners.length*2);c.sourceOwners.forEach((v,i)=>owners.writeUInt16LE(v,i*2));
  await fs.writeFile(path.join(dir,'cells.bin'),c.binary);await fs.writeFile(path.join(dir,'source-owners.bin'),owners);const reread=await readNativeBundle(dir);
  assert.deepEqual(reread.scene,s);assert.deepEqual(reread.designSources.parametricLayouts,c.designSources.parametricLayouts);assert.equal(reread.manifest.assetHash,c.manifest.assetHash);
  assert.equal(architectureEvidence(s).storeyFacadeRules[0].columns.count,'fit');
  const raw={constructionFeedback:inspectConstruction(s)},before=hash(raw),compact=correctionFeedback(raw).constructionFeedback.parametricLayouts[0];
  assert.equal(compact.rows,undefined);assert.equal(compact.floorCount,44);assert.equal(compact.rowBands.length,2);assert.equal(compact.lastFloor.height,7);assert.equal(hash(raw),before);
});

test('clear unglazed storey apertures retain negative-space feature evidence',()=>{
  const s=storeyStudy('south',{glazing:null});s.featureBindings=[{feature:'Open loggia',components:['panels']}];const c=compileScene(s);
  assert.ok(c.designSources.survivingClear.panels);assert.ok(!c.manifest.scene.diagnostics.some(d=>['feature-not-visible','component-covered'].includes(d.code)));
});
