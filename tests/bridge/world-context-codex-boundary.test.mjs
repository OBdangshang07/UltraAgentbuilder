import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {CodexAdapter} from '../../bridge/codex-adapter.mjs';
import {createContextAnalysisRunner} from '../../bridge/world-context-analysis-runner.mjs';
import {WorldContextStore} from '../../bridge/world-context-store.mjs';
import {WorldContextConsents} from '../../bridge/world-context-consent.mjs';
import {contextAnalysisSchema} from '../../contracts/context-analysis.schema.mjs';
import {selectionChunks, regionCells} from '../../contracts/world-selection.mjs';

// Exercise the actual adapter class and production runner together. Only the
// transport is replaced: no CLI, provider, paid turn or world is contacted.
async function fixture(t, longPath = false, fault = null) {
  // Keep the exact legacy-length case exact even when the full regression
  // runner owns a deeply nested TEMP. A NEW physical project build child is
  // short enough; this does not relax the actual production path guards.
  const temporaryParent = longPath === 'original-length'
    ? path.join(fileURLToPath(new URL('../../', import.meta.url)), 'build') : os.tmpdir();
  assert.equal(await fs.realpath(temporaryParent), path.resolve(temporaryParent));
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(temporaryParent, 'voxel-context-codex-boundary-')));
  const jobSuffixLength = path.join('context-analysis', 'a'.repeat(64)).length + 1;
  if (longPath === 'original-length') assert.ok(231 - jobSuffixLength - temporary.length - 1 >= 1, 'Exact legacy job path needs a short owned fixture directory');
  const dir = longPath === 'original-length' ? path.join(temporary, 'a'.repeat(231 - jobSuffixLength - temporary.length - 1))
    : longPath ? path.join(temporary, 'development-' + 'a'.repeat(48), 'build', 'context-analysis-live-' + 'b'.repeat(32), 'data') : temporary;
  await fs.mkdir(dir, {recursive: true});
  const contexts = new WorldContextStore({dataDir: dir}), consents = new WorldContextConsents();
  const selection = {format: 'WorldSelection', version: 1, world: {worldId: 'offline_boundary', dimension: 'minecraft:overworld', minY: -64, maxY: 320}, revision: 1,
    context: {min: [-2, 0, -2], max: [2, 4, 2]}, edit: {min: [-1, 1, -1], max: [1, 3, 1]}, protected: []};
  const capture = {fence: {start: 1, end: 1}, chunks: selectionChunks(selection).map(chunk => ({x: chunk.x, z: chunk.z, coverage: 'known',
    palette: [{state: 'minecraft:stone', blockEntity: false}], runs: [[0, regionCells(chunk.region)]]}))};
  const contextId = randomUUID(); await contexts.operation('capture', contextId, Buffer.from(JSON.stringify({selection, capture})));
  const intent = {format: 'WorldContextTaskIntent', version: 2, purpose: 'context-analysis', agent: 'codex', model: 'gpt-6.1-sol', effort: 'max', prompt: '  离线接口测试，不修改世界。  ', maximumCalls: 1};
  const prepared = await contexts.operation('task-disclosure', contextId, Buffer.from(JSON.stringify(intent)));
  const consent = consents.confirm(prepared.disclosure, {confirmed: true, disclosureHash: prepared.disclosure.disclosureHash, task: prepared.disclosure.recipient});
  const submission = {contextId, consentId: consent.id, requestHash: prepared.requestHash, disclosureHash: prepared.disclosure.disclosureHash, intent, explicitSend: true};
  const spec = {format: 'WorldContextAnalysis', version: 1, requestHash: prepared.requestHash, snapshotHash: prepared.request.snapshotHash, summaryHash: prepared.request.summaryHash,
    observations: ['已披露石头状态统计。'], inferences: [], unknowns: ['功能未知。'], recommendations: []};
  const adapter = new CodexAdapter(), requests = [], failures = [];
  const generate = adapter.generate.bind(adapter);
  adapter.generate = async args => { try { return await generate(fault === 'storage' ? {...args, cwd: path.join(args.cwd, 'missing')} : args); } catch (error) { failures.push({type: error.name, code: error.code ?? null, syscall: error.syscall ?? null}); throw error; } };
  adapter.connect = async () => {};
  adapter.models = async () => [{id: intent.model, efforts: ['max'], defaultEffort: 'max'}];
  adapter.readStoredTurn = async () => { throw Error('No external history reads'); };
  adapter.request = async (method, params) => {
    requests.push({method, params});
    if (method === fault) throw Error('private-account-path-token: must not enter the analysis journal');
    if (method === 'config/read') return {config: {mcp_servers: {offline: {enabled: true}}}};
    if (method === 'thread/start') return {thread: {id: 'offline-thread', ephemeral: false}};
    if (method === 'thread/unsubscribe') return {};
    assert.equal(method, 'turn/start');
    assert.deepEqual(params.outputSchema, contextAnalysisSchema);
    setImmediate(() => adapter.emit('notification', {method: 'turn/completed', params: {threadId: 'offline-thread', turn: {id: 'offline-turn', status: 'completed',
      items: [{type: 'agentMessage', phase: 'final_answer', text: JSON.stringify(spec)}]}}}));
    return {turn: {id: 'offline-turn', status: 'inProgress'}};
  };
  const runner = await createContextAnalysisRunner({dataDir: dir, contexts, consents, adapterFor: () => adapter});
  t.after(async () => { await runner.close(); adapter.close(); consents.close(); await contexts.close();
    assert.equal(await fs.realpath(temporary), temporary); assert.match(path.basename(temporary), /^voxel-context-codex-boundary-/); await fs.rm(temporary, {recursive: true}); });
  return {runner, submission, spec, requests, failures, dir};
}

for (const longPath of [false, 'original-length', true]) test('production analysis runner uses actual Codex adapter with ' + (longPath === 'original-length' ? '231-character original job length' : longPath ? 'long Windows evidence path' : 'normal evidence path'), async t => {
  const f = await fixture(t, longPath);
  if (longPath === 'original-length') assert.equal(path.join(f.dir, 'context-analysis', f.submission.requestHash).length, 231);
  await f.runner.submit(f.submission); await f.runner.idle();
  const status = await f.runner.get(f.submission.requestHash);
  assert.equal(status.state, 'completed', JSON.stringify({localStop: status.localStop, failures: f.failures, methods: f.requests.map(r => r.method), cwdLength: path.join(f.dir, 'context-analysis', f.submission.requestHash).length}));
  assert.deepEqual(status.analysis, f.spec); assert.equal(status.callsReserved, 1); assert.equal(status.canAuthorizePlacement, false);
  assert.equal(f.requests.filter(r => r.method === 'thread/start').length, 1); assert.equal(f.requests.filter(r => r.method === 'turn/start').length, 1);
  const file = path.join(f.dir, 'context-analysis', f.submission.requestHash, 'assembly-journal', 'call-1.json');
  const receipt = JSON.parse(await fs.readFile(file)).value;
  assert.equal(receipt.providerBinding.turnId, 'offline-turn'); assert.equal(receipt.providerBinding.model, 'gpt-6.1-sol');
  await f.runner.submit(f.submission); assert.equal(f.requests.filter(r => r.method === 'turn/start').length, 1);
});

for (const [fault, phase] of [['storage', 'evidence-storage'], ['config/read', 'data-only-config'], ['thread/start', 'thread-setup']]) {
  test('known pre-turn failure at ' + fault + ' is recorded locally, without model submission or private errors', async t => {
    const f = await fixture(t, false, fault);
    await f.runner.submit(f.submission); await f.runner.idle();
    const status = await f.runner.get(f.submission.requestHash);
    assert.equal(status.state, 'failed'); assert.equal(status.callsReserved, 1); assert.equal(status.canObserveOriginal, false);
    // v1 player status remains conservatively possibly-or-confirmed. The exact
    // new diagnostic is durable internal evidence, not an unversioned UI claim.
    assert.equal(status.modelSent, 'possibly-or-confirmed');
    const file = path.join(f.dir, 'context-analysis', f.submission.requestHash, 'assembly-journal', 'call-1.json');
    const raw = await fs.readFile(file, 'utf8'), receipt = JSON.parse(raw).value;
    assert.equal(receipt.error.diagnostic.reason, 'not-submitted'); assert.equal(receipt.error.diagnostic.phase, phase);
    assert.ok(!raw.includes('private-account-path-token')); assert.ok(!raw.includes(f.dir));
    if (fault === 'storage') assert.equal(status.localStop.code, 'ENOENT');
    assert.equal(f.requests.filter(r => r.method === 'turn/start').length, 0);
    await f.runner.submit(f.submission); assert.equal(f.requests.filter(r => r.method === 'turn/start').length, 0);
  });
}

test('failure after turn/start is attempted is STILL unknown and never reclassified as not submitted', async t => {
  const f = await fixture(t, false, 'turn/start');
  await f.runner.submit(f.submission); await f.runner.idle();
  const status = await f.runner.get(f.submission.requestHash);
  assert.equal(status.state, 'unknown'); assert.equal(status.callsReserved, 1); assert.equal(status.canObserveOriginal, false);
  assert.equal(f.requests.filter(r => r.method === 'turn/start').length, 1);
  await f.runner.submit(f.submission); assert.equal(f.requests.filter(r => r.method === 'turn/start').length, 1);
});
