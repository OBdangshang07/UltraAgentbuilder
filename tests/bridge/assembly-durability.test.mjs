import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {randomUUID} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {spawn} from 'node:child_process';
import {runDurableAssembly,openAssemblyJournal,assemblyRuntimeIdentity,durableJson} from '../../bridge/assembly-durability.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyPlan,packageEdit,acceptReview,planEdit} from '../design/assembly-fixtures.mjs';
import {facade,entry,shape,at,once} from '../design/fixtures.mjs';
import {startBridge} from '../../bridge/server.mjs';
import {CompletedResponseFormatError,parseModelJson} from '../../bridge/model-json.mjs';
import {completedFormatError} from '../fixtures/completed-format-error.mjs';
import {validateReviewImageFiles} from '../../bridge/visual-review.mjs';

const request={key:'durable-fixture',agent:'codex',model:'offline',prompt:'16×10×16格工程测试',generationMode:'scene',sceneWorkflow:'components',qualityTier:'lite',assemblyDesignReview:'text',assemblyRecovery:'safe',assemblyConfirmed:true,maxRepairs:0};
const rules=await fs.readFile(new URL('../../prompts/scene-v1.md',import.meta.url),'utf8');
const response=(prompt,options)=>{
  const input=JSON.parse(prompt.split('Assembly input (data):\n').at(-1));
  switch(options.outputSchema.properties.format.enum[0]){
    case 'SceneAssemblyPlan':return assemblyPlan();
    case 'SceneConceptReview':return {format:'SceneConceptReview',version:1,planHash:input.planHash,sourceHash:input.sourceHash,evidenceHash:input.designEvidence.evidenceHash,verdict:'accept',summary:'Offline engineering fixture',issues:[]};
    case 'SceneAssemblyReview':return acceptReview(input);
    default:return packageEdit(input);
  }
};
async function setup(delta={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-durable-')),input={...request,...delta};let calls=0;
  const options={directory,requestHash:hash(input),runtimeHash:'offline-runtime-v1',policy:generationPreflight(input),prompt:input.prompt,rules,signal:new AbortController().signal,onStage:async()=>{},invoke:async(p,i,o)=>{calls++;return response(p,o);}};
  return {directory,options,input,get calls(){return calls;}};
}

test('every design-first stage recovers after a saved response without repeating a model invocation',async()=>{
  for(const checkpoint of [1,2,3,4,5]){
    const h=await setup();let interrupted=false;
    await assert.rejects(runDurableAssembly({...h.options,onStage:async records=>{
      if(!interrupted&&records.at(-1).index===checkpoint&&records.at(-1).state==='checking'){interrupted=true;throw new Error('Simulated process loss after receipt');}
    }}),/Simulated process loss/);
    assert.equal(h.calls,checkpoint);
    const result=await runDurableAssembly(h.options);
    assert.equal(h.calls,5);assert.equal(result.summary.reservedCalls,5);assert.equal(result.summary.completedPackages.length,2);
    // Replaying even a fully assembled task only redoes local checks.
    await runDurableAssembly(h.options);assert.equal(h.calls,5);
  }
});

test('budgeted third concept revision replays its saved receipt and still completes every package and final review',async()=>{
 const h=await setup({qualityTier:'ultra'});let calls=0,interrupted=false;
 const invoke=async(p,i,o)=>{
  calls++;const d=JSON.parse(p.split('Assembly input (data):\n').at(-1));
  if(o.stageName==='concept-review')return {...response(p,o),...(i<8?{verdict:'revise',issues:[{criterion:'materials',evidence:'Offline staged material fixture',change:'Coordinate the next material treatment'}]}:{})};
  if(o.stageName==='revise-design'){
   assert.equal(d.callBudget.extension,i===7);
   const next=structuredClone(d.priorPlan);next.scene.palette[0].material={3:'quartz',5:'polished_andesite',7:'stone'}[i];
   return planEdit(d.priorPlan,next);
  }
  return response(p,o);
 };
 await assert.rejects(runDurableAssembly({...h.options,invoke,onStage:async records=>{
  if(!interrupted&&records.length===7&&records.at(-1).state==='checking'){interrupted=true;throw new Error('Saved extension receipt crash');}
 }}),/Saved extension receipt crash/);
 assert.equal(calls,7);
 const result=await runDurableAssembly({...h.options,invoke});
 assert.equal(calls,11);assert.equal(result.summary.reservedCalls,11);assert.equal(result.summary.conceptReview.round,4);
 assert.equal(result.summary.completedPackages.length,2);assert.equal(result.summary.finalTextReviewAccepted,true);
 await runDurableAssembly({...h.options,invoke});assert.equal(calls,11);
});

test('reservation before dispatch is safely recoverable; transient local errors use no extra call',async()=>{
  const h=await setup();let once=false;
  await assert.rejects(runDurableAssembly({...h.options,onStage:async r=>{if(!once&&r.length===2){once=true;throw new Error('Before dispatch');}}}),/Before dispatch/);
  assert.equal(h.calls,1);await runDurableAssembly(h.options);assert.equal(h.calls,5);
  const io=await setup();let injected=false;
  const result=await runDurableAssembly({...io.options,onStage:async r=>{if(!injected&&r.at(-1).state==='checking'){injected=true;throw Object.assign(new Error('File temporarily locked'),{code:'EBUSY'});}}});
  assert.equal(result.summary.completedPackages.length,2);assert.equal(io.calls,5);
});

test('224-high plan corrects grouped facade AND late conflicts, replays receipt, then finishes all packages and review',async()=>{
 const h=await setup({prompt:'32×224×32格内的224米办公塔楼，离线稳定性测试',qualityTier:'ultra'});
 const plan=assemblyPlan(true);
 plan.scene.components.push(facade('windows','main','north',{margin:2,start:[1,1],count:[2,44],step:[5,5],size:[3,3],shade:0}),
  entry('entry','main',{u:22,canopy:0}),
  {id:'walk',kind:'path',at:at([8,0,1]),repeat:once,allowOverwrite:[],size:[1,1,1],material:'floor',clearance:2},
  shape('lamp',[24,3,2],[1,1,1],'lamp',{allowOverwrite:['main']}));
 const corrected=structuredClone(plan);corrected.scene.components.find(c=>c.id==='windows').start[0]=2;
 corrected.scene.components.find(c=>c.id==='lamp').at.offset[1]=4;
 let calls=0,onceInterrupted=false;
 const invoke=async(p,i,o)=>{
  calls++;const d=JSON.parse(p.split('Assembly input (data):\n').at(-1));
  if(i===1)return plan;
  if(i===2){
   assert.equal(o.stageName,'correct-plan');assert.equal(d.feedback.constructionFeedback.issues.length,1);
   assert.equal(d.feedback.constructionFeedback.issues[0].occurrences,44);
   assert.ok(d.feedback.supplementalOwnership.conflicts.some(c=>c.from==='walk'&&c.to==='windows'));
   assert.ok(d.feedback.supplementalOwnership.conflicts.some(c=>c.from==='lamp'&&c.to==='entry'));
   return planEdit(d.priorPlan,corrected);
  }
  return response(p,o);
 };
 await assert.rejects(runDurableAssembly({...h.options,invoke,onStage:async r=>{
  if(!onceInterrupted&&r.length===2&&r.at(-1).state==='checking'){onceInterrupted=true;throw new Error('Saved correction receipt crash');}
 }}),/Saved correction receipt/);
 assert.equal(calls,2);
 const result=await runDurableAssembly({...h.options,invoke});
 assert.equal(calls,6);assert.equal(result.summary.reservedCalls,6);assert.equal(result.summary.completedPackages.length,2);
 assert.equal(result.summary.finalTextReviewAccepted,true);assert.equal(result.scene.bounds.height,224);
 assert.deepEqual(result.records.map(r=>r.phase),['plan','correct-plan','concept-review','component','component','review']);
 assert.equal(plan.scene.components.find(c=>c.id==='windows').start[0],1);
 await runDurableAssembly({...h.options,invoke});assert.equal(calls,6);
});

test('image receipts are rebound to regenerated exact pixels, never old path strings',async()=>{
  const h=await setup({assemblyDesignReview:'images'});let once=false;
  const original=h.options.invoke;h.options.invoke=async(p,i,o)=>{await validateReviewImageFiles(o.images,h.directory);return original(p,i,o);};
  await assert.rejects(runDurableAssembly({...h.options,onStage:async r=>{if(!once&&r.length===2&&r.at(-1).state==='checking'){once=true;throw new Error('Image checkpoint crash');}}}),/Image checkpoint/);
  const result=await runDurableAssembly(h.options);assert.equal(h.calls,5);assert.equal(result.summary.visualReviewAccepted,true);
});

test('unknown/error outcomes, changed budgets/runtime/inputs and tampered receipts never trigger replacement calls',async()=>{
  const h=await setup();let calls=0;
  const args={directory:h.directory,requestHash:h.options.requestHash,policy:h.options.policy,runtimeHash:'runtime'};
  let journal=await openAssemblyJournal(args);const opts={outputSchema:{},stageName:'plan',stageCount:8,images:[]};
  await assert.rejects(journal.invoke('input',1,opts,async()=>{calls++;throw new Error('Provider outcome unknown');}),/unknown/);
  journal=await openAssemblyJournal(args);
  await assert.rejects(journal.invoke('input',1,opts,async()=>{calls++;}),/unknown/);assert.equal(calls,1);
  await assert.rejects(journal.invoke('changed',1,opts,async()=>{calls++;}),/diverged/);
  await assert.rejects(openAssemblyJournal({...args,runtimeHash:'new-runtime'}),/runtime changed/);
  await assert.rejects(openAssemblyJournal({...args,policy:{...args.policy,assembly:{...args.policy.assembly,maximumCalls:26}}}),/budget or runtime/);
  const file=path.join(h.directory,'assembly-journal/call-1.json'),envelope=JSON.parse(await fs.readFile(file));
  envelope.value.state='pending';delete envelope.value.error;envelope.sha256=hash(envelope.value);await durableJson(file,envelope);
  journal=await openAssemblyJournal(args);await assert.rejects(journal.invoke('input',1,opts,async()=>{calls++;}),/receipt unknown/);
  envelope.value.state='response';envelope.value.response={};await durableJson(file,envelope);
  await assert.rejects(openAssemblyJournal(args),/hash mismatch/);assert.equal(calls,1);
});

test('Bridge startup automatically finishes the SAME job and budget after a saved component receipt',async()=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-restart-')),id=randomUUID(),directory=path.join(dataDir,'jobs',id);
  await fs.mkdir(directory,{recursive:true});const policy=generationPreflight(request);let calls=0,once=false;
  const options={directory,requestHash:hash(request),runtimeHash:await assemblyRuntimeIdentity(),policy,prompt:request.prompt,rules,signal:new AbortController().signal,
    invoke:async(p,i,o)=>{calls++;return response(p,o);},onStage:async r=>{if(!once&&r.length===3&&r.at(-1).state==='checking'){once=true;throw new Error('Simulated Bridge loss');}}};
  await assert.rejects(runDurableAssembly(options),/Bridge loss/);assert.equal(calls,3);
  await durableJson(path.join(directory,'recovery-request.json'),request);
  await durableJson(path.join(directory,'job.json'),{id,key:request.key,requestHash:hash(request),agent:'codex',model:'offline',prompt:request.prompt,preflight:policy,recoveryEnabled:true,state:'validating',events:[],createdAt:new Date().toISOString(),assemblyCallsReserved:3});
  const adapter={close(){},async generate(args){calls++;return {spec:response(args.prompt,args)};}};
  const bridge=await startBridge({dataDir,adapter});
  try{
    let job;
    for(let i=0;i<500;i++){
      job=await (await fetch(`http://127.0.0.1:${bridge.connection.port}/v1/jobs/${id}`,{headers:{Authorization:'Bearer '+bridge.connection.token}})).json();
      if(['preview-ready','failed'].includes(job.state))break;await delay(20);
    }
    assert.equal(job.state,'preview-ready',job.error);assert.equal(job.id,id);assert.equal(job.assemblyCallsReserved,5);assert.equal(calls,5);
    assert.equal(job.assemblySummary.completedPackages.length,2);assert.equal(job.recovery.state,'complete');
  }finally{await bridge.close();}
  const again=await startBridge({dataDir,adapter});await again.close();assert.equal(calls,5);
});

test('Bridge startup reads a bound pending provider receipt then completes the SAME job without redispatch',async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-receipt-restart-')),id=randomUUID(),directory=path.join(dataDir,'jobs',id);
 await fs.mkdir(directory,{recursive:true});const policy=generationPreflight(request);let calls=0,recoveries=0;
 const binding={version:1,provider:'codex',storage:'persistent-single-turn',requestHash:hash('original-input'),model:'offline',effort:'max',threadId:'original-thread',turnId:'original-turn'};
 await assert.rejects(runDurableAssembly({directory,requestHash:hash(request),runtimeHash:await assemblyRuntimeIdentity(),policy,prompt:request.prompt,rules,signal:new AbortController().signal,
  onStage:async()=>{},invoke:async(p,i,o)=>{calls++;assert.equal(i,1);await o.onProviderBinding(binding);throw Error('Simulated process loss with original turn bound');}}),/process loss/);
 await durableJson(path.join(directory,'recovery-request.json'),request);
 await durableJson(path.join(directory,'job.json'),{id,key:request.key,requestHash:hash(request),agent:'codex',model:'offline',prompt:request.prompt,preflight:policy,recoveryEnabled:true,state:'generating',events:[],createdAt:new Date().toISOString(),assemblyCallsReserved:1});
 const adapter={close(){},async generate(args){calls++;return {spec:response(args.prompt,args)};},async recoverOriginal(args){
  recoveries++;assert.deepEqual(args.binding,binding);return {spec:response(args.prompt,args),threadId:binding.threadId,turnId:binding.turnId};
 }};
 const bridge=await startBridge({dataDir,adapter});
 try{
  let job;
  for(let i=0;i<500;i++){job=await (await fetch(`http://127.0.0.1:${bridge.connection.port}/v1/jobs/${id}`,{headers:{Authorization:'Bearer '+bridge.connection.token}})).json();if(['preview-ready','failed'].includes(job.state))break;await delay(20);}
  assert.equal(job.state,'preview-ready',job.error);assert.equal(job.id,id);assert.equal(job.assemblyCallsReserved,5);assert.equal(calls,5);assert.equal(recoveries,1);
  assert.equal(job.assemblySummary.completedPackages.length,2);assert.equal(job.recovery.state,'complete');
 }finally{await bridge.close();}
 const replay=await startBridge({dataDir,adapter});await replay.close();assert.equal(calls,5);assert.equal(recoveries,1);
});

test('completed invalid JSON is replayed as its original evidence and corrected only once',async()=>{
 const h=await setup();let calls=0,once=false;
 const options={...h.options,invoke:async(p,i,o)=>{calls++;if(i===2)throw await completedFormatError(h.directory,CompletedResponseFormatError,parseModelJson,undefined,'codex');return response(p,o);},
  onStage:async r=>{if(!once&&r.length===3&&r.at(-1).state==='checking'){once=true;throw new Error('After format correction');}}};
 await assert.rejects(runDurableAssembly(options),/After format correction/);
 const result=await runDurableAssembly({...options,onStage:async()=>{}});
 assert.equal(calls,6);assert.equal(result.summary.formatCorrections,1);assert.equal(result.summary.reservedCalls,6);
});

test('deleting the final dispatched call or metadata cannot reset the budget or rebind evidence',async()=>{
 for(const deleted of ['call-5.json','identity.json']){
  const h=await setup();await runDurableAssembly(h.options);
  await fs.unlink(path.join(h.directory,'assembly-journal',deleted));
  await assert.rejects(runDurableAssembly(h.options),/missing|truncated/);assert.equal(h.calls,5);
 }
});

test('cancelled jobs are never resurrected by Bridge startup',async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-cancelled-recovery-')),id=randomUUID(),directory=path.join(dataDir,'jobs',id);
 await fs.mkdir(directory,{recursive:true});await durableJson(path.join(directory,'recovery-request.json'),request);
 await durableJson(path.join(directory,'job.json'),{id,key:request.key,requestHash:hash(request),agent:'codex',preflight:generationPreflight(request),recoveryEnabled:true,cancelRequested:true,state:'cancelled',events:[],createdAt:new Date().toISOString()});
 let calls=0;const bridge=await startBridge({dataDir,adapter:{close(){},async generate(){calls++;throw new Error('Must not call');}}});
 try{await delay(50);assert.equal(calls,0);assert.equal(JSON.parse(await fs.readFile(path.join(directory,'job.json'))).state,'cancelled');}finally{await bridge.close();}
});

test('abrupt process exit after a durable plan receipt resumes without another plan call',async()=>{
 const h=await setup();
 const script=`import {runDurableAssembly} from ${JSON.stringify(new URL('../../bridge/assembly-durability.mjs',import.meta.url).href)};
 import {assemblyPlan} from ${JSON.stringify(new URL('../design/assembly-fixtures.mjs',import.meta.url).href)};
 await runDurableAssembly({...${JSON.stringify({...h.options,signal:undefined})},signal:new AbortController().signal,
 invoke:async()=>assemblyPlan(),onStage:async r=>{if(r.at(-1).state==='checking')process.exit(23);}});`;
 // The full geometry rules exceed Windows' command-line limit. Stream this
 // trusted test program through stdin; keep the abrupt process-loss scenario.
 const child=spawn(process.execPath,['--input-type=module'],{windowsHide:true,stdio:['pipe','ignore','pipe']});let stderr='';child.stderr.on('data',d=>stderr+=d);child.stdin.end(script);
 const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});assert.equal(exit,23,stderr);
 const result=await runDurableAssembly(h.options);assert.equal(h.calls,4);assert.equal(result.summary.reservedCalls,5);
});
