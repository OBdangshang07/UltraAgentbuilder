import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../../src/generation/compiler.mjs';
import {sceneSchema} from '../../contracts/scene-spec.schema.mjs';
import {prototypeExpansionSchema,validatePrototypeExpansion,PROTOTYPE_EXPANSION_RULES} from '../../contracts/scene-prototype-expansion.mjs';
import {prototypeRoleEditSchema} from '../../contracts/scene-decomposed-prototypes.mjs';
import {preparePrototypeSeeds,expandPrototypeSeeds} from '../../src/design/prototype-expansion.mjs';
import {retainedDetailsAndServices,fullRecipeCapacity} from './prototype-capacity-fixtures.mjs';

const index=(bounds,x,y,z)=>x+bounds.width*(z+bounds.length*y);

test('recipe schemas and model guidance use the existing scene component capacity, not a separate 64-recipe ceiling',()=>{
 const maximum=sceneSchema.properties.components.maxItems;
 assert.equal(maximum,256);assert.equal(prototypeExpansionSchema.properties.recipes.maxItems,maximum);
 assert.equal(prototypeRoleEditSchema.properties.recipes.maxItems,maximum);
 assert.match(PROTOTYPE_EXPANSION_RULES,new RegExp('at most '+maximum+' recipes'));
 assert.match(PROTOTYPE_EXPANSION_RULES,/65536/);
});

test('64 retained detail recipes plus three explicit service storeys compile without deleting prior geometry or broadening authority',()=>{
 const {scene,program,retained,services}=retainedDetailsAndServices(),before=hash(scene);
 const seed=preparePrototypeSeeds(scene,program);
 const full=expandPrototypeSeeds({scene,program,...seed});
 assert.equal(program.recipes.length,67);assert.deepEqual(program.recipes.slice(0,64),retained);
 assert.equal(hash(scene),before);assert.equal(hash(seed.seedCompiled.scene),before);
 for(const recipe of retained){
  assert.deepEqual(full.scene.components.find(c=>c.id===recipe.component).repeat,{count:2,step:[0,8,0]});
  assert.equal(full.compiled.designSources.surviving[recipe.component],2);
  assert.equal(full.evidence.expansions.find(e=>e.component===recipe.component).verifiedRepetitions,2);
 }
 for(const id of services){
  const rows=full.compiled.designSources.parametricLayouts.find(l=>l.component===id).rows;
  assert.deepEqual(rows.map(r=>r.base),[113,121]);assert.deepEqual(rows.map(r=>r.height),[8,6]);
  const c=scene.components.find(c=>c.id===id),x=2+c.offset[0],z=2+c.offset[1];
  const cell=index(scene.bounds,x,122,z);
  assert.equal(seed.seedCompiled.cells[cell],1);assert.ok(full.compiled.cells[cell]>1);
  assert.ok(full.compiled.sourceOwners[cell]>0);
  assert.deepEqual(full.scene.components.find(c=>c.id===id),{...c,floors:{...c.floors,count:2}});
 }
 for(const field of ['bounds','palette','modules','reservations','constraints','featureBindings'])assert.deepEqual(full.scene[field],scene[field]);
 assert.deepEqual(full.scene.components[0],scene.components[0]);
 assert.equal(full.compiled.manifest.diagnosticOnly,true);assert.equal(full.compiled.manifest.prototypeExpansionOnly,true);
 assert.equal(full.evidence.canAuthorizePlacement,false);assert.equal(full.evidence.visualQualityVerified,false);
 assert.equal(full.evidence.navigationCertified,false);
});

test('all 256 distinct seeds expand with normal compiler quotas; a 257th recipe is rejected before expansion',()=>{
 const {scene,program}=fullRecipeCapacity(),before=hash(scene),seed=preparePrototypeSeeds(scene,program);
 const full=expandPrototypeSeeds({scene,program,...seed});
 assert.equal(full.evidence.expansions.length,256);assert.equal(full.compiled.manifest.setCount,512);
 assert.ok(full.evidence.expansions.every(e=>e.verifiedRepetitions===2));assert.equal(hash(scene),before);
 const over=structuredClone(program);over.recipes.push({component:'unknownSeed',mode:'repeat',count:2,step:[0,2,0]});
 assert.throws(()=>validatePrototypeExpansion(scene,over),error=>error.contract.issues.some(i=>i.path==='$.recipes'&&i.code==='array-length'&&i.maximum===256));
 assert.equal(hash(scene),before);
});

test('larger recipe capacity does not weaken duplicate, unknown source, stale hash, permission or program-byte checks',()=>{
 const {scene,program}=retainedDetailsAndServices(),before=hash(scene);
 for(const [change,pattern] of [
  [p=>p.recipes.push(structuredClone(p.recipes[0])),/Duplicate/],
  [p=>p.recipes[64].component='missing',/Unknown/],
  [p=>p.seedSourceHash='0'.repeat(64),/different seed source/],
  [p=>p.recipes[64].allowOverwrite=['upperHall'],/contract/],
  [p=>p.padding='x'.repeat(65536),/data quota/]
 ]){
  const invalid=structuredClone(program);change(invalid);assert.throws(()=>preparePrototypeSeeds(scene,invalid),pattern);
  assert.equal(hash(scene),before);
 }
});

test('extra storey recipes still reject wrong floor strides, nonexistent upper floors and reserved-space collisions',()=>{
 for(const [change,pattern] of [
  [(s,p)=>p.recipes[64].step=[0,8,0],/contract/],
  [(s,p)=>p.recipes[64].count=3,/floor|storey/i],
  [(s,p)=>s.reservations.push({id:'protectedUpper',at:{relativeTo:null,anchor:'min',offset:[23,122,4]},size:[1,1,1],allowedComponents:[]}),/reserved|reservation|protected/i]
 ]){
  const {scene,program}=retainedDetailsAndServices();change(scene,program);program.seedSourceHash=hash(scene);
  const before=hash(scene);
  assert.throws(()=>{const seed=preparePrototypeSeeds(scene,program);expandPrototypeSeeds({scene,program,...seed});},pattern);
  assert.equal(hash(scene),before);
 }
});
