import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../../src/generation/compiler.mjs';
import {referenceAssemblyPreflight} from '../../bridge/reference-assembly-policy.mjs';
import {runDurableAssembly} from '../../bridge/assembly-durability.mjs';
import {readJobReferenceInput} from '../../bridge/reference-generation-binding.mjs';
import {prepareAssemblyReferenceAnalysis,auditAssemblyReferenceAnalysis} from '../../bridge/assembly-reference-analysis.mjs';
import {referencePreparationOperation} from '../../bridge/reference-preparation-worker.mjs';
import {referenceFixture,referenceBrief,freeConsent} from './reference-generation-fixture.mjs';
import {assemblyPlan,packageEdit,acceptReview} from '../design/assembly-fixtures.mjs';
import {stagedRequest,stagedResponse} from './decomposed-assembly-fixtures.mjs';
import {requestNativeEvidence,acceptNativeEvidence} from '../../bridge/native-evidence.mjs';
import {fixtureUpload} from './native-evidence-fixtures.mjs';
import {CompletedResponseFormatError,parseModelJson} from '../../bridge/model-json.mjs';
import {completedFormatError} from '../fixtures/completed-format-error.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';

async function setup(t,options={}){
  const f=await referenceFixture(t,{version:2,...options});await f.confirm();
  const referenceInput=await f.bind(),reference=await readJobReferenceInput({directory:f.jobDirectory,input:referenceInput,
    model:f.generation.model,runtimeHash:f.runtimeHash}),calls=[],observations=[];
  const rules=await fs.readFile(new URL('../../prompts/scene-v1.md',import.meta.url),'utf8');
  const invoke=async(prompt,index,o)=>{
    const input=JSON.parse(prompt.split('Assembly input (data):\n').at(-1)),format=o.outputSchema.properties.format.enum[0];
    const saved=JSON.parse(await fs.readFile(path.join(f.jobDirectory,'assembly-journal',`call-${index}.json`)));
    assert.equal(saved.value.state,'pending');assert.equal(saved.value.index,index);
    calls.push({prompt,index,options:o,input});
    if(format==='ArchitectureReferenceBrief'){
      assert.deepEqual(o.referenceInput,referenceInput);assert.deepEqual(o.images,[]);
      assert.equal(input.referenceArchitecture,undefined);
      return referenceBrief(reference);
    }
    assert.equal(o.referenceInput,undefined,'Reference pixels are only sent to the prelude, not native review');
    assert.equal(input.referenceArchitecture.briefHash,hash(input.referenceArchitecture.brief));
    assert.equal(input.referenceArchitecture.brief.referenceBindingHash,referenceInput.bindingHash);
    assert.equal(input.referenceArchitecture.canAuthorizePlacement,false);
    assert.match(prompt,/UNTRUSTED design evidence/);
    if(f.generation.assemblyPrototypes==='staged')return stagedResponse(input,o);
    return format==='SceneAssemblyPlan'?assemblyPlan():format==='SceneAssemblyReview'?acceptReview(input):packageEdit(input);
  };
  return {f,referenceInput,reference,calls,observations,options:{directory:f.jobDirectory,
    requestHash:f.preparation.requestHash,runtimeHash:f.runtimeHash,policy:f.preparation.policy,prompt:f.generation.prompt,
    rules,referenceInput,signal:new AbortController().signal,invoke,onStage:async records=>observations.push(records),
    nativeEvidence:o=>requestNativeEvidence({...o,jobDirectory:f.jobDirectory,timeoutMs:2000,onWaiting:async s=>{
      if(s.state==='waiting')await acceptNativeEvidence(f.jobDirectory,s.id,fixtureUpload(s.request));
    }})}};
}

for(const qualityTier of ['lite','pro','max','ultra'])test(qualityTier+' uses one durable reference prelude and the complete ordinary component pipeline',async t=>{
  const h=await setup(t,{images:qualityTier==='lite'?1:4,generationOverrides:{qualityTier}}),result=await runDurableAssembly(h.options);
  assert.equal(h.calls.length,5);assert.equal(result.summary.reservedCalls,5);
  assert.deepEqual(result.records.map(r=>r.phase),['reference-analysis','plan','component','component','review']);
  assert.equal(result.summary.finalTextReviewAccepted,true);assert.equal(result.summary.completedPackages.length,2);
  assert.equal(result.summary.referenceAnalysis.sharedTaskBudget,true);
  assert.equal(result.summary.referenceAnalysis.referenceAngleComparisonVerified,false);
  const branch=(await fs.readdir(h.f.jobDirectory)).find(n=>n.startsWith('assembly-run-'));
  const evidence=JSON.parse(await fs.readFile(path.join(h.f.jobDirectory,branch,'assembly/reference-analysis.json')));
  const {analysisHash,...data}=evidence;assert.equal(hash(data),analysisHash);
  assert.equal(evidence.briefHash,hash(evidence.brief));assert.equal(evidence.canAuthorizePlacement,false);
  assert.equal(result.records.slice(1).every(r=>r.referenceAnalysisHash===analysisHash),true);
  const audit=await auditAssemblyReferenceAnalysis({...h.options,root:path.join(h.f.jobDirectory,branch,'assembly'),records:result.records});
  assert.equal(audit.originalBriefReceiptVerified,true);assert.equal(audit.downstreamBriefIdentityVerified,true);assert.equal(audit.auditedStages,5);
});

test('staged Ultra retains three concepts, four roles, five packages and final native review within 26 calls',async t=>{
  const {model:ignored,...generationOverrides}=stagedRequest;
  const h=await setup(t,{generationOverrides}),result=await runDurableAssembly(h.options);
  assert.equal(result.records.length,17);assert.equal(result.summary.completedPackages.length,5);
  assert.equal(result.summary.decomposition.requiredRoleStagesAccepted,4);assert.equal(result.summary.visualReviewCurrent,true);
  assert.equal(result.summary.finalTextReviewAccepted,true);assert.equal(result.scene.bounds.height,224);
  assert.equal(h.f.preparation.policy.assembly.prototypes.recoveryReserve,9);
  const blueprint=h.calls.find(c=>c.options.stageName==='assembly-blueprint');
  assert.equal(blueprint.input.callBudget.version,2);assert.equal(blueprint.input.callBudget.completedPrelude,1);
  assert.equal(blueprint.input.callBudget.consumedRecovery,0,'Mandatory analysis is not counted as a recovery call');
  assert.equal(blueprint.input.callBudget.maximumPackages,5);
  const branch=(await fs.readdir(h.f.jobDirectory)).find(n=>n.startsWith('assembly-run-'));
  const schedule=JSON.parse(await fs.readFile(path.join(h.f.jobDirectory,branch,'assembly/decomposition-schedule.json')));
  assert.equal(schedule.version,2);assert.equal(schedule.preludeCalls,1);
  assert.equal(schedule.stages[0].phase,'reference-analysis');assert.equal(schedule.stages.length,17);
  assert.equal(schedule.recoveryReserve,9);
  const audit=await auditAssemblyReferenceAnalysis({...h.options,root:path.join(h.f.jobDirectory,branch,'assembly'),records:result.records});
  assert.equal(audit.auditedStages,17);assert.equal(audit.originalBriefReceiptVerified,true);
});

test('independent audit rejects rehashed briefs, substituted original answers and changed downstream data',async t=>{
  const h=await setup(t),result=await runDurableAssembly(h.options);
  const branch=(await fs.readdir(h.f.jobDirectory)).find(n=>n.startsWith('assembly-run-')),root=path.join(h.f.jobDirectory,branch,'assembly');
  const audit=()=>auditAssemblyReferenceAnalysis({...h.options,root,records:result.records});
  assert.equal((await audit()).downstreamBriefIdentityVerified,true);
  for(const [name,change] of [
    ['reference-analysis.json',v=>{v.brief.limitations.push('Forged new analysis');v.briefHash=hash(v.brief);const {analysisHash,...data}=v;v.analysisHash=hash(data);}],
    ['1/response.json',v=>v.limitations.push('Substituted original provider answer')],
    ['2/input.json',v=>v.referenceArchitecture.brief.scaleAssumptions[0].meters=224],
    ['1/reference-brief.json',v=>v.limitations.push('Changed saved accepted brief')]
  ]){
    const file=path.join(root,name),bytes=await fs.readFile(file),value=JSON.parse(bytes);change(value);
    await fs.writeFile(file,JSON.stringify(value));await assert.rejects(audit());await fs.writeFile(file,bytes);
  }
  assert.equal((await audit()).originalBriefReceiptVerified,true);assert.equal(h.calls.length,5);
});

test('v2 binds request hash to runtime and policy; v1 request-hash semantics remain unchanged',async t=>{
  const h=await setup(t),p=h.f.preparation;
  assert.equal(p.version,2);
  assert.equal(p.requestHash,hash({version:2,generation:p.generation,referenceSetHash:p.referenceSetHash,policyHash:hash(p.policy),runtimeHash:p.runtimeHash}));
  const changed=await h.f.prepare({runtimeHash:'b'.repeat(64)});
  assert.notEqual(changed.requestHash,p.requestHash);
  await assert.rejects(h.f.confirm(changed,{input:Buffer.from(JSON.stringify(freeConsent(p)))}),/no longer matches/);
  const old=await referenceFixture(t);assert.equal(old.preparation.requestHash,hash({version:1,generation:old.generation,referenceSetHash:old.preparation.referenceSetHash}));
  assert.deepEqual(generationPreflight(old.generation),old.preparation.policy);
});

test('v2 rejects missing confirmation, non-safe recovery, insufficient tail and ordinary reference-field bypass',async t=>{
  const h=await setup(t);
  for(const edit of [{assemblyConfirmed:false},{assemblyConfirmed:undefined},{assemblyRecovery:undefined},{assemblyRecovery:'retry'},
    {assemblyCalls:4},{agent:'claude'},{sceneWorkflow:'checkpoints'},{generationMode:'single'}])
    assert.throws(()=>referenceAssemblyPreflight({...h.f.generation,...edit}));
  const bare=referenceAssemblyPreflight({...h.f.generation,assemblyCalls:5});assert.equal(bare.assembly.maxPackages,2);
  assert.equal(bare.maximumCalls,5);assert.equal(bare.maxOutputTokens,null);
  for(const assemblyCalls of [22,23,24,25,26]){
    const policy=referenceAssemblyPreflight({...stagedRequest,model:h.f.generation.model,assemblyCalls});
    assert.equal(policy.maximumCalls,assemblyCalls);assert.equal(policy.assembly.maxPackages,assemblyCalls===26?5:4);
    assert.equal(policy.assembly.prototypes.recoveryReserve,Math.min(10,assemblyCalls-15)-1);
  }
  assert.throws(()=>generationPreflight({...h.f.generation,referenceInput:h.referenceInput}),/versioned reference/);
});

test('legacy preparation, mismatched policy/runtime/prompt and missing input cannot authorize the prelude',async t=>{
  const h=await setup(t),old=await referenceFixture(t);await old.confirm();const oldInput=await old.bind();
  for(const edit of [{referenceInput:undefined},{policy:generationPreflight(h.f.generation)},{runtimeHash:'b'.repeat(64)},
    {prompt:'Changed after SEND'},{referenceInput:oldInput,directory:old.jobDirectory,policy:old.preparation.policy,runtimeHash:old.runtimeHash}])
    await assert.rejects(prepareAssemblyReferenceAnalysis({directory:h.f.jobDirectory,...h.options,...edit}));
  assert.equal(h.calls.length,0);
});

test('rejected brief is corrected once in the same ledger and its original answer is retained',async t=>{
  const h=await setup(t),invoke=h.options.invoke;
  h.options.invoke=async(p,i,o)=>{const result=await invoke(p,i,o);if(i===1)result.canAuthorizePlacement=true;return result;};
  const result=await runDurableAssembly(h.options);assert.equal(result.records.length,6);
  assert.deepEqual(result.records.slice(0,2).map(r=>[r.phase,r.state]),[['reference-analysis','rejected'],['correct-reference-analysis','accepted']]);
  const original=JSON.parse(await fs.readFile(path.join(h.f.jobDirectory,'assembly-journal/call-1.json')));
  assert.equal(original.value.response.canAuthorizePlacement,true);
  assert.equal(result.records[1].referenceBindingHash,h.referenceInput.bindingHash);
});

test('failed reference correction stops before geometry and never silently falls back to text',async t=>{
  const h=await setup(t),invoke=h.options.invoke;
  h.options.invoke=async(p,i,o)=>{const result=await invoke(p,i,o);result.canAuthorizePlacement=true;result.limitations.push('distinct '+i);return result;};
  await assert.rejects(runDurableAssembly(h.options),/Reference analysis failed/);
  assert.equal(h.calls.length,2);assert.ok(h.calls.every(c=>c.options.referenceInput));
  assert.ok(h.observations.at(-1).every(r=>r.state==='rejected'));
});

test('known completed format correction retains exact attachments and shares the task budget',async t=>{
  const h=await setup(t),invoke=h.options.invoke;let starts=0;
  h.options.invoke=async(p,i,o)=>{starts++;if(i===1)throw await completedFormatError(h.f.jobDirectory,CompletedResponseFormatError,parseModelJson,undefined,'codex');return invoke(p,i,o);};
  const result=await runDurableAssembly(h.options);assert.equal(starts,6);assert.equal(result.summary.formatCorrections,1);
  assert.equal(result.records[0].invocationOutcome,'completed-invalid-json');
  assert.equal(h.calls[0].input.formatCorrection.stage,1);assert.deepEqual(h.calls[0].options.referenceInput,h.referenceInput);
  assert.equal(result.summary.referenceAnalysis.stage,2);
});

test('minimum funded task cannot spend its mandatory building tail on an analysis correction',async t=>{
  const h=await setup(t,{generationOverrides:{assemblyCalls:5}}),invoke=h.options.invoke;
  h.options.invoke=async(p,i,o)=>{const result=await invoke(p,i,o);result.canAuthorizePlacement=true;return result;};
  await assert.rejects(runDurableAssembly(h.options),/required complete-task tail/);
  assert.equal(h.calls.length,1);
});

test('unknown original analysis stays reserved and recovery reads the original receipt without a second turn',async t=>{
  const h=await setup(t),invoke=h.options.invoke;let unknown=true,recovered=0;
  h.options.invoke=async(p,i,o)=>{
    if(i===1&&unknown){unknown=false;await o.onProviderBinding({version:1,provider:'codex',storage:'persistent-single-turn',
      threadId:'original-reference-thread',turnId:'original-reference-turn',model:h.f.generation.model,effort:'max',requestHash:hash(p)});
      throw Error('Offline observation lost; original provider outcome unknown');}
    return invoke(p,i,o);
  };
  await assert.rejects(runDurableAssembly(h.options),/outcome unknown/);assert.equal(h.calls.length,0);
  const pending=JSON.parse(await fs.readFile(path.join(h.f.jobDirectory,'assembly-journal/call-1.json')));
  assert.equal(pending.value.state,'pending');
  h.options.recoverInvocation=async(p,i,o,binding)=>{
    recovered++;assert.equal(i,1);assert.equal(binding.turnId,'original-reference-turn');
    assert.deepEqual(o.referenceInput,h.referenceInput);return referenceBrief(h.reference);
  };
  const result=await runDurableAssembly(h.options);assert.equal(recovered,1);assert.equal(result.records.length,5);
  assert.equal(h.calls.length,4);assert.equal(result.summary.finalTextReviewAccepted,true);
});

test('replay rejects altered task-owned image pixels before any further provider invocation',async t=>{
  const h=await setup(t),invoke=h.options.invoke;
  h.options.invoke=async(p,i,o)=>{if(i===2)throw Error('Offline stop before geometry');return invoke(p,i,o);};
  await assert.rejects(runDurableAssembly(h.options),/before geometry/);
  const before=h.calls.length,file=h.reference.images[0],bytes=await fs.readFile(file);bytes[bytes.length-1]^=1;await fs.writeFile(file,bytes);
  h.options.invoke=invoke;
  await assert.rejects(runDurableAssembly(h.options));assert.equal(h.calls.length,before);
});

test('rehashed v2 preparation policy cannot remove or reshape mandatory reference analysis',async t=>{
  const h=await setup(t),p=h.f.preparation,{preparationHash,...data}=structuredClone(p);
  data.policy.assembly.referenceAnalysis.maximumCorrections=9;
  data.requestHash=hash({version:2,generation:data.generation,referenceSetHash:data.referenceSetHash,policyHash:hash(data.policy),runtimeHash:data.runtimeHash});
  const forgedHash=hash(data),folder=path.join(h.f.dataDir,'reference-drafts',h.f.ownerId,'preparations',forgedHash);
  await fs.mkdir(folder);await fs.writeFile(path.join(folder,'preparation.json'),JSON.stringify({...data,preparationHash:forgedHash}));
  await assert.rejects(referencePreparationOperation({dataDir:h.f.dataDir,ownerId:h.f.ownerId,operation:'get',preparationHash:forgedHash}));
});
