import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {CodexAdapter} from '../../bridge/codex-adapter.mjs';
import {CompletedResponseFormatError} from '../../bridge/model-json.mjs';
import {hash} from '../../src/generation/compiler.mjs';

async function fixture(emit,options={}){
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-codex-generation-'));
  const a=new CodexAdapter(options),requests=[];
  a.connect=async()=>{};
  a.readStoredTurn=async()=>{throw Error('Offline history unavailable');};
  a.models=async()=>[{id:'gpt-5.6-luna',efforts:[{reasoningEffort:'max'}],defaultEffort:'max'}];
  a.request=async(method,params)=>{
    requests.push({method,params});
    if(method==='config/read')return {config:{mcp_servers:{local_test:{command:'never-execute'},'with.dot':{enabled:true,url:'https://not-contacted.invalid'}}}};
    if(method==='thread/unsubscribe')return {status:'unsubscribed'};
    if(method==='thread/start')return {thread:{id:'thread-fixture',ephemeral:false}};
    if(method==='turn/start'){
      setImmediate(()=>emit(a));return {turn:{id:'turn-fixture'}};
    }
    assert.equal(method,'turn/interrupt');return {};
  };
  const notify=(method,params={})=>a.emit('notification',{method,params:{threadId:'thread-fixture',...params}});
  return {a,cwd,requests,notify,generate:signal=>a.generate({prompt:'Offline data-only fixture',model:'gpt-5.6-luna',effort:'max',cwd,signal})};
}
const complete=(a,text,status='completed')=>{
  a.emit('notification',{method:'item/completed',params:{threadId:'thread-fixture',turnId:'turn-fixture',item:{type:'agentMessage',phase:'final_answer',text}}});
  a.emit('notification',{method:'turn/completed',params:{threadId:'thread-fixture',turn:{id:'turn-fixture',status}}});
};

test('Codex retains exact completed answer and usage, normalizes formatting without another turn',async()=>{
  const raw='```json\n{"value":"中文",}\n```';
  const f=await fixture(a=>{
    a.emit('notification',{method:'thread/tokenUsage/updated',params:{threadId:'thread-fixture',tokenUsage:{last:{totalTokens:30,inputTokens:20,outputTokens:10,private:'must not persist'}}}});
    a.emit('notification',{method:'item/reasoning/textDelta',params:{threadId:'thread-fixture',delta:'PRIVATE REASONING'}});
    complete(a,raw);
  });
  const result=await f.generate(new AbortController().signal);
  assert.deepEqual(result.spec,{value:'中文'});assert.equal(result.model,'gpt-5.6-luna');assert.equal(result.usage.totalTokens,30);
  assert.equal(f.requests.filter(r=>r.method==='turn/start').length,1);
  const start=f.requests.find(r=>r.method==='thread/start').params;
  assert.equal(start.ephemeral,false);assert.equal(start.sandbox,'read-only');assert.equal(start.config['features.shell_tool'],false);
  assert.deepEqual(start.config.mcp_servers,{local_test:{enabled:false},'with.dot':{enabled:false}});
  assert.equal(start.config['features.plugins'],false);assert.equal(start.config['features.hooks'],false);assert.equal(start.config['features.skip_host_skill_discovery'],true);
  assert.equal(f.requests.filter(r=>r.method==='thread/unsubscribe').length,1);
  const dir=path.join(f.cwd,result.diagnostic.responseEvidence.directory);
  assert.equal(await fs.readFile(path.join(dir,'answer-1.txt'),'utf8'),raw);
  assert.equal(result.diagnostic.receivedTextSha256,hash(raw));assert.equal(result.diagnostic.reason,'completed');
  const receipt=await fs.readFile(path.join(dir,'receipt.json'),'utf8');assert.ok(!receipt.includes('PRIVATE'));assert.ok(!receipt.includes('must not persist'));
  assert.equal(f.a.listenerCount('notification'),0);assert.equal(f.a.listenerCount('disconnect'),0);
});

test('Codex complete invalid JSON is source-bound private evidence, not an unknown or retried turn',async()=>{
  for(const raw of ['{"a":1,"a":2}','{"a":}']){
    const f=await fixture(a=>complete(a,raw));
    let caught;
    await assert.rejects(f.generate(new AbortController().signal),error=>{
      caught=error;
      assert.ok(error instanceof CompletedResponseFormatError);assert.match(error.message,/Codex/);
      assert.equal(error.diagnostic.reason,'completed');assert.equal(error.diagnostic.failureKind,'answer-json');
      assert.equal(error.responseText,raw);assert.equal(Object.keys(error).includes('responseText'),false);
      return true;
    });
    const dir=path.join(f.cwd,caught.diagnostic.responseEvidence.directory);
    assert.equal(await fs.readFile(path.join(dir,'answer-1.txt'),'utf8'),raw);
    assert.equal(f.requests.filter(r=>r.method==='turn/start').length,1);
    assert.equal(f.requests.filter(r=>r.method==='thread/unsubscribe').length,1);
  }
});

test('Codex cancellation, failed completion and disconnect preserve partial data without format repair eligibility',async()=>{
  for(const variant of ['cancel','failed','disconnect']){
    const controller=new AbortController();
    const f=await fixture(a=>{
      a.emit('notification',{method:'item/agentMessage/delta',params:{threadId:'thread-fixture',delta:'{"partial":'}});
      if(variant==='cancel')controller.abort();
      else if(variant==='disconnect')a.emit('disconnect',new Error('Offline disconnect'));
      else complete(a,'{"partial":','failed');
    },{observationIntervalMs:5});
    if(variant==='disconnect')f.a.readStoredTurn=async()=>({thread:{id:'thread-fixture',ephemeral:false,turns:[{
      id:'turn-fixture',status:'failed',startedAt:1,completedAt:2,itemsView:'full',error:{message:'Original failed after disconnect'},items:[
       {type:'userMessage',content:[{type:'text',text:'Offline data-only fixture'}]}]}]}});
    await assert.rejects(f.generate(controller.signal),error=>{
      assert.ok(!(error instanceof CompletedResponseFormatError));assert.notEqual(error.diagnostic.reason,'completed');
      assert.equal(error.diagnostic.responseEvidence.persisted,true);return true;
    });
    assert.equal(f.requests.filter(r=>r.method==='turn/start').length,1);
    assert.equal(f.a.listenerCount('notification'),0);
  }
});

test('Codex ignores other threads/turns and can read the final message in the completed turn',async()=>{
  const f=await fixture(a=>{
    a.emit('notification',{method:'turn/completed',params:{threadId:'foreign',turn:{id:'other',status:'completed',items:[{type:'agentMessage',text:'{"wrong":true}'}]}}});
    a.emit('notification',{method:'turn/completed',params:{threadId:'thread-fixture',turn:{id:'other',status:'completed',items:[{type:'agentMessage',text:'{"wrong":true}'}]}}});
    a.emit('notification',{method:'turn/completed',params:{threadId:'thread-fixture',turn:{id:'turn-fixture',status:'completed',items:[{type:'agentMessage',phase:'commentary',text:'Not the answer'},{type:'agentMessage',phase:'final_answer',text:'{"correct":true}'}]}}});
  });
  assert.deepEqual((await f.generate(new AbortController().signal)).spec,{correct:true});
});

test('unavailable Codex evidence storage stops before thread or turn submission',async()=>{
  const f=await fixture(()=>{throw new Error('must not invoke');});
  await assert.rejects(f.a.generate({prompt:'offline',model:'gpt-5.6-luna',effort:'max',cwd:path.join(f.cwd,'missing')}),error=>{
    assert.equal(error.code,'ENOENT');assert.equal(error.diagnostic.reason,'not-submitted');assert.equal(error.diagnostic.phase,'evidence-storage');return true;
  });
  assert.equal(f.requests.length,0);
});

test('Codex configuration inspection failures stop before thread/turn creation',async()=>{
 for(const config of [null,[],{mcp_servers:[]}]){
  const f=await fixture(()=>{throw new Error('No model turn permitted');});
  f.a.request=async(method)=>{f.requests.push({method});assert.equal(method,'config/read');return {config};};
  await assert.rejects(f.generate(new AbortController().signal),error=>{
    assert.match(error.message,/configuration/);assert.equal(error.diagnostic.reason,'not-submitted');assert.equal(error.diagnostic.phase,'data-only-config');return true;
  });
  assert.deepEqual(f.requests.map(r=>r.method),['config/read']);
 }
});

test('Codex subscription cleanup failure does not discard a completed result or resubmit',async()=>{
 const f=await fixture(a=>complete(a,'{"ok":true}')),original=f.a.request;
 f.a.request=async(method,params)=>{if(method==='thread/unsubscribe'){f.requests.push({method,params});throw new Error('Offline cleanup unavailable');}return original(method,params);};
 const result=await f.generate(new AbortController().signal);
 assert.deepEqual(result.spec,{ok:true});assert.equal(result.diagnostic.reason,'completed');
 assert.equal(f.requests.filter(r=>r.method==='turn/start').length,1);assert.equal(f.requests.filter(r=>r.method==='thread/unsubscribe').length,1);
});

test('Codex partial final items without persisted terminal status remain ambiguous',async()=>{
 const events=[],controller=new AbortController(),f=await fixture(a=>{
  a.emit('notification',{method:'item/completed',params:{threadId:'thread-fixture',turnId:'turn-fixture',item:{type:'agentMessage',phase:'final_answer',text:'{"notConfirmed":true}'}}});
 },{observationIntervalMs:5}),original=f.a.request;
 f.a.readStoredTurn=async()=>({thread:{id:'thread-fixture',ephemeral:false,turns:[{id:'turn-fixture',status:'inProgress',itemsView:'full',items:[{type:'agentMessage',phase:'final_answer',text:'{"notConfirmed":true}'}]}]}});
 const pending=f.a.generate({prompt:'Offline data-only fixture',model:'gpt-5.6-luna',effort:'max',cwd:f.cwd,signal:controller.signal,onEvent:e=>{
  events.push(e);if(e.providerProgress?.source==='original-persisted-turn')controller.abort();
 }});
 await assert.rejects(pending,error=>{assert.equal(error.diagnostic.reason,'aborted');return true;});
 assert.equal(f.requests.filter(r=>r.method==='turn/start').length,1);assert.equal(f.requests.filter(r=>r.method==='thread/start').length,1);
 assert.equal(f.requests.filter(r=>r.method==='turn/interrupt').length,1);
 assert.ok(events.some(e=>e.turnId==='turn-fixture'&&e.providerProgress?.source==='turn-start-receipt'));
 const status=events.find(e=>e.providerProgress?.source==='original-persisted-turn').providerProgress;
 assert.equal(status.terminal,false);assert.equal(status.completionRecoveryAvailable,true);assert.equal(status.receiptState,'awaiting-original-stored-receipt');
 const directory=(await fs.readdir(f.cwd)).find(n=>n.startsWith('codex-response-'));
 assert.equal(JSON.parse(await fs.readFile(path.join(f.cwd,directory,'turn.json'),'utf8')).turnId,'turn-fixture');
 assert.equal(f.a.listenerCount('notification'),0);
});

test('Codex observation errors keep the original subscription until a real terminal event',async()=>{
 const f=await fixture(()=>{},{observationIntervalMs:5}),original=f.a.request;
 let reads=0;
 f.a.readStoredTurn=async()=>{reads++;if(reads===3)setImmediate(()=>complete(f.a,'{"ok":true}'));throw Error('Read unavailable');};
 assert.deepEqual((await f.generate(new AbortController().signal)).spec,{ok:true});assert.ok(reads>=3);
 assert.equal(f.requests.filter(r=>r.method==='turn/start').length,1);
 assert.equal(f.requests.filter(r=>r.method==='turn/interrupt').length,0);
});

test('Codex systemError summary cannot replace the original failed turn notification',async()=>{
 const f=await fixture(()=>{},{observationIntervalMs:5}),original=f.a.request;
 f.a.readStoredTurn=async()=>{setImmediate(()=>complete(f.a,'','failed'));return {thread:{id:'thread-fixture',ephemeral:false,status:{type:'systemError'},turns:[]}};};
 await assert.rejects(f.generate(new AbortController().signal),error=>{
  assert.equal(error.diagnostic.reason,'failed');assert.equal(error.diagnostic.completionSource,'notification');
  assert.equal(error.diagnostic.turnId,'turn-fixture');return true;
 });
 assert.equal(f.requests.filter(r=>r.method==='turn/start').length,1);
});

test('Codex invalid final answer is checked only after an original completion notification',async()=>{
 const raw='{"a":}',f=await fixture(()=>{},{observationIntervalMs:5}),original=f.a.request;
 f.a.readStoredTurn=async()=>{setImmediate(()=>complete(f.a,raw));return {thread:{id:'thread-fixture',ephemeral:false,status:{type:'idle'},turns:[]}};};
 await assert.rejects(f.generate(new AbortController().signal),error=>{
  assert.ok(error instanceof CompletedResponseFormatError);assert.equal(error.responseText,raw);
  assert.equal(error.diagnostic.reason,'completed');assert.equal(error.diagnostic.completionSource,'notification');return true;
 });
 assert.equal(f.requests.filter(r=>r.method==='turn/start').length,1);
});

test('Codex dropped completion notification and writer disconnect recover the same persisted original turn',async()=>{
 for(const variant of ['lost-notification','writer-disconnect','invalid-json','failed-turn']){
  const raw=variant==='invalid-json'?'{"a":}':'{"recovered":true}',f=await fixture(a=>{
   if(variant==='writer-disconnect')a.emit('disconnect',Error('Offline writer exit'));
  },{observationIntervalMs:5});
  f.a.readStoredTurn=async()=>({thread:{id:'thread-fixture',ephemeral:false,turns:[{
   id:'turn-fixture',status:variant==='failed-turn'?'failed':'completed',startedAt:1,completedAt:2,itemsView:'full',error:{message:'Original failed'},items:[
    {type:'userMessage',content:[{type:'text',text:'Offline data-only fixture'}]},
    {type:'reasoning',text:'PRIVATE'},{type:'agentMessage',phase:'final_answer',text:raw}]}]}});
  const pending=f.generate(new AbortController().signal);
  if(variant==='invalid-json')await assert.rejects(pending,e=>e instanceof CompletedResponseFormatError&&e.diagnostic.completionSource==='stored-original-turn'&&e.responseText===raw);
  else if(variant==='failed-turn')await assert.rejects(pending,e=>e.diagnostic.reason==='failed'&&e.diagnostic.completionSource==='stored-original-turn');
  else{const result=await pending;assert.deepEqual(result.spec,{recovered:true});assert.equal(result.diagnostic.completionSource,'stored-original-turn');}
  assert.equal(f.requests.filter(r=>r.method==='turn/start').length,1);assert.equal(f.requests.filter(r=>r.method==='thread/start').length,1);
  assert.equal(f.requests.filter(r=>r.method==='turn/interrupt').length,0);
  assert.equal(f.a.listenerCount('notification'),0);assert.equal(f.a.listenerCount('disconnect'),0);
 }
});

test('Codex binds thread before dispatch and acknowledged turn before delivering an early completion',async()=>{
 const f=await fixture(()=>{}),original=f.a.request,bindings=[];
 f.a.request=async(method,params)=>{
  if(method==='turn/start'){
   f.requests.push({method,params});assert.equal(bindings.length,1);assert.equal(bindings[0].turnId,null);
   complete(f.a,'{"early":true}');return {turn:{id:'turn-fixture'}};
  }
  return original(method,params);
 };
 const result=await f.a.generate({prompt:'Offline data-only fixture',model:'gpt-5.6-luna',effort:'max',cwd:f.cwd,onProviderBinding:async b=>{bindings.push(b);}});
 assert.deepEqual(result.spec,{early:true});assert.equal(bindings.length,2);assert.equal(bindings[1].turnId,'turn-fixture');
 assert.equal(bindings[0].requestHash,bindings[1].requestHash);assert.equal(result.diagnostic.turnId,'turn-fixture');
});
