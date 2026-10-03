import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {startBridge} from '../../bridge/server.mjs';
import {selectionChunks, regionCells} from '../../contracts/world-selection.mjs';

const intent = {format: 'WorldContextTaskIntent', version: 2, purpose: 'context-analysis', agent: 'codex', model: 'offline-analysis-fixture', effort: 'max', prompt: '只读分析环境；明确推断与未知。', maximumCalls: 1};
function capture() {
  const selection = {format: 'WorldSelection', version: 1, world: {worldId: 'opaque_fixture', dimension: 'minecraft:overworld', minY: -64, maxY: 320}, revision: 1,
    context: {min: [-2, -2, -2], max: [2, 2, 2]}, edit: {min: [-1, -1, -1], max: [1, 1, 1]}, protected: []};
  return {selection, capture: {fence: {start: 2, end: 2}, chunks: selectionChunks(selection).map(chunk => ({x: chunk.x, z: chunk.z, coverage: 'known',
    palette: [{state: 'minecraft:stone', blockEntity: false}], runs: [[0, regionCells(chunk.region)]]}))}};
}
async function fixture(t, enabled, generate) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'voxel-context-analysis-http-'))), contextId = randomUUID(), calls = {count: 0};
  const adapter = {close() {}, async generate(args) { calls.count++; return generate(args); }};
  let service = await startBridge({dataDir: dir, adapter, claudeAdapter: adapter, deepseekAdapter: adapter, experimentalContextAnalysis: enabled});
  t.after(async () => { await service.close(); assert.equal(await fs.realpath(dir), dir); assert.match(path.basename(dir), /^voxel-context-analysis-http-/); await fs.rm(dir, {recursive: true}); });
  const request = async (route, input, custom) => {
    const result = await fetch('http://127.0.0.1:' + service.connection.port + route, {method: input ? 'POST' : 'GET',
      headers: custom ?? {Authorization: 'Bearer ' + service.connection.token, 'Content-Type': 'application/json'}, body: input ? JSON.stringify(input) : undefined});
    return {status: result.status, body: await result.json()};
  };
  const base = '/v1/world-contexts/' + contextId;
  assert.equal((await request(base + '/capture', capture())).status, 200);
  const prepared = (await request(base + '/task-disclosure', intent)).body;
  const consent = (await request(base + '/confirm-disclosure', {confirmed: true, disclosureHash: prepared.disclosure.disclosureHash, task: prepared.disclosure.recipient})).body;
  const submission = {contextId, consentId: consent.id, requestHash: prepared.requestHash, disclosureHash: prepared.disclosure.disclosureHash, intent, explicitSend: true};
  return {dir, calls, request, base, submission, prepared, adapter, async restart() {
    await service.close(); service = await startBridge({dataDir: dir, adapter, claudeAdapter: adapter, deepseekAdapter: adapter, experimentalContextAnalysis: enabled});
  }};
}
async function terminal(f) {
  for (let i = 0; i < 100; i++) { const value = await f.request('/v1/context-analysis/' + f.submission.requestHash); assert.equal(value.status, 200);
    if (['completed', 'completed-rejected', 'failed', 'unknown'].includes(value.body.state)) return value.body;
    await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('No bounded offline receipt');
}
const response = args => {
  const data = JSON.parse(args.prompt.split('(JSON data):\n')[1]);
  return {spec: {format: 'WorldContextAnalysis', version: 1, requestHash: data.requestHash,
    snapshotHash: data.request.snapshotHash, summaryHash: data.request.summaryHash, observations: ['64 格已知石头。'], inferences: [], unknowns: ['功能与通行未知。'], recommendations: []}};
};

test('default process cannot send analyses or enable the development switch through HTTP', async t => {
  const f = await fixture(t, false, async () => { throw new Error('forbidden'); });
  const capability = await f.request('/v1/context-analysis/capabilities');
  assert.equal(capability.status, 200);
  assert.deepEqual(capability.body, {format: 'WorldContextAnalysisCapabilities', version: 1, requestVersion: 2, enabled: false, maximumCalls: 1, automaticRetries: 0, canAuthorizePlacement: false});
  assert.equal((await f.request(f.base + '/send-analysis', f.submission)).status, 409);
  assert.equal((await f.request('/v1/context-analysis/' + f.submission.requestHash)).status, 409);
  assert.equal((await f.request('/v1/config/context-analysis', {experimentalContextAnalysis: true})).status, 404);
  assert.equal(f.calls.count, 0); assert.equal(f.prepared.sendingImplemented, false);
});

test('opt-in paired HTTP sends once, retrieves after restart/discard and never authorizes placement', async t => {
  const f = await fixture(t, true, async args => response(args));
  assert.equal((await f.request('/v1/context-analysis/capabilities')).body.enabled, true);
  assert.equal(f.calls.count, 0, 'Capability discovery cannot submit a model');
  const receipts = await Promise.all([f.request(f.base + '/send-analysis', f.submission), f.request(f.base + '/send-analysis', f.submission)]);
  assert.ok(receipts.every(value => value.status === 202)); const complete = await terminal(f);
  assert.equal(complete.state, 'completed'); assert.equal(complete.callsReserved, 1); assert.equal(complete.analysisClaimsVerified, false); assert.equal(complete.canAuthorizePlacement, false);
  assert.equal(f.calls.count, 1); await f.request(f.base + '/discard', {}); await f.restart();
  const recovered = await f.request('/v1/context-analysis/' + f.submission.requestHash); assert.equal(recovered.body.state, 'completed');
  assert.equal((await f.request(f.base + '/send-analysis', f.submission)).status, 202); assert.equal(f.calls.count, 1);
});

test('pairing, origin, explicit confirmation, baseline identity and edit fields reject before any call', async t => {
  const f = await fixture(t, true, async args => response(args));
  assert.equal((await f.request(f.base + '/send-analysis', f.submission, {'Content-Type': 'application/json'})).status, 401);
  assert.equal((await f.request(f.base + '/send-analysis', f.submission, {Authorization: 'Bearer invalid', Origin: 'https://example.com', 'Content-Type': 'application/json'})).status, 403);
  for (const changed of [{...f.submission, explicitSend: false}, {...f.submission, worldPatch: {}}, {...f.submission, contextId: randomUUID()},
    {...f.submission, intent: {...intent, prompt: intent.prompt + ' changed'}}, {...f.submission, intent: {...intent, maximumCalls: 2}}]) {
    assert.ok((await f.request(f.base + '/send-analysis', changed)).status >= 400);
  }
  assert.equal(f.calls.count, 0); assert.equal((await f.request('/v1/context-analysis/' + 'a'.repeat(64))).status, 404);
});

test('HTTP unknown provider outcome stays one reserved call, with no automatic restart or replacement', async t => {
  const f = await fixture(t, true, async () => { throw new Error('unknown transport'); });
  assert.equal((await f.request(f.base + '/send-analysis', f.submission)).status, 202); const value = await terminal(f);
  assert.equal(value.state, 'unknown'); assert.equal(value.callsReserved, 1); await f.restart();
  await f.request(f.base + '/send-analysis', f.submission); assert.equal(f.calls.count, 1);
  assert.equal((await f.request('/v1/context-analysis/' + f.submission.requestHash + '/observe-original', {confirmed: true})).status, 409);
  assert.equal(f.calls.count, 1);
});

test('active analysis prevents replacing its adapter/configuration', async t => {
  let release; const held = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, true, async args => { await held; return response(args); });
  await f.request(f.base + '/send-analysis', f.submission);
  assert.equal((await f.request('/v1/config/codex-path', {codexPath: ''})).status, 409);
  release(); await terminal(f); assert.equal(f.calls.count, 1);
});

test('paired experimental HTTP cannot turn an old no-call confirmation into send authority', async t => {
  const f = await fixture(t, true, async args => response(args)), legacy = {...intent, version: 1};
  const prepared = (await f.request(f.base + '/task-disclosure', legacy)).body;
  const consent = (await f.request(f.base + '/confirm-disclosure', {confirmed: true, disclosureHash: prepared.disclosure.disclosureHash, task: prepared.disclosure.recipient})).body;
  const submission = {...f.submission, consentId: consent.id, requestHash: prepared.requestHash, disclosureHash: prepared.disclosure.disclosureHash, intent: legacy};
  assert.equal((await f.request(f.base + '/send-analysis', submission)).status, 400);
  assert.ok((await f.request(f.base + '/send-analysis', {...submission, intent})).status >= 400);
  assert.equal(f.calls.count, 0); assert.equal((await f.request('/v1/context-analysis/' + prepared.requestHash)).status, 404);
});
