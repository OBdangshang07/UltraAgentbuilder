import test from 'node:test';import assert from 'node:assert/strict';import {setTimeout as delay} from 'node:timers/promises';import path from 'node:path';import os from 'node:os';import fs from 'node:fs/promises';
import {AgentDiscovery} from '../../bridge/agent-discovery.mjs';import {agentDirectories} from '../../bridge/agent-paths.mjs';import {startBridge} from '../../bridge/server.mjs';
test('progressive discovery isolates slow/error sources and never exposes account fields',async()=>{
 let calls=0;const d=new AgentDiscovery(id=>({status:async()=>{calls++;if(id==='codex')return new Promise(()=>{});if(id==='claude')throw new Error('secret');return {available:true,state:'configured',account:'secret',error:'secret',token:'secret'};}}),{timeoutMs:35});
 try{assert.equal(d.snapshot().complete,false);await delay(10);let s=d.snapshot();assert.equal(s.agents[2].available,true);assert.equal(s.agents[1].state,'unavailable');assert.equal(s.complete,false);assert.ok(!JSON.stringify(s).includes('secret'));await delay(40);s=d.snapshot();assert.equal(s.complete,true);assert.equal(s.agents[0].state,'timeout');for(let i=0;i<10;i++)d.snapshot();assert.equal(calls,3);}finally{d.close();}
});
test('refresh remains single-flight for timed-out probes and invalidation ignores stale results',async()=>{
 let resolve,calls=0;const d=new AgentDiscovery(id=>({status:()=>{calls++;return id==='codex'?new Promise(r=>resolve=r):Promise.resolve({available:false,state:'not-found'});}}),{timeoutMs:15});
 try{d.snapshot();await delay(25);const before=calls;d.snapshot(true);await delay(1);assert.equal(calls,before+2);d.invalidate('codex');resolve({available:true});await delay(1);assert.equal(d.snapshot().agents[0].state,'detecting');}finally{d.close();}
});
test('known install paths are bounded absolute and exclude empty or relative PATH entries',()=>{
 const home=path.join(os.tmpdir(),'fixture-home'),npm=path.join(home,'npm');const dirs=agentDirectories({USERPROFILE:home,APPDATA:home,NVM_SYMLINK:path.join(home,'nvm'),PATH:['','relative',npm,`"${npm}"`].join(path.delimiter)},path.join(home,'runtime/node.exe'));
 assert.ok(dirs.every(path.isAbsolute));assert.equal(dirs.filter(p=>p===npm).length,1);assert.ok(dirs.includes(path.join(home,'.local/bin')));assert.ok(dirs.includes(path.join(home,'nvm')));assert.ok(dirs.length<=128);
});
test('HTTP auto-discovery returns partial status without invoking model or generation methods',async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-auto-discovery-'));let calls=0;
 const adapter=id=>({close(){},async status(){calls++;return {id,available:id==='deepseek',state:id==='deepseek'?'configured':'login-required',account:'private'};},models(){throw new Error('No model discovery in automatic scan');},generate(){throw new Error('No generation');}});
 const s=await startBridge({dataDir,adapter:adapter('codex'),claudeAdapter:adapter('claude'),deepseekAdapter:adapter('deepseek')});
 try{const base=`http://127.0.0.1:${s.connection.port}`,headers={Authorization:`Bearer ${s.connection.token}`};
 const first=await(await fetch(base+'/v1/agents/discovery',{headers})).json();assert.equal(first.generationSubmitted,false);await delay(10);const result=await(await fetch(base+'/v1/agents/discovery',{headers})).json();assert.equal(result.complete,true);assert.equal(result.agents.filter(a=>a.available).length,1);assert.ok(!JSON.stringify(result).includes('private'));assert.equal(calls,3);assert.equal((await(await fetch(base+'/v1/jobs',{headers})).json()).jobs.length,0);
 }finally{await s.close();}
});
