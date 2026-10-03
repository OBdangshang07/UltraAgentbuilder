import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../../src/generation/compiler.mjs';
import {applyPrototypeExpansion,validatePrototypeExpansion,prototypeExpansionSchema,PROTOTYPE_EXPANSION_RULES} from '../../contracts/scene-prototype-expansion.mjs';
import {schemaFeedback} from '../../contracts/schema-feedback.mjs';
import {preparePrototypeSeeds,expandPrototypeSeeds,prototypeSeedWitness} from '../../src/design/prototype-expansion.mjs';
import {basicScene,mass,shape,facade,at,once} from './fixtures.mjs';
import {floorStudy} from './floor-components-fixtures.mjs';

function moduleSeed(){
 const scene=basicScene('prototype-module-study');scene.bounds={width:20,height:24,length:20};scene.constraints={interior:false,walkable:false,passages:[]};
 scene.modules=[{id:'table',parameters:[],size:[2,2,2],nodes:[{nodeId:'top',op:'box',origin:[0,0,0],size:[2,1,2],material:'frame',thickness:1,axis:'x',repeat:once,points:[],blockState:null}]}];
 scene.components=[mass('main',[1,0,1],[18,24,18],[5,10,15,20]),{id:'tableSeed',kind:'module',at:at([3,1,3]),module:'table',values:[],rotation:0,mirror:false,repeat:once,allowOverwrite:[]}];
 return scene;
}
const program=(scene,component,mode='repeat',count=4,step=[0,5,0])=>({format:'ScenePrototypeExpansion',version:1,seedSourceHash:hash(scene),recipes:[{component,mode,count,step}]});
const expand=(scene,p)=>{const seed=preparePrototypeSeeds(scene,p);return expandPrototypeSeeds({scene,program:p,...seed});};

test('model-facing expansion schema separates modes and states exact floor-derived placement',()=>{
 const scene=floorStudy();scene.components[1].floors.count=1;
 const p=program(scene,'rooms','storeys',4,[0,0,0]);assert.equal(schemaFeedback(p,prototypeExpansionSchema).valid,true);
 p.recipes[0].step=[0,5,0];const feedback=schemaFeedback(p,prototypeExpansionSchema);assert.equal(feedback.valid,false);
 assert.ok(feedback.issues.some(i=>i.path==='$.recipes[0].step[1]'&&i.code==='enum'));assert.ok(!feedback.issues.some(i=>i.path.endsWith('.mode')));
 p.recipes[0].step=[0,0,0];p.recipes[0].count=65;assert.equal(schemaFeedback(p,prototypeExpansionSchema).valid,false);
 assert.match(PROTOTYPE_EXPANSION_RULES,/NEVER use a vertical metre stride/);
});
test('expansion reports every invalid seed kind count and step without changing source or invoking a compiler',()=>{
 const scene=moduleSeed(),before=hash(scene),p=program(scene,'tableSeed','storeys',4,[0,0,0]);
 p.recipes.push({component:'main',mode:'panelRows',count:4,step:[1,0,1]});
 assert.throws(()=>validatePrototypeExpansion(scene,p),error=>{
  const issues=error.contract.issues;assert.ok(issues.some(i=>i.component==='tableSeed'&&i.code==='storey-seed-kind'));
  assert.ok(issues.some(i=>i.component==='tableSeed'&&i.code==='storey-seed-count'));
  assert.ok(issues.some(i=>i.component==='main'&&i.code==='panel-seed-kind'));
  assert.ok(issues.some(i=>i.component==='main'&&i.code==='panel-step'));return true;
 });assert.equal(hash(scene),before);
});

test('actual constructed module seed is immutable, witnessed and compiled before bounded full expansion',()=>{
 const scene=moduleSeed(),p=program(scene,'tableSeed'),before=hash(scene),seed=preparePrototypeSeeds(scene,p);
 assert.equal(seed.witness.seeds[0].solidCells,4);assert.equal(seed.seedCompiled.designSources.componentBounds.tableSeed.length,1);
 assert.equal(seed.seedCompiled.manifest.diagnosticOnly,true);assert.equal(seed.seedCompiled.manifest.prototypeSeedOnly,true);
 const full=expandPrototypeSeeds({scene,program:p,...seed});assert.equal(hash(scene),before);assert.equal(seed.seedCompiled.scene.components[1].repeat.count,1);
 assert.equal(full.evidence.expansions[0].verifiedRepetitions,4);assert.equal(full.compiled.designSources.surviving.tableSeed,16);
 assert.equal(full.compiled.manifest.diagnosticOnly,true);assert.equal(full.compiled.manifest.prototypeExpansionOnly,true);
 assert.equal(full.evidence.visualQualityVerified,false);assert.equal(full.evidence.navigationCertified,false);assert.equal(full.evidence.canAuthorizePlacement,false);
 assert.deepEqual(full.scene.palette,scene.palette);assert.deepEqual(full.scene.modules,scene.modules);assert.deepEqual(full.scene.constraints,scene.constraints);
 assert.deepEqual(full.scene.components[1].at,scene.components[1].at);assert.deepEqual(full.scene.components[1].allowOverwrite,[]);
});
test('storey seed uses actual irregular source floor schedule, including the exceptional last floor',()=>{
 const scene=floorStudy();scene.components[1].floors.count=1;scene.components[1].floorMaterial='frame';
 const full=expand(scene,program(scene,'rooms','storeys',4,[0,0,0]));
 const layout=full.compiled.designSources.parametricLayouts.find(l=>l.component==='rooms');
 assert.deepEqual(layout.rows.map(r=>r.base),[2,7,12,18]);assert.deepEqual(layout.rows.map(r=>r.height),[5,5,6,5]);assert.equal(layout.expandedInstanceChecks,4);
 assert.equal(full.scene.components[1].floors.source,'main');
});
test('one real facade row expands without changing horizontal rhythm, materials or entry exclusions',()=>{
 const scene=moduleSeed();scene.components.push({...facade('skin','main','north',{start:[1,1],count:[3,1],step:[5,0],size:[3,3],projection:0,sill:0,shade:0,exclude:[[1,0]]}),kind:'panelFacade',borders:[0,0,0,0],recess:0});
 const full=expand(scene,program(scene,'skin','panelRows',4,[0,5,0]));
 assert.equal(full.scene.components[2].count[0],3);assert.equal(full.scene.components[2].step[0],5);assert.deepEqual(full.scene.components[2].exclude,[[1,0]]);
 assert.ok(full.compiled.designSources.surviving.skin>0);assert.equal(full.evidence.expansions[0].verifiedRepetitions,4);assert.equal(full.evidence.expansions[0].componentBoundsCount,1); // One hosted component owns all panel rows.
});
test('stale source, duplicate recipes, an existing repetition and permission/bounds rewrites cannot become a prototype program',()=>{
 const scene=moduleSeed(),p=program(scene,'tableSeed');
 for(const change of [v=>v.seedSourceHash='0'.repeat(64),v=>v.recipes.push(structuredClone(v.recipes[0])),v=>v.recipes[0].component='main',v=>v.recipes[0].count=1,v=>v.recipes[0].step=[0,0,0],v=>v.recipes[0].allowOverwrite=['main'],v=>v.bounds={height:384}]){
  const invalid=structuredClone(p);change(invalid);assert.throws(()=>applyPrototypeExpansion(scene,invalid));
 }
 scene.components[1].repeat={count:2,step:[0,5,0]};assert.throws(()=>preparePrototypeSeeds(scene,program(scene,'tableSeed')),/one unexpanded seed/);
});
test('all expanded geometry is checked: out-of-bounds and host slab ownership fail without moving the seed',()=>{
 const scene=moduleSeed(),before=hash(scene);
 assert.throws(()=>expand(scene,program(scene,'tableSeed','repeat',4,[0,100,0])),/outside/);
 assert.throws(()=>expand(scene,program(scene,'tableSeed','repeat',4,[0,4,0])),/Ownership conflict/);
 assert.equal(hash(scene),before);
});
test('a changed saved seed cell, owner or witness fails before expansion',()=>{
 for(const change of [s=>s.seedCompiled.cells[0]=1,s=>s.seedCompiled.sourceOwners[0]=1,s=>s.witness.geometryHash='0'.repeat(64),s=>s.seedCompiled.scene.id='changed']){
  const scene=moduleSeed(),p=program(scene,'tableSeed'),seed=preparePrototypeSeeds(scene,p);change(seed);
  assert.throws(()=>expandPrototypeSeeds({scene,program:p,...seed}),/mismatch|exact original seed witness/);
 }
});
test('a seed label whose construction is completely overwritten cannot prove a completed prototype',()=>{
 const scene=moduleSeed();scene.components.push(shape('cover',[3,1,3],[2,1,2],'wall',{allowOverwrite:['tableSeed']}));
 assert.throws(()=>preparePrototypeSeeds(scene,program(scene,'tableSeed')),/no surviving geometry/);
});
test('seed witness identity includes exactly the declared expansion recipe and actual asset provenance',()=>{
 const scene=moduleSeed(),p=program(scene,'tableSeed'),seed=preparePrototypeSeeds(scene,p),changed=structuredClone(p);changed.recipes[0].count=3;
 assert.throws(()=>expandPrototypeSeeds({scene,program:changed,...seed}),/exact original seed witness/);
 assert.equal(prototypeSeedWitness(scene,p,seed.seedCompiled).witnessHash,seed.witness.witnessHash);
});
