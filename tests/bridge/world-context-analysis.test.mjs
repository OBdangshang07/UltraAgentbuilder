import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {createContextAnalysisRunner, readStableAnalysisState} from '../../bridge/world-context-analysis-runner.mjs';
import {WorldContextStore} from '../../bridge/world-context-store.mjs';
import {WorldContextConsents} from '../../bridge/world-context-consent.mjs';
import {CONTEXT_ANALYSIS_PROTOCOL_HASH} from '../../bridge/world-context-analysis-input.mjs';
import {contextAnalysisSchema, validateContextAnalysis} from '../../contracts/context-analysis.schema.mjs';
import {selectionChunks, regionCells} from '../../contracts/world-selection.mjs';
import {contextHash} from '../../src/world/context-snapshot.mjs';
import {hash} from '../../src/generation/compiler.mjs';

const intent = () => ({format: 'WorldContextTaskIntent', version: 2, purpose: 'context-analysis',
  agent: 'codex', model: 'gpt-6.1-sol', effort: 'max', prompt: '  分析环境，明确未知。\n不修改世界。  ', maximumCalls: 1});
const input = () => {
  const selection = {format: 'WorldSelection', version: 1, world: {worldId: 'opaque_session', dimension: 'minecraft:overworld', minY: -64, maxY: 320}, revision: 3,
    context: {min: [-2, -2, -2], max: [2, 2, 2]}, edit: {min: [-1, -1, -1], max: [1, 1, 1]}, protected: []};
  return {selection, capture: {fence: {start: 9, end: 9}, chunks: selectionChunks(selection).map(chunk => ({x: chunk.x, z: chunk.z, coverage: 'known',
    palette: [{state: 'minecraft:stone', blockEntity: false}], runs: [[0, regionCells(chunk.region)]]}))}};
};
const answer = prepared => ({format: 'WorldContextAnalysis', version: 1, requestHash: prepared.requestHash,
  snapshotHash: prepared.request.snapshotHash, summaryHash: prepared.request.summaryHash,
  observations: ['摘要记录了 64 格已知石头。'], inferences: ['推断：可能是石材布景；功能未知。'], unknowns: ['不能从高度 LOD 证明入口或通行。'], recommendations: ['补充确认内层的设计意图。']});
function waitable() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return {promise, resolve}; }
test('status rereads when completion races an old pending journal read', async () => {
  let version = 1, reads = 0;
  const value = await readStableAnalysisState({revision: () => version, active: () => false, readRecord: async () => {
    if (++reads === 1) { version++; return {state: 'pending'}; } return {state: 'response'};
  }});
  assert.deepEqual(value, {record: {state: 'response'}, active: false}); assert.equal(reads, 2);
});
test('stable active pending remains running, not an unknown result', async () => {
  assert.deepEqual(await readStableAnalysisState({revision: () => 1, active: () => true, readRecord: async () => ({state: 'pending'})}), {record: {state: 'pending'}, active: true});
});
test('unstable status sampling rejects after three local reads without provider actions', async () => {
  let version = 0, reads = 0;
  await assert.rejects(readStableAnalysisState({revision: () => version, active: () => false, readRecord: async () => { version++; reads++; return {state: 'pending'}; }}), error => error.statusCode === 409);
  assert.equal(reads, 3);
});
async function fixture(t, generate) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'voxel-context-analysis-'))), contexts = new WorldContextStore({dataDir: dir}), consents = new WorldContextConsents();
  const contextId = randomUUID(); await contexts.operation('capture', contextId, Buffer.from(JSON.stringify(input())));
  const prepared = await contexts.operation('task-disclosure', contextId, Buffer.from(JSON.stringify(intent())));
  const consent = consents.confirm(prepared.disclosure, {confirmed: true, disclosureHash: prepared.disclosure.disclosureHash, task: prepared.disclosure.recipient});
  const submission = {contextId, consentId: consent.id, requestHash: prepared.requestHash, disclosureHash: prepared.disclosure.disclosureHash, intent: intent(), explicitSend: true};
  const counts = {generate: 0, observe: 0}, adapter = {async generate(args) { counts.generate++; return generate ? generate(args, {prepared, counts, dir}) : {spec: answer(prepared)}; }};
  let runner = await createContextAnalysisRunner({dataDir: dir, contexts, consents, adapterFor: agent => { assert.equal(agent, 'codex'); return adapter; }});
  t.after(async () => { await runner.close(); consents.close(); await contexts.close(); assert.equal(await fs.realpath(dir), dir); assert.match(path.basename(dir), /^voxel-context-analysis-/); await fs.rm(dir, {recursive: true}); });
  return {dir, contexts, consents, prepared, consent, submission, counts, adapter, get runner() { return runner; },
    async restart() { await runner.close(); runner = await createContextAnalysisRunner({dataDir: dir, contexts, consents, adapterFor: () => adapter}); }};
}

test('worker input contains only exact disclosed summary/task, never private baseline or paths', async t => {
  const f = await fixture(t), built = await f.contexts.operation('analysis-input', f.submission.contextId, Buffer.from(JSON.stringify(intent())));
  assert.equal(built.protocolHash, CONTEXT_ANALYSIS_PROTOCOL_HASH); assert.equal(built.promptHash, contextHash(built.prompt));
  assert.deepEqual(built.prepared, f.prepared); const data = JSON.parse(built.prompt.split('(JSON data):\n')[1]);
  assert.deepEqual(Object.keys(data), ['requestHash', 'request', 'summary']); assert.deepEqual(data.request.intent, intent());
  assert.equal(data.summary.knownCells, 64); assert.equal(data.capture, undefined); assert.equal(data.chunks, undefined);
  assert.equal(data.summary.chunks, undefined); assert.ok(!built.prompt.includes(f.dir));
  assert.match(built.prompt, /Unknown coverage is NOT air/); assert.match(built.prompt, /unverified/);
});

test('explicit send reserves one call before adapter and returns non-authorizing prose receipt', async t => {
  let seen;
  const f = await fixture(t, async (args, {prepared, dir}) => {
    seen = args; const root = path.join(dir, 'context-analysis', prepared.requestHash, 'assembly-journal');
    const call = JSON.parse(await fs.readFile(path.join(root, 'call-1.json'))), dispatched = JSON.parse(await fs.readFile(path.join(root, 'dispatched.json')));
    assert.equal(call.value.state, 'pending'); assert.equal(call.value.index, 1); assert.equal(dispatched.value.count, 1);
    assert.equal(call.sha256, hash(call.value)); return {spec: answer(prepared)};
  });
  await f.runner.submit(f.submission); await f.runner.idle(); const receipt = await f.runner.get(f.prepared.requestHash);
  assert.equal(receipt.state, 'completed'); assert.equal(receipt.callsReserved, 1); assert.equal(receipt.maximumCalls, 1);
  assert.equal(receipt.automaticRetries, 0); assert.equal(receipt.analysisClaimsVerified, false); assert.equal(receipt.canAuthorizePlacement, false);
  assert.equal(seen.model, intent().model); assert.equal(seen.effort, 'max'); assert.deepEqual(seen.outputSchema, contextAnalysisSchema);
  assert.equal(Object.hasOwn(seen, 'maxOutputTokens'), false); assert.deepEqual(seen.images, []); assert.ok(!seen.prompt.includes('runs'));
  assert.deepEqual(receipt.analysis, answer(f.prepared)); assert.equal(f.counts.generate, 1);
  await f.runner.submit(f.submission); assert.equal(f.counts.generate, 1); assert.throws(() => f.consents.consume(f.consent.id, f.prepared.disclosure), /consumed/);
});
test('immediately completed local analyses never return stale pending as unknown', async t => {
  for (let i = 0; i < 8; i++) {
    const f = await fixture(t), status = await f.runner.submit(f.submission);
    assert.ok(['running', 'completed'].includes(status.state), 'False initial UNKNOWN: ' + status.state);
    await f.runner.idle(); assert.equal((await f.runner.get(f.prepared.requestHash)).state, 'completed'); assert.equal(f.counts.generate, 1);
  }
});

test('lost receipt, expired/revoked consent and discarded context recover by read, not another send', async t => {
  const f = await fixture(t); await f.runner.submit(f.submission); await f.runner.idle();
  f.consents.close(); await f.contexts.operation('discard', f.submission.contextId); await f.restart();
  const recovered = await f.runner.get(f.prepared.requestHash); assert.equal(recovered.state, 'completed');
  assert.deepEqual(await f.runner.submit(f.submission), recovered); assert.equal(f.counts.generate, 1);
});

test('concurrent duplicate sends share the same durable reservation', async t => {
  const held = waitable(), f = await fixture(t, async (args, {prepared}) => { await held.promise; return {spec: answer(prepared)}; });
  const receipts = await Promise.all([f.runner.submit(f.submission), f.runner.submit(f.submission), f.runner.submit(f.submission)]);
  assert.ok(receipts.every(receipt => receipt.id === f.prepared.requestHash && receipt.callsReserved === 1)); assert.equal(f.counts.generate, 1);
  held.resolve(); await f.runner.idle(); assert.equal((await f.runner.get(f.prepared.requestHash)).state, 'completed');
});

for (const [name, mutate] of [
  ['not explicit', v => v.explicitSend = false], ['write purpose', v => v.intent.purpose = 'edit-proposal'],
  ['extra fields', v => v.command = '/fill'], ['scope field', v => v.worldPatch = {}], ['budget', v => v.intent.maximumCalls = 2],
  ['prompt', v => v.intent.prompt += ' '], ['model', v => v.intent.model = 'another'], ['effort', v => v.intent.effort = 'high'],
  ['disclosure', v => v.disclosureHash = 'a'.repeat(64)], ['request', v => v.requestHash = 'b'.repeat(64)],
  ['consent', v => v.consentId = randomUUID()], ['path', v => v.contextId = '../private'],
]) test('changed or unsupported ' + name + ' is rejected before adapter dispatch', async t => {
  const f = await fixture(t), changed = structuredClone(f.submission); mutate(changed);
  await assert.rejects(f.runner.submit(changed)); assert.equal(f.counts.generate, 0);
});

test('invalid completed output is retained and rejected without repair or retry', async t => {
  const f = await fixture(t, async (args, {prepared}) => ({spec: {...answer(prepared), operations: [{op: 'set'}]}}));
  await f.runner.submit(f.submission); await f.runner.idle(); const status = await f.runner.get(f.prepared.requestHash);
  assert.equal(status.state, 'completed-rejected'); assert.equal(status.analysis, null); assert.equal(status.canAuthorizePlacement, false);
  const raw = JSON.parse(await fs.readFile(path.join(f.dir, 'context-analysis', f.prepared.requestHash, 'assembly-journal', 'call-1.json')));
  assert.deepEqual(raw.value.response.spec.operations, [{op: 'set'}]); await f.restart(); await f.runner.submit(f.submission); assert.equal(f.counts.generate, 1);
});

for (const reason of ['unknown', 'failed', 'completed']) test('provider ' + reason + ' persists a charged/unknown reservation with no resend', async t => {
  const f = await fixture(t, async () => { const error = new Error('secret-path-token-and-private-prose'); error.diagnostic = {provider: 'codex', reason}; throw error; });
  await f.runner.submit(f.submission); await f.runner.idle(); const status = await f.runner.get(f.prepared.requestHash);
  const stored = JSON.parse(await fs.readFile(path.join(f.dir, 'context-analysis', f.prepared.requestHash, 'assembly-journal', 'call-1.json'))).value;
  t.diagnostic(JSON.stringify({expectedReason: reason, state: status.state, journalState: stored.state, recordedReason: stored.error?.diagnostic?.reason, binding: !!stored.providerBinding, calls: f.counts.generate, localStop: status.localStop}));
  assert.equal(status.state, reason === 'unknown' ? 'unknown' : reason === 'completed' ? 'completed-rejected' : 'failed');
  assert.equal(status.callsReserved, 1); await f.restart(); await f.runner.submit(f.submission); assert.equal(f.counts.generate, 1);
  const raw = await fs.readFile(path.join(f.dir, 'context-analysis', f.prepared.requestHash, 'assembly-journal', 'call-1.json'), 'utf8');
  assert.ok(!raw.includes('secret-path-token')); await assert.rejects(f.runner.observeOriginal(f.prepared.requestHash), /No original/);
});

test('bound unknown Codex outcome can ONLY observe the exact original turn after restart', async t => {
  const f = await fixture(t, async (args) => {
    await args.onProviderBinding({version: 1, provider: 'codex', storage: 'persistent-single-turn', requestHash: 'e'.repeat(64), model: intent().model, effort: 'max', threadId: 'original-thread', turnId: 'original-turn'});
    throw new Error('transport unknown');
  });
  await f.runner.submit(f.submission); await f.runner.idle(); assert.equal((await f.runner.get(f.prepared.requestHash)).canObserveOriginal, true);
  await f.restart(); f.adapter.recoverOriginal = async args => {
    f.counts.observe++; assert.equal(args.binding.threadId, 'original-thread'); assert.equal(args.binding.turnId, 'original-turn');
    assert.equal(args.binding.model, intent().model); assert.equal(args.binding.effort, 'max'); return {spec: answer(f.prepared)};
  };
  await f.runner.observeOriginal(f.prepared.requestHash); await f.runner.idle();
  const result = await f.runner.get(f.prepared.requestHash); assert.equal(result.state, 'completed'); assert.equal(result.callsReserved, 1);
  assert.equal(f.counts.generate, 1); assert.equal(f.counts.observe, 1); assert.equal(result.canAuthorizePlacement, false);
});

test('two simultaneous original observers cannot race a receipt', async t => {
  const f = await fixture(t, async args => {
    await args.onProviderBinding({version: 1, provider: 'codex', storage: 'persistent-single-turn', requestHash: 'e'.repeat(64), model: intent().model, effort: 'max', threadId: 'thread', turnId: 'turn'});
    throw new Error('unknown');
  });
  await f.runner.submit(f.submission); await f.runner.idle();
  const held = waitable(); f.adapter.recoverOriginal = async () => { f.counts.observe++; await held.promise; return {spec: answer(f.prepared)}; };
  const first = f.runner.observeOriginal(f.prepared.requestHash); await assert.rejects(f.runner.observeOriginal(f.prepared.requestHash), /busy/);
  await first; assert.equal(f.counts.observe, 1); held.resolve(); await f.runner.idle(); assert.equal(f.counts.generate, 1);
});

test('runner has one owner and rejects context/journal symlinks without following targets', async t => {
  const f = await fixture(t); await assert.rejects(createContextAnalysisRunner({dataDir: f.dir, contexts: f.contexts, consents: f.consents, adapterFor: () => f.adapter}), /already owns/);
  const external = path.join(f.dir, 'untouched'); await fs.mkdir(external); await fs.writeFile(path.join(external, 'private'), 'preserve');
  const id = 'f'.repeat(64); try { await fs.symlink(external, path.join(f.dir, 'context-analysis', id), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('OS link privilege unavailable'); return; } throw error; }
  await assert.rejects(f.runner.get(id), /link/); assert.equal(await fs.readFile(path.join(external, 'private'), 'utf8'), 'preserve'); assert.equal(f.counts.generate, 0);
});

test('saved request, original prompt, journal and receipt tampering are never trusted', async t => {
  const f = await fixture(t); await f.runner.submit(f.submission); await f.runner.idle();
  const dir = path.join(f.dir, 'context-analysis', f.prepared.requestHash);
  for (const file of ['request.json', 'prompt.json', 'assembly-journal/identity.json', 'assembly-journal/call-1.json']) {
    const target = path.join(dir, file), bytes = await fs.readFile(target); await fs.appendFile(target, 'tampered');
    await assert.rejects(f.runner.get(f.prepared.requestHash)); await fs.writeFile(target, bytes);
  }
  const target = path.join(dir, 'request.json'), saved = JSON.parse(await fs.readFile(target)); saved.value.maximumCalls = 26; saved.sha256 = hash(saved.value);
  await fs.writeFile(target, JSON.stringify(saved)); await assert.rejects(f.runner.get(f.prepared.requestHash), /budget/); assert.equal(f.counts.generate, 1);
});

test('analysis schema binds baseline and excludes command/patch/authority fields', async t => {
  const f = await fixture(t); assert.deepEqual(validateContextAnalysis(answer(f.prepared), f.prepared), answer(f.prepared));
  for (const mutate of [v => v.snapshotHash = 'a'.repeat(64), v => v.requestHash = 'b'.repeat(64), v => v.summaryHash = 'c'.repeat(64),
    v => v.canAuthorizePlacement = true, v => v.command = '/fill', v => v.observations.push(' '), v => v.unknowns.push('x'.repeat(2001)), v => v.recommendations = Array(33).fill('text')]) {
    const changed = answer(f.prepared); mutate(changed); assert.throws(() => validateContextAnalysis(changed, f.prepared));
  }
});

test('close cancels only the active original request and keeps its one-call reservation', async t => {
  const f = await fixture(t, args => new Promise((resolve, reject) => {
    const cancelled = () => { const error = new Error('cancelled'); error.diagnostic = {provider: 'codex', reason: 'aborted'}; reject(error); };
    args.signal.addEventListener('abort', cancelled, {once: true}); if (args.signal.aborted) cancelled();
  }));
  await f.runner.submit(f.submission); await f.runner.close(); await f.restart();
  const receipt = await f.runner.get(f.prepared.requestHash); assert.equal(receipt.state, 'failed'); assert.equal(receipt.callsReserved, 1);
  await f.runner.submit(f.submission); assert.equal(f.counts.generate, 1); assert.equal(receipt.canAuthorizePlacement, false);
});

test('close during worker preparation cannot dispatch a late model request', async t => {
  const f = await fixture(t), held = waitable(), original = f.contexts.operation.bind(f.contexts);
  f.contexts.operation = async (...args) => { if (args[0] === 'analysis-input') await held.promise; return original(...args); };
  const pending = f.runner.submit(f.submission), rejected = assert.rejects(pending, /closed/);
  await new Promise(resolve => setTimeout(resolve, 20)); const closing = f.runner.close(); held.resolve();
  await rejected; await closing; assert.equal(f.counts.generate, 0); assert.equal(await f.runner.get(f.prepared.requestHash), null);
});

test('a second consent for identical task cannot fund a duplicate generation', async t => {
  const f = await fixture(t); await f.runner.submit(f.submission); await f.runner.idle();
  const second = f.consents.confirm(f.prepared.disclosure, {confirmed: true, disclosureHash: f.prepared.disclosure.disclosureHash, task: f.prepared.disclosure.recipient});
  const status = await f.runner.submit({...f.submission, consentId: second.id}); assert.equal(status.state, 'completed'); assert.equal(f.counts.generate, 1);
  assert.equal(f.consents.consume(second.id, f.prepared.disclosure).id, second.id);
});

test('a valid v1 preparation-only approval cannot send, consume its consent or be silently upgraded', async t => {
  const f = await fixture(t), legacy = {...intent(), version: 1};
  const prepared = await f.contexts.operation('task-disclosure', f.submission.contextId, Buffer.from(JSON.stringify(legacy)));
  const consent = f.consents.confirm(prepared.disclosure, {confirmed: true, disclosureHash: prepared.disclosure.disclosureHash, task: prepared.disclosure.recipient});
  const submission = {...f.submission, consentId: consent.id, requestHash: prepared.requestHash, disclosureHash: prepared.disclosure.disclosureHash, intent: legacy};
  await assert.rejects(f.runner.submit(submission), /Legacy preparation-only/);
  await assert.rejects(f.contexts.operation('analysis-input', submission.contextId, Buffer.from(JSON.stringify(legacy))), /Legacy preparation-only/);
  await assert.rejects(f.runner.submit({...submission, intent: intent()}), /changed/);
  assert.equal(f.counts.generate, 0); assert.equal(await f.runner.get(prepared.requestHash), null);
  assert.equal(f.consents.consume(consent.id, prepared.disclosure).id, consent.id);
});
