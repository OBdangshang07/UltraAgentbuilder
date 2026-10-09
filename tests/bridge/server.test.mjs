import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { startBridge } from '../../bridge/server.mjs';
import { RELEASE_VERSION } from '../../bridge/release.mjs';
import { verifySchematic } from '../../src/core/schematic-verifier.mjs';
import { findCodex } from '../../bridge/codex-adapter.mjs';
import {sampleSpec} from '../../src/generation/sample.mjs';

for(const fixture of ['passage-height','furniture'])test(`saved ${fixture} failure revalidates locally into a new revision without invoking any Agent`,async()=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-revalidate-')),id='11111111-1111-4111-8111-111111111111',dir=path.join(dataDir,'jobs',id);
  await fs.mkdir(dir,{recursive:true});const spec=sampleSpec();if(fixture==='passage-height')spec.constraints.passages[0].size[1]=1;else spec.nodes.push({nodeId:'table',op:'box',origin:[4,2,7],size:[3,2,3],material:'beam'});
  const original={id,key:'original',agent:'codex',state:'failed',attempt:0,createdAt:new Date().toISOString(),events:[],error:fixture==='passage-height'?'Passage needs valid bounds, floor and two-block headroom':'Interior has 9 disconnected standing cells'};
  await fs.writeFile(path.join(dir,'job.json'),JSON.stringify(original));await fs.writeFile(path.join(dir,'attempt-0-spec.json'),JSON.stringify(spec));
  let calls=0;const adapter={close(){},async generate(){calls++;throw new Error('Must not call a model');}};
  const s=await startBridge({dataDir,adapter});const headers={Authorization:`Bearer ${s.connection.token}`,'Content-Type':'application/json'},base=`http://127.0.0.1:${s.connection.port}`;
  try{
    const req={key:'local-revalidate',revalidateJobId:id};
    const post=()=>fetch(base+'/v1/jobs',{method:'POST',headers,body:JSON.stringify(req)}).then(r=>r.json());
    const job=await post();assert.notEqual(job.id,id);assert.equal((await post()).id,job.id);
    let final;for(let i=0;i<100;i++){final=await fetch(base+'/v1/jobs/'+job.id,{headers}).then(r=>r.json());if(['failed','preview-ready'].includes(final.state))break;await delay(30);}
    assert.equal(final.state,'preview-ready',final.error);assert.equal(calls,0);assert.ok(final.manifest.validationNotes.length);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'job.json'),'utf8')),original);
    const exported=JSON.parse(await fs.readFile(path.join(dataDir,'jobs',job.id,'spec.json'),'utf8'));assert.equal(exported.constraints.passages[0].size[1],2);assert.deepEqual(exported.nodes,spec.nodes);
    if(fixture==='furniture'){assert.deepEqual(exported.constraints,spec.constraints);assert.equal(final.manifest.navigation.unclaimedSurfaces,9);}
  }finally{await s.close();}
});

test('authenticated loopback, worker compile/export, masks, idempotency and history', async () => {
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-bridge-test-'));
  const s=await startBridge({dataDir}); const base=`http://127.0.0.1:${s.connection.port}`;
  const headers={Authorization:`Bearer ${s.connection.token}`,'Content-Type':'application/json'};
  const request=async(route,body)=>{const r=await fetch(base+route,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return [r.status,await r.json()];};
  try {
    assert.equal((await fetch(base+'/v1/health')).status,401);
    assert.equal((await fetch(base+'/v1/health',{headers:{...headers,Origin:'http://malicious.example'}})).status,403);
    assert.equal((await request('/v1/health'))[1].protocol,1);
    assert.equal((await request('/v1/health'))[1].version,RELEASE_VERSION);
    assert.equal((await request('/v1/health'))[1].builtinBundleHash,null,'source-only Bridge must not echo client/task metadata as builtin identity');
    const [status,job]=await request('/v1/jobs',{key:'sample',sample:true});assert.equal(status,202);
    assert.equal((await request('/v1/jobs',{key:'sample',sample:true}))[1].id,job.id);
    assert.equal((await request('/v1/jobs',{key:'sample',sample:false}))[0],409);
    let final;
    for(let i=0;i<200;i++){final=(await request('/v1/jobs/'+job.id))[1];if(['preview-ready','failed'].includes(final.state))break;await delay(50);}
    assert.equal(final.state,'preview-ready',final.error);
    assert.ok(final.manifest.clearCount>0);assert.equal(final.manifest.setCount,1937);
    const cells=await fetch(base+'/v1/jobs/'+job.id+'/cells',{headers});assert.equal((await cells.arrayBuffer()).byteLength,19*14*17*2);
    const [exportStatus, exported]=await request('/v1/jobs/'+job.id+'/export',{});assert.equal(exportStatus,200);await verifySchematic(exported.file);
    assert.equal((await request('/v1/jobs'))[1].jobs.length,1);
    assert.equal((await request('/v1/jobs/'+job.id+'/events?after=1'))[1].events[0].seq,2);
  } finally { await s.close(); }
  const restarted=await startBridge({dataDir});await restarted.close();
});

test('concurrent idempotency, generation cancellation and interrupted recovery are explicit', {timeout:15000}, async () => {
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-cancel-test-'));
  let calls=0,markStarted;const started=new Promise(resolve=>{markStarted=resolve;});
  const adapter={close(){},async generate({signal}){calls++;markStarted();return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});}};
  const s=await startBridge({dataDir,adapter});const base=`http://127.0.0.1:${s.connection.port}`,headers={Authorization:`Bearer ${s.connection.token}`,'Content-Type':'application/json'};
  const post=async(route,input={})=>{const r=await fetch(base+route,{method:'POST',headers,body:JSON.stringify(input)});return [r.status,await r.json()];};
  try{
    const input={key:'same-key',prompt:'house',model:'fixture'};
    const results=await Promise.all([post('/v1/jobs',input),post('/v1/jobs',input)]);
    assert.equal(results[0][1].id,results[1][1].id);await started;assert.equal(calls,1);
    const id=results[0][1].id;await post(`/v1/jobs/${id}/cancel`);
    let state;for(let i=0;i<100;i++){state=(await(await fetch(base+`/v1/jobs/${id}`,{headers})).json()).state;if(state==='cancelled')break;await delay(20);}assert.equal(state,'cancelled');
  }finally{await s.close();}
});

test('read-only key recovery after lost receipt and restart never resubmits generation', async () => {
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-recovery-test-'));
  let calls=0;const adapter={close(){},async generate(){calls++;throw new Error('No model should be called by recovery');}};
  let s=await startBridge({dataDir,adapter});let job;
  try {
    const headers={Authorization:`Bearer ${s.connection.token}`,'Content-Type':'application/json'},base=`http://127.0.0.1:${s.connection.port}`;
    job=await(await fetch(base+'/v1/jobs',{method:'POST',headers,body:JSON.stringify({key:'lost-receipt',sample:true})})).json();
    const lookup=await(await fetch(base+'/v1/jobs/by-key?key=lost-receipt',{headers})).json();assert.equal(lookup.job.id,job.id);
    assert.equal((await(await fetch(base+'/v1/jobs/by-key?key=absent',{headers})).json()).job,null);
  }finally{await s.close();}
  const file=path.join(dataDir,'jobs',job.id,'job.json'),saved=JSON.parse(await fs.readFile(file,'utf8'));saved.state='generating';await fs.writeFile(file,JSON.stringify(saved));
  s=await startBridge({dataDir,adapter});
  try{const r=await fetch(`http://127.0.0.1:${s.connection.port}/v1/jobs/by-key?key=lost-receipt`,{headers:{Authorization:`Bearer ${s.connection.token}`}});const restored=(await r.json()).job;assert.equal(restored.id,job.id);assert.equal(restored.state,'interrupted');assert.equal(calls,0);}finally{await s.close();}
});

test('diagnostics are read-only and explicit invalid Agent path never falls back',async()=>{
  const gradle=await fs.readFile(new URL('../../mod/build.gradle',import.meta.url),'utf8');
  assert.equal(gradle.match(/^version = '([^']+)'/m)?.[1],RELEASE_VERSION,'Mod and Bridge must ship the same release');
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-diagnostics-test-'));
  let calls=0;const s=await startBridge({dataDir,adapter:{close(){},async generate(){calls++;}}});
  try{
    const base=`http://127.0.0.1:${s.connection.port}`,headers={Authorization:`Bearer ${s.connection.token}`,'Content-Type':'application/json'};
    const d=await(await fetch(base+'/v1/diagnostics',{headers})).json();assert.equal(d.generationSubmitted,false);assert.equal(d.components.length,6);assert.ok(d.components.every(c=>c.present));assert.ok(d.components.some(c=>c.file==='bridge/scene-checkpoint-worker.mjs'));assert.ok(d.capabilities.includes('scene-checkpoints'));assert.ok(!JSON.stringify(d).includes(s.connection.token));
    const bad=path.join(dataDir,'missing-codex.exe');await assert.rejects(findCodex(bad),/no automatic fallback/);
    const r=await fetch(base+'/v1/config/codex-path',{method:'POST',headers,body:JSON.stringify({codexPath:bad})});assert.equal(r.status,400);assert.equal(calls,0);
    const fixture=path.join(dataDir,'fixture codex.js');await fs.writeFile(fixture,'throw new Error("This fixture must not execute")');
    const saved=await fetch(base+'/v1/config/codex-path',{method:'POST',headers,body:JSON.stringify({codexPath:fixture})});assert.equal(saved.status,200);assert.equal(JSON.parse(await fs.readFile(path.join(dataDir,'config.json'),'utf8')).codexPath,fixture);
    assert.equal(calls,0);
  }finally{await s.close();}
});

test('two Agent adapters share generation, immutable revision, diff and native import contracts without paid calls',async()=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-two-agents-'));let codexCalls=0,claudeCalls=0;
  const s=await startBridge({dataDir,adapter:{close(){},async generate(){codexCalls++;return {spec:sampleSpec()};}},claudeAdapter:{close(){},async generate(){claudeCalls++;const spec=sampleSpec();spec.palette.roof='red';return {spec};}}});
  const base=`http://127.0.0.1:${s.connection.port}`,headers={Authorization:`Bearer ${s.connection.token}`,'Content-Type':'application/json'};
  const request=async(route,input)=>{const r=await fetch(base+route,{method:input?'POST':'GET',headers,body:input?JSON.stringify(input):undefined});const data=await r.json();assert.ok(r.ok,data.error);return data;};
  const wait=async id=>{for(let i=0;i<200;i++){const j=await request('/v1/jobs/'+id);if(['preview-ready','failed'].includes(j.state)){assert.equal(j.state,'preview-ready',j.error);return j;}await delay(20);}throw new Error('Fixture timed out');};
  try{
    const a=await wait((await request('/v1/jobs',{key:'codex-fixture',agent:'codex',model:'fixture',prompt:'fixture',maxRepairs:0})).id);
    const b=await wait((await request('/v1/jobs',{key:'claude-fixture',agent:'claude',model:'fixture',prompt:'fixture',baseJobId:a.id,baseHash:a.assetHash,maxRepairs:0})).id);
    assert.equal(b.agent,'claude');const diff=await request('/v1/jobs/'+b.id+'/diff');assert.ok(diff.replaced>0);assert.equal(diff.added,0);assert.equal((await request('/v1/jobs/'+a.id)).assetHash,a.assetHash);
    const bundle=await request('/v1/jobs/'+b.id+'/bundle',{});const imported=await wait((await request('/v1/jobs',{key:'native-import',importDirectory:bundle.directory})).id);assert.equal(imported.assetHash,b.assetHash);assert.equal(imported.imported,true);assert.equal(codexCalls,1);assert.equal(claudeCalls,1);
  }finally{await s.close();}
});

test('DeepSeek is routed independently; discovery skips other Agents and invalid generation is never auto-repaired',async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-deepseek-route-'));let calls=0;
 const s=await startBridge({dataDir,adapter:{close(){},status(){throw new Error('Unselected Codex discovery');}},claudeAdapter:{close(){},status(){throw new Error('Unselected Claude discovery');}},deepseekAdapter:{close(){},async status(){return {id:'deepseek',available:true};},async models(){return [{id:'deepseek-flash'}];},async generate(){calls++;return {spec:{invalid:true}};}}});
 const base=`http://127.0.0.1:${s.connection.port}`,headers={Authorization:`Bearer ${s.connection.token}`,'Content-Type':'application/json'};
 try{const discovery=await(await fetch(base+'/v1/agents/deepseek',{headers})).json();assert.equal(discovery.agents[0].id,'deepseek');assert.equal(calls,0);
  const job=await(await fetch(base+'/v1/jobs',{method:'POST',headers,body:JSON.stringify({key:'deepseek-one',agent:'deepseek',model:'deepseek-flash',prompt:'fixture'})})).json();let last;
  for(let i=0;i<100;i++){last=await(await fetch(base+'/v1/jobs/'+job.id,{headers})).json();if(last.state==='failed')break;await delay(20);}assert.equal(last.state,'failed');assert.equal(calls,1);assert.equal(last.agent,'deepseek');
 }finally{await s.close();}
});
