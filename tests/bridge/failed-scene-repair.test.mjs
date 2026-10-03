import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startBridge} from '../../bridge/server.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {courtyard,shape} from '../design/fixtures.mjs';

const broken=()=>{const s=courtyard();s.components.push(shape('collision',[2,1,1],[1,2,1],'wall'));return s;};
const generation={agent:'deepseek',model:'deepseek-flash',effort:'max',prompt:'36×24×32格边界，高15米的木构庭院住宅；保留内饰与楼层通行。',generationMode:'scene',maxRepairs:0};
const repair=(context,key,extra={})=>({...generation,key,prompt:'修正错误；不要缩小或删除原功能。',repairJobId:context.jobId,repairSourceHash:context.sourceHash,repairConfirmed:true,...extra});
async function harness(generate){
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-failed-repair-')),inputs=[];
 const adapter={close(){},async generate(input){inputs.push(input);return generate(input,inputs.length);}};
 let bridge=await startBridge({dataDir,adapter,deepseekAdapter:adapter,claudeAdapter:adapter});
 const call=async(route,data)=>{
  const response=await fetch('http://127.0.0.1:'+bridge.connection.port+route,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+bridge.connection.token,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});
  return {status:response.status,...await response.json()};
 };
 const submit=async input=>{const r=await call('/v1/jobs',input);assert.ok(r.status<300,r.error);return r;};
 const finish=async id=>{for(let i=0;i<300;i++){const r=await call('/v1/jobs/'+id);if(['preview-ready','failed','cancelled','interrupted'].includes(r.state))return r;await delay(20);}throw new Error('Timed out observing same mock job');};
 return {dataDir,inputs,call,submit,finish,async close(){await bridge.close();},async restart(){await bridge.close();bridge=await startBridge({dataDir,adapter,deepseekAdapter:adapter,claudeAdapter:adapter});}};
}

test('failed repair preflight separates one paid call from local/scoped operations and never treats a confirmation as automatic retry',()=>{
 const input=repair({jobId:'a'.repeat(36),sourceHash:'b'.repeat(64)},'repair');
 assert.equal(generationPreflight(input).maximumCalls,1);assert.equal(generationPreflight(input).maxOutputTokens,null);
 for(const extra of [{maxRepairs:1},{sample:false},{spec:{}},{revalidateJobId:input.repairJobId},{baseJobId:input.repairJobId},{baseHash:'b'.repeat(64)},{sceneScope:{}},{reviewImages:[]},{repairSourceHash:'bad'},{generationMode:'single'},{repairConfirmed:'true'}])assert.throws(()=>generationPreflight({...input,...extra}));
 const missing={...input};delete missing.repairJobId;assert.throws(()=>generationPreflight(missing));
});

test('explicit failed draft repair binds source, preserves old failure and dimensions, makes one idempotent call and roundtrips restart',async()=>{
 const bad=broken();const h=await harness(async(_,n)=>({spec:n===1?bad:courtyard()}));
 try{
  assert.ok((await h.call('/v1/health')).capabilities.includes('failed-scene-repair'));
  const original=await h.finish((await h.submit({...generation,key:'original',worldHeight:384})).id);assert.equal(original.state,'failed');assert.ok(original.diagnosticPreview);
  const file=path.join(h.dataDir,'jobs',original.id,'attempt-0-spec.json'),bytes=await fs.readFile(file,'utf8');
  const context=await h.call('/v1/jobs/'+original.id+'/repair-context');assert.equal(context.status,200);assert.equal(context.sourceHash,hash(bad));assert.equal(context.originalPrompt,generation.prompt);
  const input=repair(context,'explicit-repair',{worldHeight:320});
  const policy=await h.call('/v1/preflight',input);assert.equal(policy.status,200);assert.equal(policy.maximumCalls,1);assert.equal(policy.minimumHeight,15);assert.deepEqual(policy.maximumBounds,{width:36,height:24,length:32});assert.equal(policy.worldHeight,320);assert.equal(h.inputs.length,1);
  const noConfirmation={...input};delete noConfirmation.repairConfirmed;
  assert.equal((await h.call('/v1/jobs',noConfirmation)).status,400);assert.equal(h.inputs.length,1);
  assert.equal((await h.call('/v1/jobs',repair(context,'stale',{repairSourceHash:'0'.repeat(64)}))).status,400);assert.equal(h.inputs.length,1);
  // Simultaneous identical bodies cross async disk preflight but must reuse one job.
  const submitted=await Promise.all(Array.from({length:4},()=>h.submit(input)));
  assert.ok(submitted.every(j=>j.id===submitted[0].id));
  const result=await h.finish(submitted[0].id);assert.equal(result.state,'preview-ready',result.error);assert.equal(h.inputs.length,2);
  assert.equal(result.failedRepair.sourceJobId,original.id);assert.equal(result.failedRepair.sourceHash,hash(bad));assert.equal(result.failedRepair.rootJobId,original.id);
  const prompt=h.inputs[1].prompt;assert.match(prompt,/ONE explicitly authorized repair/);assert.match(prompt,/originalDescription/);assert.ok(prompt.includes(generation.prompt));assert.match(prompt,/Ownership conflict/);
  assert.equal(h.inputs[1].maxOutputTokens,undefined);assert.equal(h.inputs[1].outputSchema.properties.format.enum[0],'SceneSpec');
  assert.equal(await fs.readFile(file,'utf8'),bytes);assert.equal((await h.call('/v1/jobs/'+original.id)).state,'failed');
  const saved=JSON.parse(await fs.readFile(path.join(h.dataDir,'jobs',result.id,'repair-input.json'),'utf8'));assert.deepEqual(saved.source,bad);assert.equal(saved.context.sourceHash,hash(bad));
  const diff=await h.call('/v1/jobs/'+result.id+'/diff');assert.equal(diff.fullDraftReviewRequired,true);assert.equal(diff.changed,undefined);
  const bundle=await h.call('/v1/jobs/'+result.id+'/bundle',{});assert.equal(bundle.status,200);
  assert.deepEqual((await fs.readdir(bundle.directory)).sort(),['cells.bin','design-sources.json','manifest.json','scene.json','source-owners.bin','spec.json']);
  assert.equal((await h.call('/v1/jobs/'+result.id+'/repair-context')).status,400);
  await h.restart();assert.equal((await h.submit(input)).id,result.id);assert.equal(h.inputs.length,2);
  const jobs=await h.call('/v1/jobs');assert.ok(jobs.jobs.every(j=>!j.prompt&&!j.repairOriginalPrompt));
  assert.equal((await h.call('/v1/jobs',{...input,prompt:'changed request'})).status,409);
 }finally{await h.close();}
});

test('rejected repair outputs retain intent/height/bounds, preserve all sources and never trigger another call',async()=>{
 const returned=[broken(),Object.assign(courtyard(),{constraints:{interior:false,walkable:false,passages:[]}}),courtyard(),courtyard(),courtyard()];
 returned[2].bounds.width=37;
 // Valid short geometry, but cannot replace the original requested height.
 returned[3].components=[shape('tiny',[2,0,2],[5,4,5],'wall')];returned[3].featureBindings=[];
 returned[4].format='ScenePatch';
 const h=await harness(async(_,n)=>({spec:returned[n-1]}));
 try{
  const original=await h.finish((await h.submit({...generation,key:'original'})).id),context=await h.call('/v1/jobs/'+original.id+'/repair-context');
  for(const [index,pattern] of [/disable original interior/,/超过请求/,/实际建筑高度/,/complete SceneSpec/].entries()){
   const result=await h.finish((await h.submit(repair(context,'reject-'+index))).id);
   assert.equal(result.state,'failed');assert.match(result.error,pattern);assert.equal(result.diagnosticPreview,undefined);assert.equal(h.inputs.length,index+2);
   assert.deepEqual(JSON.parse(await fs.readFile(path.join(h.dataDir,'jobs',result.id,'attempt-0-spec.json'),'utf8')),returned[index+1]);
  }
  assert.equal((await h.call('/v1/jobs/'+original.id)).state,'failed');
 }finally{await h.close();}
});

test('failed scoped revision, local revalidation and changed source cannot become an unrestricted paid repair',async()=>{
 const h=await harness(async()=>({spec:broken()}));
 try{
  const original=await h.finish((await h.submit({...generation,key:'original'})).id),context=await h.call('/v1/jobs/'+original.id+'/repair-context');
  const local=await h.finish((await h.submit({key:'local',generationMode:'scene',revalidateJobId:original.id})).id);assert.equal(local.state,'failed');
  assert.equal((await h.call('/v1/jobs',repair({...context,jobId:local.id},'not-local'))).status,400);
  const scoped=await h.finish((await h.submit({...generation,key:'bad-base',baseJobId:original.id,baseHash:'f'.repeat(64),sceneScope:{components:['main'],protectedComponents:[],regions:[{origin:[0,0,0],size:[36,24,32]}],shared:'instance'}})).id);
  assert.equal(scoped.state,'failed');assert.equal((await h.call('/v1/jobs',repair({...context,jobId:scoped.id},'not-scoped'))).status,400);
  const altered=broken();altered.seed++;
  await fs.writeFile(path.join(h.dataDir,'jobs',original.id,'attempt-0-spec.json'),JSON.stringify(altered));
  assert.equal((await h.call('/v1/jobs',repair(context,'tampered'))).status,400);assert.equal((await h.call('/v1/jobs/'+original.id+'/repair-context')).status,400);assert.equal(h.inputs.length,1);
 }finally{await h.close();}
});

test('strict policy cannot be weakened and a separately confirmed repair of a repair retains the root request',async()=>{
 const h=await harness(async()=>({spec:broken()}));
 try{
  const original=await h.finish((await h.submit({...generation,key:'strict-original',navigationPolicy:'strict'})).id),context=await h.call('/v1/jobs/'+original.id+'/repair-context');
  const p=await h.call('/v1/preflight',repair(context,'first',{navigationPolicy:'review'}));assert.equal(p.navigationPolicy,'strict');
  const first=await h.finish((await h.submit(repair(context,'first',{navigationPolicy:'review'}))).id);assert.equal(first.state,'failed');assert.equal(h.inputs.length,2);
  const nextContext=await h.call('/v1/jobs/'+first.id+'/repair-context');assert.equal(nextContext.originalPrompt,generation.prompt);assert.equal(nextContext.rootJobId,original.id);
  const second=await h.finish((await h.submit(repair(nextContext,'second'))).id);assert.equal(second.state,'failed');assert.equal(h.inputs.length,3);assert.equal(second.failedRepair.rootJobId,original.id);assert.equal(second.preflight.navigationPolicy,'strict');
  assert.ok(h.inputs[2].prompt.includes(generation.prompt));assert.equal((await h.call('/v1/jobs/'+original.id)).state,'failed');
 }finally{await h.close();}
});

test('cancelled paid repair is terminal and an uncertain receipt only reuses its original key',async()=>{
 const h=await harness(async(input,n)=>{if(n===1)return {spec:broken()};await new Promise((resolve,reject)=>{const abort=()=>reject(new Error('Mock cancelled'));if(input.signal.aborted)abort();else input.signal.addEventListener('abort',abort,{once:true});});});
 try{
  const original=await h.finish((await h.submit({...generation,key:'original'})).id),context=await h.call('/v1/jobs/'+original.id+'/repair-context');
  const input=repair(context,'cancelled-repair'),j=await h.submit(input);
  for(let i=0;i<100&&h.inputs.length<2;i++)await delay(10);assert.equal(h.inputs.length,2);
  await h.call('/v1/jobs/'+j.id+'/cancel',{});assert.equal((await h.finish(j.id)).state,'cancelled');
  assert.equal((await h.submit(input)).id,j.id);assert.equal(h.inputs.length,2);assert.equal((await h.call('/v1/jobs/'+original.id)).state,'failed');
 }finally{await h.close();}
});

test('a failed attempt to remove functionality cannot launder weaker intent into the next confirmed repair',async()=>{
 const disabled=courtyard();disabled.constraints={interior:false,walkable:false,passages:[]};
 const h=await harness(async(_,n)=>({spec:n===1?broken():disabled}));
 try{
  const root=await h.finish((await h.submit({...generation,key:'root'})).id),context=await h.call('/v1/jobs/'+root.id+'/repair-context');
  const first=await h.finish((await h.submit(repair(context,'first'))).id);assert.match(first.error,/disable original interior/);
  const next=await h.call('/v1/jobs/'+first.id+'/repair-context');assert.deepEqual(next.requiredIntent,{interior:true,walkable:true});
  const second=await h.finish((await h.submit(repair(next,'second'))).id);assert.equal(second.state,'failed');assert.match(second.error,/disable original interior/);assert.equal(h.inputs.length,3);
 }finally{await h.close();}
});

test('worker and confirmed repair deliver all static bounds feedback without rewriting or authorizing the rejected source',async()=>{
 const bad=courtyard();bad.components.push(shape('outsideA',[35,0,0],[2,1,1]),shape('outsideB',[0,0,31],[1,1,2]));
 const h=await harness(async(_,n)=>({spec:n===1?bad:courtyard()}));
 try{
  const original=await h.finish((await h.submit({...generation,key:'bounds-original'})).id);
  assert.equal(original.state,'failed');assert.equal(original.constructionFeedback.issueCount,2);assert.equal(original.diagnosticPreview,undefined);
  const file=path.join(h.dataDir,'jobs',original.id,'attempt-0-spec.json'),bytes=await fs.readFile(file,'utf8');
  const context=await h.call('/v1/jobs/'+original.id+'/repair-context');assert.deepEqual(context.constructionFeedback,original.constructionFeedback);
  assert.equal(context.constructionFeedback.canAuthorizePlacement,false);assert.equal(h.inputs.length,1);
  const result=await h.finish((await h.submit(repair(context,'bounds-repair'))).id);assert.equal(result.state,'preview-ready',result.error);
  const prompt=h.inputs[1].prompt;assert.match(prompt,/constructionFeedback/);assert.match(prompt,/outsideA/);assert.match(prompt,/outsideB/);assert.match(prompt,/parentOrigin/);
  assert.equal(h.inputs.length,2);assert.equal(await fs.readFile(file,'utf8'),bytes);assert.equal((await h.call('/v1/jobs/'+original.id)).state,'failed');
  const saved=JSON.parse(await fs.readFile(path.join(h.dataDir,'jobs',result.id,'repair-input.json'),'utf8'));assert.deepEqual(saved.context.constructionFeedback,context.constructionFeedback);
 }finally{await h.close();}
});
