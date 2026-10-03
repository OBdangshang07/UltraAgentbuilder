import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {compileSpec,hash} from '../../src/generation/compiler.mjs';import {sampleSpec} from '../../src/generation/sample.mjs';import {readNativeBundle,exportNativeBundle} from '../../src/generation/bundle.mjs';
import {BUILDING_LIMITS} from '../../contracts/building-limits.mjs';
async function fixture(){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-bundle-')),spec=sampleSpec(),a=compileSpec(spec);await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(a.manifest));await fs.writeFile(path.join(dir,'cells.bin'),a.binary);await fs.writeFile(path.join(dir,'spec.json'),JSON.stringify(spec));return {dir,a};}
test('native sharing retains masks/hash while excluding job prompts and credentials',async()=>{const {dir,a}=await fixture();await fs.writeFile(path.join(dir,'job.json'),'{"prompt":"PRIVATE"}');await fs.writeFile(path.join(dir,'connection.json'),'{"token":"PRIVATE"}');const out=await exportNativeBundle(dir);assert.deepEqual((await fs.readdir(out)).sort(),['cells.bin','manifest.json','spec.json']);const imported=await readNativeBundle(out);assert.equal(imported.manifest.assetHash,a.manifest.assetHash);assert.deepEqual(imported.binary,a.binary);});

test('native source quota measures compact data, with a separate bounded physical read',async()=>{
 const {dir,a}=await fixture(),spec=sampleSpec(),file=path.join(dir,'spec.json');
 await fs.writeFile(file,' '.repeat(BUILDING_LIMITS.bytes)+JSON.stringify(spec,null,2));
 assert.equal((await readNativeBundle(dir)).manifest.assetHash,a.manifest.assetHash);
 const huge={...spec,padding:'x'.repeat(BUILDING_LIMITS.bytes)};
 await fs.writeFile(file,JSON.stringify(huge));await assert.rejects(readNativeBundle(dir),/source data quota.*spec.json/);
 await fs.writeFile(file,' '.repeat(BUILDING_LIMITS.bytes*8+1));await assert.rejects(readNativeBundle(dir),/file quota.*spec.json/);
});
test('tampered cells, out-of-range dimensions and unsafe palettes are rejected',async()=>{const {dir,a}=await fixture();const bad=Buffer.from(a.binary);bad[0]^=2;await fs.writeFile(path.join(dir,'cells.bin'),bad);await assert.rejects(readNativeBundle(dir),/hash mismatch/);await fs.writeFile(path.join(dir,'cells.bin'),a.binary);let {assetHash,...metadata}=a.manifest;metadata={...metadata,dimensions:{...metadata.dimensions,height:495}};await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify({...metadata,assetHash:hash(metadata)}));await assert.rejects(readNativeBundle(dir),/dimensions/);});
test('native import rejects unsafe palette, incorrect counts and mismatched optional spec',async()=>{
  const {dir,a}=await fixture();const {assetHash,...metadata}=a.manifest;
  for(const [changed,error] of [[{...metadata,palette:metadata.palette.map((p,i)=>i===2?'minecraft:command_block':p)},/unsafe imported palette/],[{...metadata,setCount:metadata.setCount+1},/mask\/count mismatch/]]){
    await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify({...changed,assetHash:hash(changed)}));await assert.rejects(readNativeBundle(dir),error);
  }
  await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(a.manifest));await fs.writeFile(path.join(dir,'spec.json'),'{}');await assert.rejects(readNativeBundle(dir),/spec hash mismatch/);
  await fs.rename(path.join(dir,'spec.json'),path.join(dir,'bad-spec-retained.json'));const withoutSpec=await readNativeBundle(dir);assert.equal(withoutSpec.spec,undefined);assert.deepEqual(withoutSpec.binary,a.binary);
});
