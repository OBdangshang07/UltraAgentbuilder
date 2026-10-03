import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {runDurableAssembly} from '../../bridge/assembly-durability.mjs';
import {runSceneAssembly} from '../../bridge/scene-assembly.mjs';
import {prepareDesignContinuation} from '../../bridge/design-component-continuation.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyPlan,packageEdit,packageResponse,acceptReview} from '../design/assembly-fixtures.mjs';
import {requestNativeEvidence,acceptNativeEvidence,validateModelImageFiles} from '../../bridge/native-evidence.mjs';
import {fixtureUpload} from './native-evidence-fixtures.mjs';
const rules=await fs.readFile(new URL('../../prompts/scene-v1.md',import.meta.url),'utf8');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const save=(p,x)=>fs.writeFile(p,JSON.stringify(x));
async function source(native=false,maximumCalls=26){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-design-cont-source-'));
 const request={agent:'codex',model:'offline',effort:'max',prompt:'16×10×16格范围，原生续测工程样本',generationMode:'scene',sceneWorkflow:'components',qualityTier:'ultra',assemblyCalls:maximumCalls,assemblyQuality:'v2',assemblyDesignReview:native?'native':'text',assemblyRecovery:'safe',assemblyConfirmed:true,maxRepairs:0},policy=generationPreflight(request);
 const job={id:randomUUID(),requestHash:hash(request),state:'generating',prompt:request.prompt,preflight:policy,recoveryEnabled:true,assemblyStages:[],assemblyCallsReserved:0};
 const capture=jobDirectory=>o=>requestNativeEvidence({...o,jobDirectory,timeoutMs:2000,onWaiting:async s=>{if(s.state==='waiting')await acceptNativeEvidence(jobDirectory,s.id,fixtureUpload(s.request));}});
 await assert.rejects(runDurableAssembly({directory,requestHash:job.requestHash,runtimeHash:'fixture',prompt:job.prompt,rules,policy,signal:new AbortController().signal,nativeEvidence:capture(directory),onRecovery:async r=>{job.recovery=r;},onStage:async r=>{job.assemblyStages=r;job.assemblyCallsReserved=r.length;},invoke:async(p,i,o)=>{
  const input=JSON.parse(p.split('Assembly input (data):\n').at(-1)),kind=o.outputSchema.properties.format.enum[0];
  if(kind==='SceneAssemblyPlan')return assemblyPlan();
  if(kind==='SceneConceptReview')return {format:'SceneConceptReview',version:1,planHash:input.planHash,sourceHash:input.sourceHash,evidenceHash:input.designEvidence.evidenceHash,verdict:'accept',summary:'Engineering fixture',issues:[]};
  const edit=packageEdit(input);if(i>=4)edit.components.put[0].at.offset=i===5?[14,1,14]:[15,1,15];return packageResponse(input,edit);
 }}),/Component correction made no progress/);
 job.state='failed';await save(path.join(directory,'job.json'),job);
 const assetHash=(await read(path.join(directory,job.recovery.branch,'assembly/3/diagnostic/manifest.json'))).assetHash;
 return {directory,job,policy,capture,resume:{kind:'design-component-v1',sourceDirectory:directory,jobHash:hash(job),assetHash,authorizedNewCalls:maximumCalls-6,continuationConfirmed:true}};
}
test('design continuation retains concept and all failed calls; only pending component and final review run',async()=>{
 const s=await source(true),before=hash(await fs.readFile(path.join(s.directory,'job.json'))),prepared=await prepareDesignContinuation(s.resume,s.policy);
 assert.equal(prepared.baselineStage,3);assert.equal(prepared.correctionsUsed,2);assert.deepEqual(prepared.completed,['exterior']);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-design-cont-child-')),calls=[];
 const result=await runSceneAssembly({directory,prompt:s.job.prompt,rules,policy:s.policy,resume:s.resume,nativeEvidence:s.capture(directory),signal:new AbortController().signal,onStage:async()=>{},invoke:async(p,i,o)=>{
  calls.push([i,o.stageName]);const input=JSON.parse(p.split('Assembly input (data):\n').at(-1));await validateModelImageFiles(o.images,directory);
  if(i===7){assert.equal(input.correctionBudget.previousCorrectionsRetained,2);assert.equal(input.sourceHash,prepared.provenance.sourceHash);assert.equal(input.repairBase.approved,false);assert.match(p,/allowOverwrite cannot expand/);return packageResponse(input,packageEdit(input));}
  assert.equal(o.images.length,8);return acceptReview(input);
 }});
 assert.deepEqual(calls,[[7,'correct-component'],[8,'review']]);assert.equal(result.summary.visualReviewCurrent,true);assert.equal(result.summary.resumedFrom.priorCalls,6);
 assert.deepEqual(result.records.slice(0,6),s.job.assemblyStages);assert.equal(hash(await fs.readFile(path.join(s.directory,'job.json'))),before);
 const proof=await read(path.join(directory,'assembly/resume.json'));for(const f of proof.files)assert.equal(hash(await fs.readFile(path.join(directory,f.path))),f.sha256);
});
test('design continuation rejects changed authorization, source, scope, receipts and unknown outcomes before calls',async()=>{
 const s=await source();
 for(const patch of [{continuationConfirmed:false},{authorizedNewCalls:21},{jobHash:'0'.repeat(64)},{assetHash:'0'.repeat(64)}])await assert.rejects(prepareDesignContinuation({...s.resume,...patch},s.policy));
 await assert.rejects(prepareDesignContinuation(s.resume,{...s.policy,maximumCalls:27}),/policy/);
 const jp=path.join(s.directory,'job.json'),changed=structuredClone(s.job);changed.assemblyStages.at(-1).invocationOutcome='unknown';await save(jp,changed);
 await assert.rejects(prepareDesignContinuation({...s.resume,jobHash:hash(changed)},s.policy),/unknown/);await save(jp,s.job);
 const ip=path.join(s.directory,s.job.recovery.branch,'assembly/interfaces.json'),original=await read(ip);await save(ip,{...original,packages:[]});await assert.rejects(prepareDesignContinuation(s.resume,s.policy),/frozen packages/);await save(ip,original);
 const cp=path.join(s.directory,'assembly-journal/call-6.json'),receipt=await read(cp);receipt.value.response.candidateHash='0'.repeat(64);await save(cp,receipt);await assert.rejects(prepareDesignContinuation(s.resume,s.policy),/corrupt invocation/);
});
test('design continuation cannot relabel or retry a new unknown outcome',async()=>{
 const s=await source(),directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-design-cont-stop-'));let calls=0,records;
 await assert.rejects(runSceneAssembly({directory,prompt:s.job.prompt,rules,policy:s.policy,resume:s.resume,signal:new AbortController().signal,onStage:async r=>{records=r;},invoke:async()=>{calls++;throw Error('unknown transport result');}}),/unknown transport/);
 assert.equal(calls,1);assert.equal(records.length,7);assert.deepEqual(records.slice(0,6),s.job.assemblyStages);assert.equal(records.at(-1).invocationOutcome,'unknown');
});
test('historically rejected geometry is still a no-progress stop, and a remaining call cannot borrow the final review',async()=>{
 const s=await source(),directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-design-cont-cycle-'));let calls=0;
 await assert.rejects(runSceneAssembly({directory,prompt:s.job.prompt,rules,policy:s.policy,resume:s.resume,signal:new AbortController().signal,onStage:async()=>{},invoke:async(p)=>{
  calls++;const input=JSON.parse(p.split('Assembly input (data):\n').at(-1)),edit=packageEdit(input);edit.components.put[0].at.offset=[15,1,15];return packageResponse(input,edit);
 }}),/Component correction made no progress/);assert.equal(calls,1);
 const narrow=await source(false,7);await assert.rejects(prepareDesignContinuation(narrow.resume,narrow.policy),/remaining calls cannot fund/);
});
