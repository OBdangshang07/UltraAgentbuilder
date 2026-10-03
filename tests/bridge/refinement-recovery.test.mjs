import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runDurableAssembly} from '../../bridge/assembly-durability.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyPlan,packageEdit,packageResponse,acceptReview} from '../design/assembly-fixtures.mjs';
import {shape} from '../design/fixtures.mjs';
import {CompletedResponseFormatError,parseModelJson} from '../../bridge/model-json.mjs';
import {completedFormatError} from '../fixtures/completed-format-error.mjs';

async function fixture({budget=26,alwaysReject=false,reviewRounds,invalidFormat=false}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-refine-recovery-'));
 const request={key:'refinement-test',agent:'codex',model:'offline',prompt:'16×10×16格离线测试',generationMode:'scene',sceneWorkflow:'components',qualityTier:'ultra',assemblyCalls:budget,assemblyRecovery:'safe',assemblyDesignReview:'text',assemblyConfirmed:true,maxRepairs:0};
 const policy=generationPreflight(request);if(reviewRounds)policy.assembly.reviewRounds=reviewRounds;
 let calls=0,reviews=0,corrections=0;const inputs=[];
 const invoke=async(prompt,n,options)=>{
  calls++;const input=JSON.parse(prompt.split('Assembly input (data):\n').at(-1)),format=options.outputSchema.properties.format.enum[0];inputs.push({n,input,format});
  if(n===1)return assemblyPlan();
  if(format==='SceneConceptReview')return {format,version:1,sourceHash:input.sourceHash,planHash:input.planHash,evidenceHash:input.designEvidence.evidenceHash,verdict:'accept',summary:'Offline fixture',issues:[]};
  if(format==='SceneAssemblyReview'){
   if(++reviews===1||alwaysReject)return {...acceptReview(input),verdict:'revise',task:'exterior',issues:[{task:'exterior',criterion:'materials',evidence:'exterior__detail in fixture',change:'Refine this owned component'}]};
   return acceptReview(input);
  }
  const edit=packageEdit(input);
  if(options.stageName==='refine-component'){
   assert.equal(input.refinement,true);
   if(invalidFormat&&!input.formatCorrection)throw await completedFormatError(directory,CompletedResponseFormatError,parseModelJson,undefined,'codex');
   edit.components.put=[shape('exterior__detail',[2,1,0],[1,1,1],'wall')];
  }
  if(format==='ScenePackageRepair'){
   corrections++;assert.equal(input.refinement,true);
   edit.components.put=[shape('exterior__detail',alwaysReject?[3+corrections,1,0]:[1,1,0],[1,1,1],'wall')];
  }
  return packageResponse(input,edit);
 };
 return {directory,inputs,invoke,get calls(){return calls;},options:{directory,requestHash:hash(request),runtimeHash:'offline-refinement-recovery',policy,prompt:request.prompt,rules:'Offline fixture rules',signal:new AbortController().signal,onStage:async()=>{}}};
}

test('failed final refinement gets a bounded candidate patch then a review of the actual repaired source',async()=>{
 const f=await fixture(),done=await runDurableAssembly({...f.options,invoke:f.invoke});
 assert.equal(f.calls,8);assert.equal(done.summary.finalTextReviewAccepted,true);assert.equal(done.summary.finalTextReviewCurrent,true);
 assert.deepEqual(done.records.map(s=>s.phase),['plan','concept-review','component','component','review','refine-component','correct-component','review']);
 assert.equal(done.records[5].state,'rejected');assert.equal(done.records[6].state,'accepted');
 assert.equal(f.inputs[6].input.repairBase.candidateHash,done.records[5].sourceHash);
 assert.equal(f.inputs[7].input.sourceHash,hash(done.scene));
 await runDurableAssembly({...f.options,invoke:f.invoke});assert.equal(f.calls,8);
});

test('refinement patch receipt interruptions resume without a duplicate provider call',async()=>{
 const f=await fixture();let interrupted=false;
 await assert.rejects(runDurableAssembly({...f.options,invoke:f.invoke,onStage:async records=>{
  if(!interrupted&&records.at(-1).index===7&&records.at(-1).state==='checking'){interrupted=true;throw new Error('Offline patch receipt interruption');}
 }}),/receipt interruption/);
 assert.equal(f.calls,7);const done=await runDurableAssembly({...f.options,invoke:f.invoke});
 assert.equal(f.calls,8);assert.equal(done.summary.finalTextReviewAccepted,true);
});

test('unknown refinement patch outcomes are reserved once and never redispatched',async()=>{
 const f=await fixture();let attempts=0;
 const invoke=async(p,n,o)=>{attempts++;if(n===7)throw new Error('Unknown refinement outcome');return f.invoke(p,n,o);};
 for(let i=0;i<2;i++)await assert.rejects(runDurableAssembly({...f.options,invoke}),/Unknown refinement outcome/);
 assert.equal(attempts,7);assert.equal(f.calls,6);
});

test('unsolved refinement retains the reviewed previous source after at most two corrections',async()=>{
 const f=await fixture({alwaysReject:true}),done=await runDurableAssembly({...f.options,invoke:f.invoke});
 assert.equal(f.calls,8);assert.equal(done.summary.stopReason,'candidate-rejected-previous-preserved');
 assert.equal(done.summary.finalTextReviewCurrent,true);assert.equal(done.summary.finalTextReviewAccepted,false);
 assert.equal(hash(done.scene),f.inputs[4].input.sourceHash);
 assert.equal(done.records.filter(s=>s.phase==='correct-component').length,2);
});

test('safe refinement reserves both a call and a review round, rather than leaving an unreviewed changed source',async()=>{
 for(const options of [{budget:6},{reviewRounds:1}]){
  const f=await fixture(options),done=await runDurableAssembly({...f.options,invoke:f.invoke});
  assert.equal(f.calls,5);assert.equal(done.summary.finalTextReviewCurrent,true);assert.equal(done.summary.finalTextReviewAccepted,false);
  assert.ok(['revision-budget','review-round-budget'].includes(done.summary.stopReason));
 }
 const f=await fixture({budget:7,alwaysReject:true}),done=await runDurableAssembly({...f.options,invoke:f.invoke});
 assert.equal(f.calls,6);assert.equal(done.summary.finalTextReviewCurrent,true);assert.equal(done.records.at(-1).state,'rejected');
});

test('a completed format correction during refinement still leaves budget for repair and final review',async()=>{
 const f=await fixture({budget:9,invalidFormat:true}),done=await runDurableAssembly({...f.options,invoke:f.invoke});
 assert.equal(f.calls,9);assert.equal(done.summary.formatCorrections,1);assert.equal(done.summary.finalTextReviewAccepted,true);
 assert.equal(done.records[6].formatCorrectionOf,6);
});
