import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startBridge} from '../../bridge/server.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {readNativeBundle} from '../../src/generation/bundle.mjs';
import {courtyard,shape} from '../design/fixtures.mjs';

const request={agent:'deepseek',model:'deepseek-flash',effort:'max',prompt:'36×24×32格边界，高15米的原创庭院建筑，内饰与通路完整。',generationMode:'scene',maxRepairs:0,sceneWorkflow:'checkpoints',checkpointCalls:4,checkpointConfirmed:true};
const layout=()=>{const s=courtyard();s.constraints.passages=[{origin:[18,2,9],size:[1,2,1]}];return s;};
const edit=s=>({format:'SceneDraftEdit',version:1,sourceHash:hash(s),components:{put:[],remove:[]},modules:{put:[],remove:[]},palette:{put:[],remove:[]},reservations:{put:[],remove:[]},design:null,featureBindings:null,constraints:null});
function detail(s){const e=edit(s),c=structuredClone(s.components.find(c=>c.id==='pergola'));c.material='wall';e.components.put=[c];return e;}
const data=input=>JSON.parse(input.prompt.split('Checkpoint input (data):\n').at(-1));
async function harness(generate){
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-checkpoints-')),received=[];
 const adapter={close(){},async generate(input){received.push(input);return generate(input,received.length);}};
 let bridge=await startBridge({dataDir,adapter,deepseekAdapter:adapter,claudeAdapter:adapter});
 const call=async(route,body)=>{const r=await fetch('http://127.0.0.1:'+bridge.connection.port+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+bridge.connection.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,...await r.json()};};
 const submit=async input=>{const r=await call('/v1/jobs',input);assert.ok(r.status<300,r.error);return r;};
 const finish=async id=>{for(let i=0;i<600;i++){const j=await call('/v1/jobs/'+id);if(['preview-ready','failed','cancelled','interrupted'].includes(j.state))return j;await delay(20);}throw new Error('Timed out observing same mock job');};
 return {dataDir,received,call,submit,finish,async close(){await bridge.close();},async restart(){await bridge.close();bridge=await startBridge({dataDir,adapter,deepseekAdapter:adapter,claudeAdapter:adapter});}};
}

test('checkpoint preflight declares total underlying calls and refuses mixed or implicit authorization',()=>{
 for(const n of [2,3,4]){const p=generationPreflight({...request,checkpointCalls:n,maxOutputTokens:5000});assert.equal(p.maximumCalls,n);assert.equal(p.totalOutputTokenLimit,5000*n);assert.equal(p.checkpoints.intermediateAssetsPlaceable,false);}
 assert.equal(generationPreflight(request).maxOutputTokens,null);
 for(const extra of [{checkpointCalls:1},{checkpointCalls:5},{checkpointCalls:3.5},{sceneWorkflow:'unknown'},{generationMode:'single'},{sample:false},{spec:{}},{baseJobId:'x'},{repairJobId:'x'},{reviewImages:[]},{maxRepairs:1},{checkpointConfirmed:'yes'}])assert.throws(()=>generationPreflight({...request,...extra}));
 const input={...request};delete input.sceneWorkflow;assert.throws(()=>generationPreflight(input));
});
test('successful layout/detail stages are source-bound, counted durably, private until final, and idempotent',async()=>{
 const s=layout();const h=await harness(async(input,n)=>{
  const saved=JSON.parse(await fs.readFile(path.join(input.cwd,'job.json'),'utf8'));assert.equal(saved.checkpointCallsReserved,n);assert.equal(saved.checkpointStages[n-1].state,'reserved');
  if(n===1)return {spec:s,usage:{totalTokens:10}};
  const p=data(input);assert.equal(p.phase,'detail');assert.equal(p.sourceHash,hash(s));assert.equal(p.feedback.geometryPassed,true);assert.equal(p.feedback.canAuthorizePlacement,false);
  assert.equal(p.feedback.navigationFeedback.canAuthorizePlacement,false);assert.equal(p.feedback.navigationFeedback.passages.length,s.constraints.passages.length);
  assert.equal((await h.call('/v1/jobs/'+path.basename(input.cwd)+'/manifest')).status,409);
  return {spec:detail(p.previousDraft),usage:{totalTokens:20}};
 });
 try{
  const preflight=await h.call('/v1/preflight',request);assert.equal(preflight.maximumCalls,4);assert.equal(h.received.length,0);
  assert.equal((await h.call('/v1/jobs',{...request,key:'no-confirmation',checkpointConfirmed:false})).status,400);assert.equal(h.received.length,0);
  const input={...request,key:'success'},jobs=await Promise.all(Array.from({length:4},()=>h.submit(input)));assert.ok(jobs.every(j=>j.id===jobs[0].id));
  const j=await h.finish(jobs[0].id);assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,2);assert.equal(j.checkpointCallsReserved,2);
  assert.deepEqual(j.checkpointStages.map(s=>s.phase),['layout','detail']);assert.deepEqual(j.generations.map(g=>g.usage.totalTokens),[10,20]);assert.equal(j.usage,undefined);
  assert.equal(h.received[0].outputSchema.properties.format.enum[0],'SceneSpec');assert.equal(h.received[1].outputSchema.properties.format.enum[0],'SceneDraftEdit');assert.equal(h.received[1].maxOutputTokens,undefined);
  const dir=path.join(h.dataDir,'jobs',j.id),first=JSON.parse(await fs.readFile(path.join(dir,'checkpoints/1/scene.json'),'utf8'));assert.deepEqual(first,s);
  await assert.rejects(readNativeBundle(path.join(dir,'checkpoints/1/diagnostic')),/Diagnostic-only/);
  const feedback=JSON.parse(await fs.readFile(path.join(dir,'checkpoints/2/feedback.json'),'utf8'));assert.equal(feedback.detailGeometryChanged,true);
  assert.equal((await h.call('/v1/jobs/'+j.id+'/bundle',{})).status,200);
  await h.restart();assert.equal((await h.submit(input)).id,j.id);assert.equal(h.received.length,2);
 }finally{await h.close();}
});
test('layout corrections reserve a final detail call and later edits use the latest corrected hash',async()=>{
 const s=layout();s.components.push(shape('out',[35,0,0],[2,1,1]));
 const h=await harness(async(input,n)=>{
  if(n===1)return {spec:s};const p=data(input),e=edit(p.previousDraft);
  if(n===2){assert.equal(p.phase,'correct-layout');assert.equal(p.feedback.geometryPassed,false);assert.ok(p.feedback.constructionFeedback.issueCount);e.components.remove=['out'];return {spec:e};}
  assert.equal(n,3);assert.equal(p.phase,'detail');assert.notEqual(p.sourceHash,hash(s));return {spec:detail(p.previousDraft)};
 });
 try{const j=await h.finish((await h.submit({...request,key:'correct-layout',checkpointCalls:3})).id);assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,3);assert.deepEqual(j.checkpointStages.map(s=>s.state),['rejected','checked','checked']);}
 finally{await h.close();}
});
test('two-call budget stops after a broken layout and revalidation cannot publish any intermediate',async()=>{
 const s=layout();s.components.push(shape('out',[35,0,0],[2,1,1]));
 const h=await harness(async()=>({spec:s}));
 try{
  const j=await h.finish((await h.submit({...request,key:'two-broken',checkpointCalls:2})).id);assert.equal(j.state,'failed');assert.equal(h.received.length,1);
  const recheck=await h.finish((await h.submit({key:'no-checkpoint-revalidate',revalidateJobId:j.id})).id);assert.equal(recheck.state,'failed');assert.match(recheck.error,/Intermediate checkpoint/);assert.equal(h.received.length,1);
 }finally{await h.close();}
});
test('four-call budget is an absolute ceiling even when every detail correction still fails',async()=>{
 const h=await harness(async(input,n)=>{if(n===1)return {spec:layout()};const e=detail(data(input).previousDraft);e.components.put.push(shape('out',[35,0,0],[2,1,1]));return {spec:e};});
 try{
  const j=await h.finish((await h.submit({...request,key:'exhausted-detail'})).id);assert.equal(j.state,'failed');assert.equal(h.received.length,4);assert.equal(j.checkpointCallsReserved,4);
  assert.deepEqual(j.checkpointStages.map(s=>s.phase),['layout','detail','correct-detail','correct-detail']);assert.equal(j.checkpointStages[3].state,'rejected');assert.match(j.error,/final design/);assert.equal(j.manifest,undefined);
 }finally{await h.close();}
});
test('startup marks unfinished checkpoint reservations interrupted without invoking any adapter',async()=>{
 const h=await harness(async()=>{throw new Error('Must not invoke after restart');});
 try{
  const id='bbbbbbbb-1111-4111-8111-aaaaaaaaaaaa',dir=path.join(h.dataDir,'jobs',id);await fs.mkdir(dir);
  await fs.writeFile(path.join(dir,'job.json'),JSON.stringify({id,key:'crashed-checkpoint',state:'generating',events:[],preflight:generationPreflight(request),checkpointCallsReserved:2,checkpointStages:[{index:1,phase:'layout',state:'checked'},{index:2,phase:'detail',state:'reserved'}]}));
  await h.restart();const j=await h.call('/v1/jobs/'+id);assert.equal(j.state,'interrupted');assert.equal(j.checkpointCallsReserved,2);assert.equal(j.checkpointStages[0].state,'checked');assert.equal(j.checkpointStages[1].state,'interrupted');assert.equal(j.checkpointStages[1].invocationOutcome,'unknown');assert.equal(h.received.length,0);
  const saved=JSON.parse(await fs.readFile(path.join(dir,'job.json'),'utf8'));assert.equal(saved.state,'interrupted');
 }finally{await h.close();}
});
test('a repeatedly broken layout stops before consuming the last detail slot or exporting a skeleton',async()=>{
 const s=layout();s.components.push(shape('out',[35,0,0],[2,1,1]));
 const h=await harness(async(input,n)=>({spec:n===1?s:edit(data(input).previousDraft)}));
 try{const j=await h.finish((await h.submit({...request,key:'bad-layout'})).id);assert.equal(j.state,'failed');assert.match(j.error,/layout plus detail/);assert.equal(h.received.length,3);assert.equal(j.manifest,undefined);assert.equal((await h.call('/v1/jobs/'+j.id+'/export',{})).status,409);assert.equal((await h.call('/v1/jobs/'+j.id+'/repair-context')).status,400);}
 finally{await h.close();}
});
test('a detail error can use only remaining confirmed calls and must compile the whole merged draft',async()=>{
 const h=await harness(async(input,n)=>{
  if(n===1)return {spec:layout()};const p=data(input),e=detail(p.previousDraft);
  if(n===2)e.components.put.push(shape('out',[35,0,0],[2,1,1]));else{assert.equal(p.phase,'correct-detail');e.components.remove=['out'];}
  return {spec:e};
 });
 try{const j=await h.finish((await h.submit({...request,key:'correct-detail',checkpointCalls:3})).id);assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,3);assert.deepEqual(j.checkpointStages.map(s=>s.phase),['layout','detail','correct-detail']);}
 finally{await h.close();}
});
test('empty and metadata-only detail cannot publish an unchanged structural draft',async()=>{
 const h=await harness(async(input,n)=>{if(n===1)return {spec:layout()};const e=edit(data(input).previousDraft);e.design={...data(input).previousDraft.design,concept:'Pretend it is finished'};return {spec:e};});
 try{const j=await h.finish((await h.submit({...request,key:'no-detail',checkpointCalls:2})).id);assert.equal(j.state,'failed');assert.match(j.error,/no visible block/);assert.equal(h.received.length,2);assert.equal(j.manifest,undefined);}
 finally{await h.close();}
});
test('stale/invalid model edits stop immediately, save the rejected response, and do not silently regenerate',async()=>{
 const h=await harness(async(input,n)=>{if(n===1)return {spec:layout()};const e=edit(data(input).previousDraft);e.sourceHash='0'.repeat(64);return {spec:e};});
 try{const j=await h.finish((await h.submit({...request,key:'stale-edit'})).id);assert.equal(j.state,'failed');assert.match(j.error,/hash/);assert.equal(h.received.length,2);assert.ok(await fs.stat(path.join(h.dataDir,'jobs',j.id,'checkpoints/2/response.json')));assert.equal(j.manifest,undefined);assert.equal(j.checkpointStages[1].state,'failed');assert.equal(j.checkpointStages[1].invocationOutcome,'response-received');}
 finally{await h.close();}
});
test('cancellation during a model stage preserves reservations and cannot be resubmitted by retrying its key',async()=>{
 const h=await harness(async(input,n)=>{if(n===1)return {spec:layout()};await new Promise((resolve,reject)=>input.signal.addEventListener('abort',()=>reject(new Error('cancelled mock')),{once:true}));});
 try{
  const input={...request,key:'cancel'},j=await h.submit(input);for(let i=0;i<200&&h.received.length<2;i++)await delay(20);assert.equal(h.received.length,2);
  await h.call('/v1/jobs/'+j.id+'/cancel',{});const result=await h.finish(j.id);assert.equal(result.state,'cancelled');assert.equal(result.checkpointCallsReserved,2);assert.equal(result.generations.length,2);assert.equal(result.generations[1].outcome,'failed');assert.equal(result.generations[1].usage,null);assert.equal(result.checkpointStages[1].state,'cancelled');assert.equal(result.checkpointStages[1].invocationOutcome,'unknown');
  assert.equal((await h.submit(input)).id,j.id);await h.restart();assert.equal((await h.submit(input)).id,j.id);assert.equal(h.received.length,2);
 }finally{await h.close();}
});
test('provider failure and invalid first schema never cause an unreserved fallback call',async()=>{
 for(const kind of ['provider','schema']){
  const h=await harness(async()=>{if(kind==='provider')throw new Error('Provider returned unknown outcome');return {spec:{format:'SceneSpec'}};});
  try{const j=await h.finish((await h.submit({...request,key:kind})).id);assert.equal(j.state,'failed');assert.equal(h.received.length,1);assert.equal(j.checkpointCallsReserved,1);assert.equal(j.manifest,undefined);}
  finally{await h.close();}
 }
});

test('safe provider diagnostics survive job persistence while outcome remains unknown and unresent',async()=>{
 const diagnostic={provider:'deepseek',reason:'error',providerFailure:{code:'RATE_LIMIT',status:429},usage:null,automaticRetries:0};
 const h=await harness(async()=>{throw Object.assign(new Error('DeepSeek 生成未完成 [DSH:RATE_LIMIT] HTTP 429；没有自动重试'),{diagnostic});});
 try{
  const input={...request,key:'safe-provider-facts'},j=await h.finish((await h.submit(input)).id);assert.equal(j.state,'failed');assert.deepEqual(j.generationDiagnostic,diagnostic);
  assert.equal(j.checkpointStages[0].invocationOutcome,'unknown');assert.equal(j.checkpointCallsReserved,1);assert.equal(j.generations.length,1);assert.deepEqual(j.generations[0],{stage:1,outcome:'failed',usage:null,diagnostic});
  await h.restart();const persisted=await h.call('/v1/jobs/'+j.id);assert.deepEqual(persisted.generationDiagnostic,diagnostic);assert.equal((await h.submit(input)).id,j.id);assert.equal(h.received.length,1);
 }finally{await h.close();}
});
