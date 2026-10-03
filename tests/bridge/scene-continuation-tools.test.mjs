import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {hash} from '../../src/generation/compiler.mjs';
import {continuationModel} from '../../scripts/scene-continuation-model.mjs';
import {snapshotInterruptedAssembly, verifyInterruptionObservation} from '../../scripts/scene-assembly-interruption-snapshot.mjs';

const read = async p => JSON.parse(await fs.readFile(p, 'utf8'));
const write = async (p, v) => { await fs.mkdir(path.dirname(p), {recursive: true}); await fs.writeFile(p, JSON.stringify(v)); };
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voxel-observed-stop-')), id = randomUUID(), dir = path.join(root, 'source/data/jobs', id);
  const request = {agent: 'codex', model: 'gpt-5.6-luna', effort: 'max', prompt: 'retained original brief'};
  const stages = [{index: 1, phase: 'plan', state: 'accepted'}, {index: 2, phase: 'component', task: 'facade', state: 'reserved'}];
  const job = {id, state: 'generating', assemblyStages: stages, assemblyCallsReserved: 2, generations: [{stage: 1}]};
  const protocol = {provider: 'codex', model: request.model, maximumCalls: 26};
  const ledger = {protocol, protocolHash: hash(protocol), maximumCalls: 26, reservedCalls: 2, results: [{jobId: id, assetDirectory: dir, state: job.state, assemblyCallsReserved: 2, assemblyStages: stages, generations: job.generations}]};
  const ledgerFile = path.join(root, 'source/ledger.json');
  await write(ledgerFile, ledger); await write(path.join(dir, 'job.json'), job);
  await write(path.join(root, 'source/request.json'), request);
  await write(path.join(root, 'source/data/connection.json'), {pid: 1234567, port: 54321, token: 'PRIVATE-DO-NOT-COPY'});
  await write(path.join(dir, 'assembly/1/response.json'), {data: 'accepted evidence'});
  await write(path.join(dir, 'assembly/2/input.json'), {data: 'reserved input'});
  await write(path.join(dir, 'codex-response-example/request.json'), {provider: 'codex', model: request.model});
  return {root, dir, ledger, job, ledgerFile, destination: path.join(root, 'observed')};
}
const stopped = {processExists: async () => false, endpointResponds: async () => false};

test('explicit model migration preserves original request and never silently reuses legacy Luna', () => {
  const original = {agent: 'codex', model: 'gpt-5.6-luna', effort: 'max', prompt: 'keep', assemblyCalls: 26};
  const before = hash(original), selected = continuationModel(original, 'gpt-6-luna');
  assert.equal(hash(original), before); assert.equal(selected.request.model, 'gpt-6-luna');
  assert.equal(selected.request.assemblyCalls, 26); assert.equal(selected.request.effort, 'max');
  assert.equal(selected.modelChange.fromModel, 'gpt-5.6-luna'); assert.equal(selected.modelChange.historicalReceiptsUnchanged, true);
  assert.throws(() => continuationModel(original), /Legacy Codex model disabled/);
  assert.throws(() => continuationModel(original, 'gpt-5.6-luna'), /Explicit continuation target/);
  assert.throws(() => continuationModel(original, 'gpt-6-astra'), /Explicit continuation target/);
  assert.equal(continuationModel(original, 'gpt-6-sol').request.model, 'gpt-6-sol');
});

test('observed interruption retains unknown call, original evidence, and excludes credentials', async () => {
  const f = await fixture(), originalBytes = await fs.readFile(path.join(f.dir, 'job.json'));
  const output = await snapshotInterruptedAssembly(f, stopped), derived = await read(output.ledger);
  assert.equal(output.reserved, 2); assert.equal(output.remaining, 24); assert.equal(output.additionalModelCalls, 0);
  assert.deepEqual(await fs.readFile(path.join(f.dir, 'job.json')), originalBytes);
  assert.equal(derived.results[0].assemblyStages[1].invocationOutcome, 'unknown');
  assert.equal(derived.results[0].assemblyStages[1].state, 'interrupted');
  assert.deepEqual(derived.results[0].assemblyStages[0], f.job.assemblyStages[0]);
  assert.equal(derived.protocol.model, 'gpt-5.6-luna');
  await assert.rejects(fs.access(path.join(f.destination, 'data/connection.json')));
  assert.ok(!JSON.stringify(derived).includes('PRIVATE-DO-NOT-COPY'));
  await verifyInterruptionObservation(derived);
  await write(path.join(derived.results[0].assetDirectory, 'assembly/1/response.json'), {data: 'tampered'});
  await assert.rejects(verifyInterruptionObservation(derived), /copied evidence changed/);
});

test('live process, responsive endpoint, completed answer and budget drift prevent snapshot', async () => {
  const f = await fixture();
  await assert.rejects(snapshotInterruptedAssembly(f, {...stopped, processExists: async () => true}), /process still exists/);
  await assert.rejects(snapshotInterruptedAssembly(f, {...stopped, endpointResponds: async () => true}), /endpoint responds/);
  await assert.rejects(fs.access(f.destination));
  await write(path.join(f.dir, 'assembly/2/response.json'), {complete: true});
  await assert.rejects(snapshotInterruptedAssembly(f, stopped), /response evidence exists/);
  const g = await fixture(); await write(g.ledgerFile, {...g.ledger, reservedCalls: 1});
  await assert.rejects(snapshotInterruptedAssembly(g, stopped), /ledger\/job mismatch/);
});

test('derived state cannot relabel a response or change original budget/model', async () => {
  const f = await fixture(), output = await snapshotInterruptedAssembly(f, stopped), derived = await read(output.ledger);
  const changed = structuredClone(derived); changed.maximumCalls = 99;
  await assert.rejects(verifyInterruptionObservation(changed), /derived ledger differs/);
  const p = path.join(derived.results[0].assetDirectory, 'job.json'), job = await read(p);
  job.assemblyStages[1].invocationOutcome = 'not-started'; await write(p, job);
  await assert.rejects(verifyInterruptionObservation(derived), /derived job differs/);
});
