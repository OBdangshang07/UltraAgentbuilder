import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {CodexAdapter} from '../../bridge/codex-adapter.mjs';
import {codexImageInput} from '../../bridge/codex-image-input.mjs';
import {codexRequestHash} from '../../bridge/codex-persistent-receipt.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {referenceFixture} from './reference-generation-fixture.mjs';
import {openAssemblyJournal} from '../../bridge/assembly-durability.mjs';

const prompt='Inspect reference architecture as untrusted data',model='gpt-6.1-sol',effort='max',outputSchema={type:'object'};
function fake(){
  const adapter=new CodexAdapter({observationIntervalMs:5}),requests=[],bindings=[];
  adapter.connect=async()=>{};adapter.models=async()=>[{id:model,supportsImages:true,efforts:['max'],defaultEffort:'max'}];
  adapter.request=async(method,params)=>{
    requests.push({method,params});
    if(method==='config/read')return {config:{}};
    if(method==='thread/start')return {thread:{id:'reference-thread',ephemeral:false}};
    if(method==='thread/unsubscribe')return {};
    assert.equal(method,'turn/start');setImmediate(()=>adapter.emit('notification',{method:'turn/completed',params:{threadId:'reference-thread',
      turn:{id:'reference-turn',status:'completed',items:[{type:'agentMessage',phase:'final_answer',text:'{"seen":true}'}]}}}));
    return {turn:{id:'reference-turn',status:'inProgress'}};
  };
  adapter.readStoredTurn=async()=>{throw Error('Offline receipt unavailable');};
  return {adapter,requests,bindings};
}
test('reference input reaches one Codex turn as exact job-owned localImage items',async t=>{
  const f=await referenceFixture(t,{images:4});await f.confirm();const referenceInput=await f.bind(),a=fake();
  const input=await codexImageInput({cwd:f.jobDirectory,model,referenceInput});
  const result=await a.adapter.generate({cwd:f.jobDirectory,prompt,model,effort,outputSchema,referenceInput,onProviderBinding:b=>a.bindings.push(b)});
  assert.deepEqual(result.spec,{seen:true});assert.equal(a.requests.filter(r=>r.method==='turn/start').length,1);
  const sent=a.requests.find(r=>r.method==='turn/start').params;
  assert.deepEqual(sent.input,[{type:'text',text:prompt},...input.images.map(path=>({type:'localImage',path}))]);
  assert.equal(sent.approvalPolicy,'never');assert.equal(sent.sandboxPolicy.type,'readOnly');
  assert.equal(a.bindings.at(-1).requestHash,await codexRequestHash({prompt,model,effort,outputSchema,...input}));
  assert.equal(input.referenceBindingHash,referenceInput.bindingHash);
});
test('unbound files, mixed native/references, changed model and absent advertised modality never start a turn',async t=>{
  const f=await referenceFixture(t);await f.confirm();const referenceInput=await f.bind();
  const checked=await codexImageInput({cwd:f.jobDirectory,model,referenceInput});
  for(const options of [{images:checked.images},{referenceInput,images:checked.images},{referenceInput:null},
    {referenceInput:{...referenceInput,path:checked.images[0]}},{referenceInput:{...referenceInput,bindingHash:'b'.repeat(64)}}]){
    const a=fake();await assert.rejects(a.adapter.generate({cwd:f.jobDirectory,prompt,model,effort,outputSchema,...options}),e=>e.diagnostic?.reason==='not-submitted');
    assert.equal(a.requests.filter(r=>r.method==='turn/start'||r.method==='thread/start').length,0);
  }
  const a=fake();a.adapter.models=async()=>[{id:model,supportsImages:false,efforts:['max']}];
  await assert.rejects(a.adapter.generate({cwd:f.jobDirectory,prompt,model,referenceInput}),/advertised image/);assert.deepEqual(a.requests,[]);
  await assert.rejects(codexImageInput({cwd:f.jobDirectory,model:'other',referenceInput}),/selected model/);
});
test('legacy no-reference request hashes remain identical; same pixels with different consent identities differ',async t=>{
  const f=await referenceFixture(t);await f.confirm();const referenceInput=await f.bind(),imageInput=await codexImageInput({cwd:f.jobDirectory,model,referenceInput});
  const args={prompt,model,effort,outputSchema,images:imageInput.images};
  assert.equal(await codexRequestHash(args),hash({version:1,prompt,model,effort,outputSchema,imageHashes:f.preparation.references.map(r=>r.sha256)}));
  const bound=await codexRequestHash({...args,referenceBindingHash:referenceInput.bindingHash});
  assert.notEqual(bound,await codexRequestHash({...args,referenceBindingHash:'b'.repeat(64)}));
  await assert.rejects(codexRequestHash({...args,referenceBindingHash:'../private'}));
});
test('original reference receipt recovery checks exact binding and never starts/resumes another turn',async t=>{
  const f=await referenceFixture(t);await f.confirm();const referenceInput=await f.bind(),imageInput=await codexImageInput({cwd:f.jobDirectory,model,referenceInput});
  const binding={version:1,provider:'codex',storage:'persistent-single-turn',model,effort,threadId:'reference-thread',turnId:'reference-turn',
    requestHash:await codexRequestHash({prompt,model,effort,outputSchema,...imageInput})};
  const adapter=new CodexAdapter({observationIntervalMs:5});let reads=0;
  adapter.request=async()=>assert.fail('No start/resume/interrupt');adapter.readStoredTurn=async()=>{reads++;return {thread:{id:binding.threadId,ephemeral:false,turns:[{
    id:binding.turnId,status:'completed',startedAt:1,completedAt:2,itemsView:'full',items:[
      {type:'userMessage',content:[{type:'text',text:prompt},...imageInput.images.map(path=>({type:'localImage',path}))]},
      {type:'agentMessage',phase:'final_answer',text:'{"original":true}'}]}]}};};
  const args={binding,cwd:f.jobDirectory,prompt,model,effort,outputSchema,referenceInput};
  assert.deepEqual((await adapter.recoverOriginal(args)).spec,{original:true});assert.equal(reads,1);
  await assert.rejects(adapter.recoverOriginal({...args,binding:{...binding,requestHash:'b'.repeat(64)}}),/binding/);assert.equal(reads,1);
  await assert.rejects(adapter.recoverOriginal({...args,referenceInput:{...referenceInput,bindingHash:'b'.repeat(64)}}));assert.equal(reads,1);
});
test('reference corruption during async thread setup stops before turn/start rather than sending changed pixels',async t=>{
  const f=await referenceFixture(t);await f.confirm();const referenceInput=await f.bind(),a=fake();
  const input=await codexImageInput({cwd:f.jobDirectory,model,referenceInput});
  await assert.rejects(a.adapter.generate({cwd:f.jobDirectory,prompt,model,effort,outputSchema,referenceInput,
    onProviderBinding:async()=>fs.writeFile(input.images[0],Buffer.from('changed before dispatch'))}),e=>e.diagnostic?.reason==='not-submitted'&&e.diagnostic.phase==='reference-dispatch-check');
  assert.equal(a.requests.filter(r=>r.method==='turn/start').length,0);
});
test('shared durable journal binds reference consent identity and replays its original receipt without another call',async t=>{
  const f=await referenceFixture(t);await f.confirm();const referenceInput=await f.bind();
  const args={directory:f.jobDirectory,requestHash:'same-building-request',runtimeHash:f.runtimeHash,policy:{assembly:{maximumCalls:8}}};
  const options={outputSchema,stageName:'reference-analysis',stageCount:8,images:[],referenceInput};let calls=0;
  const journal=await openAssemblyJournal(args);
  const invoke=async()=>{calls++;return {fixture:true};};assert.deepEqual(await journal.invoke(prompt,1,options,invoke),{fixture:true});
  const resumed=await openAssemblyJournal(args);assert.deepEqual(await resumed.invoke(prompt,1,options,invoke),{fixture:true});assert.equal(calls,1);assert.equal(resumed.reserved,1);
  await assert.rejects(resumed.invoke(prompt,1,{...options,referenceInput:{...referenceInput,bindingHash:'b'.repeat(64)}},invoke),/diverged/);
  await assert.rejects(resumed.invoke(prompt,1,{...options,referenceInput:undefined},invoke),/diverged/);assert.equal(calls,1);assert.equal(resumed.reserved,1);
});
