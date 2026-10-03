import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {WorldContextStore} from '../../bridge/world-context-store.mjs';
import {createWorldPatchDesignRunner} from '../../bridge/world-patch-design-runner.mjs';
import {validateFrozenWorldPatchExplicitSend} from '../../contracts/world-patch-send.mjs';
import {selectionChunks, regionCells} from '../../contracts/world-selection.mjs';
import {createContextSnapshot, contextHash} from '../../src/world/context-snapshot.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {startBridge} from '../../bridge/server.mjs';
import {readFrozenWorldPatchTaskSource} from '../../bridge/world-patch-task-capsule.mjs';
import {prepareResponseCandidate, readResponseCandidate} from '../../bridge/world-patch-response-candidate.mjs';
import {readFrozenResponsePreview, readFrozenResponseCandidate, WORLD_PATCH_PREVIEW_DOWNLOAD_BYTES, WORLD_PATCH_CANDIDATE_DOWNLOAD_BYTES} from '../../bridge/world-patch-preview-download.mjs';

const raw = value => Buffer.from(JSON.stringify(value));
const pins = ['capsuleId', 'manifestHash', 'taskDisclosureHash', 'taskHash', 'requestHash', 'disclosureHash', 'promptSha256', 'reviewHash'];
function capture() {
  const selection = {format: 'WorldSelection', version: 1, world: {worldId: 'patch_runner_fixture', dimension: 'minecraft:overworld', minY: -64, maxY: 320}, revision: 7,
    context: {min: [-2, -2, -2], max: [2, 2, 2]}, edit: {min: [-1, -1, -1], max: [1, 1, 1]}, protected: []};
  return {selection, capture: {fence: {start: 11, end: 11}, chunks: selectionChunks(selection).map(c => ({x: c.x, z: c.z, coverage: 'known',
    palette: [{state: 'minecraft:stone', blockEntity: false}], runs: [[0, regionCells(c.region)]]}))}};
}
async function fixture(t, overrides = {}) {
  const parent = await fs.realpath(os.tmpdir()), dir = await fs.realpath(await fs.mkdtemp(path.join(parent, 'voxel-patch-send-')));
  const store = new WorldContextStore({dataDir: dir}), opened = [];
  t.after(async () => {
    await Promise.allSettled(opened.map(r => r.close())); await store.close();
    assert.equal(await fs.realpath(dir), dir); assert.equal(path.dirname(dir), parent); assert.match(path.basename(dir), /^voxel-patch-send-/);
    await fs.rm(dir, {recursive: true});
  });
  const payload = capture(), snapshot = createContextSnapshot(payload.selection, payload.capture), contextId = randomUUID();
  const intent = {format: 'WorldPatchDesignIntent', version: 1, purpose: 'world-patch-design', agent: 'codex',
    model: 'gpt-6.1-sol', effort: 'max', prompt: '  根据周边设计玻璃入口 🏙️\n保留道路。  ', maximumCalls: 1, ...overrides};
  await store.operation('capture', contextId, raw(payload));
  const prepared = await store.operation('patch-task-disclosure', contextId, raw(intent));
  const confirmation = {format: 'SavedWorldPatchDesignConfirmation', version: 1, purpose: 'world-patch-design', confirmed: true,
    taskDisclosureHash: prepared.taskDisclosureHash, taskHash: prepared.taskHash, requestHash: prepared.task.requestHash,
    disclosureHash: prepared.task.disclosure.disclosureHash, promptSha256: prepared.task.request.promptSha256};
  const receipt = await store.operation('patch-freeze-task', contextId, raw({intent, confirmation}));
  const send = {format: 'FrozenWorldPatchExplicitSend', version: 1, purpose: 'world-patch-design', confirmed: true,
    ...Object.fromEntries(pins.map(k => [k, receipt[k]])), maximumCalls: 1};
  const proposal = {format: 'WorldPatchProposal', version: 1, snapshotHash: snapshot.snapshotHash, selectionHash: snapshot.selectionHash,
    operations: [{op: 'set', position: [0, 0, 0], before: 'minecraft:stone', after: 'minecraft:glass'}]};
  let calls = 0, observations = 0;
  const adapter = {async generate(input) { calls++; assert.equal(input.model, intent.model); assert.equal(input.effort, intent.effort === 'default' ? undefined : intent.effort);
    assert.equal(input.prompt, prepared.task.disclosure.modelPrompt); assert.deepEqual(input.images, []); return {spec: proposal}; },
    async recoverOriginal() { observations++; throw Error('No original binding supplied in this fixture'); }, close() {}};
  const open = async selected => { const r = await createWorldPatchDesignRunner({dataDir: dir, contexts: store,
    adapterFor: agent => { assert.equal(agent, intent.agent); return selected ?? adapter; }}); opened.push(r); return r; };
  const server = async (enabled, production = false) => { const service = await startBridge({dataDir: dir, adapter, claudeAdapter: adapter, deepseekAdapter: adapter,
    experimentalWorldPatchDesign: enabled, worldPatchSending: production}); opened.push(service); return service; };
  return {dir, store, contextId, intent, receipt, send, proposal, snapshot, prepared, open, server, adapter,
    count: () => calls, observations: () => observations, jobDir: path.join(dir, 'world-patch-design', receipt.capsuleId)};
}
async function wait(runner, id, target) {
  for (let i = 0; i < 300; i++) { const value = await runner.get(id); if (target.includes(value.state)) return value; await delay(20); }
  assert.fail('Original patch job did not reach expected state');
}
const load = async file => (JSON.parse(await fs.readFile(file, 'utf8'))).value;
const rewrite = (file, value) => fs.writeFile(file, JSON.stringify({value, sha256: hash(value)}));

test('independent SEND reaches archived-baseline checked state with exactly one call and no placement authority', async t => {
  const f = await fixture(t), r = await f.open();
  assert.equal(await r.get('a'.repeat(64)), null);
  const result = await r.submit(f.send); assert.equal(result.id, f.receipt.capsuleId);
  const end = await wait(r, result.id, ['completed-checked']); assert.equal(f.count(), 1); assert.equal(end.callsReserved, 1);
  assert.equal(end.version,2);assert.equal(end.runtimeHash,r.runtimeHash);assert.match(r.runtimeHash,/^[a-f0-9]{64}$/);
  assert.equal(end.maximumCalls, 1); assert.equal(end.responseCheck.snapshotHash, f.snapshot.snapshotHash);
  assert.equal(end.responseCheck.sourceArchiveReverified, true); assert.equal(end.responseCheck.serverBaselineVerified, false);
  assert.equal(end.candidatePublished, true); assert.equal(end.candidateCurrentFilesReverified, false);
  assert.match(end.candidateHash, /^[a-f0-9]{64}$/); assert.equal(end.canAuthorizePlacement, false); assert.equal(end.worldWrites, 0);
  assert.deepEqual(await r.submit(f.send), end); assert.equal(f.count(), 1);
  const journal = await load(path.join(f.jobDir, 'assembly-journal/call-1.json'));
  assert.deepEqual(journal.response.spec, f.proposal); assert.equal(journal.state, 'response');
  await r.close(); const reopened = await f.open(); assert.equal((await reopened.submit(f.send)).state, 'completed-checked'); assert.equal(f.count(), 1);
});

test('concurrent duplicates reuse stable task; a different exact SEND cannot substitute', async t => {
  const f = await fixture(t), r = await f.open();
  const values = await Promise.all([r.submit(f.send), r.submit(f.send), r.submit(f.send)]);
  assert.equal(new Set(values.map(v => v.id)).size, 1); await wait(r, f.receipt.capsuleId, ['completed-checked']); assert.equal(f.count(), 1);
  await assert.rejects(r.submit({...f.send, disclosureHash: 'b'.repeat(64)})); assert.equal(f.count(), 1);
});

for (const key of pins) test('new SEND rejects altered ' + key + ' without an invocation', async t => {
  const f = await fixture(t), r = await f.open(); await assert.rejects(r.submit({...f.send, [key]: 'b'.repeat(64)})); assert.equal(f.count(), 0);
});

test('review/preparation alone, extra fields, missing purpose and larger budgets are not SEND', async t => {
  const f = await fixture(t), r = await f.open();
  for (const value of [f.receipt, f.prepared, {...f.send, confirmed: false}, {...f.send, maximumCalls: 2}, {...f.send, purpose: 'context-analysis'}, {...f.send, allowWorldWrites: true}]) {
    await assert.rejects(r.submit(value)); assert.equal(f.count(), 0);
  }
  assert.deepEqual(validateFrozenWorldPatchExplicitSend(f.send), f.send);
});

test('expired capture forbids a NEW send even though the frozen archive remains auditable', async t => {
  const f = await fixture(t), r = await f.open();
  t.mock.timers.enable({apis: ['Date'], now: f.receipt.recordExpiresAt + 1000});
  await assert.rejects(r.submit(f.send), /expired/); assert.equal(f.count(), 0);
  assert.deepEqual(await f.store.operation('patch-frozen-task', f.receipt.capsuleId), f.receipt);
});

test('new send still works after original capture discard, using only the exact frozen source', async t => {
  const f = await fixture(t); await f.store.operation('discard', f.contextId);
  const r = await f.open(); await r.submit(f.send); await wait(r, f.receipt.capsuleId, ['completed-checked']); assert.equal(f.count(), 1);
});

test('invalid original proposal is retained and rejected, with no automatic correction call', async t => {
  const f = await fixture(t); f.proposal.operations[0].before = 'minecraft:dirt';
  const r = await f.open(); await r.submit(f.send); const end = await wait(r, f.receipt.capsuleId, ['completed-rejected']);
  assert.equal(end.responseCheck, null); assert.equal(f.count(), 1);
  assert.deepEqual((await load(path.join(f.jobDir, 'assembly-journal/call-1.json'))).response.spec, f.proposal);
  await r.submit(f.send); assert.equal(f.count(), 1);
});

test('unknown unbound provider outcome is not repeated on duplicate or restart', async t => {
  const f = await fixture(t); let calls = 0;
  const adapter = {async generate() {calls++; throw Error('Private provider failure text must not reach UI');}};
  const r = await f.open(adapter); await r.submit(f.send); const end = await wait(r, f.receipt.capsuleId, ['unknown']);
  assert.equal(end.canObserveOriginal, false); assert.doesNotMatch(JSON.stringify(end), /Private provider/);
  await r.submit(f.send); await r.close(); const next = await f.open(adapter); await next.submit(f.send);
  await assert.rejects(next.observeOriginal(f.receipt.capsuleId)); assert.equal(calls, 1);
});

async function pendingFixture(t) {
  const f = await fixture(t); let calls = 0, observations = 0;
  const binding = {version: 1, provider: 'codex', storage: 'persistent-single-turn', threadId: 'original-thread', turnId: 'original-turn',
    model: f.intent.model, effort: f.intent.effort, requestHash: 'd'.repeat(64)};
  const adapter = {async generate(input) { calls++; await input.onProviderBinding(binding); const e = Error('RPC disappeared'); e.diagnostic = {provider: 'codex', reason: 'unknown'}; throw e; },
    async recoverOriginal(input) { observations++; assert.deepEqual(input.binding, binding); assert.equal(input.prompt, f.prepared.task.disclosure.modelPrompt); return {spec: f.proposal}; }};
  const r = await f.open(adapter); await r.submit(f.send); await wait(r, f.receipt.capsuleId, ['unknown']);
  return {...f, r, selected: adapter, calls: () => calls, recovered: () => observations};
}

// Deterministically replace the mutable journal between lstat and open.
function replaceBeforeRead(t, file, replacements, mutate = value => value) {
  const originalOpen = fs.open; let changes = 0;
  const mock = t.mock.method(fs, 'open', async (target, flags, ...rest) => {
    if (target === file && flags === 'r' && changes < replacements) {
      const value = mutate(await load(file)), tmp = file + '.' + randomUUID() + '.tmp';
      await rewrite(tmp, value); await fs.rename(tmp, file); changes++;
    }
    return originalOpen(target, flags, ...rest);
  });
  return {changes: () => changes, restore: () => mock.mock.restore()};
}
async function heldFixture(t) {
  const f = await fixture(t); let release, calls = 0;
  const held = new Promise(resolve => {release = resolve;});
  t.after(() => release());
  const r = await f.open({async generate(input) {
    calls++;
    await new Promise(resolve => {
      const done = () => {input.signal.removeEventListener('abort', done); resolve();};
      input.signal.addEventListener('abort', done, {once: true}); held.then(done);
    });
    input.signal.throwIfAborted(); return {spec: f.proposal};
  }});
  await r.submit(f.send);
  return {...f, r, release, calls: () => calls};
}
test('active atomic journal replacement retries only the read and never resubmits', async t => {
  const f = await heldFixture(t), file = path.join(f.jobDir, 'assembly-journal/call-1.json');
  const race = replaceBeforeRead(t, file, 1, value => ({...value, harmlessReadFixture: true}));
  const observed = await f.r.get(f.receipt.capsuleId); race.restore();
  assert.equal(race.changes(), 1); assert.equal(observed.state, 'running'); assert.equal(observed.callsReserved, 1); assert.equal(f.calls(), 1);
  f.release(); await wait(f.r, f.receipt.capsuleId, ['completed-checked']); assert.equal(f.calls(), 1);
});
test('active read race exhausts exactly three observations without dispatch or evidence removal', async t => {
  const f = await heldFixture(t), file = path.join(f.jobDir, 'assembly-journal/call-1.json');
  const race = replaceBeforeRead(t, file, 8);
  await assert.rejects(f.r.get(f.receipt.capsuleId), {code: 'PATCH_JOURNAL_READ_RACE'}); race.restore();
  assert.equal(race.changes(), 3); assert.equal((await load(file)).state, 'pending'); assert.equal(f.calls(), 1);
  f.release(); await wait(f.r, f.receipt.capsuleId, ['completed-checked']);
});

for (const corrupt of [false, true]) test('query sees exact writer retire during its atomic journal replacement'+(corrupt?' but still rejects corrupt retained evidence':''), async t => {
  const f = await fixture(t); let release, bound, calls = 0;
  const held = new Promise(resolve => {release = resolve;}), bindingSaved = new Promise(resolve => {bound = resolve;});
  t.after(() => release());
  const binding = {version:1,provider:'codex',storage:'persistent-single-turn',threadId:'retiring-thread',turnId:'retiring-turn',
    model:f.intent.model,effort:f.intent.effort,requestHash:'d'.repeat(64)};
  const r = await f.open({async generate(input) {
    calls++;await input.onProviderBinding(binding);bound();await held;
    const error = Error('Original outcome unknown');error.diagnostic={provider:'codex',reason:'unknown'};throw error;
  }});
  await r.submit(f.send);await bindingSaved;
  const file=path.join(f.jobDir,'assembly-journal/call-1.json'),before=await fs.readFile(file,'utf8'),originalOpen=fs.open;let replacements=0;
  const race=t.mock.method(fs,'open',async(target,flags,...rest)=>{
    if(target===file&&flags==='r'&&replacements===0){
      replacements++;const tmp=file+'.'+randomUUID()+'.tmp';
      await fs.writeFile(tmp,before);await fs.rename(tmp,file);
      release();while(r.busy())await delay(1);
      if(corrupt){const envelope=JSON.parse(before);envelope.sha256='0'.repeat(64);await fs.writeFile(file,JSON.stringify(envelope));}
    }
    return originalOpen(target,flags,...rest);
  });
  if(corrupt)await assert.rejects(r.get(f.receipt.capsuleId),error=>error.code!=='PATCH_JOURNAL_READ_RACE'&&/integrity/.test(error.message));
  else{
    const observed=await r.get(f.receipt.capsuleId);
    assert.equal(observed.state,'unknown');assert.equal(observed.canObserveOriginal,true);assert.equal(observed.callsReserved,1);
    assert.equal(await fs.readFile(file,'utf8'),before);
  }
  race.mock.restore();assert.equal(replacements,1);assert.equal(calls,1);assert.equal((await load(file)).state,'pending');
});

test('inactive original journal replacement is not retried or adopted as a new call', async t => {
  const f = await pendingFixture(t); await f.r.close(); const next = await f.open(f.selected);
  const race = replaceBeforeRead(t, path.join(f.jobDir, 'assembly-journal/call-1.json'), 8);
  await assert.rejects(next.get(f.receipt.capsuleId), {code: 'PATCH_JOURNAL_READ_RACE'}); race.restore();
  assert.equal(race.changes(), 1); assert.equal(f.calls(), 1); assert.equal(f.recovered(), 0);
});
test('active journal hash corruption never acquires atomic-write retry semantics', async t => {
  const f = await heldFixture(t), file = path.join(f.jobDir, 'assembly-journal/call-1.json'), original = await fs.readFile(file);
  const envelope = JSON.parse(original); envelope.sha256 = '0'.repeat(64); await fs.writeFile(file, JSON.stringify(envelope));
  await assert.rejects(f.r.get(f.receipt.capsuleId), error => error.code !== 'PATCH_JOURNAL_READ_RACE' && /integrity/.test(error.message));
  assert.equal(f.calls(), 1); await fs.writeFile(file, original); f.release(); await wait(f.r, f.receipt.capsuleId, ['completed-checked']);
});

test('bound unknown uses only the exact original turn, including after source expiry and discard', async t => {
  const f = await pendingFixture(t); await f.r.close(); await f.store.operation('discard', f.contextId);
  t.mock.timers.enable({apis: ['Date'], now: f.receipt.recordExpiresAt + 1000});
  const next = await f.open(f.selected); assert.equal((await next.submit(f.send)).canObserveOriginal, true);
  await next.observeOriginal(f.receipt.capsuleId); const end = await wait(next, f.receipt.capsuleId, ['completed-checked']);
  assert.equal(end.callsReserved, 1); assert.equal(f.calls(), 1); assert.equal(f.recovered(), 1);
});

test('another live owner cannot observe/adopt a pending task before explicit release', async t => {
  const f = await pendingFixture(t), next = await f.open(f.selected);
  await assert.rejects(next.observeOriginal(f.receipt.capsuleId), /live\/inconclusive/);
  assert.equal(f.calls(), 1); assert.equal(f.recovered(), 0);
  await f.r.observeOriginal(f.receipt.capsuleId); await wait(f.r, f.receipt.capsuleId, ['completed-checked']); assert.equal(f.recovered(), 1);
});

test('crashed observation claim is preserved, never aged out as a fresh retry', async t => {
  const f = await pendingFixture(t); await f.r.close(); const file = path.join(f.jobDir, '_observer.json');
  await rewrite(file, {unknownClaim: true}); const original = await fs.readFile(file); const next = await f.open(f.selected);
  await assert.rejects(next.observeOriginal(f.receipt.capsuleId), /EEXIST/);
  assert.deepEqual(await fs.readFile(file), original); assert.equal(f.recovered(), 0); assert.equal(f.calls(), 1);
});

for (const count of ['zero', 'missing', 'empty']) test('missing original call with ' + count + ' journal never permits dispatch or observation', async t => {
  const f = await pendingFixture(t); await f.r.close(); const journal = path.join(f.jobDir, 'assembly-journal');
  await fs.unlink(path.join(journal, 'call-1.json'));
  if (count === 'zero') await rewrite(path.join(journal, 'dispatched.json'), {count: 0});
  else if (count === 'missing') await fs.unlink(path.join(journal, 'dispatched.json'));
  else for (const n of await fs.readdir(journal)) await fs.unlink(path.join(journal, n));
  const next = await f.open(f.selected); await assert.rejects(next.get(f.receipt.capsuleId));
  await assert.rejects(next.submit(f.send)); await assert.rejects(next.observeOriginal(f.receipt.capsuleId));
  assert.equal(f.calls(), 1); assert.equal(f.recovered(), 0);
});

test('partial original job directory is retained and never adopted', async t => {
  const f = await fixture(t), r = await f.open(); await fs.mkdir(f.jobDir); await fs.writeFile(path.join(f.jobDir, 'unknown'), 'original');
  await assert.rejects(r.submit(f.send)); assert.equal(await fs.readFile(path.join(f.jobDir, 'unknown'), 'utf8'), 'original'); assert.equal(f.count(), 0);
});

test('local abort is not represented as a provider terminal result', async t => {
  const f = await fixture(t); let calls = 0;
  const adapter = {async generate(input) { calls++; await input.onProviderBinding({version: 1, provider: 'codex', storage: 'persistent-single-turn', threadId: 'aborted-thread', turnId: 'aborted-turn',
    requestHash: 'a'.repeat(64), model: f.intent.model, effort: f.intent.effort});
    const e = Error('Locally cancelled'); e.diagnostic = {provider: 'codex', reason: 'aborted'}; throw e; }};
  const r = await f.open(adapter); await r.submit(f.send); const end = await wait(r, f.receipt.capsuleId, ['unknown']);
  assert.equal(end.canObserveOriginal, true); assert.equal(calls, 1);
});

test('source corruption during dispatch retains response without falsely blaming model output', async t => {
  const f = await fixture(t); let calls = 0;
  const adapter = {async generate() { calls++; await fs.appendFile(path.join(f.dir, 'world-patch-tasks', f.receipt.capsuleId, 'payload.json'), 'corrupt'); return {spec: f.proposal}; }};
  const r = await f.open(adapter); await r.submit(f.send); const end = await wait(r, f.receipt.capsuleId, ['response-retained']);
  assert.equal(end.responseCheck, null); assert.equal(calls, 1); await r.submit(f.send); assert.equal(calls, 1);
});

for (const mode of ['runtime', 'owner', 'budget', 'fingerprint']) test('rehashed ' + mode + ' job metadata cannot change original invocation binding', async t => {
  const f = await pendingFixture(t); await f.r.close();
  const file = path.join(f.jobDir, 'request.json'), value = await load(file);
  if (mode === 'runtime') value.runtimeHash = 'b'.repeat(64);
  if (mode === 'owner') value.ownerReferenceHash = 'b'.repeat(64);
  if (mode === 'budget') value.maximumCalls = 2;
  if (mode === 'fingerprint') value.invocationFingerprint = 'b'.repeat(64);
  await rewrite(file, value); const next = await f.open(f.selected);
  await assert.rejects(next.submit(f.send)); await assert.rejects(next.observeOriginal(f.receipt.capsuleId)); assert.equal(f.calls(), 1); assert.equal(f.recovered(), 0);
});

test('rehashed completion cannot claim world-write or current-server authority', async t => {
  const f = await fixture(t), r = await f.open(); await r.submit(f.send); await wait(r, f.receipt.capsuleId, ['completed-checked']);
  const file = path.join(f.jobDir, 'completion.json'), value = await load(file); value.responseCheck.canAuthorizePlacement = true; await rewrite(file, value);
  await assert.rejects(r.get(f.receipt.capsuleId)); assert.equal(f.count(), 1);
});

async function completedFixture(t) {
  const f = await fixture(t), r = await f.open(); await r.submit(f.send);
  const end = await wait(r, f.receipt.capsuleId, ['completed-checked']);
  const request = await load(path.join(f.jobDir, 'request.json'));
  const source = await readFrozenWorldPatchTaskSource({root: path.join(f.dir, 'world-patch-tasks'), capsuleId: f.receipt.capsuleId});
  const preparedCandidate = prepareResponseCandidate({source, send: f.send, runtimeHash: request.runtimeHash, spec: f.proposal});
  return {...f, r, end, preparedCandidate, candidateDir: path.join(f.jobDir, 'candidate')};
}
test('saved candidate includes exact original proposal, guarded patch and world-anchored difference preview', async t => {
  const f = await completedFixture(t), c = await readResponseCandidate({directory: f.candidateDir, prepared: f.preparedCandidate, expectedCandidateHash: f.end.candidateHash});
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.candidateDir, 'proposal.json'))), f.proposal);
  assert.equal(c.patchHash, f.end.responseCheck.patchHash); assert.equal(c.previewHash, f.end.responseCheck.previewHash);
  assert.equal(c.coordinateSpace, 'original-world-absolute'); assert.equal(c.movable, false);
  for (const key of ['canAuthorizePlacement', 'serverBaselineVerified', 'modelOriginVerified', 'worldRendered', 'crashAtomicPublication']) assert.equal(c[key], false);
  assert.equal(c.additionalModelCalls, 0); assert.equal(c.worldWrites, 0);
  assert.deepEqual(f.preparedCandidate.preview.summary.counts, {added: 0, removed: 0, replaced: 1});
});
test('missing local completion marker rebuilds from the same response after restart, discard and source expiry', async t => {
  const f = await completedFixture(t); await f.r.close(); await f.store.operation('discard', f.contextId);
  const recordBefore = await fs.readFile(path.join(f.jobDir, 'assembly-journal/call-1.json'));
  await fs.unlink(path.join(f.jobDir, 'completion.json'));
  t.mock.timers.enable({apis: ['Date'], now: f.receipt.recordExpiresAt + 1000});
  const next = await f.open(); assert.equal((await next.get(f.receipt.capsuleId)).state, 'response-retained');
  const result = await next.recheckResponse(f.receipt.capsuleId);
  assert.equal(result.state, 'completed-checked'); assert.equal(result.candidateHash, f.end.candidateHash);
  assert.deepEqual(await fs.readFile(path.join(f.jobDir, 'assembly-journal/call-1.json')), recordBefore);
  assert.equal(f.count(), 1); assert.equal(f.observations(), 0); assert.equal(result.callsReserved, 1);
});
for (const mode of ['proposal', 'patch', 'preview', 'metadata', 'extra', 'missing', 'hardlink']) test('candidate ' + mode + ' corruption is retained and never overwritten or resent', async t => {
  const f = await completedFixture(t); await f.r.close(); let file;
  if (mode === 'extra') {file = path.join(f.candidateDir, 'unknown'); await fs.writeFile(file, 'original');}
  else if (mode === 'missing') {file = path.join(f.candidateDir, 'patch.json'); await fs.unlink(file);}
  else if (mode === 'hardlink') {file = path.join(f.candidateDir, 'patch.json'); await fs.link(file, path.join(f.jobDir, 'linked-patch'));}
  else {file = path.join(f.candidateDir, {proposal: 'proposal.json', patch: 'patch.json', preview: 'preview.json', metadata: 'candidate.json'}[mode]); await fs.appendFile(file, ' ');}
  const before = mode === 'missing' ? null : await fs.readFile(file), next = await f.open();
  await assert.rejects(readResponseCandidate({directory: f.candidateDir, prepared: f.preparedCandidate, expectedCandidateHash: f.end.candidateHash}));
  await assert.rejects(next.recheckResponse(f.receipt.capsuleId));
  if (before) assert.deepEqual(await fs.readFile(file), before); else await assert.rejects(fs.stat(file), {code: 'ENOENT'});
  assert.equal(f.count(), 1); assert.equal(f.observations(), 0); assert.equal((await next.get(f.receipt.capsuleId)).candidateCurrentFilesReverified, false);
});
test('partial candidate publication and crashed local-check claim are preserved without automatic adoption', async t => {
  const f = await fixture(t); const r = await f.open({async generate() {await fs.mkdir(path.join(f.jobDir, 'candidate')); return {spec: f.proposal};}});
  await r.submit(f.send); await wait(r, f.receipt.capsuleId, ['response-retained']);
  await assert.rejects(r.recheckResponse(f.receipt.capsuleId)); assert.deepEqual(await fs.readdir(path.join(f.jobDir, 'candidate')), []);
  await rewrite(path.join(f.jobDir, '_response-check.json'), {unknownClaim: true});
  const before = await fs.readFile(path.join(f.jobDir, '_response-check.json'));
  await assert.rejects(r.recheckResponse(f.receipt.capsuleId), /EEXIST/);
  assert.deepEqual(await fs.readFile(path.join(f.jobDir, '_response-check.json')), before);
});
test('new observer cannot rebuild a completed response while the exact primary owner is still live', async t => {
  const f = await completedFixture(t), next = await f.open();
  await assert.rejects(next.recheckResponse(f.receipt.capsuleId), /live\/inconclusive/);
  await f.r.close(); assert.equal((await next.recheckResponse(f.receipt.capsuleId)).candidateHash, f.end.candidateHash); assert.equal(f.count(), 1);
});
test('pending original result cannot be locally replaced by candidate reconstruction', async t => {
  const f = await pendingFixture(t); await assert.rejects(f.r.recheckResponse(f.receipt.capsuleId), /completed response/);
  assert.equal(f.calls(), 1); assert.equal(f.recovered(), 0);
});

for (const agent of ['claude', 'deepseek']) test(agent + ' still uses selected provider and one non-retrying reservation in FREE simulation', async t => {
  const f = await fixture(t, {agent, model: 'mock-model', effort: 'default'}), r = await f.open();
  await r.submit(f.send); await wait(r, f.receipt.capsuleId, ['completed-checked']); await r.submit(f.send); assert.equal(f.count(), 1);
});

async function evidenceTree(dir) {
  const result = [];
  async function walk(at) {
    for (const entry of (await fs.readdir(at, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(at, entry.name);
      if (entry.isDirectory()) await walk(file);
      else result.push([path.relative(dir, file), hash(await fs.readFile(file))]);
    }
  }
  await walk(dir); return result;
}
test('preview download rebuilds exact original source and candidate with no new writes, reservations or exposed prompt', async t => {
  const f = await completedFixture(t), before = await evidenceTree(f.dir);
  const bytes = await f.r.downloadPreview(f.send.capsuleId, f.end.candidateHash), value = JSON.parse(bytes);
  assert.ok(Buffer.isBuffer(bytes)); assert.ok(bytes.length <= WORLD_PATCH_PREVIEW_DOWNLOAD_BYTES);
  const {downloadHash, ...content} = value; assert.equal(downloadHash, contextHash(content));
  assert.equal(value.format, 'FrozenWorldPatchPreviewDownload'); assert.equal(value.version, 1);
  assert.equal(value.manifestHash, f.receipt.manifestHash); assert.equal(value.submissionHash, contextHash(f.send));
  assert.equal(value.responseHash, contextHash(f.proposal)); assert.equal(value.candidateHash, f.end.candidateHash);
  assert.equal(value.contextRevision, 11); assert.deepEqual(value.selection, f.snapshot.selection);
  assert.deepEqual(value.preview, f.preparedCandidate.preview); assert.equal(value.previewHash, f.end.responseCheck.previewHash);
  for (const field of ['archivedSourceOnly', 'originalResponseReverified', 'candidateFilesReverified']) assert.equal(value[field], true);
  for (const field of ['serverBaselineVerified', 'canAuthorizePlacement']) assert.equal(value[field], false);
  assert.equal(value.worldWrites, 0); assert.equal(value.additionalModelCalls, 0);
  for (const field of ['payload', 'prompt', 'modelPrompt', 'chunks', 'proposal', 'source', 'ownerId']) assert.equal(value[field], undefined);
  assert.doesNotMatch(bytes.toString(), /根据周边设计玻璃入口|保留道路/);
  assert.deepEqual(await evidenceTree(f.dir), before); assert.deepEqual(await f.r.get(f.send.capsuleId), f.end);
  assert.equal(f.count(), 1); assert.equal(f.observations(), 0);
});
test('read-only preview survives expiry/discard/restart without refreshing consent or current-world authority', async t => {
  const f = await completedFixture(t), original = await f.r.downloadPreview(f.send.capsuleId, f.end.candidateHash);
  const candidate = await f.r.downloadCandidate(f.send.capsuleId, f.end.candidateHash);
  await f.r.close(); await f.store.operation('discard', f.contextId);
  t.mock.timers.enable({apis: ['Date'], now: f.receipt.recordExpiresAt + 1000});
  const next = await f.open(), before = await evidenceTree(f.dir);
  assert.deepEqual(await next.downloadPreview(f.send.capsuleId, f.end.candidateHash), original);
  assert.deepEqual(await next.downloadCandidate(f.send.capsuleId, f.end.candidateHash), candidate);
  assert.deepEqual(await evidenceTree(f.dir), before); assert.equal(f.count(), 1); assert.equal(f.observations(), 0);
});
test('download requires exact retained pins and checked completion; never guesses a candidate', async t => {
  const f = await completedFixture(t), before = await evidenceTree(f.dir);
  for (const pin of [undefined, '', 'a'.repeat(64), '../candidate', f.receipt.manifestHash]) await assert.rejects(f.r.downloadPreview(f.send.capsuleId, pin));
  await assert.rejects(f.r.downloadPreview('b'.repeat(64), f.end.candidateHash));
  await assert.rejects(f.r.downloadPreview('../source', f.end.candidateHash));
  assert.deepEqual(await evidenceTree(f.dir), before); assert.equal(f.count(), 1);
  await fs.rename(path.join(f.jobDir, 'completion.json'), path.join(f.dir, 'retained-completion.json'));
  await assert.rejects(f.r.downloadPreview(f.send.capsuleId, f.end.candidateHash));
  assert.equal((await f.r.get(f.send.capsuleId)).state, 'response-retained'); assert.equal(f.count(), 1);
});
for (const mode of ['proposal', 'patch', 'preview', 'metadata', 'extra', 'missing', 'hardlink', 'source']) test('read worker rejects '+mode+' tamper and preserves evidence without rechecking or resending', async t => {
  const f = await completedFixture(t);
  if (mode === 'source') await fs.appendFile(path.join(f.dir, 'world-patch-tasks', f.send.capsuleId, 'payload.json'), 'changed');
  else if (mode === 'extra') await fs.writeFile(path.join(f.candidateDir, 'unknown'), 'private');
  else if (mode === 'missing') await fs.unlink(path.join(f.candidateDir, 'patch.json'));
  else if (mode === 'hardlink') await fs.link(path.join(f.candidateDir, 'preview.json'), path.join(f.jobDir, 'linked-preview'));
  else await fs.appendFile(path.join(f.candidateDir, {proposal:'proposal.json',patch:'patch.json',preview:'preview.json',metadata:'candidate.json'}[mode]), ' ');
  const before = await evidenceTree(f.dir);
  await assert.rejects(f.r.downloadPreview(f.send.capsuleId, f.end.candidateHash), /read-only preview verification/);
  await assert.rejects(f.r.downloadCandidate(f.send.capsuleId, f.end.candidateHash), /read-only preview verification/);
  assert.deepEqual(await evidenceTree(f.dir), before); assert.equal(f.count(), 1); assert.equal(f.observations(), 0);
  assert.equal((await f.r.get(f.send.capsuleId)).candidateCurrentFilesReverified, false); assert.equal(f.r.busy(), false);
});
test('direct preview reader cannot substitute original response or hash', async t => {
  const f = await completedFixture(t), args = {root:path.join(f.dir,'world-patch-tasks'),directory:f.candidateDir,capsuleId:f.send.capsuleId,
    send:f.send,runtimeHash:f.preparedCandidate.candidate.runtimeHash,spec:f.proposal,responseHash:contextHash(f.proposal),candidateHash:f.end.candidateHash};
  const expected = await f.r.downloadPreview(f.send.capsuleId, f.end.candidateHash);
  assert.deepEqual(await readFrozenResponsePreview(args), expected);
  assert.deepEqual(await readFrozenResponseCandidate(args), await f.r.downloadCandidate(f.send.capsuleId,f.end.candidateHash));
  const proposal = structuredClone(f.proposal); proposal.operations[0].after = 'minecraft:dirt';
  await assert.rejects(readFrozenResponsePreview({...args,spec:proposal}));
  await assert.rejects(readFrozenResponsePreview({...args,spec:proposal,responseHash:contextHash(proposal)}));
  await assert.rejects(readFrozenResponseCandidate({...args,spec:proposal,responseHash:contextHash(proposal)}));
  await assert.rejects(readFrozenResponsePreview({...args,send:{...f.send,confirmed:false}})); assert.equal(f.count(), 1);
});
// Hold ONLY a read before opening immutable metadata; avoid sleeps or fake
// workers. Same pin reuses one read and close cancels without publication.
function holdFirstRead(t, file) {
  const original = fs.open; let release, reached;
  const gate = new Promise(resolve => {release=resolve;}); const entered = new Promise(resolve => {reached=resolve;}); let reads=0;
  const mock = t.mock.method(fs, 'open', async (target, flags, ...rest) => {
    if (target===file && flags==='r') {reads++; if(reads===1){reached();await gate;}}
    return original(target,flags,...rest);
  });
  t.after(()=>release()); return {release,entered,reads:()=>reads,restore:()=>mock.mock.restore()};
}
test('same candidate concurrent downloads reuse one promise; other pins/tasks and mutation actions are busy', async t => {
  const f = await completedFixture(t), gate = holdFirstRead(t,path.join(f.jobDir,'request.json'));
  const first = f.r.downloadPreview(f.send.capsuleId,f.end.candidateHash); await gate.entered;
  const second = f.r.downloadPreview(f.send.capsuleId,f.end.candidateHash); assert.equal(f.r.busy(),true); assert.equal(gate.reads(),1);
  await assert.rejects(f.r.downloadPreview(f.send.capsuleId,'f'.repeat(64)),/identity differs/);
  await assert.rejects(f.r.downloadCandidate(f.send.capsuleId,f.end.candidateHash),/identity differs/);
  await assert.rejects(f.r.downloadPreview('b'.repeat(64),f.end.candidateHash),{statusCode:429});
  await assert.rejects(f.r.recheckResponse(f.send.capsuleId),/busy/); await assert.rejects(f.r.observeOriginal(f.send.capsuleId),/busy/);
  gate.release(); assert.deepEqual(await first,await second); gate.restore(); assert.equal(f.r.busy(),false); assert.equal(f.count(),1);
});
test('closing an active preview read rejects only that transfer, leaving original response and candidate untouched', async t => {
  const f = await completedFixture(t), gate = holdFirstRead(t,path.join(f.jobDir,'request.json'));
  const pending = f.r.downloadPreview(f.send.capsuleId,f.end.candidateHash); const rejected=assert.rejects(pending,/abort|cancel/i);
  await gate.entered; const closed=f.r.close(); gate.release(); await rejected; await closed; gate.restore();
  await assert.rejects(f.r.downloadPreview(f.send.capsuleId,f.end.candidateHash),{statusCode:503});
  const next=await f.open(); assert.equal((await next.get(f.send.capsuleId)).candidateHash,f.end.candidateHash);
  assert.equal(JSON.parse(await next.downloadPreview(f.send.capsuleId,f.end.candidateHash)).candidateHash,f.end.candidateHash);
  assert.equal(f.count(),1); assert.equal(f.observations(),0);
});
test('unknown/active original response has no preview fallback or new adapter call', async t => {
  const f=await pendingFixture(t); const before=await evidenceTree(f.dir);
  await assert.rejects(f.r.downloadPreview(f.send.capsuleId,'a'.repeat(64))); assert.deepEqual(await evidenceTree(f.dir),before);
  await assert.rejects(f.r.downloadCandidate(f.send.capsuleId,'a'.repeat(64))); assert.deepEqual(await evidenceTree(f.dir),before);
  assert.equal(f.calls(),1); assert.equal(f.recovered(),0);
});

test('full candidate download retains exact proposal and preview; old preview protocol remains proposal-free', async t => {
  const f=await completedFixture(t), before=await evidenceTree(f.dir);
  const bytes=await f.r.downloadCandidate(f.send.capsuleId,f.end.candidateHash), value=JSON.parse(bytes);
  assert.ok(bytes.length<=WORLD_PATCH_CANDIDATE_DOWNLOAD_BYTES);assert.equal(value.format,'FrozenWorldPatchCandidateDownload');assert.equal(value.version,1);
  const {downloadHash,...content}=value;assert.equal(downloadHash,contextHash(content));
  assert.deepEqual(value.proposal,f.proposal);assert.equal(contextHash(value.proposal),f.end.responseCheck.responseHash);
  assert.deepEqual(value.preview,f.preparedCandidate.preview);assert.equal(value.patchHash,f.end.responseCheck.patchHash);
  assert.equal(value.canAuthorizePlacement,false);assert.equal(value.serverBaselineVerified,false);assert.equal(value.worldWrites,0);assert.equal(value.additionalModelCalls,0);
  for(const key of ['prompt','modelPrompt','chunks','guards','writes','source'])assert.equal(value[key],undefined);
  assert.equal(JSON.parse(await f.r.downloadPreview(f.send.capsuleId,f.end.candidateHash)).proposal,undefined);
  await assert.rejects(f.r.downloadCandidate(f.send.capsuleId,'f'.repeat(64)));
  assert.deepEqual(await evidenceTree(f.dir),before);assert.equal(f.count(),1);assert.equal(f.observations(),0);
});

test('candidate HTTP GET is paired, strict, read-only and disabled in the normal service', async t => {
  const f=await fixture(t),service=await f.server(true),request=requestAt(service),route='/v1/world-patch/jobs/'+f.send.capsuleId;
  await request(route+'/send',f.send);let end;
  for(let i=0;i<300;i++){end=(await request(route)).value;if(end.state==='completed-checked')break;await delay(20);}
  assert.equal(end.state,'completed-checked');const query='?candidateHash='+end.candidateHash;
  assert.equal((await request(route+'/candidate'+query,undefined,{})).status,401);
  assert.equal((await request(route+'/candidate'+query,undefined,{Authorization:'Bearer '+service.connection.token,Origin:'https://example.com'})).status,403);
  for(const suffix of ['','?candidateHash=','?candidateHash='+end.candidateHash+'&candidateHash='+end.candidateHash,query+'&proposal=private'])assert.equal((await request(route+'/candidate'+suffix)).status,400);
  assert.equal((await request(route+'/candidate'+query,{})).status,405);
  const before=await evidenceTree(f.dir),download=await request(route+'/candidate'+query);
  assert.equal(download.status,200);assert.equal(download.value.format,'FrozenWorldPatchCandidateDownload');assert.deepEqual(download.value.proposal,f.proposal);
  assert.deepEqual(await evidenceTree(f.dir),before);assert.equal(f.count(),1);
  await service.close();const normal=await f.server(false);assert.equal((await requestAt(normal)(route+'/candidate'+query)).status,409);assert.equal(f.count(),1);
});

test('close cancels candidate transfer and same-format concurrent reads share the original lane', async t => {
  const f=await completedFixture(t),gate=holdFirstRead(t,path.join(f.jobDir,'request.json'));
  const first=f.r.downloadCandidate(f.send.capsuleId,f.end.candidateHash),second=f.r.downloadCandidate(f.send.capsuleId,f.end.candidateHash);
  const rejected=assert.rejects(first,/abort|cancel/i),secondRejected=assert.rejects(second,/abort|cancel/i);await gate.entered;
  await assert.rejects(f.r.downloadPreview(f.send.capsuleId,f.end.candidateHash),/identity differs/);
  const closed=f.r.close();gate.release();await rejected;await secondRejected;await closed;gate.restore();
  const next=await f.open();assert.equal(JSON.parse(await next.downloadCandidate(f.send.capsuleId,f.end.candidateHash)).candidateHash,f.end.candidateHash);
  assert.equal(f.count(),1);assert.equal(f.observations(),0);
});
test('HTTP preview uses exact query, pairing, immutable pins, bounded JSON and explicit opt-in only', async t => {
  const f=await fixture(t),service=await f.server(true),request=requestAt(service),route='/v1/world-patch/jobs/'+f.send.capsuleId;
  await request(route+'/send',f.send); let end;
  for(let i=0;i<300;i++){end=(await request(route)).value;if(end.state==='completed-checked')break;await delay(20);}
  assert.equal(end.state,'completed-checked');const query='?candidateHash='+end.candidateHash;
  assert.equal((await request(route+'/preview'+query,undefined,{})).status,401);
  assert.equal((await request(route+'/preview'+query,undefined,{Authorization:'Bearer '+service.connection.token,Origin:'https://example.com'})).status,403);
  for(const suffix of ['','?candidateHash=','?candidateHash='+end.candidateHash+'&candidateHash='+end.candidateHash,query+'&prompt=private','?other='+end.candidateHash]) assert.equal((await request(route+'/preview'+suffix)).status,400);
  assert.equal((await request(route+'/preview'+query,{})).status,405);
  assert.equal((await request(route+'/preview?candidateHash='+'a'.repeat(64))).status,409);
  const before=await evidenceTree(f.dir),response=await fetch('http://127.0.0.1:'+service.connection.port+route+'/preview'+query,{headers:{Authorization:'Bearer '+service.connection.token}});
  assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer()),value=JSON.parse(bytes);
  assert.equal(Number(response.headers.get('content-length')),bytes.length); assert.equal(response.headers.get('cache-control'),'no-store'); assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.match(response.headers.get('content-type'),/application\/json; charset=utf-8/);assert.equal(value.candidateHash,end.candidateHash);assert.equal(value.canAuthorizePlacement,false);
  assert.deepEqual(await evidenceTree(f.dir),before); assert.equal(f.count(),1);
  await service.close();const normal=await f.server(false);assert.equal((await requestAt(normal)(route+'/preview'+query)).status,409);assert.equal(f.count(),1);
});

function requestAt(service) {
  const base = 'http://127.0.0.1:' + service.connection.port, auth = {Authorization: 'Bearer ' + service.connection.token};
  return async (route, value, custom = auth) => {
    const response = await fetch(base + route, {method: value === undefined ? 'GET' : 'POST', headers: {...custom, 'Content-Type': 'application/json'},
      ...(value === undefined ? {} : {body: JSON.stringify(value)})});
    return {status: response.status, value: await response.json()};
  };
}
test('legacy v1 has no player SEND and cannot be enabled through config/HTTP', async t => {
  const f = await fixture(t), service = await f.server(false), request = requestAt(service);
  const capabilities = (await request('/v1/world-patch/capabilities')).value;
  assert.equal(capabilities.sendingImplemented, false); assert.equal(capabilities.experimentalSendingEnabled, false);
  assert.equal(capabilities.jobStatusVersion,2);assert.equal(capabilities.previewDownloadVersion,1);assert.equal(capabilities.runtimeHash,null);
  assert.equal((await request('/v1/world-patch/jobs/' + f.send.capsuleId + '/send', f.send)).status, 409);
  assert.equal((await request('/v1/config/world-patch-design', {experimentalWorldPatchDesign: true})).status, 404);
  assert.equal(f.count(), 0);
});
test('production v2 explicitly sends once, leaves legacy disabled, and survives duplicate/restart without world authority', async t => {
  const f = await fixture(t), service = await f.server(false, true), request = requestAt(service);
  const route = '/v2/world-patch/jobs/' + f.send.capsuleId;
  const capability = (await request('/v2/world-patch/capabilities')).value;
  assert.equal(capability.version, 2); assert.equal(capability.sendingImplemented, true); assert.equal(capability.sendingEnabled, true);
  assert.equal(capability.sendAuthorization, 'independent-player-confirmation');
  assert.equal(capability.worldWriteAuthorization, 'independent-in-game-confirmation');
  assert.equal(capability.placementImplemented, false); assert.equal(capability.canAuthorizePlacement, false);
  assert.equal(capability.serverBaselineVerified, false); assert.equal(capability.maximumCalls, 1);
  assert.equal(f.count(), 0, 'Capabilities/preparation alone never invoke a model');
  const legacy = (await request('/v1/world-patch/capabilities')).value;
  assert.equal(legacy.version, 1); assert.equal(legacy.sendingImplemented, false);
  assert.equal(legacy.experimentalSendingEnabled, false); assert.equal(legacy.runtimeHash, null);
  assert.equal((await request('/v1/world-patch/jobs/' + f.send.capsuleId + '/send', f.send)).status, 409);
  for (const value of [f.receipt, {...f.send, confirmed: false}, {...f.send, maximumCalls: 2}, {...f.send, allowWorldWrites: true}]) {
    assert.equal((await request(route + '/send', value)).status, 400); assert.equal(f.count(), 0);
  }
  assert.equal((await request(route + '/send', f.send, {})).status, 401);
  assert.equal((await request(route + '/send', f.send, {Authorization: 'Bearer ' + service.connection.token, Origin: 'https://example.com'})).status, 403);
  assert.equal((await request(route + '/send', {...f.send, capsuleId: 'b'.repeat(64)})).status, 400);
  assert.equal((await request(route + '/send', f.send)).status, 202);
  let end;
  for (let i = 0; i < 300; i++) {end = (await request(route)).value; if (end.state === 'completed-checked') break; await delay(20);}
  assert.equal(end.state, 'completed-checked'); assert.equal(end.runtimeHash, capability.runtimeHash);
  assert.equal(end.canAuthorizePlacement, false); assert.equal(end.worldWrites, 0); assert.equal(end.callsReserved, 1);
  for (const action of ['preview', 'candidate']) {
    const downloaded = await request(route + '/' + action + '?candidateHash=' + end.candidateHash);
    assert.equal(downloaded.status, 200); assert.equal(downloaded.value.canAuthorizePlacement, false);
    assert.equal(downloaded.value.serverBaselineVerified, false); assert.equal(downloaded.value.worldWrites, 0);
  }
  assert.equal((await request(route + '/send', f.send)).status, 202); assert.equal(f.count(), 1);
  await service.close(); const restarted = await f.server(false, true), again = requestAt(restarted);
  assert.deepEqual((await again(route)).value, end);
  assert.equal((await again(route + '/send', f.send)).status, 202); assert.equal(f.count(), 1);
});
test('disabled production v2 cannot be switched on over HTTP or substituted with experimental v1', async t => {
  const f = await fixture(t), service = await f.server(true, false), request = requestAt(service);
  const capability = (await request('/v2/world-patch/capabilities')).value;
  assert.equal(capability.sendingImplemented, true); assert.equal(capability.sendingEnabled, false); assert.equal(capability.runtimeHash, null);
  assert.equal((await request('/v2/world-patch/jobs/' + f.send.capsuleId + '/send', f.send)).status, 409);
  assert.equal((await request('/v1/config/world-patch-design', {worldPatchSending: true})).status, 404);
  assert.equal(f.count(), 0);
});
test('production v2 unknown original is retained and neither duplicate nor restart resubmits', async t => {
  const f = await fixture(t); let calls = 0;
  f.adapter.generate = async () => {calls++; throw Error('Transport outcome unknown');};
  const service = await f.server(false, true), request = requestAt(service), route = '/v2/world-patch/jobs/' + f.send.capsuleId;
  assert.equal((await request(route + '/send', f.send)).status, 202);
  let end;
  for (let i = 0; i < 300; i++) {end = (await request(route)).value; if (end.state === 'unknown') break; await delay(20);}
  assert.equal(end.state, 'unknown'); assert.equal(end.canObserveOriginal, false); assert.equal(end.callsReserved, 1);
  await request(route + '/send', f.send); await service.close();
  const restarted = await f.server(false, true), again = requestAt(restarted);
  assert.equal((await again(route)).value.state, 'unknown'); await again(route + '/send', f.send);
  assert.equal((await again(route + '/observe-original', {confirmed: true})).status, 409);
  assert.equal(calls, 1);
});
test('process opt-in HTTP lifecycle requires pairing, exact route and SEND and never yields placement authority', async t => {
  const f = await fixture(t), service = await f.server(true), request = requestAt(service);
  const route = '/v1/world-patch/jobs/' + f.send.capsuleId;
  assert.equal((await request(route + '/send', f.send, {})).status, 401);
  assert.equal((await request(route + '/send', f.send, {Authorization: 'Bearer ' + service.connection.token, Origin: 'https://example.com'})).status, 403);
  assert.equal((await request(route + '/send', {...f.send, capsuleId: 'b'.repeat(64)})).status, 400);
  assert.equal((await request(route + '/send', f.receipt)).status, 400); assert.equal(f.count(), 0);
  assert.equal((await request(route + '/send', f.send)).status, 202);
  let end;
  for (let i = 0; i < 300; i++) { end = (await request(route)).value; if (end.state === 'completed-checked') break; await delay(20); }
  assert.equal(end.state, 'completed-checked'); assert.equal(end.canAuthorizePlacement, false); assert.equal(end.candidatePublished, true);
  assert.equal((await request(route + '/send', f.send)).status, 202); assert.equal(f.count(), 1);
  assert.equal((await request(route + '/recheck-response', {confirmed: false})).status, 400);
  assert.equal((await request(route + '/recheck-response', {confirmed: true, spec: f.proposal})).status, 400);
  assert.equal((await request(route + '/recheck-response', {confirmed: true})).status, 200); assert.equal(f.count(), 1);
  const capabilities = (await request('/v1/world-patch/capabilities')).value;
  assert.equal(capabilities.sendingImplemented, false); assert.equal(capabilities.experimentalSendingEnabled, true);
  assert.equal(capabilities.runtimeHash,end.runtimeHash);assert.equal(capabilities.jobStatusVersion,end.version);
});
