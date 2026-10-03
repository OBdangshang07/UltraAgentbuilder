import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import nbt from 'prismarine-nbt';
import {compileSpec} from '../../src/generation/compiler.mjs';import {sampleSpec} from '../../src/generation/sample.mjs';import {generatorExamples} from '../../src/generation/generator-examples.mjs';import {generationInstructions} from '../../bridge/generation-prompt.mjs';import {exportCompiled} from '../../src/generation/export.mjs';import {readNativeBundle,exportNativeBundle} from '../../src/generation/bundle.mjs';
const review=s=>compileSpec(s,{normalizeGeneratedPassages:true,navigationPolicy:'review'});
test('all teaching examples pass the exact strict compiler and include complete schema node fields',async()=>{
 for(const s of generatorExamples()){assert.equal(compileSpec(s).manifest.quality.navigation,'verified');for(const n of s.nodes)for(const k of ['nodeId','op','origin','size','material','thickness','axis','repeat','points'])assert.ok(Object.hasOwn(n,k));}
 const prompt=await generationInstructions();for(const term of ['VERIFIED TEACHING EXAMPLES','[X,Y,Z]','run >= height','slab','KEEP','box treads'])assert.ok(prompt.includes(term),term);
});
test('single-column staircase semantics are identical to stair primitive or box without hiding actual navigation failure',()=>{
 const s=sampleSpec();s.nodes.push({nodeId:'column',op:'staircase',origin:[4,2,7],size:[1,3,2],material:'floor'});const original=JSON.stringify(s),c=review(s),box=structuredClone(s),primitive=structuredClone(s);box.nodes.at(-1).op='box';primitive.nodes.at(-1).op='stair';
 assert.deepEqual(c.binary,review(box).binary);assert.deepEqual(c.binary,review(primitive).binary);assert.equal(JSON.stringify(s),original);assert.ok(c.manifest.validationNotes.some(n=>n.includes('单列台阶柱')));assert.equal(c.manifest.quality.navigation,'unverified');assert.equal(c.manifest.quality.requiresAcknowledgement,true);
});
test('blocked entry, missing floor and disconnected floors become explicit review outcomes with unchanged masks',()=>{
 for(const mutation of [s=>s.nodes.push({nodeId:'blocked',op:'box',origin:[8,2,2],size:[3,3,1],material:'wall'}),s=>s.nodes.push({nodeId:'missing',op:'keep',origin:[8,1,2],size:[1,1,1]}),s=>s.nodes.push({nodeId:'upper',op:'box',origin:[4,4,7],size:[3,1,3],material:'floor'})]){
  const s=sampleSpec();mutation(s);assert.throws(()=>compileSpec(s));const c=review(s),raw=compileSpec({...s,constraints:{interior:false,walkable:false,passages:[]}});
  assert.deepEqual(c.binary,raw.binary);assert.deepEqual(c.spec.constraints,s.constraints);assert.equal(c.manifest.quality.navigation,'unverified');assert.ok(c.manifest.quality.issues.length);assert.equal(c.manifest.quality.requiresAcknowledgement,true);
 }
});
test('review cannot hide invalid materials, IDs, bounds, declaration vectors or volume',()=>{
 for(const mutation of [s=>s.palette.wall='unsafe',s=>s.nodes[0].origin=[-1,0,0],s=>s.nodes[0].size=[300,1,1],s=>s.nodes[1].nodeId=s.nodes[0].nodeId,s=>s.constraints.passages[0].origin=[30,2,0],s=>s.constraints.passages[0].size=[1,-1,1],s=>s.bounds={width:256,height:384,length:256}]){const s=sampleSpec();mutation(s);assert.throws(()=>review(s));}
});
test('unverified quality survives native roundtrip and schematic report without pretending serialization proves walkability',async()=>{
 const s=sampleSpec();s.nodes.push({nodeId:'blocked',op:'box',origin:[8,2,2],size:[3,3,1],material:'wall'});const c=review(s),dir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-quality-share-'));
 await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(c.manifest));await fs.writeFile(path.join(dir,'cells.bin'),c.binary);await fs.writeFile(path.join(dir,'spec.json'),JSON.stringify(c.spec));
 const restored=await readNativeBundle(await exportNativeBundle(dir));assert.deepEqual(restored.manifest.quality,c.manifest.quality);assert.equal(restored.manifest.assetHash,c.manifest.assetHash);
 const exported=await exportCompiled(c,dir);assert.equal(exported.report.quality.requiresAcknowledgement,true);assert.match(exported.report.airPolicy,/NOT walkability/);
 const {parsed}=await nbt.parse(await fs.readFile(exported.file));const quality=JSON.parse(nbt.simplify(parsed).Metadata.VoxelStudioQuality);
 assert.equal(quality.navigation,'unverified');assert.equal(quality.requiresAcknowledgement,true);assert.match(quality.warning,/通行未验证/);
});
