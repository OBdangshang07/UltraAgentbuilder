import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {startBridge} from '../../bridge/server.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';

function ownedProcess(args, options = {}) {
  const child = spawn(process.execPath, args, {
    windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'], ...options,
  });
  let stderr = '';
  child.stderr.on('data', bytes => { stderr += bytes.toString(); });
  const closed = new Promise(resolve => {
    child.once('error', error => resolve({code: null, error: error.message}));
    child.once('close', (code, signal) => resolve({code, signal}));
  });
  return {child, closed, stderr: () => stderr};
}

async function deadline(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(label)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

test('normal companion CLI exposes reference SEND without preparing, generating or writing a world', {timeout: 90000}, async t => {
  const dataDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'reference-cli-start-')));
  const serverFile = fileURLToPath(new URL('../../bridge/server.mjs', import.meta.url));
  // The normal CLI's parent watchdog supplies graceful shutdown on Windows.
  // Ending this owned sentinel never signals an unrelated process or game.
  const owner = ownedProcess(['-e', "process.stdin.once('end',()=>process.exit(0));process.stdin.resume();"]);
  const cli = ownedProcess([serverFile, '--data-dir', dataDir, '--parent-pid', String(owner.child.pid)]);
  t.after(async () => {
    owner.child.stdin.end();
    assert.equal((await deadline(owner.closed, 5000, 'Owned sentinel exit unknown')).code, 0);
    assert.equal((await deadline(cli.closed, 15000, 'Original CLI exit unknown; do not relaunch')).code, 0, cli.stderr());
    await assert.rejects(fs.access(path.join(dataDir, 'connection.json')), {code: 'ENOENT'});
    await assert.rejects(fs.access(path.join(dataDir, 'bridge.lock')), {code: 'ENOENT'});
  });
  let connection;
  const began = Date.now();
  while (!connection) {
    assert.ok(Date.now() - began < 60000, 'Original CLI startup outcome unknown; do not relaunch');
    try { connection = JSON.parse(await fs.readFile(path.join(dataDir, 'connection.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await delay(100); }
  }
  assert.equal(connection.protocol, 1);
  assert.equal(connection.pid, cli.child.pid);
  assert.ok(Number.isSafeInteger(connection.port) && connection.port > 0 && connection.port <= 65535);
  assert.match(connection.token, /^[a-f0-9]{64}$/);
  const request = async (route, input, authorized = true) => {
    const response = await fetch('http://127.0.0.1:' + connection.port + route, {
      method: input === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: {...(authorized ? {Authorization: 'Bearer ' + connection.token} : {}), 'Content-Type': 'application/json'},
      ...(input === undefined ? {} : {body: JSON.stringify(input)}), signal: AbortSignal.timeout(10000),
    });
    return {status: response.status, value: await response.json()};
  };
  const capabilities = await request('/v1/reference-generation-jobs/capabilities');
  assert.equal(capabilities.status, 200);
  assert.equal(capabilities.value.sendingImplemented, true);
  assert.equal(capabilities.value.preparationVersion, 2);
  for (const key of ['sharedBudget', 'originalReceiptRecoveryOnly', 'immutableJobOwnedImages'])
    assert.equal(capabilities.value[key], true, key);
  assert.equal(capabilities.value.ordinaryJobsAcceptReferences, false);
  assert.equal(capabilities.value.canAuthorizePlacement, false);
  // Normal CLI parsing must expose the same NEW bounded Ultra policy as the
  // imported server, without model discovery, a budget confirmation or SEND.
  // This synthetic model ID is not a statement of real provider availability.
  const bounded = {key: 'synthetic-cli-preflight', agent: 'codex', model: 'synthetic-cli-model', effort: 'max',
    prompt: '在64×224×64格边界内设计高224米办公楼，免费预检夹具', generationMode: 'scene', sceneWorkflow: 'components',
    qualityTier: 'ultra', assemblyCalls: 26, assemblyRecovery: 'safe', assemblyQuality: 'v4',
    assemblyPrototypes: 'staged', assemblyDesignReview: 'native', assemblyProviderRecovery: 'bounded',
    maxRepairs: 0, worldHeight: 384};
  const preflight = await request('/v1/preflight', bounded);
  assert.equal(preflight.status, 200);
  assert.deepEqual(preflight.value, generationPreflight(bounded));
  assert.equal(preflight.value.minimumHeight, 224);
  assert.deepEqual(preflight.value.maximumBounds, {width: 64, height: 224, length: 64});
  assert.equal(preflight.value.maximumCalls, 26);
  assert.equal(preflight.value.maxOutputTokens, null);
  assert.equal(preflight.value.assembly.providerRetries, 2);
  assert.deepEqual(preflight.value.assembly.providerRecovery.waitMs, [10000, 30000]);
  assert.equal(preflight.value.assembly.intermediateAssetsPlaceable, false);
  const legacy = {...bounded}; delete legacy.assemblyProviderRecovery;
  const legacyPreflight = await request('/v1/preflight', legacy);
  assert.equal(legacyPreflight.status, 200);
  assert.deepEqual(legacyPreflight.value, generationPreflight(legacy));
  assert.equal(legacyPreflight.value.assembly.providerRetries, 0);
  assert.ok(!Object.hasOwn(legacyPreflight.value.assembly, 'providerRecovery'));
  assert.equal((await request('/v1/preflight', {...bounded, effort: undefined})).status, 400);
  assert.equal((await request('/v1/preflight', bounded, false)).status, 401);
  assert.equal((await request('/v1/reference-generation-jobs', {})).status, 400);
  assert.equal((await request('/v1/reference-generation-jobs', {}, false)).status, 401);
  assert.deepEqual((await request('/v1/jobs')).value.jobs, []);
  assert.deepEqual(await fs.readdir(path.join(dataDir, 'jobs')), []);
  await assert.rejects(fs.access(path.join(dataDir, 'reference-drafts')), {code: 'ENOENT'});
  await assert.rejects(fs.access(path.join(dataDir, 'reference-submissions')), {code: 'ENOENT'});
});

test('imported Bridge remains explicitly opt-in and cannot activate reference SEND from a request', async t => {
  const dataDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'reference-import-default-')));
  let modelQueries = 0, generations = 0;
  const adapter = {close() {}, async models() { modelQueries++; return []; }, async generate() { generations++; throw Error('Unexpected generation'); }};
  const service = await startBridge({dataDir, adapter, claudeAdapter: adapter, deepseekAdapter: adapter});
  t.after(() => service.close());
  const request = async (route, input) => {
    const response = await fetch('http://127.0.0.1:' + service.connection.port + route, {
      method: input === undefined ? 'GET' : 'POST',
      headers: {Authorization: 'Bearer ' + service.connection.token, 'Content-Type': 'application/json'},
      ...(input === undefined ? {} : {body: JSON.stringify(input)}), signal: AbortSignal.timeout(10000),
    });
    return {status: response.status, value: await response.json()};
  };
  assert.equal((await request('/v1/reference-generation-jobs/capabilities')).value.sendingImplemented, false);
  assert.equal((await request('/v1/reference-generation-jobs', {referenceGenerationSending: true})).status, 409);
  assert.deepEqual((await request('/v1/jobs')).value.jobs, []);
  assert.equal(modelQueries, 0);
  assert.equal(generations, 0);
});
