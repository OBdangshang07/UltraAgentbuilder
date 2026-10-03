import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {startBridge} from '../../bridge/server.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {encodeReferencePixels} from '../../bridge/reference-pixels.mjs';
import {readJobReferenceInput} from '../../bridge/reference-generation-binding.mjs';
import {referenceGenerationOperation} from '../../bridge/reference-generation-worker.mjs';
import {auditAssemblyReferenceAnalysis} from '../../bridge/assembly-reference-analysis.mjs';
import {assemblyRuntimeIdentity} from '../../bridge/assembly-durability.mjs';
import {assemblyPlan,packageEdit,acceptReview} from '../design/assembly-fixtures.mjs';
import {referenceBrief,freeConsent,sendConsent} from './reference-generation-fixture.mjs';

async function fixture(t,{enabled=true,version=2}={}){
  const dataDir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reference-send-api-')));
  let service,supportsImages=true,handler=null,modelHook=null;const calls=[],recoveries=[];
  const answer=async options=>{
    const input=JSON.parse(options.prompt.split('Assembly input (data):\n').at(-1)),format=options.outputSchema.properties.format.enum[0];
    if(format==='ArchitectureReferenceBrief'){
      assert.ok(options.referenceInput);assert.deepEqual(options.images,[]);
      const reference=await readJobReferenceInput({directory:options.cwd,input:options.referenceInput,model:options.model,runtimeHash:await assemblyRuntimeIdentity()});
      return {spec:referenceBrief(reference)};
    }
    assert.equal(options.referenceInput,undefined);assert.ok(input.referenceArchitecture);
    return {spec:format==='SceneAssemblyPlan'?assemblyPlan():format==='SceneAssemblyReview'?acceptReview(input):packageEdit(input)};
  };
  const adapter={close(){},async models(){await modelHook?.();return [{id:'gpt-6.1-sol',supportsImages}];},
    async generate(o){calls.push(o);return handler?handler(o):answer(o);},
    async recoverOriginal(o){recoveries.push(o);return answer(o);}};
  const open=async({sending=enabled}={})=>{service=await startBridge({dataDir,adapter,claudeAdapter:adapter,deepseekAdapter:adapter,referenceGenerationSending:sending});};
  await open();t.after(async()=>{await service.close();await fs.rm(dataDir,{recursive:true,force:true});});
  const fetcher=(route,input,extra={})=>fetch('http://127.0.0.1:'+service.connection.port+route,{method:input===undefined?'GET':'POST',
    headers:{Authorization:'Bearer '+service.connection.token,'Content-Type':'application/json'},body:input===undefined?undefined:JSON.stringify(input),...extra});
  const json=async(route,input,extra)=>{const r=await fetcher(route,input,extra);return {status:r.status,value:await r.json()};};
  const ownerId=randomUUID(),prefix='/v1/reference-drafts/'+ownerId;
  const input={format:'ReferenceGenerationPreparationRequest',version,
    generation:{key:ownerId,prompt:'设计一座有层次的办公入口建筑，保留参考依据与未知区域',agent:'codex',model:'gpt-6.1-sol',effort:'max',
      generationMode:'scene',sceneWorkflow:'components',qualityTier:'lite',assemblyConfirmed:true,assemblyRecovery:'safe'},
    upload:{format:'UserReferenceUpload',version:1,mode:'multi-view',references:['front','side'].map((view,i)=>({
      png:encodeReferencePixels(2,1,Buffer.from([i+1,20,30,255,40,50,60,255])).toString('base64'),
      annotation:{purpose:'exterior',view,caption:'离线传输夹具，不是真实建筑图片'}}))}};
  const prepared=await json(prefix+'/prepare',input);assert.equal(prepared.status,200,prepared.value.error);const p=prepared.value;
  const submission={format:'ReferenceGenerationJobRequest',version:1,ownerId,preparationHash:p.preparationHash,sendConfirmation:sendConsent(p)};
  const confirm=()=>json(prefix+'/preparations/'+p.preparationHash+'/confirm',freeConsent(p));
  const send=(request=submission)=>json('/v1/reference-generation-jobs',request);
  const wait=async(id)=>{for(let i=0;i<200;i++){const result=(await json('/v1/jobs/'+id)).value;if(['preview-ready','failed','cancelled','interrupted'].includes(result.state))return result;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('Local fixture did not reach terminal state');};
  return {dataDir,ownerId,p,submission,input,json,fetcher,confirm,send,wait,open,service:()=>service,calls,recoveries,
    setCapability:v=>{supportsImages=v;},setHandler:v=>{handler=v;},setModelHook:v=>{modelHook=v;}};
}

test('explicit production archive preserves terminal original model/history/images across restart with SEND disabled',async t=>{
  const f=await fixture(t);await f.confirm();const created=await f.send(),job=await f.wait(created.value.id);assert.equal(job.state,'preview-ready');
  const prefix=`/v1/reference-drafts/${f.ownerId}/archive`,s=await f.json(prefix);assert.equal(s.status,200,s.value.error);
  assert.equal(s.value.submissionProtection.state,'known-terminal');assert.equal(s.value.submissionProtection.knownCalls,5);
  const beforeJob=await fs.readFile(path.join(f.dataDir,'jobs',job.id,'job.json')),beforeHistory=(await f.json(`/v1/reference-generation-jobs/${job.id}/history`)).value;
  const consent={format:'ReferenceDraftArchiveConfirmation',version:1,action:'archive-reference-draft',actionId:randomUUID(),ownerId:f.ownerId,snapshotHash:s.value.snapshotHash,accepted:true};
  const archived=await f.json(prefix,consent);assert.equal(archived.status,200,archived.value.error);assert.equal(archived.value.state,'archived');
  assert.deepEqual((await f.json(`/v1/reference-generation-jobs/${job.id}/history`)).value,beforeHistory);
  await f.service().close();await f.open({sending:false});assert.deepEqual((await f.json(prefix+'/'+consent.actionId)).value,archived.value);
  assert.deepEqual((await f.json(`/v1/reference-generation-jobs/${job.id}/history`)).value,beforeHistory);
  for(const r of f.p.references){const image=await f.fetcher(`/v1/reference-generation-jobs/${job.id}/images/${r.id}`);assert.equal(image.status,200);assert.equal(hash(Buffer.from(await image.arrayBuffer())),r.sha256);}
  assert.ok(beforeJob.equals(await fs.readFile(path.join(f.dataDir,'jobs',job.id,'job.json'))));assert.equal(f.calls.length,5);assert.equal(f.recoveries.length,0);
});

test('archive cannot race original SEND capability discovery or alter an active original analysis',async t=>{
  const f=await fixture(t);await f.confirm();let release,entered;const blocked=new Promise(resolve=>{release=resolve;}),seen=new Promise(resolve=>{entered=resolve;});
  f.setModelHook(async()=>{entered();await blocked;});const sent=f.send();await seen;
  try{assert.equal((await f.json(`/v1/reference-drafts/${f.ownerId}/archive`)).status,429);assert.equal((await f.json('/v1/reference-drafts')).status,429);}
  finally{release();}
  const result=await sent;assert.equal(result.status,202,result.value.error);assert.equal((await f.wait(result.value.id)).state,'preview-ready');assert.equal(f.calls.length,5);
});

test('active original analysis and cancelled unknown invocation remain archive-protected without resend',async t=>{
  const f=await fixture(t);await f.confirm();let entered;const seen=new Promise(resolve=>{entered=resolve;});
  f.setHandler(async o=>{entered();await new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>reject(Error('Fixture original outcome unknown')),{once:true}));});
  const created=await f.send();await seen;const prefix=`/v1/reference-drafts/${f.ownerId}/archive`;
  assert.equal((await f.json(prefix)).status,400);assert.equal((await f.json('/v1/reference-drafts')).value.drafts[0].archiveAllowed,false);
  await f.json(`/v1/jobs/${created.value.id}/cancel`,{});assert.equal((await f.wait(created.value.id)).state,'cancelled');
  assert.equal((await f.json(prefix)).status,400);assert.equal(f.calls.length,1);assert.equal(f.recoveries.length,0);
  assert.ok(await fs.stat(path.join(f.dataDir,'reference-drafts',f.ownerId)));
});

test('original reference history and job-owned pixels remain read-only with SEND disabled and draft storage gone',async t=>{
  const f=await fixture(t);await f.confirm();const created=await f.send(),job=await f.wait(created.value.id);assert.equal(job.state,'preview-ready');
  const directory=path.join(f.dataDir,'jobs',job.id),before=await fs.readFile(path.join(directory,'job.json'));
  await fs.rename(path.join(f.dataDir,'reference-drafts'),path.join(f.dataDir,'archived-original-drafts'));
  await f.service().close();await f.open({sending:false});
  const history=await f.json(`/v1/reference-generation-jobs/${job.id}/history`);assert.equal(history.status,200,history.value.error);
  const h=history.value,{historyHash,...content}=h;assert.equal(hash(content),historyHash);assert.equal(h.jobId,job.id);
  assert.equal(h.preparation.preparationHash,f.p.preparationHash);assert.equal(h.binding.bindingHash,job.referenceGeneration.input.bindingHash);
  assert.equal(h.manifest.references.length,2);assert.equal(h.analysis.status,'accepted',h.analysis.reason);
  assert.equal(h.analysis.audit.originalBriefReceiptVerified,true);assert.equal(h.analysis.audit.downstreamBriefIdentityVerified,true);
  assert.equal(h.additionalModelCalls,0);assert.equal(h.worldWrites,0);assert.equal(h.canAuthorizePlacement,false);
  assert.equal(h.analysis.audit.realImageUnderstandingVerified,false);assert.deepEqual(h.sendConfirmation,f.submission.sendConfirmation);
  for(const record of h.manifest.references){const result=await f.fetcher(`/v1/reference-generation-jobs/${job.id}/images/${record.id}`);assert.equal(result.status,200);const bytes=Buffer.from(await result.arrayBuffer());assert.equal(hash(bytes),record.sha256);}
  assert.equal((await f.send()).status,409);assert.equal(f.calls.length,5);assert.equal(f.recoveries.length,0);
  assert.ok(before.equals(await fs.readFile(path.join(directory,'job.json'))),'Historical GET changed original job');
  assert.equal(JSON.stringify(h).includes('C:/'),false);assert.equal(JSON.stringify(h).includes('reference-input/'),false);
});

test('reference history rejects writes, unauthorized origins, cross-job images and malformed paths',async t=>{
  const f=await fixture(t);await f.confirm();const created=await f.send(),job=await f.wait(created.value.id),prefix=`/v1/reference-generation-jobs/${job.id}`;
  assert.equal((await f.json(prefix+'/history',{})).status,405);
  assert.equal((await f.fetcher(prefix+'/history',undefined,{headers:{}})).status,401);
  assert.equal((await f.fetcher(prefix+'/history',undefined,{headers:{Authorization:'Bearer '+f.service().connection.token,Origin:'https://example.com'}})).status,403);
  assert.equal((await f.json(prefix+'/images/'+'f'.repeat(64))).status,400);
  assert.equal((await f.json('/v1/reference-generation-jobs/'+randomUUID()+'/history')).status,404);
  assert.equal((await f.json(prefix+'/images/not-an-image')).status,404);assert.equal(f.calls.length,5);
});

test('history never displays a rehashed altered brief as the original model answer and keeps pictures inspectable',async t=>{
  const f=await fixture(t);await f.confirm();const created=await f.send(),job=await f.wait(created.value.id),prefix=`/v1/reference-generation-jobs/${job.id}`;
  const directory=path.join(f.dataDir,'jobs',job.id),file=path.join(directory,job.recovery.branch,'assembly','reference-analysis.json');
  const original=JSON.parse(await fs.readFile(file));const altered={...original,brief:{...original.brief,limitations:['Substituted text, not the original model answer']}};
  altered.briefHash=hash(altered.brief);delete altered.analysisHash;altered.analysisHash=hash(altered);await fs.writeFile(file,JSON.stringify(altered));
  const result=await f.json(prefix+'/history');assert.equal(result.status,200);assert.equal(result.value.analysis.status,'unavailable');assert.equal(result.value.analysis.evidence,undefined);
  assert.match(result.value.analysis.reason,/audit did not pass/);assert.equal((await f.fetcher(prefix+'/images/'+f.p.references[0].id)).status,200);
  assert.deepEqual(JSON.parse(await fs.readFile(file)),altered);assert.equal(f.calls.length,5);
});

test('history observes an active original analysis without completing, cancelling or resending it',async t=>{
  const f=await fixture(t);await f.confirm();let entered;const observed=new Promise(resolve=>{entered=resolve;});
  f.setHandler(async o=>{entered();await new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>reject(Error('Explicit fixture cancellation')),{once:true}));});
  const created=await f.send();await observed;const id=created.value.id;
  const read=await f.json(`/v1/reference-generation-jobs/${id}/history`);assert.equal(read.status,200,read.value.error);assert.equal(read.value.analysis.status,'pending');assert.equal(f.calls.length,1);
  const still=(await f.json('/v1/jobs/'+id)).value;assert.equal(still.state,'generating');assert.equal(still.assemblyCallsReserved,1);
  await f.json('/v1/jobs/'+id+'/cancel',{});assert.equal((await f.wait(id)).state,'cancelled');assert.equal(f.calls.length,1);
});

test('reference production SEND is separate, authenticated and process-owned',async t=>{
  const f=await fixture(t,{enabled:false});await f.confirm();
  assert.equal((await f.json('/v1/reference-generation-jobs/capabilities')).value.sendingImplemented,false);
  assert.equal((await f.send()).status,409);
  assert.equal((await f.fetcher('/v1/reference-generation-jobs',f.submission,{headers:{}})).status,401);
  assert.equal((await f.fetcher('/v1/reference-generation-jobs',f.submission,{headers:{Authorization:'Bearer '+f.service().connection.token,'Content-Type':'application/json',Origin:'https://example.com'}})).status,403);
  assert.equal(f.calls.length,0);assert.equal((await f.json('/v1/jobs')).value.jobs.length,0);
});
test('free confirmation, strict v2 and complete original SEND are all required before job creation',async t=>{
  const f=await fixture(t);
  assert.equal((await f.send()).status,400);assert.equal((await f.json('/v1/jobs')).value.jobs.length,0);
  assert.deepEqual(await fs.readdir(path.join(f.dataDir,'jobs')),[]);
  await f.confirm();
  for(const bad of [{...f.submission,sendConfirmation:freeConsent(f.p)},{...f.submission,extra:true},
    {...f.submission,sendConfirmation:{...f.submission.sendConfirmation,accepted:false}},
    {...f.submission,sendConfirmation:{...f.submission.sendConfirmation,policyHash:'b'.repeat(64)}}])
    assert.equal((await f.send(bad)).status,400);
  assert.equal(f.calls.length,0);
  const old=await fixture(t,{version:1});await old.confirm();const rejected=await old.send();assert.equal(rejected.status,400);assert.match(rejected.value.error,/preparation v2/);assert.equal(old.calls.length,0);
});
test('actual HTTP SEND freezes task-owned pictures, forwards them to analysis and completes one shared compiled task',async t=>{
  const f=await fixture(t);await f.confirm();const created=await f.send();assert.equal(created.status,202,created.value.error);
  const job=await f.wait(created.value.id);assert.equal(job.state,'preview-ready',job.error);
  assert.equal(job.key,f.ownerId);assert.notEqual(job.id,f.ownerId);assert.equal(job.assemblyCallsReserved,5);assert.equal(f.calls.length,5);
  assert.equal(f.calls.filter(c=>c.referenceInput).length,1);assert.equal(job.assemblySummary.completedPackages.length,2);
  assert.equal(job.assemblySummary.finalTextReviewAccepted,true);
  const directory=path.join(f.dataDir,'jobs',job.id),reference=await readJobReferenceInput({directory,input:job.referenceGeneration.input,model:f.p.model,runtimeHash:f.p.runtimeHash});
  assert.equal(reference.images.length,2);assert.equal(reference.manifest.setHash,f.p.referenceSetHash);
  const audit=await auditAssemblyReferenceAnalysis({directory,root:path.join(directory,job.recovery.branch,'assembly'),records:job.assemblyStages,
    referenceInput:job.referenceGeneration.input,policy:job.preflight,prompt:f.input.generation.prompt,runtimeHash:f.p.runtimeHash});
  assert.equal(audit.originalBriefReceiptVerified,true);assert.equal(audit.downstreamBriefIdentityVerified,true);
  assert.equal((await f.send()).status,200);assert.equal(f.calls.length,5);
  assert.equal((await f.send({...f.submission,sendConfirmation:{...f.submission.sendConfirmation,generationHash:'a'.repeat(64)}})).status,409);
  assert.equal((await f.json('/v1/jobs',{...f.input.generation})).status,409);
  await fs.rename(path.join(f.dataDir,'reference-drafts'),path.join(f.dataDir,'archived-original-reference-drafts'));
  await f.service().close();await f.open();
  assert.equal((await f.send()).value.id,job.id);assert.equal(f.calls.length,5);
  assert.equal((await f.json('/v1/jobs/by-key?key='+f.ownerId)).value.job.id,job.id);
});
test('restarting an interrupted original analysis recovers its original receipt, never sends a duplicate turn',async t=>{
  const f=await fixture(t);await f.confirm();let entered;const observed=new Promise(resolve=>{entered=resolve;});
  f.setHandler(async o=>{
    await o.onProviderBinding({version:1,provider:'codex',storage:'persistent-single-turn',threadId:'original-reference-thread',
      turnId:'original-reference-turn',model:f.p.model,effort:'max',requestHash:hash(o.prompt)});
    entered();
    await new Promise((resolve,reject)=>{o.signal.addEventListener('abort',()=>reject(Error('Original observation interrupted')),{once:true});});
  });
  const created=await f.send();assert.equal(created.status,202);await observed;await f.service().close();
  assert.equal(f.calls.length,1);f.setHandler(null);await f.open();
  const job=await f.wait(created.value.id);assert.equal(job.state,'preview-ready',job.error);
  assert.equal(job.assemblyCallsReserved,5);assert.equal(f.calls.length,5);assert.equal(f.recoveries.length,1);
  assert.equal(f.recoveries[0].binding.turnId,'original-reference-turn');
  assert.deepEqual(f.recoveries[0].referenceInput,job.referenceGeneration.input);
});
test('capability loss and changed runtime reject SEND before invoking any provider',async t=>{
  const f=await fixture(t);await f.confirm();f.setCapability(false);
  const rejected=await f.send();assert.equal(rejected.status,400);assert.match(rejected.value.error,/not advertised/);assert.equal(f.calls.length,0);
  f.setCapability(true);const changed=await f.send({...f.submission,sendConfirmation:{...f.submission.sendConfirmation,runtimeHash:'c'.repeat(64)}});
  assert.equal(changed.status,400);assert.equal(f.calls.length,0);
});
test('malformed and arbitrary-path reference SEND cannot become ordinary generation',async t=>{
  const f=await fixture(t);await f.confirm();
  assert.equal((await f.json('/v1/reference-generation-jobs',{}, {body:Buffer.from([0xff])})).status,400);
  assert.equal((await f.send({...f.submission,referenceInput:{path:'C:/arbitrary.png'}})).status,400);
  for(const route of ['/v1/jobs','/v1/preflight']){
    const r=await f.json(route,{...f.input.generation,referenceInput:{path:'C:/arbitrary.png'}});
    assert.equal(r.status,400);assert.match(r.value.error,/versioned reference preparation/);
  }
  assert.equal(f.calls.length,0);
});
test('durable pre-publication SEND resumes the same job ID and prevents ordinary key reuse',async t=>{
  const f=await fixture(t);await f.confirm();
  const saved=await referenceGenerationOperation({dataDir:f.dataDir,operation:'submit',input:Buffer.from(JSON.stringify(f.submission)),
    runtimeHash:f.p.runtimeHash,capability:{id:f.p.model,supportsImages:true}});
  assert.equal(f.calls.length,0);assert.equal((await f.json('/v1/jobs')).value.jobs.length,0);
  await f.service().close();await f.open();
  const job=await f.wait(saved.jobId);assert.equal(job.state,'preview-ready',job.error);assert.equal(f.calls.length,5);
  assert.equal((await f.send()).value.id,saved.jobId);
});
test('rehashed job capsule or modified pixels block recovery instead of silently discarding reference input',async t=>{
  const f=await fixture(t);await f.confirm();
  const saved=await referenceGenerationOperation({dataDir:f.dataDir,operation:'submit',input:Buffer.from(JSON.stringify(f.submission)),
    runtimeHash:f.p.runtimeHash,capability:{id:f.p.model,supportsImages:true}});
  const directory=path.join(f.dataDir,'jobs',saved.jobId),reference=await readJobReferenceInput({directory,input:saved.referenceInput,model:f.p.model,runtimeHash:f.p.runtimeHash});
  const bytes=await fs.readFile(reference.images[0]);bytes[bytes.length-1]^=1;await fs.writeFile(reference.images[0],bytes);
  await f.service().close();await f.open();
  const observed=(await f.json('/v1/jobs/by-key?key='+f.ownerId)).value;
  assert.equal(observed.job,null);assert.equal(observed.pendingReferenceSubmission,true);assert.ok(observed.error);
  assert.equal((await f.send()).status,400);assert.equal(f.calls.length,0);
  assert.equal((await f.json('/v1/jobs',f.input.generation)).status,409);
});
test('one SEND lane blocks duplicate submissions and agent configuration changes during asynchronous discovery',async t=>{
  const f=await fixture(t);await f.confirm();let entered,release;
  const observed=new Promise(resolve=>{entered=resolve;}),blocked=new Promise(resolve=>{release=resolve;});
  f.setModelHook(async()=>{entered();await blocked;});
  const original=f.send();await observed;
  try{
    assert.equal((await f.send()).status,429);
    assert.equal((await f.json('/v1/jobs',f.input.generation)).status,429);
    assert.equal((await f.json('/v1/config/codex-path',{codexPath:''})).status,409);
  }finally{f.setModelHook(null);release();}
  const created=await original;assert.equal(created.status,202,created.value.error);
  const job=await f.wait(created.value.id);assert.equal(job.state,'preview-ready',job.error);assert.equal(f.calls.length,5);
  assert.equal((await f.json('/v1/jobs')).value.jobs.length,1);
});
test('capability is rechecked after immutable binding and again before first dispatch',async t=>{
  const f=await fixture(t);await f.confirm();let discovery=0;
  f.setModelHook(()=>{if(++discovery===2)f.setCapability(false);});
  const refused=await f.send();assert.equal(refused.status,400);assert.match(refused.value.error,/no longer advertises/);
  assert.equal(f.calls.length,0);
  const pending=(await f.json('/v1/jobs/by-key?key='+f.ownerId)).value;
  assert.equal(pending.pendingReferenceSubmission,true);assert.equal(pending.job,null);
  assert.equal((await f.json('/v1/jobs',f.input.generation)).status,409);
  f.setModelHook(null);f.setCapability(true);const created=await f.send();
  assert.equal(created.status,202,created.value.error);assert.equal((await f.wait(created.value.id)).state,'preview-ready');
  assert.equal(f.calls.length,5);
});
