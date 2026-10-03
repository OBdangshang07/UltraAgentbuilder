import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {runSceneAssembly} from '../../bridge/scene-assembly.mjs';
import {prepareAssemblyResume} from '../../bridge/scene-assembly-resume.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {readNativeBundle} from '../../src/generation/bundle.mjs';
import {assemblyPlan,packageEdit,acceptReview} from '../design/assembly-fixtures.mjs';
const rules=await fs.readFile(new URL('../../prompts/scene-v1.md',import.meta.url),'utf8');
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const write=(file,value)=>fs.writeFile(file,JSON.stringify(value));
const input={agent:'deepseek',model:'offline',effort:'max',prompt:'16×10×16格边界，原创公共建筑，完整内饰与通路',generationMode:'scene',sceneWorkflow:'components',qualityTier:'ultra',assemblyConfirmed:true,maxRepairs:0};
async function interruptedSource(maximumCalls=26,makePlan=assemblyPlan){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-resume-source-')),policy=generationPreflight({...input,assemblyCalls:maximumCalls});
 const job={id:randomUUID(),state:'generating',prompt:input.prompt,model:input.model,effort:input.effort,preflight:policy,assemblyStages:[],assemblyCallsReserved:0};
 await write(path.join(directory,'job.json'),job);
 const common={directory,prompt:input.prompt,rules,policy,signal:new AbortController().signal,onStage:async records=>{job.assemblyStages=records;job.assemblyCallsReserved=records.length;await write(path.join(directory,'job.json'),job);}};
 await assert.rejects(runSceneAssembly({...common,invoke:async(prompt,index)=>{
  if(index===4)throw new Error('Offline simulated TRANSPORT; no paid calls');
  const data=JSON.parse(prompt.split('Assembly input (data):\n').at(-1));
  if(index===1)return makePlan();const edit=packageEdit(data);if(index===3)edit.components.put[0].at.offset=[14,1,14];return edit;
 }}),/TRANSPORT/);
 job.state='failed';await write(path.join(directory,'job.json'),job);
 const assetHash=(await read(path.join(directory,'assembly/2/diagnostic/manifest.json'))).assetHash;
 return {directory,job,policy,resume:{sourceDirectory:directory,jobHash:hash(job),assetHash}};
}

test('explicit resume skips accepted packages, counts unknown calls, and uses saved geometry without publishing it',async()=>{
 const source=await interruptedSource(),originalJob=await fs.readFile(path.join(source.directory,'job.json'));
 // Emulate an older v1 job: auxiliary planning evidence was not yet emitted.
 await fs.unlink(path.join(source.directory,'assembly/freeze-advisory.json'));
 const prepared=await prepareAssemblyResume(source.resume,source.policy);
 assert.deepEqual(prepared.completed,['exterior']);assert.equal(prepared.records.length,4);assert.equal(prepared.correctionsUsed,1);assert.equal(prepared.baselineStage,2);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-resume-child-')),calls=[];let records;
 const result=await runSceneAssembly({directory,prompt:input.prompt,rules,policy:source.policy,resume:source.resume,signal:new AbortController().signal,onStage:async r=>{records=r;},invoke:async(prompt,index,options)=>{
  calls.push({index,phase:options.stageName});assert.equal(records.at(-1).state,'reserved');assert.equal(records.length,index);
  const data=JSON.parse(prompt.split('Assembly input (data):\n').at(-1));
  if(index===5){assert.equal(data.task.id,'interior');assert.deepEqual(data.completedPackages,['exterior']);assert.equal(data.sourceHash,prepared.provenance.sourceHash);assert.match(data.critique.feedback.error,/outside approved regions/);assert.equal(data.capacity.assembly.pendingPackages.length,1);assert.equal(data.assemblyAdvisory.canAuthorizePlacement,false);return packageEdit(data);}
  assert.equal(index,6);return acceptReview(data);
 }});
 assert.deepEqual(calls,[{index:5,phase:'correct-component'},{index:6,phase:'review'}]);assert.equal(result.summary.reservedCalls,6);assert.deepEqual(result.summary.completedPackages,['exterior','interior']);assert.equal(result.records[3].invocationOutcome,'unknown');assert.equal(result.summary.resumedFrom.priorCalls,4);
 assert.deepEqual(await fs.readFile(path.join(source.directory,'job.json')),originalJob);
 const proof=await read(path.join(directory,'assembly/resume.json'));for(const file of proof.files)assert.equal(hash(await fs.readFile(path.join(directory,file.path))),file.sha256);
 await assert.rejects(readNativeBundle(path.join(directory,'assembly/2/diagnostic')),/Diagnostic-only/);
});

test('a new transport failure does not replay itself or reset the inherited correction allowance',async()=>{
 const source=await interruptedSource(),directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-resume-stop-'));let calls=0,records;
 await assert.rejects(runSceneAssembly({directory,prompt:input.prompt,rules,policy:source.policy,resume:source.resume,signal:new AbortController().signal,onStage:async r=>{records=r;},invoke:async()=>{calls++;throw new Error('Offline TRANSPORT again');}}),/TRANSPORT again/);
 assert.equal(calls,1);assert.equal(records.length,5);assert.equal(records.at(-1).state,'failed');assert.equal(records[3].state,'failed');
 const job={...source.job,id:randomUUID(),assemblyStages:records,assemblyCallsReserved:5};await write(path.join(directory,'job.json'),job);
 await assert.rejects(prepareAssemblyResume({sourceDirectory:directory,jobHash:hash(job),assetHash:source.resume.assetHash},source.policy),/nonterminal unknown stage|correction budget exhausted/);
});

test('resume rejects tampered provenance, mutable policy, unfinished sources and insufficient remaining budget',async()=>{
 const source=await interruptedSource();
 await assert.rejects(prepareAssemblyResume({...source.resume,jobHash:'0'.repeat(64)},source.policy),/source job changed/);
 await assert.rejects(prepareAssemblyResume({...source.resume,assetHash:'0'.repeat(64)},source.policy),/last accepted asset changed/);
 await assert.rejects(prepareAssemblyResume(source.resume,{...source.policy,maximumCalls:99}),/policy\/budget/);
 const live={...source.job,state:'generating'};await write(path.join(source.directory,'job.json'),live);
 await assert.rejects(prepareAssemblyResume({...source.resume,jobHash:hash(live)},source.policy),/not an unfinished component/);
 await write(path.join(source.directory,'job.json'),source.job);
 const file=path.join(source.directory,'assembly/2/diagnostic/cells.bin'),bytes=await fs.readFile(file);bytes[0]^=1;await fs.writeFile(file,bytes);
 await assert.rejects(prepareAssemblyResume(source.resume,source.policy),/geometry\/provenance/);
 const small=await interruptedSource(5);await assert.rejects(prepareAssemblyResume(small.resume,small.policy),/insufficient remaining calls/);
});

test('resume refuses a changed brief and cancellation before any model invocation',async()=>{
 const source=await interruptedSource(),directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-resume-cancel-'));let calls=0;
 const common={directory,rules,policy:source.policy,resume:source.resume,onStage:async()=>{},invoke:async()=>{calls++;}};
 await assert.rejects(runSceneAssembly({...common,prompt:'different building',signal:new AbortController().signal}),/cannot change the original brief/);
 const abort=new AbortController();abort.abort();await assert.rejects(runSceneAssembly({...common,prompt:input.prompt,signal:abort.signal}));assert.equal(calls,0);
});

test('completed answer requalification uses no generation call, preserves original outcome and inherits unknown history',async()=>{
 const source=await interruptedSource(),directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-resume-ancestor-'));let records;
 await assert.rejects(runSceneAssembly({directory,prompt:input.prompt,rules,policy:source.policy,resume:source.resume,signal:new AbortController().signal,onStage:async r=>{records=r;},invoke:async()=>{throw new Error('offline stop');}}),/offline stop/);
 const proof=await read(path.join(directory,'assembly/resume.json')),draft=await read(path.join(directory,'assembly/5/input.json'));
 const response=packageEdit(draft);await write(path.join(directory,'assembly/5/response.json'),response);
 Object.assign(records.at(-1),{responseReceived:true,invocationOutcome:'response-received',error:'legacy merge error'});
 const parent={...source.job,id:randomUUID(),assemblyStages:records,assemblyCallsReserved:5,resumedFrom:proof};await write(path.join(directory,'job.json'),parent);
 const resume={sourceDirectory:directory,jobHash:hash(parent),assetHash:source.resume.assetHash,replayResponseHash:hash(response)},target=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-completed-replay-'));let calls=0;
 const result=await runSceneAssembly({directory:target,prompt:input.prompt,rules,policy:source.policy,resume,signal:new AbortController().signal,onStage:async()=>{},invoke:async(prompt,index,options)=>{calls++;assert.equal(index,6);assert.equal(options.stageName,'review');return acceptReview(JSON.parse(prompt.split('Assembly input (data):\n').at(-1)));}});
 assert.equal(calls,1);assert.equal(result.records[3].invocationOutcome,'unknown');assert.equal(result.records[4].state,'accepted');assert.equal(result.records[4].engineeringReplay.originalState,'failed');assert.equal(result.records[4].engineeringReplay.additionalModelCalls,0);assert.equal(hash(await read(path.join(directory,'job.json'))),hash(parent));assert.equal((await read(path.join(target,'assembly/5/engineering-replay.json'))).responseHash,hash(response));
 assert.ok((await fs.readdir(path.join(target,'assembly/resume-history'))).length);
 await assert.rejects(prepareAssemblyResume({...resume,replayResponseHash:'0'.repeat(64)},source.policy),/completed response changed/);
});

test('free engineering replay cannot consume a later package reserve or reset spent corrections',async()=>{
 const source=await interruptedSource(26,()=>{
  const p=assemblyPlan(),sample=packageEdit({previousDraft:p.scene,task:p.packages[0]}).components.put[0];
  p.packages.push({id:'landscape',name:'Landscape',purpose:'Offline remaining package',dependsOn:['interior'],regions:[{origin:[13,1,8],size:[1,2,1]}],editableComponents:[],interfaces:[]});
  for(let i=0;p.scene.components.length<253;i++)p.scene.components.push({...structuredClone(sample),id:'fill'+i,size:[1,1,1],at:{relativeTo:null,anchor:'min',offset:[3+i%10,5+Math.floor(i/100),3+Math.floor(i/10)%10]}});
  return p;
 });
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-reserve-parent-'));let records;
 await assert.rejects(runSceneAssembly({directory,prompt:input.prompt,rules,policy:source.policy,resume:source.resume,signal:new AbortController().signal,onStage:async r=>{records=r;},invoke:async()=>{throw new Error('offline reserve stop');}}),/offline reserve stop/);
 const proof=await read(path.join(directory,'assembly/resume.json')),draft=await read(path.join(directory,'assembly/5/input.json'));
 const response=packageEdit(draft);response.components.put.push({...structuredClone(response.components.put[0]),id:'interior__extra',size:[1,1,1],at:{relativeTo:null,anchor:'min',offset:[10,1,8]}});
 await write(path.join(directory,'assembly/5/response.json'),response);
 Object.assign(records.at(-1),{responseReceived:true,invocationOutcome:'response-received',error:'legacy uninspected answer'});
 const parent={...source.job,id:randomUUID(),assemblyStages:records,assemblyCallsReserved:5,resumedFrom:proof};await write(path.join(directory,'job.json'),parent);
 const target=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-reserve-replay-'));let calls=0,replayed;
 await assert.rejects(runSceneAssembly({directory:target,prompt:input.prompt,rules,policy:source.policy,
  resume:{sourceDirectory:directory,jobHash:hash(parent),assetHash:source.resume.assetHash,replayResponseHash:hash(response)},
  signal:new AbortController().signal,onStage:async r=>{replayed=r;},invoke:async()=>{calls++;throw new Error('must not invoke');}}),/correction budget exhausted/);
 assert.equal(calls,0);assert.equal(replayed.length,5);assert.equal(replayed[3].invocationOutcome,'unknown');
 assert.equal(replayed[4].state,'rejected');assert.equal(replayed[4].engineeringReplay.additionalModelCalls,0);
 const result=await read(path.join(target,'assembly/5/result.json'));assert.equal(result.feedback.reserveCheck.remainingAfter,0);assert.equal(result.feedback.reserveCheck.reservedForPendingConstruction,1);
 assert.equal(hash(await read(path.join(directory,'job.json'))),hash(parent));
});
