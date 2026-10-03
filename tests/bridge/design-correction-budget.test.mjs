import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runDurableAssembly} from '../../bridge/assembly-durability.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {designCorrectionBudget} from '../../bridge/assembly-budget.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyPlan,packageEdit,planEdit,acceptReview} from '../design/assembly-fixtures.mjs';

const request={agent:'codex',model:'offline',prompt:'16×10×16格离线整体改稿纠错测试',generationMode:'scene',sceneWorkflow:'components',qualityTier:'ultra',assemblyRecovery:'safe',assemblyDesignReview:'text',assemblyConfirmed:true,maxRepairs:0};

test('actual five-call design failure can fund another correction plus seven packages, concept/final reviews and recovery',()=>{
 const t=generationPreflight(request).assembly;
 const b=designCorrectionBudget(t,Array(5).fill({}),{round:0,packageCount:7,correctionsUsed:2});
 assert.equal(b.correctionExtension,true);assert.equal(b.canStart,true);assert.equal(b.remaining,21);
 assert.equal(b.mandatoryCalls,3);assert.equal(b.reservedHeadroom,5);assert.equal(b.maximumPackages,13);
 const old=structuredClone(t);delete old.designReview.budgetedCorrections;
 assert.equal(designCorrectionBudget(old,Array(5).fill({}),{round:0,packageCount:7,correctionsUsed:2}).stopReason,'design-correction-limit');
 assert.equal(designCorrectionBudget(t,Array(12).fill({}),{round:0,packageCount:7,correctionsUsed:3}).stopReason,'design-correction-recovery-reserve');
 assert.equal(designCorrectionBudget(t,Array(5).fill({}),{round:0,packageCount:7,correctionsUsed:1}).canStart,true);
});

async function fixture({maximumCalls=26,legacy=false,unknown=false,repeat=false}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-design-correction-budget-'));
 const input={...request,assemblyCalls:maximumCalls},policy=generationPreflight(input);if(legacy)delete policy.assembly.designReview.budgetedCorrections;
 let calls=0,branch;const inputs=[];
 const options={directory,requestHash:hash(input),runtimeHash:'offline-design-correction-v1',policy,prompt:input.prompt,rules:'Offline fixture only',signal:new AbortController().signal,onStage:async()=>{},onRecovery:async r=>{if(r.branch)branch=r.branch;},
  invoke:async(prompt,n,o)=>{
   calls++;const d=JSON.parse(prompt.split('Assembly input (data):\n').at(-1));inputs.push({n,d,phase:o.stageName});
   if(n===1)return assemblyPlan();
   if(o.stageName==='concept-review')return {format:'SceneConceptReview',version:1,sourceHash:d.sourceHash,planHash:d.planHash,evidenceHash:d.designEvidence.evidenceHash,verdict:n===2?'revise':'accept',summary:'Offline engineering fixture only',issues:n===2?[{criterion:'materials',evidence:'Test original shell material',change:'Coordinate quartz material before freezing'}]:[]};
   if(o.stageName==='revise-design'||o.stageName==='correct-design'){
    if(n===6&&unknown)throw new Error('Unknown design extension outcome');
    if(n>=4){assert.equal(d.callBudget.correctionsUsed,n-4);assert.equal(d.callBudget.correctionExtension,n>=6);}
    const next=structuredClone(d.priorPlan);next.scene.palette[0].material='quartz';
    next.scene.components[0].size[1]=repeat?11:n<6?8+n:10;
    return planEdit(d.priorPlan,next);
   }
   return o.stageName==='review'?acceptReview(d):packageEdit(d);
  }};
 return {directory,inputs,options,get calls(){return calls;},get branch(){return branch;}};
}

test('third geometric design correction replays once, receives another concept review and finishes all packages',async()=>{
 const f=await fixture();let interrupted=false;
 await assert.rejects(runDurableAssembly({...f.options,onStage:async r=>{
  if(!interrupted&&r.length===6&&r.at(-1).state==='checking'){interrupted=true;throw new Error('Saved design correction receipt crash');}
 }}),/Saved design correction receipt crash/);
 assert.equal(f.calls,6);
 const done=await runDurableAssembly(f.options);assert.equal(f.calls,10);
 assert.equal(done.summary.reservedCalls,10);assert.equal(done.summary.finalTextReviewAccepted,true);assert.equal(done.summary.conceptReview.round,2);
 assert.deepEqual(done.summary.completedPackages,['exterior','interior']);assert.deepEqual(done.scene.bounds,assemblyPlan().scene.bounds);assert.deepEqual(done.scene.constraints,assemblyPlan().scene.constraints);
 assert.equal(done.scene.palette[0].material,'quartz');
 const b=JSON.parse(await fs.readFile(path.join(f.directory,f.branch,'assembly/5/design-correction-budget.json')));
 assert.equal(b.correctionExtension,true);assert.equal(b.canStart,true);assert.equal(b.currentPackageCount,2);
 await runDurableAssembly(f.options);assert.equal(f.calls,10);
});

test('unapproved revisions stop on old policy or protected reserves, never freeze or publish partial work',async()=>{
 for(const settings of [{legacy:true},{maximumCalls:12}]){
  const f=await fixture(settings);await assert.rejects(runDurableAssembly(f.options),/Architectural revision rejected/);assert.equal(f.calls,5);
  const b=JSON.parse(await fs.readFile(path.join(f.directory,f.branch,'assembly/5/design-correction-budget.json')));
  assert.equal(b.canStart,false);assert.equal(b.stopReason,settings.legacy?'design-correction-limit':'design-correction-recovery-reserve');
  await assert.rejects(fs.stat(path.join(f.directory,f.branch,'assembly/interfaces.json')),/ENOENT/);
  await assert.rejects(runDurableAssembly(f.options),/Architectural revision rejected/);assert.equal(f.calls,5);
 }
});

test('design correction extensions do not resend unknown requests or loop identical rejected proposals',async()=>{
 for(const settings of [{unknown:true},{repeat:true}]){
  const f=await fixture(settings),message=settings.unknown?/Unknown design extension outcome/:/Architectural correction made no progress/;
  for(let i=0;i<2;i++)await assert.rejects(runDurableAssembly(f.options),message);
  assert.equal(f.calls,settings.unknown?6:4);
 }
});
