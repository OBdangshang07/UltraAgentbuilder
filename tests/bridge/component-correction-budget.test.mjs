import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runDurableAssembly} from '../../bridge/assembly-durability.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {componentCorrectionBudget} from '../../bridge/assembly-budget.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyPlan,packageEdit,packageResponse,acceptReview} from '../design/assembly-fixtures.mjs';
import {shape} from '../design/fixtures.mjs';

const request={agent:'codex',model:'offline',prompt:'16×10×16格离线纠错预算测试',generationMode:'scene',sceneWorkflow:'components',qualityTier:'ultra',assemblyRecovery:'safe',assemblyDesignReview:'text',assemblyConfirmed:true,maxRepairs:0};
const tier=()=>generationPreflight(request).assembly;

test('actual 11/26 package failure has room for a third correction while funding six pending packages and recovery',()=>{
 const t=tier(),before=structuredClone(t),records=Array.from({length:11},()=>({state:'rejected'}));
 const b=componentCorrectionBudget(t,records,{correctionsUsed:2,pendingPackages:6});
 assert.equal(b.extension,true);assert.equal(b.canStart,true);assert.equal(b.remaining,15);
 assert.equal(b.mandatoryCalls,8);assert.equal(b.reservedHeadroom,4);
 assert.deepEqual(b.recoveryReserve,{componentCorrections:2,reviewCorrection:1,formatCorrection:1});
 assert.equal(componentCorrectionBudget(t,Array(15).fill({}),{correctionsUsed:3,pendingPackages:6}).stopReason,'component-recovery-reserve');
 assert.deepEqual(t,before);assert.equal(t.maximumCalls,26);
});

test('legacy policies cannot acquire extensions; basic corrections still work on tight confirmed budgets',()=>{
 const t=tier();delete t.componentCorrection;
 assert.equal(componentCorrectionBudget(t,[],{correctionsUsed:2,pendingPackages:1}).stopReason,'component-correction-limit');
 const p=tier();p.maximumCalls=8;
 assert.equal(componentCorrectionBudget(p,Array(5).fill({}),{correctionsUsed:1,pendingPackages:1}).canStart,true);
 assert.equal(componentCorrectionBudget(p,Array(6).fill({}),{correctionsUsed:1,pendingPackages:1}).stopReason,'component-call-budget');
 assert.equal(componentCorrectionBudget(p,Array(5).fill({}),{correctionsUsed:2,pendingPackages:1}).stopReason,'component-recovery-reserve');
});

test('all reserved outcomes consume calls and the format reserve releases only after a recorded format correction',()=>{
 const records=Array.from({length:18},(_,i)=>({state:i%2?'failed':'reserved'}));
 const a=componentCorrectionBudget(tier(),records,{correctionsUsed:2,pendingPackages:3});
 assert.equal(a.remaining,8);assert.equal(a.canStart,false);
 records[17].formatCorrectionOf=17;
 const b=componentCorrectionBudget(tier(),records,{correctionsUsed:2,pendingPackages:3});
 assert.equal(b.remaining,8);assert.equal(b.recoveryReserve.formatCorrection,0);assert.equal(b.canStart,true);
 assert.equal(componentCorrectionBudget(tier(),[],{correctionsUsed:2,pendingPackages:0}).recoveryReserve.componentCorrections,0);
 for(const delta of [{correctionsUsed:-1,pendingPackages:0},{correctionsUsed:2,pendingPackages:NaN}])assert.throws(()=>componentCorrectionBudget(tier(),[],delta));
});

async function fixture({maximumCalls=26,legacy=false,repeat=false,unknown=false,cancel=false}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-component-budget-'));
 const input={...request,assemblyCalls:maximumCalls},policy=generationPreflight(input);
 if(legacy)delete policy.assembly.componentCorrection;
 const controller=new AbortController(),inputs=[];let calls=0,branch,records=[];
 const options={directory,requestHash:hash(input),runtimeHash:'offline-component-budget-v1',policy,prompt:input.prompt,rules:'Offline fixture only',signal:controller.signal,
  onRecovery:async r=>{if(r.branch)branch=r.branch;},onStage:async r=>{records=r;},
  invoke:async(prompt,n,o)=>{
   calls++;const data=JSON.parse(prompt.split('Assembly input (data):\n').at(-1));inputs.push({n,data});
   if(n===1)return assemblyPlan();
   if(n===2)return {format:'SceneConceptReview',version:1,sourceHash:data.sourceHash,planHash:data.planHash,evidenceHash:data.designEvidence.evidenceHash,verdict:'accept',summary:'Offline fixture only',issues:[]};
   if(o.stageName==='review')return acceptReview(data);
   const edit=packageEdit(data);
   if(n===3)edit.components.put=[shape('exterior__bad',[2,1,0],[1,1,1],'frame'),shape('exterior__preserve',[0,1,0],[1,1,1],'frame')];
   if(n>=4&&data.task.id==='exterior'){
    assert.equal(o.outputSchema.properties.format.enum[0],'ScenePackageRepair');
    assert.ok(o.outputSchema.properties.edit.anyOf.length);
    assert.match(prompt,/MANDATORY REPAIR/);
    assert.equal(data.repairRequirement.status,'rejected-candidate-must-change');
    assert.equal(data.repairRequirement.candidateHash,data.repairBase.candidateHash);
    assert.equal(data.correctionBudget.correctionsUsed,n-4);
    assert.equal(data.correctionBudget.extension,n>=6);
    if(n===6&&unknown)throw new Error('Unknown extension outcome');
    if(n===6&&cancel)controller.abort(new Error('Cancelled extension fixture'));
    const part=structuredClone(data.repairBase.scene.components.find(c=>c.id==='exterior__bad'));
    part.at.offset=repeat?[2,1,0]:n===4?[1,1,2]:n===5?[0,1,2]:[1,1,0];edit.components.put=[part];
   }
   return packageResponse(data,edit);
  }};
 return {options,directory,inputs,get calls(){return calls;},get branch(){return branch;},get records(){return records;}};
}

test('third correction finishes the original task, preserves valid candidate work and is crash-replay safe',async()=>{
 const f=await fixture();let interrupted=false;
 await assert.rejects(runDurableAssembly({...f.options,onStage:async records=>{
  if(!interrupted&&records.length===6&&records.at(-1).state==='checking'){interrupted=true;throw new Error('Saved extension receipt crash');}
 }}),/Saved extension receipt crash/);
 assert.equal(f.calls,6);
 const done=await runDurableAssembly(f.options);
 assert.equal(f.calls,8);assert.equal(done.summary.reservedCalls,8);assert.equal(done.summary.finalTextReviewAccepted,true);
 assert.deepEqual(done.summary.completedPackages,['exterior','interior']);
 assert.deepEqual(done.scene.constraints,assemblyPlan().scene.constraints);
 assert.deepEqual(done.scene.components.find(c=>c.id==='exterior__preserve'),shape('exterior__preserve',[0,1,0],[1,1,1],'frame'));
 assert.deepEqual(done.scene.components.find(c=>c.id==='exterior__bad').at.offset,[1,1,0]);
 const budget=JSON.parse(await fs.readFile(path.join(f.directory,f.branch,'assembly/5/correction-budget.json')));
 assert.equal(budget.extension,true);assert.equal(budget.canStart,true);assert.equal(budget.pendingPackages,1);
 await runDurableAssembly(f.options);assert.equal(f.calls,8);
});

test('insufficient spare budget and old confirmed strategy both stop without publishing an unfinished task',async()=>{
 for(const settings of [{maximumCalls:9},{legacy:true}]){
  const f=await fixture(settings);
  await assert.rejects(runDurableAssembly(f.options),/Required package exterior failed/);
  assert.equal(f.calls,5);
  const budget=JSON.parse(await fs.readFile(path.join(f.directory,f.branch,'assembly/5/correction-budget.json')));
  assert.equal(budget.canStart,false);assert.equal(budget.stopReason,settings.legacy?'component-correction-limit':'component-recovery-reserve');
  await assert.rejects(fs.stat(path.join(f.directory,f.branch,'assembly/summary.json')),/ENOENT/);
  await assert.rejects(runDurableAssembly(f.options),/Required package exterior failed/);assert.equal(f.calls,5);
 }
});

test('a small repair wrapper cannot conceal the exact same rejected candidate',async()=>{
 const f=await fixture({repeat:true});
 await assert.rejects(runDurableAssembly(f.options),/Component correction made no progress/);
 assert.equal(f.calls,4);
 const budget=JSON.parse(await fs.readFile(path.join(f.directory,f.branch,'assembly/4/correction-budget.json')));
 assert.equal(budget.stopReason,'component-no-progress');assert.equal(budget.canStart,false);
});

test('unknown extension outcome and cancellation never dispatch again or publish a partial building',async()=>{
 for(const settings of [{unknown:true},{cancel:true}]){
  const f=await fixture(settings);
  for(let run=0;run<2;run++)await assert.rejects(runDurableAssembly(f.options),/Unknown extension outcome|Cancelled extension fixture/);
  assert.equal(f.calls,6);
  assert.equal((await fs.readdir(path.join(f.directory,'assembly-journal'))).filter(n=>/^call-\d+\.json$/.test(n)).length,6);
  await assert.rejects(fs.stat(path.join(f.directory,f.branch,'assembly/summary.json')),/ENOENT/);
 }
});
