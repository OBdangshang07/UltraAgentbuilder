import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {setTimeout as delay} from 'node:timers/promises';
import {startBridge} from '../../bridge/server.mjs';import {generationPreflight} from '../../bridge/generation-policy.mjs';import {courtyard,shape,at,once} from '../design/fixtures.mjs';import {readNativeBundle} from '../../src/generation/bundle.mjs';import {hash} from '../../src/generation/compiler.mjs';

test('scene preflight separates paid design from free compilation and refuses unsanctioned refinements',()=>{
 const input={agent:'deepseek',model:'deepseek-flash',prompt:'a building',generationMode:'scene',effort:'max'};
 assert.equal(generationPreflight(input).maximumCalls,1);assert.equal(generationPreflight({...input,spec:courtyard()}).maximumCalls,0);
 assert.equal(generationPreflight(input).maxOutputTokens,null);
 assert.throws(()=>generationPreflight({...input,maxRepairs:1}),/0/);
 assert.throws(()=>generationPreflight({...input,baseJobId:'base',baseHash:'hash'}),/scope/);
 assert.throws(()=>generationPreflight({...input,reviewImages:[]}),/Codex/);
});

test('scene once-only generation, immutable source/provenance, scoped local branch and native round-trip',async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-scene-http-'));let calls=0;const received=[];
 const adapter={close(){},async generate(input){calls++;received.push(input);return {spec:courtyard(),model:'deepseek-flash'};}};
 const bridge=await startBridge({dataDir,deepseekAdapter:adapter});
 const headers={Authorization:'Bearer '+bridge.connection.token,'Content-Type':'application/json'},url='http://127.0.0.1:'+bridge.connection.port;
 const request=async(route,data)=>{const r=await fetch(url+route,{method:data?'POST':'GET',headers,body:data?JSON.stringify(data):undefined});const j=await r.json();assert.ok(r.ok,j.error);return j;};
 const finish=async id=>{for(let i=0;i<160;i++){const j=await request('/v1/jobs/'+id);if(['preview-ready','failed','cancelled'].includes(j.state))return j;await delay(20);}throw new Error('Job timeout');};
 try{
  const input={key:'scene-generation',agent:'deepseek',model:'deepseek-flash',effort:'max',prompt:'Warm courtyard',generationMode:'scene',maxRepairs:0};
  const submitted=await request('/v1/jobs',input);assert.equal((await request('/v1/jobs',input)).id,submitted.id);
  const base=await finish(submitted.id);assert.equal(base.state,'preview-ready',base.error);assert.equal(calls,1);
  assert.equal(received[0].outputSchema.properties.format.enum[0],'SceneSpec');assert.equal(received[0].maxOutputTokens,undefined);
  const scene=await request('/v1/jobs/'+base.id+'/scene');assert.equal(scene.format,'SceneSpec');
  const sources=await request('/v1/jobs/'+base.id+'/design-sources');assert.ok(sources.surviving.front>0);
  const replacement=structuredClone(scene.components.find(c=>c.id==='pergola'));replacement.material='wall';
  const next=await request('/v1/jobs',{key:'scene-local-revision',generationMode:'scene',baseJobId:base.id,baseHash:base.assetHash,sceneScope:{components:['pergola'],protectedComponents:['main'],regions:[{origin:[2,1,1],size:[10,5,5]}],shared:'instance'},scenePatch:{baseHash:base.assetHash,replaceComponents:[replacement],removeComponents:[],replaceModules:[]}});
  const revised=await finish(next.id);assert.equal(revised.state,'preview-ready',revised.error);assert.equal(calls,1);assert.notEqual(revised.assetHash,base.assetHash);
  assert.equal((await request('/v1/jobs/'+base.id)).assetHash,base.assetHash);assert.ok((await request('/v1/jobs/'+next.id+'/diff')).changed>0);
  const bundle=await request('/v1/jobs/'+revised.id+'/bundle',{}),roundtrip=await readNativeBundle(bundle.directory);assert.equal(roundtrip.scene.id,scene.id);assert.equal(roundtrip.manifest.assetHash,revised.assetHash);
  const imported=await request('/v1/jobs',{key:'scene-import',importDirectory:bundle.directory});assert.equal((await finish(imported.id)).state,'preview-ready');
  assert.equal((await request('/v1/jobs/'+imported.id+'/scene')).format,'SceneSpec');
  const invalid=await request('/v1/jobs',{...input,key:'invalid-instance-before-paid-call',baseJobId:base.id,baseHash:base.assetHash,sceneScope:{components:['pergola'],protectedComponents:[],regions:[{origin:[0,0,0],size:[36,24,32]}],shared:'instance',instances:[{component:'pergola',index:255}]}});
  const rejected=await finish(invalid.id);assert.equal(rejected.state,'failed');assert.match(rejected.error,/Unknown repeated instance/);assert.equal(calls,1);
 }finally{await bridge.close();}
});

test('failed SceneSpec preserves exact output and never auto-calls a repair',async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-scene-fail-'));let calls=0;const spec=courtyard();spec.components[0].at.relativeTo='main';
 const bridge=await startBridge({dataDir,deepseekAdapter:{close(){},async generate(){calls++;return {spec};}}});
 const headers={Authorization:'Bearer '+bridge.connection.token,'Content-Type':'application/json'},url='http://127.0.0.1:'+bridge.connection.port;
 try{
  const j=await fetch(url+'/v1/jobs',{method:'POST',headers,body:JSON.stringify({key:'failure',agent:'deepseek',model:'deepseek-flash',prompt:'building',generationMode:'scene'})}).then(r=>r.json());let final;
  for(let i=0;i<100;i++){final=await fetch(url+'/v1/jobs/'+j.id,{headers}).then(r=>r.json());if(final.state==='failed')break;await delay(20);}
  assert.equal(final.state,'failed');assert.equal(calls,1);assert.match(final.error,/Cyclic/);
  assert.equal(final.diagnosticPreview,undefined);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dataDir,'jobs',j.id,'attempt-0-spec.json'),'utf8')),spec);
 }finally{await bridge.close();}
});

test('module hard-error context survives the worker, preserves source and offers no diagnostic geometry or retry',async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-scene-module-error-'));let calls=0;const spec=courtyard();
 spec.modules=[{id:'core_doors',size:[3,2,1],parameters:[],nodes:[{nodeId:'door_a',op:'door',origin:[0,0,0],size:[2,2,1],material:'door',thickness:1,axis:'x',repeat:once,points:[],blockState:null}]}];
 spec.components.push({id:'core_doors_tower',kind:'module',module:'core_doors',at:at([10,2,10]),values:[],rotation:0,mirror:false,repeat:once,allowOverwrite:[]});
 const adapter={close(){},async generate(){calls++;return {spec};}};
 const bridge=await startBridge({dataDir,adapter,deepseekAdapter:adapter,claudeAdapter:adapter});
 const headers={Authorization:'Bearer '+bridge.connection.token,'Content-Type':'application/json'},url='http://127.0.0.1:'+bridge.connection.port;
 try{
  const input={key:'bad-module-door',agent:'deepseek',model:'deepseek-flash',prompt:'building',generationMode:'scene'};
  const post=()=>fetch(url+'/v1/jobs',{method:'POST',headers,body:JSON.stringify(input)}).then(r=>r.json());
  const job=await post();let final;
  for(let i=0;i<200;i++){final=await fetch(url+'/v1/jobs/'+job.id,{headers}).then(r=>r.json());if(final.state==='failed')break;await delay(20);}
  assert.equal(final.state,'failed');assert.equal((await post()).id,job.id);assert.equal(calls,1);
  assert.match(final.error,/core_doors_tower \/ module core_doors \/ node door_a: door component size/);
  assert.equal(final.diagnosticPreview,undefined);assert.equal(final.manifest,undefined);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dataDir,'jobs',job.id,'attempt-0-spec.json'),'utf8')),spec);
 }finally{await bridge.close();}
});

test('internal conflicts retain a read-only failed view, not an exportable or revisable success',async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-scene-diagnostic-'));let calls=0;
 const spec=courtyard();spec.components.push(shape('collision',[2,1,1],[1,2,1],'wall'));
 const adapter={close(){},async generate(){calls++;return {spec};}};
 let bridge=await startBridge({dataDir,adapter,deepseekAdapter:adapter,claudeAdapter:adapter});
 const request=async(route,data)=>fetch('http://127.0.0.1:'+bridge.connection.port+route,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+bridge.connection.token,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});
 const finish=async id=>{for(let i=0;i<200;i++){const j=await (await request('/v1/jobs/'+id)).json();if(['preview-ready','failed'].includes(j.state))return j;await delay(20);}throw new Error('Job timeout');};
 try{
  const submitted=await (await request('/v1/jobs',{key:'failed-internal',agent:'deepseek',model:'deepseek-flash',prompt:'courtyard',generationMode:'scene'})).json();
  const failed=await finish(submitted.id);assert.equal(failed.state,'failed');assert.match(failed.error,/Ownership/);assert.equal(calls,1);
  assert.equal(failed.manifest,undefined);assert.equal(failed.diagnosticPreview.diagnosticOnly,true);
  assert.equal(failed.diagnosticPreview.scene.sourceHash,hash(spec));
  const route='/v1/jobs/'+failed.id;
  const manifest=await (await request(route+'/diagnostic-manifest')).json();
  const bytes=Buffer.from(await (await request(route+'/diagnostic-cells')).arrayBuffer());assert.equal(hash(bytes),manifest.cellsHash);
  for(const action of ['manifest','cells','scene','design-sources','diff'])assert.equal((await request(route+'/'+action)).status,409);
  for(const action of ['export','bundle'])assert.equal((await request(route+'/'+action,{})).status,409);
  await assert.rejects(readNativeBundle(path.join(dataDir,'jobs',failed.id,'diagnostic')),/diagnostic|诊断/i);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dataDir,'jobs',failed.id,'attempt-0-spec.json'),'utf8')),spec);
  assert.deepEqual((await fs.readdir(path.join(dataDir,'jobs',failed.id,'diagnostic'))).sort(),['cells.bin','manifest.json']);
  // Local revalidation preserves the original failure and never calls the adapter.
  const replay=await (await request('/v1/jobs',{key:'diagnostic-local-replay',revalidateJobId:failed.id})).json();
  assert.equal((await finish(replay.id)).diagnosticPreview.assetHash,manifest.assetHash);assert.equal(calls,1);
  const revise=await (await request('/v1/jobs',{key:'diagnostic-not-base',baseJobId:failed.id,baseHash:manifest.assetHash,agent:'deepseek',model:'deepseek-flash',prompt:'repair',generationMode:'scene',sceneScope:{components:['collision'],regions:[{origin:[2,1,1],size:[1,2,1]}],protectedComponents:[],shared:'instance'}})).json();
  const rejected=await finish(revise.id);assert.equal(rejected.state,'failed');assert.match(rejected.error,/base revision/);assert.equal(rejected.diagnosticPreview,undefined);assert.equal(calls,1);
  // Requested dimensions remain hard, even though the ownership fault came first.
  const bounded=await (await request('/v1/jobs',{key:'diagnostic-hard-bounds',agent:'deepseek',model:'deepseek-flash',prompt:'20×20×20格边界',generationMode:'scene'})).json();
  const tooLarge=await finish(bounded.id);assert.equal(tooLarge.state,'failed');assert.equal(tooLarge.diagnosticPreview,undefined);assert.match(tooLarge.diagnosticUnavailable,/超过请求/);assert.equal(calls,2);
  await bridge.close();bridge=await startBridge({dataDir,adapter,deepseekAdapter:adapter,claudeAdapter:adapter});
  assert.deepEqual(await (await request(route+'/diagnostic-manifest')).json(),manifest);assert.equal(calls,2);
  await fs.writeFile(path.join(dataDir,'jobs',failed.id,'diagnostic','cells.bin'),Buffer.from([1,2]));
  assert.equal((await request(route+'/diagnostic-cells')).status,400);
 }finally{await bridge.close();}
});
