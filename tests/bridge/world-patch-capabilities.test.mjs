import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {worldPatchSendingCapabilities} from '../../bridge/world-patch-capabilities.mjs';

test('production SEND capabilities validate runtime and never certify Minecraft writes', () => {
  const disabled = worldPatchSendingCapabilities({preparationEnabled: true, sendingEnabled: false, runtimeHash: null});
  assert.equal(disabled.version, 2); assert.equal(disabled.sendingImplemented, true); assert.equal(disabled.sendingEnabled, false);
  const active = worldPatchSendingCapabilities({preparationEnabled: true, sendingEnabled: true, runtimeHash: 'a'.repeat(64)});
  assert.equal(active.maximumCalls, 1); assert.equal(active.automaticRetries, 0); assert.equal(active.jobApiVersion, 2);
  assert.equal(active.sendRequestVersion, 1); assert.equal(active.jobStatusVersion, 2);
  for (const key of ['canAuthorizePlacement', 'serverBaselineVerified', 'placementImplemented', 'summaryConsentTransferable']) assert.equal(active[key], false);
  for (const change of [{preparationEnabled: false}, {runtimeHash: null}, {runtimeHash: ''}, {runtimeHash: 'z'.repeat(64)}, {sendingEnabled: 'true'}]) {
    assert.throws(() => worldPatchSendingCapabilities({preparationEnabled: true, sendingEnabled: true, runtimeHash: 'a'.repeat(64), ...change}));
  }
});

test('normal CLI startup enables v2 without flags, keeps v1 disabled, and invokes no model merely by starting', {timeout: 30000}, async t => {
  const parent = await fs.realpath(os.tmpdir()), dir = await fs.realpath(await fs.mkdtemp(path.join(parent, 'voxel-patch-cli-')));
  // Config cannot smuggle a legacy opt-in or turn a reviewed request into SEND.
  await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify({experimentalWorldPatchDesign: true, worldPatchSending: false}), {flag: 'wx'});
  const script = fileURLToPath(new URL('../../bridge/server.mjs', import.meta.url));
  const child = spawn(process.execPath, [script, '--data-dir', dir], {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  let exited = false, output = ''; const done = new Promise(resolve => {
    child.once('error', error => {exited = true; resolve({error});});
    child.once('close', code => {exited = true; resolve({code});});
  });
  child.stdout.on('data', bytes => {output += bytes;}); child.stderr.on('data', bytes => {output += bytes;});
  t.after(async () => {
    if (!exited) child.kill();
    await done;
    assert.equal(await fs.realpath(dir), dir); assert.equal(path.dirname(dir), parent); assert.match(path.basename(dir), /^voxel-patch-cli-/);
    await fs.rm(dir, {recursive: true});
  });
  let connection = null;
  for (let i = 0; i < 400; i++) {
    assert.equal(exited, false, 'Original CLI exited before exposing its service');
    try {connection = JSON.parse(await fs.readFile(path.join(dir, 'connection.json'), 'utf8')); break;}
    catch (error) {if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;}
    await delay(25);
  }
  assert.ok(connection, 'Exact original CLI did not publish a connection');
  assert.equal(connection.pid, child.pid);
  const request = async route => {
    const response = await fetch('http://127.0.0.1:' + connection.port + route, {headers: {Authorization: 'Bearer ' + connection.token}});
    assert.equal(response.status, 200); return response.json();
  };
  const production = await request('/v2/world-patch/capabilities'), legacy = await request('/v1/world-patch/capabilities');
  assert.equal(production.version, 2); assert.equal(production.sendingEnabled, true); assert.match(production.runtimeHash, /^[a-f0-9]{64}$/);
  assert.equal(production.canAuthorizePlacement, false); assert.equal(production.placementImplemented, false);
  assert.equal(legacy.version, 1); assert.equal(legacy.sendingImplemented, false); assert.equal(legacy.experimentalSendingEnabled, false);
  assert.equal(legacy.runtimeHash, null); assert.deepEqual(await fs.readdir(path.join(dir, 'world-patch-design')), []);
  assert.deepEqual(await fs.readdir(path.join(dir, 'jobs')), []);
  const shutdown = await fetch('http://127.0.0.1:' + connection.port + '/v1/shutdown',
    {method: 'POST', headers: {Authorization: 'Bearer ' + connection.token}});
  assert.equal(shutdown.status, 202); await shutdown.arrayBuffer();
  assert.equal((await done).code, 0); assert.match(output, /Bridge ready/);
});
