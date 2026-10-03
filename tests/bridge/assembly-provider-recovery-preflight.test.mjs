import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../../src/generation/compiler.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {validateReferencePreparation} from '../../contracts/reference-preparation.mjs';
import {assemblyProviderRecoveryPolicy} from '../../contracts/assembly-provider-recovery.mjs';
import {referencePreparationOperation} from '../../bridge/reference-preparation-worker.mjs';
import {bindReferencePreparationToJob} from '../../bridge/reference-generation-binding.mjs';
import {recoveryRequest} from './assembly-provider-recovery-fixtures.mjs';
import {stagedRequest} from './decomposed-assembly-fixtures.mjs';
import {referenceFixture,freeConsent,sendConsent} from './reference-generation-fixture.mjs';

const request={...recoveryRequest,assemblyProviderRecovery:'bounded'};

test('omitted recovery keeps both historical policy hashes and zero retries unchanged',()=>{
  assert.equal(hash(generationPreflight(recoveryRequest)),'098383b3cab834d5921280e363f787deec8cf695448937ce3fa8843af423febc');
  assert.equal(hash(generationPreflight(stagedRequest)),'4476ebeb9ff21cbc4d92c2f4c953a367070396a8305876d35567024d6b7cf12a');
  for(const input of [recoveryRequest,stagedRequest]){
    const p=generationPreflight(input);assert.equal(p.assembly.providerRetries,0);assert.equal(p.assembly.providerRecovery,undefined);
    assert.equal(p.warnings.some(w=>w.includes('容量恢复')),false);
  }
});

test('explicit bounded preflight freezes the fixed contract, not a larger budget or smaller path',()=>{
  for(const assemblyCalls of [5,7,26]){
    const old=generationPreflight({...recoveryRequest,assemblyCalls}),p=generationPreflight({...request,assemblyCalls,assemblyConfirmed:false});
    assert.equal(p.maximumCalls,old.maximumCalls);assert.equal(p.assembly.maxPackages,old.assembly.maxPackages);
    assert.equal(p.maxOutputTokens,null);assert.equal(p.budgetSource,'agent-default');assert.equal(p.assembly.providerRetries,2);
    assert.deepEqual(p.assembly.providerRecovery,assemblyProviderRecoveryPolicy());
    assert.match(p.warnings.join('\n'),/10 \/ 30 秒/);assert.match(p.warnings.join('\n'),/未知、截断或部分输出不重发/);
    // A caller cannot mutate the fixed contract used by another preflight.
    p.assembly.providerRecovery.waitMs[0]=0;assert.equal(generationPreflight(request).assembly.providerRecovery.waitMs[0],10000);
  }
  const legacy=generationPreflight(stagedRequest),bounded=generationPreflight({...stagedRequest,agent:'codex',effort:'max',assemblyProviderRecovery:'bounded'});
  assert.equal(bounded.maximumCalls,legacy.maximumCalls);assert.deepEqual(bounded.assembly.prototypes,legacy.assembly.prototypes);
  assert.equal(bounded.assembly.maxPackages,legacy.assembly.maxPackages);
});

test('only the new Codex safe component lane and an explicit model/effort can request recovery',()=>{
  const changes=[{assemblyProviderRecovery:null},{assemblyProviderRecovery:true},{assemblyProviderRecovery:'off'},
    {assemblyProviderRecovery:{}},{assemblyProviderRecovery:'unlimited'},{agent:undefined},{agent:'deepseek'},
    {agent:'claude'},{model:undefined},{model:''},{model:'../model'},{model:' model '},{effort:undefined},
    {effort:null},{effort:''},{effort:'default'},{effort:'invented'},{assemblyRecovery:undefined},
    {sceneWorkflow:undefined},{sceneWorkflow:'checkpoints'},{generationMode:'single'},{maxRepairs:1},
    ...['sample','spec','patch','scenePatch','importDirectory','revalidateJobId','baseJobId','baseHash','sceneScope','reviewImages','repairJobId','checkpointCalls','checkpointConfirmed'].map(k=>({[k]:null}))];
  for(const change of changes)assert.throws(()=>generationPreflight({...request,...change}),JSON.stringify(change));
  for(const effort of ['none','minimal','low','medium','high','xhigh','max','ultra'])
    assert.equal(generationPreflight({...request,effort}).assembly.providerRetries,2);
});

test('reference preparation v1 cannot gain bounded authority, even with valid safe settings',async t=>{
  const f=await referenceFixture(t,{version:2});
  const input={...f.request,version:1,generation:{...f.generation,assemblyProviderRecovery:'bounded'}};
  assert.throws(()=>validateReferencePreparation(f.ownerId,input),/preparation v2/);
  const p=validateReferencePreparation(f.ownerId,{...input,version:2});
  assert.equal(p.assembly.providerRetries,2);assert.equal(p.maximumCalls,f.preparation.policy.maximumCalls);
  assert.deepEqual(p.assembly.referenceAnalysis,f.preparation.policy.assembly.referenceAnalysis);
  assert.equal(p.assembly.maxPackages,f.preparation.policy.assembly.maxPackages);
});

test('reference v2 binds changed recovery/model/effort to new preparation, free consent and SEND',async t=>{
  const f=await referenceFixture(t,{version:2});await f.confirm();
  for(const change of [{assemblyProviderRecovery:'bounded'},
    {assemblyProviderRecovery:'bounded',effort:'high'},
    {assemblyProviderRecovery:'bounded',model:'synthetic-other-model'}]){
    const input={...f.request,generation:{...f.generation,...change}},capability={id:input.generation.model,supportsImages:true};
    const p=await referencePreparationOperation({dataDir:f.dataDir,ownerId:f.ownerId,operation:'prepare',runtimeHash:f.runtimeHash,
      capability,input:Buffer.from(JSON.stringify(input))});
    assert.notEqual(p.generationHash,f.preparation.generationHash);assert.notEqual(p.preparationHash,f.preparation.preparationHash);
    assert.notEqual(p.requestHash,f.preparation.requestHash);assert.equal(p.policy.assembly.providerRetries,2);
    assert.equal(p.callsReserved,0);assert.equal(p.generationSubmitted,false);assert.equal(p.canAuthorizePlacement,false);
    await assert.rejects(referencePreparationOperation({dataDir:f.dataDir,ownerId:f.ownerId,operation:'confirm',runtimeHash:f.runtimeHash,
      capability,preparationHash:p.preparationHash,input:Buffer.from(JSON.stringify(freeConsent(f.preparation)))}));
    await referencePreparationOperation({dataDir:f.dataDir,ownerId:f.ownerId,operation:'confirm',runtimeHash:f.runtimeHash,
      capability,preparationHash:p.preparationHash,input:Buffer.from(JSON.stringify(freeConsent(p)))});
    await assert.rejects(bindReferencePreparationToJob({dataDir:f.dataDir,jobDirectory:f.jobDirectory,ownerId:f.ownerId,
      preparationHash:p.preparationHash,generation:p.generation,runtimeHash:f.runtimeHash,capability,sendConfirmation:sendConsent(f.preparation)}));
  }
  // Preparing other options never rewrites the original preparation/authority.
  assert.deepEqual(await f.prepare(),f.preparation);
});
