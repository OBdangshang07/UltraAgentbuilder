import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {CodexAdapter} from '../../bridge/codex-adapter.mjs';
import {codexImageInput} from '../../bridge/codex-image-input.mjs';
import {codexRequestHash} from '../../bridge/codex-persistent-receipt.mjs';
import {createReferenceWorldPatchDesignRunner} from '../../bridge/reference-world-patch-design-runner.mjs';
import {assemblyRuntimeIdentity} from '../../bridge/assembly-durability.mjs';
import {freezeReferenceWorldPatchTaskImages} from '../../bridge/reference-world-patch-task-images.mjs';
import {readFrozenReferenceWorldPatchTaskSource} from '../../bridge/reference-world-patch-task-capsule.mjs';
import {jointCapsuleFixture} from '../fixtures/reference-world-patch-capsule-fixture.mjs';
import {patchTaskProposal} from '../fixtures/world-patch-task-fixture.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {REFERENCE_PATCH_INVOCATION_PINS} from '../../contracts/reference-world-patch-invocation.mjs';

// Real adapter, capsule/worker/journal/compilation code; authored pixels,
// proposal and provider transport only. No paid call, real account or world.
const runtimeHash = await assemblyRuntimeIdentity();
const selected = f => ({agent: f.input.intent.agent, model: f.input.intent.model, effort: f.input.intent.effort,
  runtimeHash, capability: structuredClone(f.input.capability)});
const request = f => ({send: f.send, selected: selected(f)});
const jobDir = f => path.join(f.dir, 'reference-world-patch-invocations', f.receipt.capsuleId);
async function fixture(t, changes = {}) {
  const f = await jointCapsuleFixture(t, {runtimeHash, ...changes});
  await freezeReferenceWorldPatchTaskImages({dataDir: f.dir, capsuleId: f.receipt.capsuleId, send: f.send});
  f.snapshot = (await readFrozenReferenceWorldPatchTaskSource({dataDir: f.dir, capsuleId: f.receipt.capsuleId})).saved.snapshot;
  return f;
}
function fake(f, {proposal = patchTaskProposal(f.snapshot), supportsImages = true, beforeTurn, unknown = false} = {}) {
  const adapter = new CodexAdapter({observationIntervalMs: 10}), requests = [];
  adapter.connect = async () => {};
  adapter.models = async () => [{id: f.input.intent.model, supportsImages, efforts: ['high','max'], defaultEffort: 'max'}];
  adapter.readStoredTurn = async () => {throw Error('Synthetic original turn not yet closed');};
  adapter.request = async (method, params) => {
    requests.push({method, params});
    if (method === 'config/read') return {config: {}};
    if (method === 'thread/start') {await beforeTurn?.(params); return {thread: {id: 'joint-thread', ephemeral: false}};}
    if (method === 'thread/unsubscribe') return {};
    assert.equal(method, 'turn/start');
    if (unknown) throw Error('Synthetic unknown ACK; no terminal receipt');
    setImmediate(() => adapter.emit('notification', {method: 'turn/completed', params: {threadId: 'joint-thread',
      turn: {id: 'joint-turn', status: 'completed', items: [{type: 'agentMessage', phase: 'final_answer', text: JSON.stringify(proposal)}]}}}));
    return {turn: {id: 'joint-turn', status: 'inProgress'}};
  };
  return {adapter, requests};
}
async function open(t, f, transport) {
  const runner = await createReferenceWorldPatchDesignRunner({dataDir: f.dir, contexts: f.store, adapterFor: agent => {
    assert.equal(agent, 'codex'); return transport.adapter;
  }});
  t.after(() => runner.close()); return runner;
}
async function settle(runner) {
  const deadline = Date.now() + 15000;
  while (runner.busy()) {assert.ok(Date.now() < deadline, 'Only offline fixture settling deadline'); await delay(10);}
}
async function inventory(dir) {
  const result = {};
  for (const name of await fs.readdir(dir)) {
    const file = path.join(dir, name), stat = await fs.lstat(file);
    result[name] = stat.isDirectory() && !stat.isSymbolicLink() ? await inventory(file) : stat.isFile() ? hash(await fs.readFile(file)) : 'link';
  }
  return result;
}
const load = async file => JSON.parse(await fs.readFile(file, 'utf8')).value;

test('joint exact pixels reach one real CodexAdapter turn after durable reservation; archived patch candidate is checked without world rights', async t => {
  const f = await fixture(t), transport = fake(f), runner = await open(t, f, transport);
  const original = await inventory(path.join(f.dir, 'reference-world-patch-tasks'));
  await runner.submit(request(f)); await settle(runner);
  const status = await runner.get(f.receipt.capsuleId);
  assert.equal(status.state, 'completed-checked'); assert.equal(status.callsReserved, 1); assert.equal(status.maximumCalls, 1);
  assert.equal(status.automaticRetries, 0); assert.equal(status.worldWrites, 0); assert.equal(status.canAuthorizePlacement, false);
  assert.equal(status.serverBaselineVerified, false); assert.equal(status.candidatePublished, true);
  assert.equal(status.responseCheck.snapshotHash, f.snapshot.snapshotHash);
  const turns = transport.requests.filter(r => r.method === 'turn/start'); assert.equal(turns.length, 1);
  assert.equal(turns[0].params.input.length, 3);
  for (const [i, image] of turns[0].params.input.slice(1).entries()) {
    assert.equal(image.type, 'localImage'); assert.deepEqual(await fs.readFile(image.path), f.pixels[i]);
  }
  assert.equal(turns[0].params.sandboxPolicy.type, 'readOnly'); assert.equal(turns[0].params.sandboxPolicy.networkAccess, false);
  const call = await load(path.join(jobDir(f), 'assembly-journal/call-1.json'));
  assert.equal(call.state, 'response'); assert.equal(call.providerBinding.turnId, 'joint-turn');
  assert.deepEqual(call.response.spec, patchTaskProposal(f.snapshot));
  const patch = JSON.parse(await fs.readFile(path.join(jobDir(f), 'candidate/patch.json'), 'utf8'));
  assert.deepEqual(patch.writes.map(w => w.position), [[0,-60,0]]);
  assert.deepEqual(await inventory(path.join(f.dir, 'reference-world-patch-tasks')), original);
  assert.equal(JSON.stringify(status).includes(f.dir), false); assert.doesNotMatch(JSON.stringify(status), /modelPrompt|image-0\.png|ownerReference/);
});

test('concurrent and reopened duplicate joint SENDs cannot reserve or dispatch a second call', async t => {
  const f = await fixture(t), transport = fake(f), runner = await open(t, f, transport);
  await Promise.all([runner.submit(request(f)), runner.submit(request(f)), runner.submit(request(f))]); await settle(runner);
  const before = await inventory(f.dir), expected = await runner.get(f.receipt.capsuleId);
  assert.deepEqual(await runner.submit(request(f)), expected);
  await runner.close(); const second = await open(t, f, transport);
  assert.deepEqual(await second.submit(request(f)), expected);
  assert.deepEqual(await inventory(f.dir), before);
  assert.equal(transport.requests.filter(r => r.method === 'turn/start').length, 1);
  await assert.rejects(second.submit({...request(f), selected: {...selected(f), effort: 'high'}}), /differs/);
});

test('unadvertised images stop before any adapter thread/turn and do not auto-retry later', async t => {
  const f = await fixture(t), transport = fake(f, {supportsImages: false}), runner = await open(t, f, transport);
  await runner.submit(request(f)); await settle(runner);
  const status = await runner.get(f.receipt.capsuleId);
  assert.equal(status.state, 'reserved-not-dispatched'); assert.equal(status.callsReserved, 0);
  assert.deepEqual(transport.requests, []);
  transport.adapter.models = async () => [{id: f.input.intent.model, supportsImages: true, efforts: ['high','max']}];
  await runner.submit(request(f)); assert.deepEqual(transport.requests, []);
});

test('unknown original turn ACK remains unknown, budget-spent and unresent on duplicate or reopening', async t => {
  const f = await fixture(t), transport = fake(f, {unknown: true}), runner = await open(t, f, transport);
  await runner.submit(request(f)); await settle(runner);
  const status = await runner.get(f.receipt.capsuleId);
  assert.equal(status.state, 'unknown'); assert.equal(status.callsReserved, 1); assert.equal(status.candidatePublished, false);
  const before = await inventory(jobDir(f));
  await runner.submit(request(f)); await runner.close();
  const reopened = await open(t, f, transport); assert.deepEqual(await reopened.submit(request(f)), status);
  assert.equal(transport.requests.filter(r => r.method === 'turn/start').length, 1);
  assert.deepEqual(await inventory(jobDir(f)), before);
});

test('completed out-of-scope proposal is retained as rejected, never promoted to placeable or sent again', async t => {
  const f = await fixture(t), proposal = patchTaskProposal(f.snapshot); proposal.operations[0].position = [2,-60,0];
  const transport = fake(f, {proposal}), runner = await open(t, f, transport);
  await runner.submit(request(f)); await settle(runner);
  const status = await runner.get(f.receipt.capsuleId);
  assert.equal(status.state, 'completed-rejected'); assert.equal(status.responseCheck, null); assert.equal(status.candidatePublished, false);
  assert.deepEqual((await load(path.join(jobDir(f), 'assembly-journal/call-1.json'))).response.spec, proposal);
  await runner.submit(request(f)); assert.equal(transport.requests.filter(r => r.method === 'turn/start').length, 1);
});

test('pixel mutation during thread setup aborts before turn/start without substituting or recreating pixels', async t => {
  const f = await fixture(t);
  const image = path.join(f.dir, 'reference-world-patch-task-images', f.receipt.capsuleId, 'image-0.png');
  const transport = fake(f, {beforeTurn: () => fs.appendFile(image, ' synthetic corruption')}), runner = await open(t, f, transport);
  await runner.submit(request(f)); await settle(runner);
  assert.equal(transport.requests.filter(r => r.method === 'thread/start').length, 1);
  assert.equal(transport.requests.filter(r => r.method === 'turn/start').length, 0);
  assert.equal((await runner.get(f.receipt.capsuleId)).state, 'failed');
  assert.ok((await fs.readFile(image)).includes(Buffer.from('synthetic corruption')));
});

test('adapter rejects caller pin/path injection, mixed native pixels and completed-call reuse', async t => {
  const f = await fixture(t), transport = fake(f), runner = await open(t, f, transport);
  await runner.submit(request(f)); await settle(runner);
  const input = (await load(path.join(jobDir(f), 'request.json'))).send;
  const binding = {format: 'FrozenReferenceWorldPatchInvocationBinding', version: 1, purpose: 'reference-world-patch-design',
    ...Object.fromEntries(REFERENCE_PATCH_INVOCATION_PINS.map(k => [k, f.receipt[k]]))};
  assert.equal(input.capsuleId, binding.capsuleId);
  for (const pin of REFERENCE_PATCH_INVOCATION_PINS) await assert.rejects(codexImageInput({cwd: jobDir(f), model: f.input.intent.model,
    referenceInput: {...binding, [pin]: 'b'.repeat(64)}}));
  await assert.rejects(codexImageInput({cwd: jobDir(f), model: f.input.intent.model, referenceInput: {...binding, path: '../source'}}));
  await assert.rejects(codexImageInput({cwd: jobDir(f), model: f.input.intent.model, referenceInput: binding}), /pending original/);
  await assert.rejects(codexImageInput({cwd: jobDir(f), model: f.input.intent.model, referenceInput: binding, images: ['not-permitted']}), /mixed/);
});

test('expired consent during thread setup cannot submit a turn or renew the original capture', async t => {
  const f = await fixture(t), transport = fake(f, {beforeTurn: () => t.mock.timers.enable({apis: ['Date'], now: f.receipt.recordExpiresAt})});
  const runner = await open(t, f, transport);
  await runner.submit(request(f));
  // Date is intentionally frozen in this synthetic fixture, so use a bounded
  // iteration count here instead of the ordinary clock-based settling helper.
  for (let i = 0; runner.busy() && i < 1000; i++) await delay(10);
  assert.equal(runner.busy(), false); assert.equal(transport.requests.filter(r => r.method === 'turn/start').length, 0);
  assert.equal((await runner.get(f.receipt.capsuleId)).state, 'failed');
  await runner.submit(request(f)); assert.equal(transport.requests.filter(r => r.method === 'turn/start').length, 0);
});

test('image capability changes during thread setup block dispatch instead of silently using another model', async t => {
  const f = await fixture(t); let transport;
  transport = fake(f, {beforeTurn: () => {transport.adapter.models = async () => [{id: f.input.intent.model, supportsImages: false, efforts: ['high','max']}];}});
  const runner = await open(t, f, transport); await runner.submit(request(f)); await settle(runner);
  assert.equal(transport.requests.filter(r => r.method === 'turn/start').length, 0);
  assert.equal((await runner.get(f.receipt.capsuleId)).state, 'failed');
});

test('partial invocation directory and unexpected history are retained without owner adoption or dispatch', async t => {
  const f = await fixture(t), transport = fake(f), runner = await open(t, f, transport);
  await fs.mkdir(jobDir(f)); await fs.writeFile(path.join(jobDir(f), 'synthetic-partial'), 'preserve original', {flag: 'wx'});
  const before = await inventory(f.dir);
  await assert.rejects(runner.submit(request(f))); assert.deepEqual(await inventory(f.dir), before);
  assert.deepEqual(transport.requests, []);
});

test('only the original closed-turn reader can resolve a bound unknown after expiry; no new turn, reservation or live-owner takeover', async t => {
  const f = await fixture(t), transport = fake(f); let calls = 0, captured;
  transport.adapter.generate = async args => {
    calls++; const imageInput = await codexImageInput(args);
    const requestHash = await codexRequestHash({...args, ...imageInput});
    const binding = {version: 1, provider: 'codex', storage: 'persistent-single-turn', model: args.model, effort: args.effort,
      threadId: 'joint-original-thread', turnId: null, requestHash};
    await args.onProviderBinding(binding); await args.onProviderBinding({...binding, turnId: 'joint-original-turn'});
    captured = {args, imageInput};
    const error = Error('Synthetic bound unknown after original dispatch'); error.diagnostic = {provider: 'codex', reason: 'unknown'}; throw error;
  };
  const runner = await open(t, f, transport); await runner.submit(request(f)); await settle(runner);
  assert.equal((await runner.get(f.receipt.capsuleId)).canObserveOriginal, true);
  const other = await open(t, f, transport);
  await assert.rejects(other.observeOriginal(f.receipt.capsuleId), /owner live\/inconclusive/);
  transport.adapter.request = async () => assert.fail('Original-receipt observation may not start/resume/interrupt a turn');
  transport.adapter.readStoredTurn = async () => ({thread: {id: 'joint-original-thread', ephemeral: false, turns: [{
    id: 'joint-original-turn', status: 'completed', startedAt: 1, completedAt: 2, itemsView: 'full', items: [
      {type: 'userMessage', content: [{type: 'text', text: captured.args.prompt}, ...captured.imageInput.images.map(path => ({type: 'localImage', path}))]},
      {type: 'agentMessage', phase: 'final_answer', text: JSON.stringify(patchTaskProposal(f.snapshot))}]}]}});
  t.mock.timers.enable({apis: ['Date'], now: f.receipt.recordExpiresAt});
  const status = await runner.observeOriginal(f.receipt.capsuleId);
  assert.equal(status.state, 'completed-checked'); assert.equal(status.callsReserved, 1); assert.equal(calls, 1);
  assert.equal(status.localStop.isProviderTerminalReceipt, false); assert.equal(status.canAuthorizePlacement, false);
  await assert.rejects(fs.stat(path.join(jobDir(f), '_observer.json')), {code: 'ENOENT'});
  await runner.submit(request(f)); assert.equal(calls, 1);
});

test('close during synthetic thread setup stops before dispatch and preserves the original one-call reservation', async t => {
  const f = await fixture(t); let enteredResolve, release;
  const entered = new Promise(resolve => {enteredResolve = resolve;}), wait = new Promise(resolve => {release = resolve;});
  const transport = fake(f, {beforeTurn: async () => {enteredResolve(); await wait;}}), runner = await open(t, f, transport);
  await runner.submit(request(f)); await entered;
  const closing = runner.close(); release(); await closing;
  assert.equal(transport.requests.filter(r => r.method === 'turn/start').length, 0);
  const status = await runner.get(f.receipt.capsuleId); assert.equal(status.callsReserved, 1); assert.equal(status.canAuthorizePlacement, false);
  await assert.rejects(runner.submit(request(f)), /closed/);
});

test('an extra persisted invocation is rejected instead of silently reporting a one-call task', async t => {
  const f = await fixture(t), transport = fake(f), runner = await open(t, f, transport);
  await runner.submit(request(f)); await settle(runner);
  const ledger = path.join(jobDir(f), 'assembly-journal');
  await fs.copyFile(path.join(ledger, 'call-1.json'), path.join(ledger, 'call-2.json'));
  const before = await inventory(jobDir(f));
  await assert.rejects(runner.get(f.receipt.capsuleId), /one-call budget/);
  await assert.rejects(runner.submit(request(f)), /one-call budget/);
  assert.deepEqual(await inventory(jobDir(f)), before);
  assert.equal(transport.requests.filter(r => r.method === 'turn/start').length, 1);
});

test('concurrent identical original downloads share the bounded reader, while changed kind/hash and close never return fallback bytes', async t => {
  const f=await fixture(t),transport=fake(f),runner=await open(t,f,transport);
  await runner.submit(request(f));await settle(runner);
  const status=await runner.get(f.receipt.capsuleId),id=f.receipt.capsuleId;
  const first=runner.downloadPreview(id,status.candidateHash),same=runner.downloadPreview(id,status.candidateHash);
  await assert.rejects(runner.downloadCandidate(id,status.candidateHash),/differs/);
  await assert.rejects(runner.downloadPreview(id,'b'.repeat(64)),/differs/);
  const [a,b]=await Promise.all([first,same]);assert.deepEqual(a,b);
  assert.equal(JSON.parse(a).candidateFilesReverified,true);
  const reading=runner.downloadCandidate(id,status.candidateHash),rejected=assert.rejects(reading,/closed|cancelled/);
  await runner.close();await rejected;
  assert.equal(transport.requests.filter(r=>r.method==='turn/start').length,1);
});

test('private worker metadata input is bounded, rejects caller paths and UUIDs, and a missing original invocation creates nothing', async t => {
  const f=await fixture(t),transport=fake(f);await open(t,f,transport);
  const operation=(id,value)=>f.store.operation('reference-patch-invocation-metadata',id,Buffer.from(JSON.stringify(value)));
  assert.equal(await operation(f.receipt.capsuleId,{runtimeHash}),null);
  await assert.rejects(operation(f.id,{runtimeHash}),/identity/);
  await assert.rejects(operation(f.receipt.capsuleId,{runtimeHash,path:'../caller-source'}),/unknown|unexpected|keys|field/i);
  await assert.rejects(f.store.operation('reference-patch-invocation-metadata',f.receipt.capsuleId,Buffer.alloc(129)),{statusCode:413});
  await assert.rejects(fs.stat(jobDir(f)),{code:'ENOENT'});assert.deepEqual(transport.requests,[]);
});
