import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {privateAssemblyError,persistAssemblyTerminalFailure,REFERENCE_ASSEMBLY_TERMINAL_FAILURE_FILE} from '../../bridge/reference-world-assembly-terminal-failure.mjs';
import {hash} from '../../src/generation/compiler.mjs';

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-terminal-diagnostic-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const id='00000000-0000-0000-0000-000000000001',directory=path.join(root,'reference-world-assembly-jobs',id);
  await fs.mkdir(directory,{recursive:true});
  const binding={id,requestHash:'1'.repeat(64),preparationHash:'2'.repeat(64),runtimeHash:'3'.repeat(64),maximumCalls:26,reservedCalls:23,stageEventsObserved:30};
  const input={directory,binding,phase:'candidate-publication',state:'failed-needs-original-inspection',error:Error('Synthetic local failure, not a provider receipt')};
  return {root,directory,binding,input,file:path.join(directory,REFERENCE_ASSEMBLY_TERMINAL_FAILURE_FILE)};
}

test('private original error/cause and exact phase persist once without granting authority',async t=>{
  const f=await fixture(t),cause=Object.assign(Error('synthetic internal cause'),{code:'EIO'});
  f.input.error=Error('synthetic original failure',{cause});
  const saved=await persistAssemblyTerminalFailure(f.input);assert.deepEqual(saved,{saved:true,diagnosticOnly:true,allowsNewModelCall:false});
  const first=await fs.readFile(f.file),envelope=JSON.parse(first),v=envelope.value;
  assert.equal(envelope.sha256,hash(v));assert.equal(v.id,f.binding.id);assert.equal(v.phase,'candidate-publication');
  assert.equal(v.error.message.text,'synthetic original failure');assert.equal(v.error.cause.message.text,'synthetic internal cause');assert.equal(v.error.cause.code.text,'EIO');
  assert.equal(v.providerOutcome,'not-established-by-local-error');
  for(const key of ['allowsNewModelCall','originalOutcomeRewritten','canAuthorizePlacement'])assert.equal(v[key],false);
  assert.equal(v.worldWrites,0);await assert.rejects(persistAssemblyTerminalFailure(f.input),{code:'EEXIST'});
  assert.deepEqual(await fs.readFile(f.file),first);
});

test('error getters, custom serialization and arbitrary model fields are not read',()=>{
  let invoked=0;const e={message:'own original',privateModelResponse:'not copied',toJSON(){invoked++;throw Error('not allowed');}};
  for(const key of ['stack','cause','name','code'])Object.defineProperty(e,key,{get(){invoked++;throw Error('not allowed');}});
  const value=privateAssemblyError(e);assert.equal(invoked,0);assert.equal(value.message.text,'own original');
  assert.equal(value.stack,null);assert.equal(value.name,null);assert.equal(value.code,null);assert.equal(Object.hasOwn(value,'cause'),false);
  assert.equal(JSON.stringify(value).includes('not copied'),false);
});

test('huge messages, multibyte text, thrown primitives and cyclic/deep causes are bounded and explicitly marked',()=>{
  const e={message:'界'.repeat(100000),stack:'x'.repeat(100000)};e.cause=e;
  const value=privateAssemblyError(e);assert.equal(value.message.truncated,true);assert.equal(value.stack.truncated,true);assert.equal(value.cause.kind,'cause-cycle');
  assert.ok(Buffer.byteLength(value.message.text)<=8195);assert.ok(JSON.stringify(value).length<20000);
  assert.equal(privateAssemblyError('thrown literal').value.text,'thrown literal');assert.equal(privateAssemblyError(null).kind,'non-error-thrown');
  let nested=Error('leaf');for(let i=0;i<10;i++)nested=Error('outer',{cause:nested});
  let result=privateAssemblyError(nested);for(let i=0;i<6;i++)result=result.cause;assert.equal(result.kind,'cause-depth-limit');
});

test('invalid phase, bindings, paths and quota claims cannot create a diagnostic',async t=>{
  const f=await fixture(t);
  for(const changed of [{phase:'provider-closed'},{state:'preview-ready'},{directory:f.directory+'/..'},
    {binding:{...f.binding,id:'bad'}},{binding:{...f.binding,reservedCalls:27}},{binding:{...f.binding,maximumCalls:100}},
    {binding:{...f.binding,runtimeHash:'not-a-digest'}},{binding:{...f.binding,authority:true}}])
    await assert.rejects(persistAssemblyTerminalFailure({...f.input,...changed}));
  await assert.rejects(fs.stat(f.file),{code:'ENOENT'});
});

test('preexisting partial record and hard-linked file are preserved without any overwrite',async t=>{
  const f=await fixture(t),original=Buffer.from('partial original record');
  await fs.writeFile(f.file,original);await assert.rejects(persistAssemblyTerminalFailure(f.input),{code:'EEXIST'});assert.deepEqual(await fs.readFile(f.file),original);
  const second=path.join(f.directory,'linked-original');await fs.link(f.file,second);
  await assert.rejects(persistAssemblyTerminalFailure(f.input),{code:'EEXIST'});assert.deepEqual(await fs.readFile(second),original);
});
