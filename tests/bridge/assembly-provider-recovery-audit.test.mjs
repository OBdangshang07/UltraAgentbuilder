import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../../src/generation/compiler.mjs';
import {runDurableAssembly} from '../../bridge/assembly-durability.mjs';
import {auditAssemblyProviderRecovery,isAssemblyProviderRecoveryAudit} from '../../bridge/assembly-provider-recovery-audit.mjs';
import {recoveryHarness,capacityMessage} from './assembly-provider-recovery-fixtures.mjs';

async function inventory(directory){
  const entries=[];
  async function walk(relative=''){
    for(const entry of (await fs.readdir(path.join(directory,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      const file=path.join(relative,entry.name);if(entry.isDirectory())await walk(file);else entries.push([file,hash(await fs.readFile(path.join(directory,file)))]);
    }
  }
  await walk();return entries;
}
const args=(h,result)=>({...h.options,root:path.join(h.directory,h.events.findLast(e=>e.branch).branch,'assembly'),
  records:result.records,summary:result.summary});

for(const phase of ['plan','concept-review','component','review'])test('read-only '+phase+' recovery audit recomputes authority and retains all original bytes',async t=>{
  let failed=false;const h=await recoveryHarness(t,{choose:({stage})=>{
    if(!failed&&stage.stageName===phase){failed=true;return {failure:capacityMessage};}
  }}),result=await runDurableAssembly(h.options),before=await inventory(h.directory);
  const audit=await auditAssemblyProviderRecovery(args(h,result));
  assert.equal(isAssemblyProviderRecoveryAudit(audit),true);assert.equal(isAssemblyProviderRecoveryAudit(audit.report),false);
  assert.equal(audit.report.relationships.length,1);assert.equal(audit.report.allReservedCallsClosed,true);
  assert.equal(audit.report.additionalModelCalls,0);assert.equal(audit.report.canAuthorizeRetry,false);assert.equal(audit.report.canAuthorizePlacement,false);
  assert.deepEqual(await inventory(h.directory),before);assert.equal(h.calls.length,6);
  const relation=audit.report.relationships[0],failedRecord=result.records[relation.failedIndex-1],retry=result.records[relation.retryIndex-1];
  assert.equal(audit.isVerifiedCapacityRetry(failedRecord,retry),true);assert.equal(audit.isProviderRetry(retry),true);
  assert.equal(audit.preparedStageIndex(retry),failedRecord.index);assert.equal(audit.diagnosticFor(failedRecord.index).failureKind,'model-capacity');
  assert.equal(audit.isVerifiedCapacityRetry({...failedRecord,state:'accepted'},retry),false);
  assert.throws(()=>audit.preparedStageIndex({...retry,task:'foreign'}),/differs from audited/);
});

test('intertwined capacity and serialization audit retains both failed calls and the one original format correction',async t=>{
  const h=await recoveryHarness(t,{choose:({index})=>index===1||index===3?{failure:capacityMessage}:index===2?{text:'{"fixture":'}:{}});
  const result=await runDurableAssembly(h.options),audit=await auditAssemblyProviderRecovery(args(h,result));
  assert.equal(audit.report.relationships.length,2);assert.equal(audit.report.formatCorrections.length,1);
  assert.deepEqual(audit.report.formatCorrections.map(r=>[r.originalIndex,r.correctionIndex]),[[2,3]]);
  assert.equal(audit.report.reservedCalls,8);assert.equal(audit.diagnosticFor(2).failureKind,'answer-json');
  assert.equal(h.calls.length,8);
});

test('complete durable replay audits its original prefix proofs, not the later live ledger counters',async t=>{
  let failed=false;const h=await recoveryHarness(t,{choose:()=>{if(!failed){failed=true;return {failure:capacityMessage};}}});
  await runDurableAssembly(h.options);
  const result=await runDurableAssembly({...h.options,invoke:async()=>assert.fail('No audit/replay provider call'),wait:async()=>assert.fail('No replay wait')});
  const audit=await auditAssemblyProviderRecovery(args(h,result));assert.equal(audit.report.relationships.length,1);
  assert.equal(audit.report.allReservedCallsClosed,true);assert.equal(h.calls.length,6);assert.deepEqual(h.waits,[10000]);
});

test('a pending original retry remains unresolved even when its capacity predecessor and relationship verify',async t=>{
  let records=[];const h=await recoveryHarness(t,{choose:({index})=>index===1?{failure:capacityMessage}:{unknown:true}});
  h.options.onStage=async value=>{records=value;};await assert.rejects(runDurableAssembly(h.options),/observer lost/);
  const audit=await auditAssemblyProviderRecovery(args(h,{records}));assert.equal(audit.report.relationships.length,1);
  assert.equal(audit.report.allReservedCallsClosed,false);assert.equal(audit.diagnosticFor(2),null);assert.equal(h.calls.length,2);
});

test('rehashed recovery markers, changed canonical/model inputs, original answers and false summary cannot obtain independent proof',async t=>{
  let failed=false;const h=await recoveryHarness(t,{choose:()=>{if(!failed){failed=true;return {failure:capacityMessage};}}});
  const result=await runDurableAssembly(h.options),parameters=args(h,result);
  for(const [relative,change] of [
    ['2/input.json',v=>v.providerRecovery.budget.protectedPackageCeiling=2],
    ['2/model-input.json',v=>v.description='Changed original scope'],
    ['2/invocation.json',v=>v.options.outputSchema={type:'object'}],
    ['2/response.json',v=>v.designIntent='Changed original answer'],
    ['1/provider-recovery.json',v=>v.receiptHash=hash('foreign')]
  ]){
    const file=path.join(parameters.root,relative),original=await fs.readFile(file),value=JSON.parse(original);change(value);
    await fs.writeFile(file,JSON.stringify(value));await assert.rejects(auditAssemblyProviderRecovery(parameters));await fs.writeFile(file,original);
  }
  for(const summary of [{...result.summary,maximumCalls:27},{...result.summary,providerRecovery:{...result.summary.providerRecovery,retriesReserved:0}}])
    await assert.rejects(auditAssemblyProviderRecovery({...parameters,summary}));
  await assert.rejects(auditAssemblyProviderRecovery({...parameters,records:result.records.map(r=>r.index===1?{...r,state:'accepted'}:r)}));
  assert.equal((await auditAssemblyProviderRecovery(parameters)).report.relationships.length,1);assert.equal(h.calls.length,6);
});

test('legacy workflows cannot be upgraded by a report or caller-supplied recovery flags',async()=>{
  assert.equal(await auditAssemblyProviderRecovery({records:[]}),null);
  for(const records of [[{index:1,providerRetryOf:0}],[{index:1,invocationOutcome:'completed-empty-capacity'}]])
    await assert.rejects(auditAssemblyProviderRecovery({records}),/legacy policy/);
  await assert.rejects(auditAssemblyProviderRecovery({records:[],summary:{providerRecovery:{version:1}}}),/legacy summary/);
  assert.equal(isAssemblyProviderRecoveryAudit({report:{verified:true},isVerifiedCapacityRetry:()=>true}),false);
});

test('opaque proof cannot be rewritten and later original-file or reservation-inventory changes invalidate it',async t=>{
  let failed=false;const h=await recoveryHarness(t,{choose:()=>{if(!failed){failed=true;return {failure:capacityMessage};}}});
  const result=await runDurableAssembly(h.options),parameters=args(h,result),audit=await auditAssemblyProviderRecovery(parameters);
  assert.throws(()=>{audit.report.allReservedCallsClosed=false;},TypeError);
  assert.throws(()=>{audit.report.relationships[0].receiptHash=hash('foreign');},TypeError);
  assert.throws(()=>{audit.isVerifiedCapacityRetry=()=>true;},TypeError);
  const file=path.join(parameters.root,'2/response.json'),original=await fs.readFile(file);
  await fs.writeFile(file,Buffer.concat([original,Buffer.from(' ')]));await assert.rejects(audit.verifyUnchanged(),/evidence changed/);
  await fs.writeFile(file,original);await audit.verifyUnchanged();
  const extra=path.join(h.directory,'assembly-journal','call-7.json');await fs.writeFile(extra,'{}',{flag:'wx'});
  await assert.rejects(audit.verifyUnchanged(),/reservation inventory changed/);await fs.unlink(extra);await audit.verifyUnchanged();
  const folder=path.join(h.directory,'codex-response-extra-observation');await fs.mkdir(folder);
  await assert.rejects(audit.verifyUnchanged(),/observation inventory changed/);await fs.rmdir(folder);await audit.verifyUnchanged();
  result.records[0].task='foreign';await assert.rejects(audit.verifyUnchanged(),/stage records changed/);
  assert.equal(h.calls.length,6);
});

for(const phase of ['assembly-blueprint','prototype-role','review'])test('full staged '+phase+' audit retains the original packages and four-role geometry correction sequence',async t=>{
  let failed=false;const h=await recoveryHarness(t,{staged:true,choose:({stage})=>{
    if(!failed&&stage.stageName===phase){failed=true;return {failure:capacityMessage};}
  }}),result=await runDurableAssembly(h.options),audit=await auditAssemblyProviderRecovery(args(h,result));
  assert.equal(audit.report.relationships.length,1);assert.equal(audit.report.allReservedCallsClosed,true);
  assert.equal(result.summary.completedPackages.length,5);assert.equal(result.summary.decomposition.requiredRoleStagesAccepted,4);
  assert.equal(h.calls.length,17);assert.equal(audit.report.additionalModelCalls,0);
});
