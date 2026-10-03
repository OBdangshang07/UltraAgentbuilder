import test from 'node:test';
import assert from 'node:assert/strict';
import {checkClosedReferenceSnapshot, checkClosedReferenceExit, assertClosedOriginalProcesses, checkClosedReferenceCalls} from '../../scripts/closed-reference-gates.mjs';

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
