import test from 'node:test';import assert from 'node:assert/strict';
import {sceneSchema,validateScene} from '../../contracts/scene-spec.schema.mjs';
import {sceneCapacity,sceneDraftEditSchema,DraftCandidateError} from '../../contracts/scene-draft-edit.schema.mjs';
import {applyPackageEdit} from '../../contracts/scene-assembly.schema.mjs';
import {compileScene} from '../../src/design/compiler.mjs';
import {BUILDING_LIMITS} from '../../contracts/building-limits.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyPlan,packageEdit} from './assembly-fixtures.mjs';
import {instanceStudy} from './fixtures.mjs';
const template=id=>({...structuredClone(instanceStudy().modules[0]),id});

test('whole scene supports 16 existing plus 18 new templates while each edit stays bounded',()=>{
 const p=assemblyPlan(),s=p.scene;s.modules=Array.from({length:16},(_,i)=>template('old'+i));
 const before=hash(s),edit=packageEdit({previousDraft:s,task:p.packages[0]});edit.modules.put=Array.from({length:18},(_,i)=>template('exterior__m'+i));
 const result=applyPackageEdit(s,edit,p.packages[0]);assert.equal(result.scene.modules.length,34);assert.equal(hash(s),before);assert.ok(compileScene(result.scene).manifest.setCount>0);
 assert.equal(sceneCapacity(s).collections.modules.remaining,240);assert.equal(sceneSchema.properties.modules.maxItems,256);assert.equal(sceneDraftEditSchema.properties.modules.properties.put.maxItems,32);
 edit.modules.put.push(...Array.from({length:15},(_,i)=>template('exterior__extra'+i)));assert.throws(()=>applyPackageEdit(s,edit,p.packages[0]),/Invalid draft edit collection/);
 assert.deepEqual(BUILDING_LIMITS,{width:256,height:384,length:256,cells:8388608,occupied:1000000,nodes:4096,visits:32000000,bytes:1048576});
});

test('merged capacity errors have exact feedback but cannot launder an unauthorized edit',()=>{
 const p=assemblyPlan(),s=p.scene;s.modules=Array.from({length:256},(_,i)=>template('old'+i));validateScene(s);
 const edit=packageEdit({previousDraft:s,task:p.packages[0]});edit.modules.put=[template('exterior__overflow')];
 assert.throws(()=>applyPackageEdit(s,edit,p.packages[0]),error=>error instanceof DraftCandidateError&&error.contract.issues.some(i=>i.path==='$.modules'&&i.code==='array-length')&&error.scene.modules.length===257);
 edit.components.put.push(structuredClone(s.components[0]));assert.throws(()=>applyPackageEdit(s,edit,p.packages[0]),error=>!(error instanceof DraftCandidateError)&&/outside package ownership/.test(error.message));
});
