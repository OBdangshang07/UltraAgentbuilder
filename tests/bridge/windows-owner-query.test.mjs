import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import {collectWindowsOwnerQuery, publicWindowsOwnerQueryFailure, WINDOWS_OWNER_QUERY_LIMITS} from '../../bridge/windows-owner-query.mjs';
import * as bridgeObservation from '../../bridge/world-patch-owner-observation.mjs';
import * as scriptObservation from '../../scripts/world-patch-owner-observation.mjs';

function fixture(options={}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  const timers = []; let kills = 0, monotonicTime = 0;
  child.kill = () => { kills++; return true; };
  const pending = collectWindowsOwnerQuery(child, {
    setTimer(callback, milliseconds) {
      assert.equal(milliseconds, timers.length === 0 ? options.timeoutMs??45000 : options.activeTimeoutMs??30000);
      const timer = {callback, milliseconds, cleared:false, unreferenced:false, unref() { this.unreferenced = true; }};
      timers.push(timer); return timer;
    },
    clearTimer(timer) { timer.cleared = true; }, now: () => monotonicTime, ...options
  });
  // Observe rejection immediately so fake close events never leave an unhandled
  // rejection. Still assert the original promise and exact diagnostic later.
  pending.catch(() => {});
  return {child, pending, timeout: () => timers[0].callback(), activeTimeout: () => timers[1].callback(), timers, at: value => {monotonicTime=value;},
    kills: () => kills, timerCleared: () => timers.every(t => t.cleared), timerUnref: () => timers.every(t => t.unreferenced)};
}
test('both owner implementations retain exact identity and both independent boot checks', async () => {
  for (const file of ['bridge/world-patch-owner-observation.mjs']) {
    const source = await fs.readFile(new URL('../../'+file,import.meta.url),'utf8');
    assert.equal((source.match(/Get-CimInstance Win32_OperatingSystem -Property LastBootUpTime -ErrorAction Stop/g)??[]).length,2);
    {
      assert.doesNotMatch(source,/Get-CimInstance Win32_Process/);
      for(const exact of ['[Diagnostics.Process]::GetProcessById($voxelOwnerPid)','$voxelProcess.StartTime.ToUniversalTime()',
        '$voxelProcess.MainModule.FileName','$voxelStarted.Ticks % 10','$voxelProcess.Dispose()'])assert.ok(source.includes(exact));
      assert.ok(source.includes('catch [ArgumentException]'));
    }
    assert.ok(source.includes("if ($voxelBoot -cne $voxelBootAfter) { throw 'Boot changed during observation' }"));
    assert.doesNotMatch(source,/Get-CimInstance Win32_OperatingSystem -ErrorAction Stop/);
  }
  const wrapper=await fs.readFile(new URL('../../scripts/world-patch-owner-observation.mjs',import.meta.url),'utf8');
  assert.ok(wrapper.includes("from '../bridge/world-patch-owner-observation.mjs'"));
  for(const key of ['observeWindowsOwnerProcess','createWorldPatchOwnerReference','inspectWorldPatchOwnerProcess'])assert.equal(scriptObservation[key],bridgeObservation[key]);
});
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
test('owner query has bounded cold-start headroom and retains byte limits and stdout-only data', async () => {
  assert.deepEqual(WINDOWS_OWNER_QUERY_LIMITS, {timeoutMs: 45000, activeTimeoutMs:30000, stdoutBytes: 8192, stderrBytes: 8192});
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
test('a timeout with complete stdout and later zero exit remains rejected, not recovered', async () => {
  const f = fixture(); f.child.emit('spawn');
  f.child.stderr.emit('data', Buffer.from('VOXEL_OWNER_STAGE:serialize\n'));
  f.child.stdout.emit('data', Buffer.from('{"synthetic":"complete but expired"}\n'));
  f.timeout(); f.child.emit('exit', 0); f.child.emit('close', 0, null);
  const error = await failure(f, 'timeout', 'serialize');
  assert.equal(error.observationDiagnostic.helperExitCode, 0);
  assert.equal(error.observationDiagnostic.ownershipRecovered, false);
  assert.equal(f.kills(), 1);
});
test('one real synthetic cold helper can report its first phase after30s and close without acquiring authority', {timeout: 60000}, async () => {
  const data = {synthetic: true, ownerObserved: false, ownershipRecovered: false, canAuthorizePlacement: false};
  const child = spawn(process.execPath, ['-e',
    `setTimeout(()=>{process.stderr.write('VOXEL_OWNER_STAGE:serialize\\n');setTimeout(()=>process.stdout.write(${JSON.stringify(JSON.stringify(data)+'\n')}),100);},31000);`],
  {windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe']});
  const started = process.hrtime.bigint(), output = await collectWindowsOwnerQuery(child);
  assert.equal(child.exitCode, 0); assert.equal(child.signalCode, null);
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 >= 31000);
  const value = JSON.parse(output); assert.deepEqual(value, data);
  assert.throws(() => bridgeObservation.validateWindowsOwnerObservation(value));
  assert.throws(() => scriptObservation.validateWindowsOwnerObservation(value));
});
test('only the first complete allowlisted phase arms the30s active bound; later phases cannot renew it',async()=>{
  const f=fixture();assert.deepEqual(f.timers.map(t=>t.milliseconds),[45000]);
  f.child.stderr.emit('data',Buffer.from('VOXEL_OWNER_STAGE:unknown-private\nVOXEL_OWNER_STAGE:boot-before'));
  assert.equal(f.timers.length,1);f.child.stderr.emit('data',Buffer.from('\nVOXEL_OWNER_STAGE:process\n'));
  assert.deepEqual(f.timers.map(t=>t.milliseconds),[45000,30000]);const active=f.timers[1];
  f.child.stderr.emit('data',Buffer.from('VOXEL_OWNER_STAGE:boot-after\nVOXEL_OWNER_STAGE:serialize\n'));
  assert.equal(f.timers.length,2);assert.equal(f.timers[1],active);
  f.child.stdout.emit('data',Buffer.from('synthetic-only'));f.child.emit('close',0,null);
  assert.equal(await f.pending,'synthetic-only');assert.equal(f.kills(),0);assert.ok(f.timerCleared());
});
test('the30s active deadline rejects while cold overall budget remains and still awaits original close',async()=>{
  const f=fixture();f.child.emit('spawn');f.child.stderr.emit('data',Buffer.from('VOXEL_OWNER_STAGE:process\n'));
  let settled=false;f.pending.then(()=>settled=true,()=>settled=true);f.activeTimeout();
  f.child.stdout.emit('data',Buffer.from('{"synthetic":"late-complete"}'));f.child.emit('exit',0);await Promise.resolve();
  assert.equal(settled,false);assert.equal(f.kills(),1);assert.equal(f.timerCleared(),false);
  f.child.emit('close',0,null);await failure(f,'timeout','process');
});
test('late marker cannot extend the45s overall deadline and unmarked startup stays bounded',async()=>{
  for(const marker of [null,'boot-before']){const f=fixture();f.child.emit('spawn');if(marker)f.child.stderr.emit('data',Buffer.from('VOXEL_OWNER_STAGE:'+marker+'\n'));
    f.timeout();f.child.emit('close',0,null);await failure(f,'timeout',marker);assert.equal(f.kills(),1);}
});
test('a delayed timer callback cannot admit a helper closed at or beyond the overall deadline',async()=>{
  for(const closedAt of [45000,45001]){const f=fixture();f.child.emit('spawn');f.child.stdout.emit('data',Buffer.from('synthetic-complete'));
    f.at(closedAt);f.child.emit('close',0,null);await failure(f,'timeout');assert.equal(f.kills(),0);}
  const fresh=fixture();fresh.child.stdout.emit('data',Buffer.from('synthetic-only'));fresh.at(44999);fresh.child.emit('close',0,null);assert.equal(await fresh.pending,'synthetic-only');
});
test('monotonic active deadline remains30s even if no timer callback has fired',async()=>{
  const f=fixture();f.at(10000);f.child.emit('spawn');f.child.stderr.emit('data',Buffer.from('VOXEL_OWNER_STAGE:process\n'));
  f.at(40000);f.child.stdout.emit('data',Buffer.from('synthetic-complete'));f.child.emit('close',0,null);await failure(f,'timeout','process');assert.equal(f.kills(),0);
});
test('late first phase within hard bound still has its own nonrenewable active window',async()=>{
  const f=fixture();f.at(31000);f.child.stderr.emit('data',Buffer.from('VOXEL_OWNER_STAGE:serialize\n'));f.at(31100);
  f.child.stdout.emit('data',Buffer.from('synthetic-only'));f.child.emit('close',0,null);assert.equal(await f.pending,'synthetic-only');assert.ok(f.timerCleared());
});
test('legacy fixture may explicitly bound both windows at60s, never unbounded or active beyond overall',async()=>{
  const f=fixture({timeoutMs:60000,activeTimeoutMs:60000});f.child.stderr.emit('data',Buffer.from('VOXEL_OWNER_STAGE:serialize\n'));f.at(50000);f.child.stdout.emit('data',Buffer.from('synthetic-control-only'));f.child.emit('close',0,null);assert.equal(await f.pending,'synthetic-control-only');
  for(const value of [{timeoutMs:0},{timeoutMs:60001},{timeoutMs:Infinity},{activeTimeoutMs:0},{activeTimeoutMs:45001}])assert.throws(()=>collectWindowsOwnerQuery(f.child,value),/Invalid bounded owner query allowance/);
});
test('an invalid/nonmonotonic injected clock never yields an owner observation',async()=>{
  for(const closedAt of [-1,NaN]){const f=fixture();f.at(closedAt);f.child.emit('close',0,null);await failure(f,'query-failed');assert.equal(f.kills(),0);}
});
test('invalid first-phase clock cannot disable the active window while final close clock looks valid',async()=>{
  for(const phaseAt of [-1,NaN,Infinity]){const f=fixture();f.at(phaseAt);f.child.stderr.emit('data',Buffer.from('VOXEL_OWNER_STAGE:process\n'));
    f.at(1);f.child.emit('close',0,null);await failure(f,'query-failed','process');assert.equal(f.kills(),0);}
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
