import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startBridge} from '../../bridge/server.mjs';

test('Bridge persists original provider identity and observations before completion',async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-provider-progress-'));
 let entered,calls=0;const ready=new Promise(resolve=>{entered=resolve;});
 const adapter={close(){},async generate({onEvent,signal}){
  calls++;
  await onEvent({threadId:'original-thread'});
  await onEvent({threadId:'original-thread',turnId:'original-turn',providerProgress:{source:'original-thread-status',runtimeStatus:'active',completionRecoveryAvailable:false,terminal:false,observedAt:new Date().toISOString()}});
  entered();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('Offline cancellation')),{once:true}));
 }};
 const server=await startBridge({dataDir,adapter});
 const request=async(route,body)=>{const r=await fetch('http://127.0.0.1:'+server.connection.port+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+server.connection.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.ok(r.status===200||r.status===202);return r.json();};
 try{
  const job=await request('/v1/jobs',{key:'original-progress',agent:'codex',model:'offline',prompt:'工程状态测试',maxRepairs:0});
  await ready;const live=await request('/v1/jobs/'+job.id),saved=JSON.parse(await fs.readFile(path.join(dataDir,'jobs',job.id,'job.json'),'utf8'));
  for(const current of [live,saved]){
   assert.equal(current.threadId,'original-thread');assert.equal(current.turnId,'original-turn');
   assert.equal(current.providerProgress.source,'original-thread-status');assert.equal(current.providerProgress.terminal,false);
   assert.equal(current.state,'generating');assert.equal(current.generations,undefined);
  }
  await request('/v1/jobs/'+job.id+'/cancel',{});
  for(let i=0;i<100;i++){if((await request('/v1/jobs/'+job.id)).state==='cancelled')break;await delay(10);}
  assert.equal(calls,1);assert.equal((await request('/v1/jobs/'+job.id)).state,'cancelled');
 }finally{await server.close();}
});
