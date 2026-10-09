import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {collectWindowsOwnerQuery, publicWindowsOwnerQueryFailure, WINDOWS_OWNER_QUERY_LIMITS} from '../../bridge/windows-owner-query.mjs';
import * as bridgeObservation from '../../bridge/world-patch-owner-observation.mjs';
import * as scriptObservation from '../../scripts/world-patch-owner-observation.mjs';

function fixture() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  let timerCallback, timerCleared = false, timerUnref = false, kills = 0;
  child.kill = () => { kills++; return true; };
  const pending = collectWindowsOwnerQuery(child, {
    setTimer(callback, milliseconds) {
      assert.equal(milliseconds, 15000); timerCallback = callback;
      return {unref() { timerUnref = true; }};
    },
    clearTimer() { timerCleared = true; }
  });
  // Observe rejection immediately so fake close events never leave an unhandled
  // rejection. Still assert the original promise and exact diagnostic later.
  pending.catch(() => {});
  return {child, pending, timeout: () => timerCallback(), kills: () => kills,
    timerCleared: () => timerCleared, timerUnref: () => timerUnref};
}
async function failure(f, reason, phase = null) {
  const error = await f.pending.catch(value => value);
  assert.ok(error instanceof Error);
  assert.equal(error.code, 'WINDOWS_OWNER_QUERY_FAILED');
  assert.equal(error.observationDiagnostic.reason, reason);
  assert.equal(error.observationDiagnostic.phase, phase);
  assert.equal(error.observationDiagnostic.helperClosed, true);
  assert.equal(error.observationDiagnostic.ownershipRecovered, false);
  assert.equal(error.observationDiagnostic.canAuthorizePlacement, false);
  assert.ok(f.timerCleared()); assert.ok(f.timerUnref());
  return error;
}
test('owner query retains the original fixed bounds and only stdout as data', async () => {
  assert.deepEqual(WINDOWS_OWNER_QUERY_LIMITS, {timeoutMs: 15000, stdoutBytes: 8192, stderrBytes: 8192});
  assert.ok(Object.isFrozen(WINDOWS_OWNER_QUERY_LIMITS));
  const f = fixture(); f.child.emit('spawn');
  f.child.stderr.emit('data', Buffer.from('private-query-text\nVOXEL_OWNER_STAGE:serialize\n'));
  f.child.stdout.emit('data', Buffer.from(' {"exact":"'));
  f.child.stdout.emit('data', Buffer.from('stdout"} \n'));
  f.child.emit('exit', 0); f.child.emit('close', 0, null);
  assert.equal(await f.pending, '{"exact":"stdout"}');
  assert.equal(f.kills(), 0); assert.ok(f.timerCleared());
});
test('timeout waits for the exact helper close, not exit or kill return', async () => {
  const f = fixture(); f.child.emit('spawn');
  f.child.stderr.emit('data', Buffer.from('VOXEL_OWNER_STAGE:boot-before\n'));
  let settled = false; f.pending.then(() => {settled = true;}, () => {settled = true;});
  f.timeout(); f.timeout(); f.child.emit('exit', 0); await Promise.resolve();
  assert.equal(settled, false); assert.equal(f.kills(), 1);
  assert.equal(f.timerCleared(), false);
  f.child.emit('close', null, 'SIGTERM');
  const error = await failure(f, 'timeout', 'boot-before');
  assert.equal(error.observationDiagnostic.helperStarted, true);
  assert.equal(error.observationDiagnostic.helperExitSignal, 'SIGTERM');
});
test('stdout over limit fails even with zero helper exit and valid prefix', async () => {
  const f = fixture(); f.child.stdout.emit('data', Buffer.alloc(8193, 32));
  f.child.emit('close', 0, null); await failure(f, 'stdout-limit');
  assert.equal(f.kills(), 1);
});
test('stdout exact byte limit is accepted without changing caller validation', async () => {
  const f = fixture(); f.child.stdout.emit('data', Buffer.alloc(8192, 120));
  f.child.emit('close', 0, null); assert.equal((await f.pending).length, 8192);
  assert.equal(f.kills(), 0);
});
test('stderr is bounded and never retained in a thrown diagnostic', async () => {
  const f = fixture(); f.child.stderr.emit('data', Buffer.alloc(8193, 120));
  f.child.emit('close', 0, null);
  const error = await failure(f, 'stderr-limit');
  assert.ok(!JSON.stringify(error).includes('xxxx')); assert.equal(f.kills(), 1);
});
test('nonzero query records only an allowlisted complete stage marker', async () => {
  const f = fixture(); f.child.emit('spawn');
  f.child.stderr.emit('data', Buffer.from('VOXEL_OWNER_STA'));
  f.child.stderr.emit('data', Buffer.from('GE:process\r\nprivate-query-text\nVOXEL_OWNER_STAGE:unknown-private\n'));
  f.child.stdout.emit('data', Buffer.from('{"untrusted":"partial"}'));
  f.child.emit('close', 1, null);
  const error = await failure(f, 'query-failed', 'process');
  assert.equal(error.observationDiagnostic.helperExitCode, 1);
  assert.ok(!error.message.includes('private')); assert.ok(!JSON.stringify(error).includes('partial'));
  assert.equal(f.kills(), 0);
});
test('an incomplete or malformed stage marker cannot enter diagnostics', async () => {
  const f = fixture();
  f.child.stderr.emit('data', Buffer.from(' VOXEL_OWNER_STAGE:machine\nVOXEL_OWNER_STAGE:boot-after'));
  f.child.emit('close', 1, null); await failure(f, 'query-failed');
});
for (const code of ['ENOENT', 'EACCES', 'EPERM', 'private-query-text']) {
  test('spawn failure stays closed and sanitized: ' + code, async () => {
    const f = fixture();
    f.child.emit('error', Object.assign(Error('private-query-text'), {code}));
    f.child.emit('close', -2, null);
    const error = await failure(f, 'spawn-error');
    assert.equal(error.observationDiagnostic.helperStarted, false);
    assert.equal(error.observationDiagnostic.spawnCode, code === 'private-query-text' ? 'OTHER' : code);
    assert.ok(!JSON.stringify(error).includes('private-query-text')); assert.equal(f.kills(), 0);
  });
}
for (const stream of ['stdout', 'stderr']) {
  test(stream + ' stream failure cannot yield an observation', async () => {
    const f = fixture(); f.child[stream].emit('error', Error('private-query-text'));
    f.child.emit('close', 0, null); await failure(f, 'stream-error');
    assert.equal(f.kills(), 1);
  });
}
test('first failure and its phase cannot be overwritten after a timeout', async () => {
  const f = fixture(); f.child.stderr.emit('data', Buffer.from('VOXEL_OWNER_STAGE:machine\n'));
  f.timeout(); f.child.stderr.emit('data', Buffer.from('VOXEL_OWNER_STAGE:serialize\n'));
  f.child.stdout.emit('data', Buffer.alloc(8193)); f.child.emit('close', 1, null);
  await failure(f, 'timeout', 'machine'); assert.equal(f.kills(), 1);
});
test('signal-only helper death is rejected without claiming observed owner death', async () => {
  const f = fixture(); f.child.emit('spawn'); f.child.emit('close', null, 'SIGTERM');
  await failure(f, 'query-failed'); assert.equal(f.kills(), 0);
});
test('paired HTTP diagnostic is a defensive copy of only the closed fixed query contract', async () => {
  const f = fixture(); f.child.emit('spawn');
  f.child.stderr.emit('data', Buffer.from('synthetic-private-stderr\nVOXEL_OWNER_STAGE:process\n'));
  f.child.emit('close', 1, null);
  const error = await failure(f, 'query-failed', 'process');
  error.message = 'synthetic-private-message'; error.path = 'synthetic-private-path';
  const diagnostic = publicWindowsOwnerQueryFailure(error);
  assert.deepEqual(diagnostic, error.observationDiagnostic); assert.notEqual(diagnostic, error.observationDiagnostic);
  assert.doesNotMatch(JSON.stringify(diagnostic), /synthetic-private/);
  diagnostic.phase = 'machine'; assert.equal(error.observationDiagnostic.phase, 'process');
});
test('unrecognized or authority-bearing query diagnostics remain redacted', async () => {
  const f = fixture(); f.timeout(); f.child.emit('close', null, 'SIGTERM');
  const error = await failure(f, 'timeout'), original = error.observationDiagnostic;
  for (const change of [{format:'Other'}, {version:2}, {reason:'synthetic-private-reason'}, {phase:'synthetic-private-phase'},
    {helperStarted:'true'}, {helperClosed:false}, {helperExitCode:'synthetic-private-code'},
    {helperExitSignal:'synthetic-private-signal'}, {spawnCode:'synthetic-private-code'},
    {ownershipRecovered:true}, {canAuthorizePlacement:true}, {path:'synthetic-private-path'}]) {
    assert.equal(publicWindowsOwnerQueryFailure({...error, observationDiagnostic:{...original,...change}}), null);
  }
  for (const value of [null, {}, Error('synthetic-private'), {code:'OTHER',observationDiagnostic:original},
    {code:'WINDOWS_OWNER_QUERY_FAILED', observationDiagnostic:null}]) assert.equal(publicWindowsOwnerQueryFailure(value), null);
});
for (const [label, observation] of [['bridge', bridgeObservation], ['script', scriptObservation]]) {
  test(label + ' still rejects invalid observations instead of granting recovery', () => {
    assert.throws(() => observation.validateWindowsOwnerObservation(null));
    assert.throws(() => observation.validateWindowsOwnerObservation({format: 'WindowsOwnerQueryFailure'}));
  });
  test(label + ' reads exact self identity with real Windows query', {skip: process.platform !== 'win32'}, async () => {
    const value = await observation.observeWindowsOwnerProcess(process.pid);
    assert.equal(value.format, 'WindowsOwnerObservation');
    assert.equal(value.queriedPid, process.pid); assert.equal(value.process.pid, process.pid);
    assert.deepEqual(observation.validateWindowsOwnerObservation(value), value);
  });
}
