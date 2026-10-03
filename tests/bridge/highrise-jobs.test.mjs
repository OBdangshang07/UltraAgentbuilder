import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {setTimeout as delay} from 'node:timers/promises';
import {startBridge} from '../../bridge/server.mjs';import {highriseParts} from '../fixtures/highrise.mjs';import {sampleSpec} from '../../src/generation/sample.mjs';

async function fixture(adapter){
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-staged-')),s=await startBridge({dataDir,deepseekAdapter:adapter});
 const headers={Authorization:`Bearer ${s.connection.token}`,'Content-Type':'application/json'},base=`http://127.0.0.1:${s.connection.port}`;
 const request=async(route,input)=>{const r=await fetch(base+route,{method:input?'POST':'GET',headers,body:input?JSON.stringify(input):undefined});return {status:r.status,data:await r.json()};};
 const wait=async id=>{for(let i=0;i<300;i++){const {data}=await request('/v1/jobs/'+id);if(['failed','cancelled','preview-ready'].includes(data.state))return data;await delay(20);}throw new Error('Fixture timed out');};
 return {dataDir,s,request,wait};
}
const input={key:'tower',agent:'deepseek',model:'deepseek-flash',prompt:'200米以上CBD办公楼，1方块:1米，内饰照明',generationMode:'layered',maxOutputTokens:32768,maxRepairs:0,worldHeight:384};
test('preflight is read-only; rejected height never creates job or calls model',async()=>{
 let calls=0;const f=await fixture({close(){},async generate(){calls++;}});
 try{const pre=await f.request('/v1/preflight',input);assert.equal(pre.status,200);assert.equal(pre.data.maximumCalls,2);
  for(const route of ['/v1/jobs','/v1/preflight']){const bad=await f.request(route,{...input,prompt:'高500米办公楼'});assert.equal(bad.status,400);assert.match(bad.data.error,/尚未调用模型/);}
  assert.equal((await f.request('/v1/jobs')).data.jobs.length,0);assert.equal(calls,0);
 }finally{await f.s.close();}
});
test('two-stage generation merges once, preserves masks and exports only a completed building',async()=>{
 let calls=0;const parts=highriseParts();const f=await fixture({close(){},async generate(req){calls++;assert.equal(req.maxOutputTokens,32768);return {spec:calls===1?parts.envelope:parts.interior};}});
 try{const first=await f.request('/v1/jobs',input),duplicate=await f.request('/v1/jobs',input);assert.equal(duplicate.data.id,first.data.id);const job=await f.wait(first.data.id);
  assert.equal(job.state,'preview-ready',job.error);assert.equal(calls,2);assert.equal(job.generations.length,2);assert.equal(job.manifest.dimensions.height,224);assert.equal(job.manifest.navigation.disconnectedFloorCells,0);
  assert.ok(await fs.stat(path.join(f.dataDir,'jobs',job.id,'stage-1-spec.json')));assert.ok(await fs.stat(path.join(f.dataDir,'jobs',job.id,'stage-2-spec.json')));
 }finally{await f.s.close();}
});
for(const failStage of [1,2])test(`stage ${failStage} truncation stops without retry, partial preview or overwrite`,async()=>{
 let calls=0;const parts=highriseParts();const f=await fixture({close(){},async generate(){calls++;if(calls===failStage){const e=new Error('DeepSeek 达到预算（max-tokens），没有自动重试');e.diagnostic={reason:'max-tokens',maxOutputTokens:32768,receivedTextBytes:50,usage:null,automaticRetries:0};throw e;}return {spec:parts.envelope};}});
 try{const {data}=await f.request('/v1/jobs',input),job=await f.wait(data.id);assert.equal(job.state,'failed');assert.equal(calls,failStage);assert.equal(job.generationDiagnostic.reason,'max-tokens');assert.equal((await f.request('/v1/jobs/'+job.id+'/manifest')).status,409);
  const dir=path.join(f.dataDir,'jobs',job.id);assert.equal((await fs.readdir(dir)).includes('manifest.json'),false);
  if(failStage===2)assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'stage-1-spec.json'),'utf8')),parts.envelope);
 }finally{await f.s.close();}
});
test('undersized first phase fails before a second call; no quiet shrink to a cottage',async()=>{
 let calls=0;const spec=sampleSpec();spec.constraints={interior:false,walkable:false,passages:[]};const f=await fixture({close(){},async generate(){calls++;return {spec};}});
 try{const {data}=await f.request('/v1/jobs',input),job=await f.wait(data.id);assert.equal(job.state,'failed');assert.match(job.error,/实际建筑高度/);assert.equal(calls,1);}finally{await f.s.close();}
});

test('cancellation during the first phase cannot invoke the second phase',async()=>{
 let calls=0,started;const entered=new Promise(resolve=>started=resolve);const f=await fixture({close(){},async generate({signal}){signal.throwIfAborted();calls++;started();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));}});
 try{const {data}=await f.request('/v1/jobs',input);await entered;await f.request('/v1/jobs/'+data.id+'/cancel',{});const job=await f.wait(data.id);assert.equal(job.state,'cancelled');assert.equal(calls,1);assert.equal(job.manifest,undefined);}finally{await f.s.close();}
});

test('local revalidation cannot bypass a failed job minimum-height requirement',async()=>{
 let calls=0;const f=await fixture({close(){},async generate(){calls++;return {spec:sampleSpec()};}});
 try{const {data}=await f.request('/v1/jobs',{...input,generationMode:'single'});const failed=await f.wait(data.id);assert.equal(failed.state,'failed');assert.match(failed.error,/实际建筑高度/);
  const original=await fs.readFile(path.join(f.dataDir,'jobs',data.id,'job.json'));
  const rerun=await f.request('/v1/jobs',{key:'revalidate-size',revalidateJobId:data.id});const checked=await f.wait(rerun.data.id);
  assert.equal(checked.state,'failed');assert.match(checked.error,/实际建筑高度/);assert.equal(calls,1);assert.deepEqual(await fs.readFile(path.join(f.dataDir,'jobs',data.id,'job.json')),original);
 }finally{await f.s.close();}
});
