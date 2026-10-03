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

async function fixture(){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-package-repair-'));
 const request={key:'patch-fixture',agent:'codex',model:'offline',prompt:'16×10×16格的离线测试',generationMode:'scene',sceneWorkflow:'components',qualityTier:'ultra',assemblyRecovery:'safe',assemblyDesignReview:'text',assemblyConfirmed:true,maxRepairs:0};
 let calls=0;const inputs=[];
 const invoke=async(prompt,n,options)=>{
  calls++;const input=JSON.parse(prompt.split('Assembly input (data):\n').at(-1)),format=options.outputSchema.properties.format.enum[0];inputs.push({n,format,input});
  if(n===1)return assemblyPlan();
  if(n===2)return {format:'SceneConceptReview',version:1,sourceHash:input.sourceHash,planHash:input.planHash,evidenceHash:input.designEvidence.evidenceHash,verdict:'accept',summary:'Offline fixture',issues:[]};
  if(format==='SceneAssemblyReview')return acceptReview(input);
  const edit=packageEdit(input);
  if(n===3)edit.components.put=[shape('exterior__bad',[2,1,0],[1,1,1],'frame'),shape('exterior__preserve',[0,1,0],[1,1,1],'frame')];
  if(n===4||n===5){
   assert.equal(format,'ScenePackageRepair');assert.equal(input.repairBase.approved,false);assert.equal(input.repairBase.canAuthorizePlacement,false);
   const spatial=input.critique.feedback.packageSpatialFeedback;assert.ok(spatial);assert.equal(spatial.canAuthorizePlacement,false);
   assert.equal(spatial.candidateSourceHash,input.repairBase.candidateHash);assert.equal(spatial.acceptedSourceHash,input.sourceHash);
   const part=structuredClone(input.repairBase.scene.components.find(c=>c.id==='exterior__bad'));
   part.at.offset=n===4?[1,1,2]:[1,1,0];edit.components.put=[part];
   const kept=input.repairBase.scene.components.find(c=>c.id==='exterior__preserve');assert.deepEqual(kept,shape('exterior__preserve',[0,1,0],[1,1,1],'frame'));
  }
  return packageResponse(input,edit);
 };
 return {directory,inputs,invoke,get calls(){return calls;},options:{directory,requestHash:hash(request),runtimeHash:'isolated-package-repair-test',policy:generationPreflight(request),prompt:request.prompt,rules:'Offline fixture rules',signal:new AbortController().signal,onStage:async()=>{}}};
}

test('successive candidate patches survive receipt crashes without regenerating whole packages or spending extra calls',async()=>{
 for(const at of [4,5]){
  const f=await fixture();let interrupted=false;
  await assert.rejects(runDurableAssembly({...f.options,invoke:f.invoke,onStage:async records=>{
   if(!interrupted&&records.at(-1).index===at&&records.at(-1).state==='checking'){interrupted=true;throw new Error('Fixture receipt crash');}
  }}),/receipt crash/);
  assert.equal(f.calls,at);
  const done=await runDurableAssembly({...f.options,invoke:f.invoke});
  assert.equal(f.calls,7);assert.equal(done.summary.reservedCalls,7);assert.equal(done.summary.finalTextReviewAccepted,true);
  assert.deepEqual(done.records.map(r=>r.state),['accepted','accepted','rejected','rejected','accepted','accepted','accepted']);
  assert.deepEqual(done.scene.components.find(c=>c.id==='exterior__preserve'),shape('exterior__preserve',[0,1,0],[1,1,1],'frame'));
  assert.deepEqual(done.scene.components.find(c=>c.id==='exterior__bad').at.offset,[1,1,0]);
  const repairs=f.inputs.filter(v=>v.format==='ScenePackageRepair');assert.equal(repairs.length,2);
  assert.equal(repairs[0].input.sourceHash,repairs[1].input.sourceHash);assert.notEqual(repairs[0].input.repairBase.candidateHash,repairs[1].input.repairBase.candidateHash);
  await runDurableAssembly({...f.options,invoke:f.invoke});assert.equal(f.calls,7);
 }
});

test('unknown package patch outcomes retain reservation and never dispatch again on recovery',async()=>{
 const f=await fixture();let attempted=0;
 const invoke=async(p,n,o)=>{attempted++;if(n===4)throw new Error('Unknown provider patch outcome');return f.invoke(p,n,o);};
 for(let i=0;i<2;i++)await assert.rejects(runDurableAssembly({...f.options,invoke}),/Unknown provider patch outcome/);
 assert.equal(attempted,4);assert.equal(f.calls,3);
 const envelope=JSON.parse(await fs.readFile(path.join(f.directory,'assembly-journal/call-4.json')));assert.equal(envelope.value.state,'error');
 assert.equal((await fs.readdir(path.join(f.directory,'assembly-journal'))).filter(n=>/^call-/.test(n)).length,4);
});

test('completed invalid patch JSON uses one bounded format correction without losing candidate identity',async()=>{
 const f=await fixture();let attempted=0;
 const invoke=async(p,n,o)=>{attempted++;if(n===4)throw await completedFormatError(f.directory,CompletedResponseFormatError,parseModelJson,undefined,'codex');return f.invoke(p,n,o);};
 const result=await runDurableAssembly({...f.options,invoke});
 assert.equal(attempted,7);assert.equal(result.summary.formatCorrections,1);assert.equal(result.summary.finalTextReviewAccepted,true);
 assert.equal(result.records[4].formatCorrectionOf,4);assert.equal(result.records[4].state,'accepted');
 assert.deepEqual(result.scene.components.find(c=>c.id==='exterior__preserve'),shape('exterior__preserve',[0,1,0],[1,1,1],'frame'));
 await runDurableAssembly({...f.options,invoke});assert.equal(attempted,7);
});
