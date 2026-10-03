import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {planCandidateBase,applyPlanCandidateCorrection,planCandidateDelta} from '../../contracts/scene-plan-candidate.mjs';
import {applyAssemblyPlanEdit} from '../../contracts/scene-assembly.schema.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {runDurableAssembly} from '../../bridge/assembly-durability.mjs';
import {assemblyPlan,planEdit,packageEdit,acceptReview} from '../design/assembly-fixtures.mjs';
import {shape} from '../design/fixtures.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {readNativeBundle} from '../../src/generation/bundle.mjs';
import {CompletedResponseFormatError,parseModelJson} from '../../bridge/model-json.mjs';
import {completedFormatError} from '../fixtures/completed-format-error.mjs';
import {freezeSceneRuntime} from '../../scripts/scene-runtime-snapshot.mjs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';

const request={agent:'codex',model:'offline',prompt:'16×10×16格离线候选局部纠错测试',generationMode:'scene',sceneWorkflow:'components',qualityTier:'ultra',assemblyRecovery:'safe',assemblyDesignReview:'text',assemblyConfirmed:true,maxRepairs:0};
const tier=generationPreflight(request).assembly;
function rejectedPlan(source){
 const next=structuredClone(source);next.scene.palette[0].material='quartz';
 next.scene.components.push(shape('candidateGood',[0,0,4],[1,2,1],'frame'),shape('candidateBad',[16,0,0],[1,1,1],'frame'));
 return next;
}

test('small candidate delta retains earlier changes, binds both baselines and leaves originals immutable',()=>{
 const source=assemblyPlan(),candidate=rejectedPlan(source),response=planEdit(source,candidate),before=hash({source,candidate,response});
 const base=planCandidateBase(source,{plan:candidate,response},tier);assert.ok(base);assert.equal(base.approved,false);
 const next=structuredClone(candidate);next.scene.components.find(c=>c.id==='candidateBad').at.offset=[1,0,0];
 const patch=planEdit(candidate,next);assert.deepEqual(patch.sceneEdit.components.put.map(c=>c.id),['candidateBad']);assert.equal(patch.sceneEdit.palette.put.length,0);
 const repaired=applyPlanCandidateCorrection(source,base,patch,tier);
 assert.equal(repaired.plan.scene.palette[0].material,'quartz');assert.deepEqual(repaired.plan.scene.components.find(c=>c.id==='candidateGood'),candidate.scene.components.find(c=>c.id==='candidateGood'));
 assert.deepEqual(applyAssemblyPlanEdit(source,repaired.effectiveEdit,tier,{designReview:true}).plan,next);
 assert.equal(hash({source,candidate,response}),before);assert.notEqual(patch.planHash,hash(source));
 for(const changed of [{...patch,planHash:hash(source)},{...patch,sceneEdit:{...patch.sceneEdit,sourceHash:hash(source.scene)}}])assert.throws(()=>applyPlanCandidateCorrection(source,base,changed,tier),/identity/);
 assert.throws(()=>applyPlanCandidateCorrection(source,{...base,approved:true},patch,tier),/identity/);
 assert.equal(planCandidateBase(source,{plan:candidate,response:{...response,extra:true}},tier),null);
 assert.equal(planCandidateBase(source,{plan:{...candidate,designIntent:'tampered'},response},tier),null);
 for(const field of ['id','seed','bounds']){
  const changed=structuredClone(next);changed.scene[field]=field==='bounds'?{...changed.scene.bounds,height:11}:field==='seed'?1:'different';
  assert.throws(()=>planCandidateDelta(source,changed),/fixed/);
 }
});

test('candidate corrections cannot silently disable required intent or reorder original objects',()=>{
 const source=assemblyPlan();source.scene.components.push(shape('originalDetail',[0,0,4],[1,2,1],'frame'));
 const target=structuredClone(source);target.scene.palette[0].material='quartz';
 const base=planCandidateBase(source,{plan:target,response:planEdit(source,target)},tier);
 const disabled=structuredClone(target);disabled.scene.constraints.walkable=false;
 assert.throws(()=>applyPlanCandidateCorrection(source,base,planEdit(target,disabled),tier),/disable original walkable/);
 const removed=structuredClone(target);removed.scene.components.shift();
 const base2=planCandidateBase(source,{plan:removed,response:planEdit(source,removed)},tier);assert.ok(base2);
 const reordered=structuredClone(removed);reordered.scene.components.push(structuredClone(source.scene.components[0]));
 assert.throws(()=>applyPlanCandidateCorrection(source,base2,planEdit(removed,reordered),tier),/cannot reorder/);
});

async function fixture({unknown=false,formatError=false,legacy=false}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-plan-candidate-')),policy=generationPreflight(request),source=assemblyPlan();
 if(legacy)delete policy.assembly.designReview.candidateCorrections;
 let calls=0,branch;const inputs=[];
 const options={directory,requestHash:hash(request),runtimeHash:'plan-candidate-fixture-v1',policy,prompt:request.prompt,rules:'Offline fixture only',signal:new AbortController().signal,onStage:async()=>{},onRecovery:async r=>{if(r.branch)branch=r.branch;},
  invoke:async(prompt,n,o)=>{
   calls++;const d=JSON.parse(prompt.split('Assembly input (data):\n').at(-1));inputs.push({n,d,phase:o.stageName});
   if(n===1)return source;
   if(o.stageName==='concept-review')return {format:'SceneConceptReview',version:1,sourceHash:d.sourceHash,planHash:d.planHash,evidenceHash:d.designEvidence.evidenceHash,verdict:n===2?'revise':'accept',summary:'Offline fixture only',issues:n===2?[{criterion:'materials',evidence:'Original material',change:'Coordinate facade material and bounded details'}]:[]};
   if(o.stageName==='revise-design')return planEdit(source,rejectedPlan(source));
   if(o.stageName==='correct-design'){
    if(n===4&&unknown)throw new Error('Unknown candidate edit outcome');
    if(n===4&&formatError)throw await completedFormatError(directory,CompletedResponseFormatError,parseModelJson,undefined,'codex');
    if(legacy){assert.equal(d.repairBase,undefined);assert.equal(d.planHash,hash(source));const next=rejectedPlan(source);next.scene.components.find(c=>c.id==='candidateBad').at.offset=[1,0,0];return planEdit(source,next);}
    assert.equal(d.repairBase.authorityPlanHash,hash(source));assert.equal(d.repairBase.approved,false);assert.equal(d.planHash,hash(d.priorPlan));
    assert.equal(d.sourceHash,hash(d.priorPlan.scene));assert.deepEqual(o.outputSchema.properties.planHash.enum,[d.planHash]);
    assert.match(prompt,/SMALL correction/);assert.doesNotMatch(prompt,/TEXT REVISION:/);
    const next=structuredClone(d.priorPlan);next.scene.components.find(c=>c.id==='candidateBad').at.offset=[1,0,0];return planEdit(d.priorPlan,next);
   }
   return o.stageName==='review'?acceptReview(d):packageEdit(d);
  }};
 return {directory,options,inputs,get calls(){return calls;},get branch(){return branch;}};
}

test('saved candidate patch replays without regenerating earlier design work or repeating paid calls',async()=>{
 const f=await fixture();let once=false;
 await assert.rejects(runDurableAssembly({...f.options,onStage:async r=>{if(!once&&r.length===4&&r.at(-1).state==='checking'){once=true;throw new Error('Saved candidate receipt crash');}}}),/Saved candidate receipt crash/);
 assert.equal(f.calls,4);const done=await runDurableAssembly(f.options);assert.equal(f.calls,8);assert.equal(done.summary.finalTextReviewAccepted,true);
 assert.equal(done.scene.palette[0].material,'quartz');assert.ok(done.scene.components.some(c=>c.id==='candidateGood'));
 assert.deepEqual(done.scene.components.find(c=>c.id==='candidateBad').at.offset,[1,0,0]);assert.deepEqual(done.summary.completedPackages,['exterior','interior']);
 const root=path.join(f.directory,f.branch,'assembly'),raw=JSON.parse(await fs.readFile(path.join(root,'4/response.json'))),effective=JSON.parse(await fs.readFile(path.join(root,'4/effective-edit.json')));
 assert.equal(raw.sceneEdit.palette.put.length,0);assert.equal(effective.sceneEdit.palette.put[0].material,'quartz');
 assert.ok(effective.sceneEdit.components.put.some(c=>c.id==='candidateGood'));
 await assert.rejects(readNativeBundle(path.join(root,'3/diagnostic')),/ENOENT|Diagnostic-only/);
 await runDurableAssembly(f.options);assert.equal(f.calls,8);
});

test('legacy design corrections, unknown outcomes and bounded format repair preserve their original semantics',async()=>{
 for(const settings of [{legacy:true},{unknown:true},{formatError:true}]){
  const f=await fixture(settings);
  if(settings.unknown){for(let i=0;i<2;i++)await assert.rejects(runDurableAssembly(f.options),/Unknown candidate edit outcome/);assert.equal(f.calls,4);}
  else{const done=await runDurableAssembly(f.options);assert.equal(done.summary.finalTextReviewAccepted,true);assert.equal(f.calls,settings.formatError?9:8);await runDurableAssembly(f.options);assert.equal(f.calls,settings.formatError?9:8);}
 }
});

test('terminal assessment reconstructs both candidate and accepted baselines from a frozen offline Bridge task',async()=>{
 const f=await fixture(),project=fileURLToPath(new URL('../../',import.meta.url));
 const frozen=await freezeSceneRuntime(project,path.join(f.directory,'runtimes'));
 const {startBridge}=await import(pathToFileURL(path.join(frozen.runtime,'bridge/server.mjs')));
 const dataDir=path.join(f.directory,'data'),adapter={close(){},async generate(args){
  const job=JSON.parse(await fs.readFile(path.join(args.cwd,'job.json')));
  return {spec:await f.options.invoke(args.prompt,f.calls+1,{...args,stageName:job.stageName})};
 }};
 const bridge=await startBridge({dataDir,adapter,claudeAdapter:adapter,deepseekAdapter:adapter});
 const startedAt=new Date().toISOString();let job;
 try{
  const call=async(route,body)=>{
   const r=await fetch('http://127.0.0.1:'+bridge.connection.port+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+bridge.connection.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
   assert.ok(r.ok);return r.json();
  };
  const submitted=await call('/v1/jobs',{...request,key:'offline-candidate-audit'});
  for(let i=0;i<500;i++){job=await call('/v1/jobs/'+submitted.id);if(['preview-ready','failed'].includes(job.state))break;await delay(20);}
  assert.equal(job.state,'preview-ready',job.error);assert.equal(f.calls,8);
 }finally{await bridge.close();}
 const finishedAt=new Date().toISOString(),protocol={type:'offline-engineering-fixture',maximumCalls:26};
 const ledger={protocol,protocolHash:hash(protocol),...frozen,maximumCalls:26,reservedCalls:job.assemblyCallsReserved,finishedAt,
  results:[{jobId:job.id,assetDirectory:path.join(dataDir,'jobs',job.id),state:job.state,assemblyCallsReserved:job.assemblyCallsReserved,assemblyStages:job.assemblyStages,startedAt,finishedAt}]};
 const ledgerFile=path.join(f.directory,'ledger.json'),output=path.join(f.directory,'assessment.json');
 await fs.writeFile(ledgerFile,JSON.stringify(ledger),{flag:'wx'});
 await promisify(execFile)(process.execPath,[path.join(project,'scripts/scene-assembly-assessment.mjs'),ledgerFile,output],{maxBuffer:1024*1024,windowsHide:true});
 const report=JSON.parse(await fs.readFile(output));assert.equal(report.state,'preview-ready');assert.equal(report.additionalModelCalls,0);assert.equal(report.geometryChangedByAssessment,false);
 assert.equal(report.final.assetHash,job.assetHash);assert.equal(report.assemblySummary.finalTextReviewAccepted,true);assert.equal(f.calls,8);
});
