import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {hash} from '../../src/generation/compiler.mjs';
import {runDurableAssembly} from '../../bridge/assembly-durability.mjs';
import {auditAssemblyProviderRecovery} from '../../bridge/assembly-provider-recovery-audit.mjs';
import {recoveryHarness,capacityMessage} from './assembly-provider-recovery-fixtures.mjs';
import {checkClosedReferenceSnapshot, checkClosedReferenceExit, assertClosedOriginalProcesses, checkClosedReferenceCalls, checkClosedReferencePreview,checkClosedReferenceGeneration} from '../../scripts/closed-reference-gates.mjs';

function snapshot(state = 'preview-ready', mode = 'single') {
  const authorization = {root: 'original-root', ownerId: 'original-owner', model: 'vision-fixture', effort: 'max', maximumCalls: 8, runtimeHash: 'r'.repeat(64)};
  const initial = {id: 'original-job', key: authorization.ownerId, agent: 'codex', model: authorization.model, effort: authorization.effort,
    state: 'generating', assemblyCallsReserved: 2, preflight: {maximumCalls: 8}, referenceGeneration: {version: 1, mode, bindingHash: 'b'.repeat(64)}};
  const savedGet = {...structuredClone(initial), state, assemblyCallsReserved: 7};
  const savedJob = {...structuredClone(savedGet), prompt: 'not public', requestHash: 'h'.repeat(64), spec: {original: true}};
  const ledger = {root: authorization.root, ownerId: authorization.ownerId, runtimeHash: authorization.runtimeHash, jobId: savedGet.id,
    maximumCalls: 8, callsReserved: 7, state, result: state === 'preview-ready' ? 'generated-awaiting-independent-visual-review' : 'original-task-terminal-non-success'};
  return {authorization, ledger, initial, savedGet, savedJob};
}
test('single and multiple original references can be audited without restarting their service', () => {
  for (const mode of ['single', 'multi']) assert.equal(checkClosedReferenceSnapshot(snapshot('preview-ready', mode)).success, true);
});
test('non-success terminal outcomes stay non-success', () => {
  for (const state of ['failed', 'cancelled', 'interrupted']) assert.equal(checkClosedReferenceSnapshot(snapshot(state)).success, false);
});
test('a runner observation failure does not rewrite a successful original model outcome', () => {
  const value = snapshot(); value.ledger.result = 'failed-or-unknown';
  assert.equal(checkClosedReferenceSnapshot(value).success, true);
});
test('missing, nonterminal or altered original public snapshots are refused', () => {
  assert.throws(() => checkClosedReferenceSnapshot({...snapshot(), savedGet: {}}));
  for (const change of [v => { v.savedGet.state = 'generating'; }, v => { v.savedGet.prompt = 'invented GET'; },
    v => { v.savedJob.assetHash = 'changed'; }, v => { v.savedGet.error = 'failed'; v.savedJob.error = 'failed'; }]) {
    const value = snapshot(); change(value); assert.throws(() => checkClosedReferenceSnapshot(value));
  }
});
test('changing task, model, budget, source binding or reservation counts is refused', () => {
  for (const change of [v => { v.initial.id = 'other'; }, v => { v.authorization.model = 'other'; },
    v => { v.ledger.runtimeHash = 'changed'; }, v => { v.ledger.callsReserved = 6; }, v => { v.ledger.maximumCalls = 9; },
    v => { v.initial.assemblyCallsReserved = 8; }, v => { v.initial.referenceGeneration.bindingHash = 'changed'; },
    v => { v.initial.preflight.maximumCalls = 7; }]) {
    const value = snapshot(); change(value); assert.throws(() => checkClosedReferenceSnapshot(value));
  }
});
const identities = [101, 102].map(ProcessId => ({ProcessId, CreatedUtc: '2026-10-03T00:00:00Z', ExecutablePath: 'original-node.exe', CommandLine: 'owned original task ' + ProcessId}));
function lifecycle() { return {processes: {entry: 'normal-packaged-cli', bridgePid: 101, parentSentinelPid: 102, startedAt: '2026-10-03T00:00:00Z'},
  exit: {originalExited: true, bridgePid: 101, bridge: {code: 0, signal: null}, sentinel: {code: 0, signal: null}, worldWrites: 0}, identities: structuredClone(identities), current: []}; }
test('clean original handles must exit and their exact lifetimes must be retired', () => {
  checkClosedReferenceExit(lifecycle());
  const value = lifecycle(); value.current = structuredClone(identities);
  assert.throws(() => checkClosedReferenceExit(value), /still alive/);
});
test('a recycled PID does not authorize killing the unrelated process', () => {
  assertClosedOriginalProcesses(identities, identities.map(row => ({...row, CreatedUtc: '2026-10-04T00:00:00Z'})));
});
test('unknown process identities cannot be treated as retired', () => {
  assert.throws(() => assertClosedOriginalProcesses(identities, [{...identities[0], CreatedUtc: 'unknown'}]));
  assert.throws(() => assertClosedOriginalProcesses(identities, [{...identities[0], CommandLine: null}]));
  assert.throws(() => assertClosedOriginalProcesses(identities, [{...identities[0], CommandLine: 'changed'}]));
  assert.throws(() => assertClosedOriginalProcesses(identities, [{...identities[0], ExecutablePath: 'changed.exe'}]));
});
test('missing, unrelated, failed or signalled original closure receipts are refused', () => {
  for (const change of [v => { v.exit.bridgePid = 999; }, v => { v.exit.bridge.code = 1; }, v => { v.exit.sentinel.signal = 'SIGTERM'; },
    v => { v.exit.originalExited = false; }, v => { v.identities = []; }, v => { v.processes.startedAt = '2026-10-04T00:00:00Z'; }]) {
    const value = lifecycle(); change(value); assert.throws(() => checkClosedReferenceExit(value));
  }
});
const response = {index: 1, state: 'response', unresolved: false, originalResponseVerified: true, originalProviderReceiptVerified: true};
test('only independently verified closed original calls can be certified', () => {
  checkClosedReferenceCalls([response], 1);
  checkClosedReferenceCalls([{...response, state: 'error', originalResponseVerified: false, errorClosureReason: 'failed'}], 1);
  for (const call of [{...response, state: 'pending'}, {...response, unresolved: true}, {...response, originalProviderReceiptVerified: false},
    {...response, index: 2}, {...response, originalResponseVerified: false}, {...response, state: 'error', errorClosureReason: 'incomplete'}]) assert.throws(() => checkClosedReferenceCalls([call], 1));
  assert.throws(() => checkClosedReferenceCalls([response], 0));
});

function preview(mode = 'multi') {
  const base = snapshot('preview-ready', mode), job = base.savedJob;
  base.authorization.mode = mode;
  job.assetHash = 'a'.repeat(64); job.assemblySummary = {sourceHash: 's'.repeat(64)}; job.assemblyCallsReserved = 1;
  return {authorization: base.authorization, job, exit: lifecycle().exit,
    audit: {type: 'read-only-closed-original-reference-terminal-audit', result: 'passed', root: base.authorization.root,
      jobId: job.id, state: 'preview-ready', syntheticTransportFixture: false, observationSource: 'original-runner-terminal-get-and-exited-lifetimes',
      originalProcessesRetired: true, originalFilesUnchanged: true, jobTerminal: true, originalServiceRestarted: false,
      requestResent: false, additionalModelCalls: 0, worldWrites: 0, canAuthorizePlacement: false, runtimeHash: base.authorization.runtimeHash,
      calls: [structuredClone(response)], final: {nativeSourceIdentityVerified: true, finalTextReviewAccepted: true, assetHash: job.assetHash, sourceHash: job.assemblySummary.sourceHash}}};
}
test('normal single and multi closures can authorize read-only rendering, never placement', () => {
  for (const mode of ['single', 'multi']) checkClosedReferencePreview(preview(mode));
});
test('synthetic, restarted, failed, live or unverified assets cannot become original final previews', () => {
  for (const change of [v => { v.audit.syntheticTransportFixture = true; }, v => { v.authorization.syntheticTransportFixture = true; },
    v => { v.audit.originalServiceRestarted = true; }, v => { v.audit.originalProcessesRetired = false; },
    v => { v.audit.jobTerminal = false; }, v => { v.job.state = 'failed'; }, v => { v.audit.final.nativeSourceIdentityVerified = false; },
    v => { v.audit.final.finalTextReviewAccepted = false; }, v => { v.audit.calls[0].originalProviderReceiptVerified = false; }]) {
    const value = preview(); change(value); assert.throws(() => checkClosedReferencePreview(value));
  }
});
test('preview gates refuse cross-task identities and world-write or resubmission claims', () => {
  for (const change of [v => { v.job.assetHash = 'different'; }, v => { v.job.key = 'different'; }, v => { v.audit.runtimeHash = 'different'; },
    v => { v.audit.additionalModelCalls = 1; }, v => { v.audit.worldWrites = 1; }, v => { v.audit.canAuthorizePlacement = true; },
    v => { v.audit.requestResent = true; }, v => { v.exit.bridge.signal = 'SIGTERM'; }]) {
    const value = preview(); change(value); assert.throws(() => checkClosedReferencePreview(value));
  }
});

test('only independently audited closed capacity/format chains can replace the all-response preview condition',async t=>{
  const h=await recoveryHarness(t,{choose:({index})=>index===1||index===3?{failure:capacityMessage}:index===2?{text:'{"fixture":'}:{}});
  const result=await runDurableAssembly(h.options),audit=await auditAssemblyProviderRecovery({...h.options,
    root:path.join(h.directory,h.events.findLast(e=>e.branch).branch,'assembly'),records:result.records,summary:result.summary});
  const journal=await h.journal(),calls=journal.map(c=>({index:c.index,state:c.state,unresolved:c.state==='pending',
    originalResponseVerified:c.state==='response',originalProviderReceiptVerified:true,errorClosureReason:c.error?.diagnostic?.reason}));
  const job={requestHash:h.options.requestHash,preflight:h.options.policy,assemblyStages:result.records,assemblySummary:result.summary,assemblyCallsReserved:calls.length};
  const parameters={calls,job,runtimeHash:h.options.runtimeHash,providerRecoveryAudit:audit.report};
  checkClosedReferenceGeneration(parameters);
  assert.equal(calls.filter(c=>c.state==='error').length,3);assert.equal(calls.length,8);
  assert.throws(()=>checkClosedReferenceGeneration({...parameters,providerRecoveryAudit:undefined}),/audit required/);
  for(const change of [v=>v.relationships.pop(),v=>v.formatCorrections.pop(),v=>v.allReservedCallsClosed=false,
    v=>v.relationships[0].receiptHash=hash('foreign'),v=>v.relationships[0].retryIndex++,v=>v.canAuthorizeRetry=true,
    v=>v.runtimeHash=hash('foreign'),v=>v.stagesHash=hash([]),v=>v.summary.unknownOutcomeRetries=1]){
    const report=structuredClone(audit.report);change(report);const {auditHash,...content}=report;report.auditHash=hash(content);
    assert.throws(()=>checkClosedReferenceGeneration({...parameters,providerRecoveryAudit:report}));
  }
  for(const change of [v=>v.calls[1].unresolved=true,v=>v.calls[3].state='pending',v=>v.calls[0].errorClosureReason='aborted',
    v=>v.job.assemblyStages[1].task='foreign',v=>v.job.assemblyStages[1].providerRetryOf=3]){
    const p=structuredClone(parameters);change(p);assert.throws(()=>checkClosedReferenceGeneration(p));
  }
  assert.equal(h.calls.length,8);
});

test('legacy preview condition cannot adopt error closure or invented bounded recovery authority',()=>{
  const value=preview(),parameters={calls:value.audit.calls,job:value.job,runtimeHash:value.authorization.runtimeHash};
  checkClosedReferenceGeneration(parameters);
  assert.throws(()=>checkClosedReferenceGeneration({...parameters,providerRecoveryAudit:{verified:true}}),/Legacy/);
  const calls=[{...response,state:'error',errorClosureReason:'failed'}];
  assert.throws(()=>checkClosedReferenceGeneration({...parameters,calls}),/entirely accepted/);
});
