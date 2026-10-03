import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {CodexAdapter} from '../../bridge/codex-adapter.mjs';
import {codexRequestHash,checkCodexBinding,inspectPersistedCodexTurn,observePersistedCodexTurn} from '../../bridge/codex-persistent-receipt.mjs';
import {CompletedResponseFormatError} from '../../bridge/model-json.mjs';
import {openAssemblyJournal} from '../../bridge/assembly-durability.mjs';
import {hash} from '../../src/generation/compiler.mjs';

const prompt='Offline data-only prompt',model='gpt-6.1-sol',effort='max',outputSchema={type:'object'};
const ids={threadId:'original-thread',turnId:'original-turn',prompt};
const stored=(status='completed',text='{"ok":true}')=>({thread:{id:ids.threadId,ephemeral:false,status:{type:'notLoaded'},turns:[{id:ids.turnId,status,startedAt:1,completedAt:2,itemsView:'full',items:[
 {type:'userMessage',content:[{type:'text',text:prompt}]},{type:'reasoning',text:'PRIVATE REASONING'},
 {type:'agentMessage',phase:'commentary',text:'PRIVATE COMMENTARY'},{type:'agentMessage',phase:'final_answer',text}]}]}});
const binding=async()=>({version:1,provider:'codex',storage:'persistent-single-turn',model,effort,threadId:ids.threadId,turnId:ids.turnId,requestHash:await codexRequestHash({prompt,model,effort,outputSchema})});

test('stored original completed/failed/interrupted turns are authoritative; summaries and partial items are not',()=>{
 for(const status of ['completed','failed','interrupted']){
  const checked=inspectPersistedCodexTurn(stored(status),ids);
  assert.equal(checked.turn.status,status);assert.equal(checked.progress.terminal,true);
  assert.ok(!JSON.stringify(checked).includes('PRIVATE'));assert.ok(!JSON.stringify(checked).includes(prompt));
 }
 assert.equal(inspectPersistedCodexTurn(stored('inProgress'),ids).turn,undefined);
 for(const status of ['idle','systemError','active','notLoaded']){
  const r=stored();r.thread.turns=[];r.thread.status={type:status};assert.equal(inspectPersistedCodexTurn(r,ids).turn,undefined);
 }
});

test('wrong identities, ephemeral history, incomplete items, foreign input and ambiguous finals fail closed',()=>{
 const mutations=[r=>r.thread.id='foreign',r=>r.thread.ephemeral=true,r=>r.thread.turns[0].id='foreign',r=>r.thread.turns.push(structuredClone(r.thread.turns[0])),
  r=>r.thread.turns[0].itemsView='summary',r=>r.thread.turns[0].items[0].content[0].text='foreign',r=>r.thread.turns[0].items.pop(),r=>r.thread.turns[0].items.push(r.thread.turns[0].items.at(-1)),r=>r.thread.turns[0].status='idle'];
 for(const mutate of mutations){const r=stored();mutate(r);assert.throws(()=>inspectPersistedCodexTurn(r,ids));}
});

test('CLI reconstructed interrupted/completed status without a closed event timestamp remains UNKNOWN',()=>{
 for(const status of ['interrupted','failed','completed'])for(const timestamp of [null,undefined,0,-1,1.5]){
  const r=stored(status);r.thread.turns[0].completedAt=timestamp;
  const checked=inspectPersistedCodexTurn(r,ids);assert.equal(checked.turn,undefined);assert.equal(checked.progress.terminal,false);
  assert.equal(checked.progress.receiptState,'awaiting-closed-original-receipt');
 }
});

test('binding covers original model, effort, prompt, schema and image contents, not regenerated path names',async()=>{
 const b=await binding();assert.deepEqual(checkCodexBinding(b,b.requestHash),{threadId:ids.threadId,turnId:ids.turnId});
 for(const changes of [{model:'foreign'},{effort:'low'},{prompt:'foreign'},{outputSchema:{}}])assert.throws(()=>checkCodexBinding(b,hash(changes)));
 assert.throws(()=>checkCodexBinding({...b,turnId:null},b.requestHash));
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-receipt-hash-')),a=path.join(dir,'a'),bfile=path.join(dir,'b');
 await fs.writeFile(a,'same pixels');await fs.writeFile(bfile,'same pixels');
 const args={prompt,model,effort,outputSchema};assert.equal(await codexRequestHash({...args,images:[a]}),await codexRequestHash({...args,images:[bfile]}));
 await fs.writeFile(bfile,'changed pixels');assert.notEqual(await codexRequestHash({...args,images:[a]}),await codexRequestHash({...args,images:[bfile]}));
});

test('recovery reads only the original turn; invalid original JSON stays a completed format error',async()=>{
 const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-receipt-recovery-'));
 for(const text of ['{"ok":true}','{"a":}']){
  const adapter=new CodexAdapter({observationIntervalMs:5});let reads=0;
  adapter.connect=async()=>assert.fail('No writer connection');adapter.generate=async()=>assert.fail('No replacement generation');adapter.request=async()=>assert.fail('No resume/start');
  adapter.readStoredTurn=async identity=>{assert.equal(identity.threadId,ids.threadId);reads++;return stored('completed',text);};
  const promise=adapter.recoverOriginal({binding:await binding(),prompt,model,effort,outputSchema,cwd,signal:new AbortController().signal});
  if(text==='{"ok":true}'){
   const result=await promise;assert.deepEqual(result.spec,{ok:true});assert.equal(result.diagnostic.completionSource,'stored-original-turn');
   const receipt=await fs.readFile(path.join(cwd,result.diagnostic.responseEvidence.directory,'receipt.json'),'utf8');assert.ok(!receipt.includes('PRIVATE'));
  }else await assert.rejects(promise,e=>e instanceof CompletedResponseFormatError&&e.diagnostic.reason==='completed'&&e.responseText===text);
  assert.equal(reads,1);
 }
});

test('unavailable history waits for the same receipt; cancellation never resubmits or guesses',async()=>{
 const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-receipt-wait-')),adapter=new CodexAdapter({observationIntervalMs:5}),controller=new AbortController();let reads=0;
 adapter.readStoredTurn=async()=>{reads++;if(reads===1)throw Error('Unavailable');if(reads===2)return stored('inProgress');return stored();};
 const result=await adapter.recoverOriginal({binding:await binding(),prompt,model,effort,outputSchema,cwd,signal:controller.signal});
 assert.equal(reads,3);assert.deepEqual(result.spec,{ok:true});
 adapter.readStoredTurn=async()=>{controller.abort();return stored('inProgress');};
 await assert.rejects(adapter.recoverOriginal({binding:await binding(),prompt,model,effort,outputSchema,cwd,signal:controller.signal}),/cancelled/);
});

test('late receipt after stop and failing progress callback cannot settle or crash an observer',async()=>{
 let complete,count=0;const watch=observePersistedCodexTurn({identity:ids,intervalMs:60000,read:()=>new Promise(r=>{complete=r;}),onTerminal:()=>count++,onProgress:()=>{},onUnavailable:()=>{throw Error('progress');}});
 const pending=watch.poll();watch.stop();complete(stored());await pending;assert.equal(count,0);
 const failed=observePersistedCodexTurn({identity:ids,intervalMs:60000,read:async()=>{throw Error('unavailable');},onUnavailable:()=>{throw Error('progress');}});
 try{await failed.poll();}finally{failed.stop();}
});

test('bound pending journal recovers after process loss without another reservation or provider call',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-journal-receipt-')),args={directory,requestHash:'request',runtimeHash:'runtime',policy:{assembly:{maximumCalls:26}}};
 const options={outputSchema,stageName:'plan',stageCount:26,images:[]};let calls=0,recoveries=0;
 let journal=await openAssemblyJournal(args);
 await assert.rejects(journal.invoke(prompt,1,options,async(p,i,o)=>{
  calls++;await o.onProviderBinding(await binding());throw Error('Simulated process loss after turn acknowledgement');
 }),/process loss/);
 const file=path.join(directory,'assembly-journal/call-1.json'),before=JSON.parse(await fs.readFile(file));assert.equal(before.value.state,'pending');
 journal=await openAssemblyJournal(args);
 const response=await journal.invoke(prompt,1,options,async()=>assert.fail('Provider may not be invoked again'),async(p,i,o,b)=>{
  recoveries++;assert.equal(b.turnId,ids.turnId);return {ok:true};
 });
 assert.deepEqual(response,{ok:true});assert.equal(calls,1);assert.equal(recoveries,1);assert.equal(journal.reserved,1);
 assert.deepEqual(await journal.invoke(prompt,1,options,async()=>assert.fail('Already received'),async()=>assert.fail('Already received')),{ok:true});
 const after=JSON.parse(await fs.readFile(file));assert.equal(after.value.reservedAt,before.value.reservedAt);assert.equal(after.value.state,'response');
 assert.equal(after.value.providerBinding.turnId,ids.turnId);
});

test('pending journal rejects changed inputs, binding reassignments, and receipts without acknowledged turn identity',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-journal-identity-')),args={directory,requestHash:'request',runtimeHash:'runtime',policy:{assembly:{maximumCalls:26}}};
 const options={outputSchema,stageName:'plan',stageCount:26};const journal=await openAssemblyJournal(args);
 await assert.rejects(journal.invoke(prompt,1,options,async(p,i,o)=>{
  const b=await binding();await o.onProviderBinding({...b,turnId:null});await o.onProviderBinding({...b,threadId:'foreign'});
 }),/rebound/);
 await assert.rejects(journal.invoke(prompt,1,options,async()=>assert.fail('No dispatch'),async()=>assert.fail('No recovery without turn id')),/receipt unknown/);
 await assert.rejects(journal.invoke('changed',1,options,async()=>assert.fail('No dispatch'),async()=>assert.fail('No foreign recovery')),/diverged/);
});
