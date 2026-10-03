import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {compileSpec,LIMITS,hash} from '../../src/generation/compiler.mjs';
import {exportCompiled} from '../../src/generation/export.mjs';
import {readNativeBundle} from '../../src/generation/bundle.mjs';
import {generationPreflight,validateRequestedHeight,requestedHeight,outputBudget} from '../../bridge/generation-policy.mjs';
import {mergeInterior} from '../../bridge/layered-generation.mjs';
import {specSchema} from '../../contracts/building-spec.schema.mjs';
import {highriseParts} from '../fixtures/highrise.mjs';

test('explicit numeric height and output budget preflight has bounded one-to-one semantics',()=>{
  for(const text of ['200米以上的CBD办公楼','高度 224 米','高300格','224 metres tall','height: 224m'])assert.ok(requestedHeight(text)>=200,text);
  assert.equal(requestedHeight('200 平米办公室'),null);
  assert.equal(requestedHeight('1方块:1米的现代办公楼'),null);
  assert.equal(requestedHeight('第200层有餐厅'),null);
  const p=generationPreflight({agent:'deepseek',prompt:'200米以上办公楼',generationMode:'layered',maxRepairs:0,worldHeight:384});
  assert.equal(p.minimumHeight,200);assert.equal(p.maximumCalls,2);assert.equal(p.maxOutputTokens,null);assert.equal(p.totalOutputTokenLimit,null);assert.equal(p.budgetSource,'agent-default');
  assert.equal(generationPreflight({agent:'deepseek',prompt:'house',maxOutputTokens:1000000}).maxOutputTokens,1000000);
  assert.throws(()=>generationPreflight({prompt:'高度385米'}),/尚未调用模型/);
  assert.throws(()=>generationPreflight({prompt:'高度300米',worldHeight:256}),/维度总高度/);
  assert.throws(()=>generationPreflight({prompt:'house',generationMode:'layered',maxRepairs:1}),/预算须为 0/);
  assert.throws(()=>generationPreflight({prompt:'house',generationMode:'layered',baseJobId:'a'}),/新建筑/);
  for(const value of [0,32768.5,'32768',NaN,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>outputBudget(value));
  assert.equal(outputBudget(null),null);assert.equal(outputBudget(65537),65537);assert.equal(outputBudget(),null);
  assert.equal(outputBudget(Number.MAX_SAFE_INTEGER),Number.MAX_SAFE_INTEGER);
  assert.equal(generationPreflight({agent:'deepseek',prompt:'house',generationMode:'layered',maxOutputTokens:Number.MAX_SAFE_INTEGER}).totalOutputTokenLimit,null);
});

test('224-block reusable floors have connected interiors, real lamps and verified native/schematic export',async()=>{
  const {envelope,interior}=highriseParts(),spec=mergeInterior(envelope,interior),c=compileSpec(spec);
  assert.equal(c.manifest.dimensions.height,224);assert.equal(c.manifest.navigation.disconnectedFloorCells,0);
  assert.ok(c.manifest.navigation.reachable>20000);assert.ok(c.manifest.setCount<1000000);
  assert.ok(c.manifest.palette.includes('minecraft:sea_lantern'));assert.ok(c.manifest.clearCount>100000);
  assert.ok(spec.nodes.length<30);assert.ok(Buffer.byteLength(JSON.stringify(spec))<8192);
  validateRequestedHeight(c,{minimumHeight:224});assert.throws(()=>validateRequestedHeight(c,{minimumHeight:225}),/实际建筑高度/);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-highrise-'));
  for(const [name,data] of [['manifest.json',JSON.stringify(c.manifest)],['cells.bin',c.binary],['spec.json',JSON.stringify(spec)]])await fs.writeFile(path.join(dir,name),data);
  assert.deepEqual((await readNativeBundle(dir)).binary,c.binary);const result=await exportCompiled(c,dir);assert.equal(result.report.dimensions.height,224);assert.ok(result.report.verified);
  // Empty height padding cannot satisfy a requested tower.
  const padded={...c,manifest:{...c.manifest,dimensions:{...c.manifest.dimensions,height:384}},cells:new Uint16Array(c.cells.length)};padded.cells[0]=2;
  assert.throws(()=>validateRequestedHeight(padded,{minimumHeight:200}),/实际建筑高度/);
});

test('height 384 accepted, 385 and excessive volume rejected before allocation; schema agrees',()=>{
  assert.equal(specSchema.properties.bounds.properties.height.maximum,LIMITS.height);
  const {envelope}=highriseParts();envelope.bounds={width:3,height:384,length:3};envelope.nodes=[{nodeId:'column',op:'box',origin:[1,0,1],size:[1,384,1],material:'wall'},{nodeId:'top',op:'lampRow',origin:[1,383,1],size:[1,1,1],material:'lamp'}];
  assert.equal(compileSpec(envelope).manifest.setCount,384);
  envelope.bounds.height=385;assert.throws(()=>compileSpec(envelope),/height/);
  envelope.bounds={width:256,height:384,length:256};assert.throws(()=>compileSpec(envelope),/Volume quota/);
});

test('layered merge preserves exterior identity and refuses duplicates or weakened navigation',()=>{
  for(const mutate of [s=>s.bounds.height=128,s=>s.palette.wall='red',s=>s.nodes[0].nodeId='envelope',s=>s.constraints.walkable=false]){
    const {envelope,interior}=highriseParts(),original=hash(envelope);mutate(interior);assert.throws(()=>mergeInterior(envelope,interior));assert.equal(hash(envelope),original);
  }
  const {envelope,interior}=highriseParts();interior.nodes=interior.nodes.filter(n=>!n.nodeId.startsWith('return-flight'));
  assert.throws(()=>compileSpec(mergeInterior(envelope,interior)),/disconnected/);
});
