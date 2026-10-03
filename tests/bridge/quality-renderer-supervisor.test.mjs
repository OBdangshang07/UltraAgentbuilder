import test from 'node:test';
import assert from 'node:assert/strict';
import {rendererSupervisor} from '../../scripts/quality-renderer-supervisor.mjs';

async function fixture(options={}){
 let time=0;const clients=[],events=[];
 const api=rendererSupervisor({idleMs:10,now:()=>time,onEvent:e=>events.push(e),start:async()=>{
  const c={dead:false,stops:0,ids:[],outcome:{result:'passed',launcherExited:true,nativeClientExitVerified:true,worldLoaded:false,assetOnly:true},
   async check(){if(this.dead)throw Error('native client stopped');},async observe(id){this.ids.push(id);},async settle(){this.stops++;this.dead=true;return this.outcome;}};
  assert.ok(clients.every(c=>c.dead),'parallel clients forbidden');clients.push(c);return c;
 },...options});
 await api.warmup();await api.observe('one-job');
 return {api,clients,events,advance:ms=>time+=ms,job:{id:'one-job',state:'generating',nativeEvidence:{state:'complete'}}};
}
test('native client retires during long model generation and starts only on an image request',async()=>{
 const f=await fixture();await f.api.update(f.job);f.advance(11);await f.api.update(f.job);
 assert.equal(f.clients[0].stops,1);for(let i=0;i<4;i++)await f.api.update(f.job);assert.equal(f.clients.length,1);
 await f.api.update({...f.job,nativeEvidence:{state:'waiting',id:'immutable-request'}});assert.equal(f.clients.length,2);assert.deepEqual(f.clients[1].ids,['one-job']);
 await f.api.update({...f.job,state:'preview-ready'});const result=await f.api.stop();assert.equal(result.result,'passed');assert.equal(result.additionalModelCalls,0);
});
test('native crash during generation is isolated until the next immutable image request',async()=>{
 const f=await fixture();f.clients[0].dead=true;f.clients[0].outcome={result:'failed',launcherExited:true,nativeClientExitVerified:true,worldLoaded:null};
 await f.api.update(f.job);assert.equal(f.clients.length,1);assert.equal(f.api.inspect().blocked,null);
 await f.api.update({...f.job,nativeEvidence:{state:'waiting'}});assert.equal(f.clients.length,2);
 const result=await f.api.stop();assert.equal(result.result,'recovered');assert.equal(result.worldLoaded,null);assert.equal(result.sessions[0].result,'failed');
});
test('a live or unknown JVM prevents any second client while model observations continue',async()=>{
 const f=await fixture();f.clients[0].dead=true;f.clients[0].outcome={result:'failed',launcherExited:true,nativeClientExitVerified:false};
 for(let i=0;i<5;i++)await f.api.update({...f.job,nativeEvidence:{state:'waiting'}});
 assert.equal(f.clients.length,1);assert.match(f.api.inspect().blocked,/unverified/);assert.equal((await f.api.settle()).result,'failed');
});
test('only one renderer recovery is allowed; no infinite restart loop and no model functions exist',async()=>{
 const f=await fixture();const waiting={...f.job,nativeEvidence:{state:'waiting'}};
 f.clients[0].dead=true;await f.api.update(waiting);assert.equal(f.clients.length,2);
 f.clients[1].dead=true;for(let i=0;i<3;i++)await f.api.update(waiting);
 assert.equal(f.clients.length,2);assert.match(f.api.inspect().blocked,/limit exhausted/);
 assert.equal(f.api.submit,undefined);assert.equal(f.api.cancel,undefined);
});
test('startup failure cannot submit a model call or certify an unknown child exit',async()=>{
 const api=rendererSupervisor({start:async()=>{throw Error('launch failed');}});await assert.rejects(api.warmup(),/no generation submitted/);
 assert.equal((await api.settle()).result,'failed');assert.equal(api.inspect().starts,1);
});
test('session limit is finite and settling is idempotent',async()=>{
 const f=await fixture({maxStarts:1});await f.api.update(f.job);f.advance(11);await f.api.update(f.job);
 await f.api.update({...f.job,nativeEvidence:{state:'waiting'}});assert.equal(f.clients.length,1);
 const [a,b]=await Promise.all([f.api.settle(),f.api.settle()]);assert.deepEqual(a,b);assert.equal(f.clients[0].stops,1);assert.equal(a.result,'failed');
});
test('supervisor never switches jobs, even if another waiting request is observed',async()=>{
 const f=await fixture();await assert.rejects(f.api.observe('other-job'),/cannot switch/);await assert.rejects(f.api.update({...f.job,id:'other-job'}),/identity changed/);await f.api.stop();
});
