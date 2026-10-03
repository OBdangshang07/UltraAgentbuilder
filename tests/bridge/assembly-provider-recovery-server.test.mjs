import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from '../../src/generation/compiler.mjs';
import {startBridge} from '../../bridge/server.mjs';
import {assemblyRuntimeIdentity} from '../../bridge/assembly-durability.mjs';
import {auditAssemblyProviderRecovery} from '../../bridge/assembly-provider-recovery-audit.mjs';
import {auditAssemblyReferenceAnalysis} from '../../bridge/assembly-reference-analysis.mjs';
import {readJobReferenceInput} from '../../bridge/reference-generation-binding.mjs';
import {encodeReferencePixels} from '../../bridge/reference-pixels.mjs';
import {assemblyPlan,packageEdit,packageResponse,acceptReview} from '../design/assembly-fixtures.mjs';
import {referenceBrief,freeConsent,sendConsent} from './reference-generation-fixture.mjs';
import {syntheticRecoveryTurn,recoveryRequest,recoveryModel,recoveryEffort,capacityMessage} from './assembly-provider-recovery-fixtures.mjs';

const terminal=job=>['preview-ready','failed','cancelled','interrupted'].includes(job.state);
async function fixture(t,{choose=()=>({})}={}){
  const dataDir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'bounded-recovery-api-'))),calls=[],transport=[];
  let service;
  const adapter={close(){},models:async()=>[{id:recoveryModel,supportsImages:true,efforts:[{reasoningEffort:recoveryEffort}],defaultEffort:recoveryEffort}],
    async generate(options){
      const index=calls.length+1,input=JSON.parse(options.prompt.split('Assembly input (data):\n').at(-1)),format=options.outputSchema.properties.format.enum[0];
      let answer;
      if(format==='ArchitectureReferenceBrief'){
        const reference=await readJobReferenceInput({directory:options.cwd,input:options.referenceInput,model:options.model,runtimeHash:await assemblyRuntimeIdentity()});
        answer=referenceBrief(reference);
      }else if(format==='SceneConceptReview')answer={format:'SceneConceptReview',version:1,planHash:input.planHash,sourceHash:input.sourceHash,
        evidenceHash:input.designEvidence.evidenceHash,verdict:'accept',summary:'Synthetic engineering acceptance only',issues:[]};
      else answer=format==='SceneAssemblyPlan'?assemblyPlan():format==='SceneAssemblyReview'?acceptReview(input):packageResponse(input,packageEdit(input));
      const saved=JSON.parse(await fs.readFile(path.join(options.cwd,'job.json')));
      calls.push({index,input,options,recoveryState:saved.recovery?.state});
      return syntheticRecoveryTurn(options,{index,answer,selected:choose({index,input,options})??{},transport});
    },recoverOriginal:async()=>assert.fail('No original outcome may be resent or substituted')};
  const open=async()=>{service=await startBridge({dataDir,adapter,claudeAdapter:adapter,deepseekAdapter:adapter,referenceGenerationSending:true});};
  await open();t.after(async()=>{await service.close();await fs.rm(dataDir,{recursive:true,force:true});});
  const json=async(route,input)=>{
    const response=await fetch('http://127.0.0.1:'+service.connection.port+route,{method:input===undefined?'GET':'POST',
      headers:{Authorization:'Bearer '+service.connection.token,'Content-Type':'application/json'},body:input===undefined?undefined:JSON.stringify(input)});
    return {status:response.status,value:await response.json()};
  };
  const until=async(id,condition=terminal)=>{
    const deadline=Date.now()+90000;
    while(Date.now()<deadline){const result=(await json('/v1/jobs/'+id)).value;if(condition(result))return result;await new Promise(resolve=>setTimeout(resolve,50));}
    throw Error('Synthetic HTTP task did not reach expected state');
  };
  const journal=async id=>{
    const root=path.join(dataDir,'jobs',id,'assembly-journal'),names=(await fs.readdir(root)).filter(n=>/^call-\d+\.json$/.test(n));
    return Promise.all(names.sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0])).map(async n=>JSON.parse(await fs.readFile(path.join(root,n))).value));
  };
  const request={...recoveryRequest,key:randomUUID(),assemblyProviderRecovery:'bounded'};
  return {dataDir,calls,transport,request,json,until,journal,open,close:()=>service.close()};
}

async function referencePreparation(f){
  const generation={...f.request,assemblyDesignReview:undefined},ownerId=generation.key;
  const input={format:'ReferenceGenerationPreparationRequest',version:2,generation,
    upload:{format:'UserReferenceUpload',version:1,mode:'multi-view',references:['front','side'].map((view,i)=>({
      png:encodeReferencePixels(2,1,Buffer.from([i+1,20,30,255,40,50,60,255])).toString('base64'),
      annotation:{purpose:'exterior',view,caption:'Synthetic transport image; not architectural evidence'}}))}};
  const prepared=await f.json('/v1/reference-drafts/'+ownerId+'/prepare',input);assert.equal(prepared.status,200,prepared.value.error);
  const p=prepared.value,confirmed=await f.json(`/v1/reference-drafts/${ownerId}/preparations/${p.preparationHash}/confirm`,freeConsent(p));
  assert.equal(confirmed.status,200,confirmed.value.error);
  return {p,submission:{format:'ReferenceGenerationJobRequest',version:1,ownerId,preparationHash:p.preparationHash,sendConfirmation:sendConsent(p)}};
}

async function independentAudit(f,job){
  const directory=path.join(f.dataDir,'jobs',job.id),branch=(await fs.readdir(directory)).filter(n=>n.startsWith('assembly-run-')).sort().at(-1),root=path.join(directory,branch,'assembly');
  // HTTP deliberately omits the private request identity; independently read
  // original disk bytes instead of weakening that boundary for a test.
  const saved=JSON.parse(await fs.readFile(path.join(directory,'job.json')));
  return auditAssemblyProviderRecovery({directory,root,records:saved.assemblyStages,summary:saved.assemblySummary,
    policy:saved.preflight,requestHash:saved.requestHash,runtimeHash:await assemblyRuntimeIdentity(),model:saved.model,effort:saved.effort});
}

test('HTTP preflight reserves nothing and rejects implicit model/effort, invalid lanes and unconfirmed SEND',async t=>{
  const f=await fixture(t),prepared=await f.json('/v1/preflight',{...f.request,assemblyConfirmed:false});
  assert.equal(prepared.status,200);assert.equal(prepared.value.assembly.providerRetries,2);assert.equal(f.calls.length,0);
  for(const change of [{effort:undefined},{effort:'default'},{model:''},{agent:'deepseek'},{assemblyRecovery:undefined},{sceneWorkflow:undefined}]){
    const r=await f.json('/v1/preflight',{...f.request,...change});assert.equal(r.status,400);
  }
  const rejected=await f.json('/v1/jobs',{...f.request,assemblyConfirmed:false});assert.equal(rejected.status,400);
  assert.equal(f.calls.length,0);assert.equal((await f.json('/v1/jobs')).value.jobs.length,0);
});

test('ordinary HTTP capacity recovery uses exact identity, real waits, original fees and one final immutable asset',async t=>{
  const f=await fixture(t,{choose:({index})=>index===1?{failure:capacityMessage}:{}}),created=await f.json('/v1/jobs',f.request);
  assert.equal(created.status,202,created.value.error);const job=await f.until(created.value.id),journal=await f.journal(job.id);
  assert.equal(job.state,'preview-ready',job.error);assert.equal(f.calls.length,6);assert.equal(journal.length,6);
  assert.equal(job.assemblySummary.finalTextReviewAccepted,true);assert.equal(job.assemblySummary.completedPackages.length,2);
  assert.equal(journal[0].state,'error');assert.equal(journal[1].providerRetry.failedIndex,1);assert.equal(journal[1].providerRetry.waitMs,10000);
  assert.equal(job.generations.length,6);assert.equal(job.generations[0].outcome,'failed');assert.equal(job.assemblyCallsReserved,6);
  assert.equal(f.calls[1].recoveryState,'provider-capacity-dispatched');assert.equal(job.recovery.state,'complete');assert.equal(job.recovery.waitMs,0);
  for(const turn of f.transport.filter(v=>v.method==='turn/start')){assert.equal(turn.model,f.request.model);assert.equal(turn.effort,f.request.effort);}
  const audit=await independentAudit(f,job);assert.equal(audit.report.allReservedCallsClosed,true);assert.equal(audit.report.relationships.length,1);
  assert.equal((await f.json('/v1/jobs',f.request)).value.id,job.id);assert.equal(f.calls.length,6);
  await f.close();await f.open();assert.equal((await f.json('/v1/jobs',f.request)).value.assetHash,job.assetHash);assert.equal(f.calls.length,6);
  assert.equal((await f.json('/v1/jobs',{...f.request,effort:'high'})).status,409);
});

test('two-image HTTP SEND closes capacity-format-capacity prelude, preserves original pixels and independently audits history',async t=>{
  const f=await fixture(t,{choose:({index})=>[1,3].includes(index)?{failure:capacityMessage}:index===2?{text:'{"incomplete":'}:{}});
  const {p,submission}=await referencePreparation(f);assert.equal(p.policy.assembly.providerRetries,2);
  const created=await f.json('/v1/reference-generation-jobs',submission);assert.equal(created.status,202,created.value.error);
  const job=await f.until(created.value.id),journal=await f.journal(job.id);assert.equal(job.state,'preview-ready',job.error);
  assert.equal(f.calls.length,8);assert.equal(journal.length,8);assert.equal(job.assemblySummary.reservedCalls,8);
  assert.equal(job.assemblySummary.providerRecovery.retriesReserved,2);assert.equal(job.assemblySummary.formatCorrections,1);
  assert.equal(job.assemblySummary.completedPackages.length,2);assert.equal(job.assemblySummary.finalTextReviewAccepted,true);
  assert.deepEqual(journal.slice(0,4).map(v=>v.state),['error','error','error','response']);
  assert.deepEqual(journal.filter(v=>v.providerRetry).map(v=>v.providerRetry.waitMs),[10000,30000]);
  for(const index of [1,3])assert.equal(f.calls[index].recoveryState,'provider-capacity-dispatched');assert.equal(job.recovery.state,'complete');assert.equal(job.recovery.waitMs,0);
  const turns=f.transport.filter(v=>v.method==='turn/start');
  const first=turns[0].input.filter(v=>v.type==='localImage').map(v=>v.path);assert.equal(first.length,2);
  for(const turn of turns.slice(0,4)){assert.deepEqual(turn.input.filter(v=>v.type==='localImage').map(v=>v.path),first);assert.equal(turn.effort,'max');}
  for(const turn of turns.slice(4))assert.equal(turn.input.some(v=>v.type==='localImage'),false);
  const audit=await independentAudit(f,job);assert.equal(audit.report.allReservedCallsClosed,true);assert.equal(audit.report.relationships.length,2);
  const directory=path.join(f.dataDir,'jobs',job.id),referenceInput=job.referenceGeneration.input;
  const branch=(await fs.readdir(directory)).find(n=>n.startsWith('assembly-run-'));
  const analysis=await auditAssemblyReferenceAnalysis({directory,root:path.join(directory,branch,'assembly'),records:job.assemblyStages,
    policy:job.preflight,prompt:p.generation.prompt,referenceInput,model:job.model,runtimeHash:p.runtimeHash,providerRecoveryAudit:audit});
  assert.equal(analysis.originalBriefReceiptVerified,true);assert.equal(analysis.downstreamBriefIdentityVerified,true);
  const before=await fs.readFile(path.join(directory,'job.json')),history=await f.json(`/v1/reference-generation-jobs/${job.id}/history`);
  assert.equal(history.status,200,history.value.error);assert.equal(history.value.analysis.status,'accepted',history.value.analysis.reason);
  assert.equal(history.value.additionalModelCalls,0);assert.equal(history.value.worldWrites,0);assert.equal(history.value.canAuthorizePlacement,false);
  assert.deepEqual(await fs.readFile(path.join(directory,'job.json')),before);
  await f.close();await f.open();assert.deepEqual((await f.json(`/v1/reference-generation-jobs/${job.id}/history`)).value,history.value);
  assert.equal((await f.json('/v1/reference-generation-jobs',submission)).value.id,job.id);assert.equal(f.calls.length,8);
});

test('cancelling real HTTP capacity wait retains failure and cannot reserve a retry',async t=>{
  const f=await fixture(t,{choose:()=>({failure:capacityMessage})}),created=await f.json('/v1/jobs',f.request);
  const waiting=await f.until(created.value.id,j=>j.recovery?.state==='provider-capacity-wait');assert.equal(waiting.assemblyCallsReserved,1);
  await f.json(`/v1/jobs/${created.value.id}/cancel`,{});const job=await f.until(created.value.id);
  assert.equal(job.state,'cancelled');assert.equal(f.calls.length,1);assert.equal((await f.journal(job.id)).length,1);
  assert.equal(job.assetHash,undefined);assert.equal((await f.json('/v1/jobs/'+job.id+'/manifest')).status,409);
  await f.close();await f.open();assert.equal((await f.json('/v1/jobs',f.request)).value.state,'cancelled');assert.equal(f.calls.length,1);
});

for(const variant of ['legacy','unfunded'])test('HTTP '+variant+' stops rather than acquiring new authority or dropping scope',async t=>{
  const f=await fixture(t,{choose:()=>({failure:capacityMessage})});
  const input={...f.request,...(variant==='legacy'?{assemblyProviderRecovery:undefined}:{assemblyCalls:5})},created=await f.json('/v1/jobs',input);
  const job=await f.until(created.value.id);assert.equal(job.state,'failed');assert.equal(f.calls.length,1);
  assert.equal((await f.journal(job.id)).length,1);assert.equal(job.assemblyCallsReserved,1);assert.equal(job.assetHash,undefined);
  if(variant==='legacy')assert.equal(job.preflight.assembly.providerRetries,0);else assert.equal(job.preflight.maximumCalls,5);
});

test('unknown reference invocation remains pending and idempotent SEND/restart never resends it',async t=>{
  const f=await fixture(t,{choose:()=>({unknown:true})}),{submission}=await referencePreparation(f);
  const created=await f.json('/v1/reference-generation-jobs',submission),job=await f.until(created.value.id);
  assert.equal(job.state,'failed');assert.equal(f.calls.length,1);assert.equal((await f.journal(job.id))[0].state,'pending');
  assert.equal(job.assetHash,undefined);assert.equal((await f.json('/v1/jobs/'+job.id+'/manifest')).status,409);
  await f.close();await f.open();await f.json('/v1/reference-generation-jobs',submission);assert.equal(f.calls.length,1);
  const history=await f.json(`/v1/reference-generation-jobs/${job.id}/history`);
  assert.notEqual(history.value.analysis.status,'accepted');assert.equal(history.value.canAuthorizePlacement,false);
});
