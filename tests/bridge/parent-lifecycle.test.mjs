import test from 'node:test';
import assert from 'node:assert/strict';
import {parseParentPid, parentPresence, watchParent} from '../../bridge/parent-lifecycle.mjs';

const argv = (...args) => ['node', 'server.mjs', ...args];
test('parent argument is optional and a valid positive PID preserves CLI compatibility', () => {
  assert.equal(parseParentPid(argv('--data-dir', 'synthetic')), null);
  assert.equal(parseParentPid(argv('--parent-pid', '1234')), 1234);
  assert.equal(parseParentPid(argv('--parent-pid', '4294967295')), 4294967295);
});
for (const value of [undefined, '', '0', '-1', '01', '1.5', 'NaN', '1e3', '4294967296', '1234suffix'])
  test('rejects malformed parent argument ' + String(value), () => assert.throws(() => parseParentPid(argv('--parent-pid', value))));
test('duplicate parent arguments cannot choose an ambiguous owner', () =>
  assert.throws(() => parseParentPid(argv('--parent-pid', '1234', '--parent-pid', '5678'))));
test('successful parent read is present and uses only signal zero', () => {
  const probes = [];
  assert.deepEqual(parentPresence(1234, (pid, signal) => { probes.push([pid, signal]); return true; }), {state: 'present'});
  assert.deepEqual(probes, [[1234, 0]]);
});
test('only explicit ESRCH is absence', () => {
  assert.deepEqual(parentPresence(1234, () => { throw Object.assign(Error('synthetic'), {code: 'ESRCH'}); }), {state: 'absent'});
});
for (const code of ['EPERM', 'EACCES', 'ETIMEDOUT', 'EPIPE', 'ENOENT', 'ECONNRESET'])
  test(code + ' remains unknown rather than cancelling the service', () => {
    assert.deepEqual(parentPresence(1234, () => { throw Object.assign(Error('must not be exposed'), {code}); }), {state: 'unknown', code});
  });
test('unknown exception content and unexpected probe results cannot leak or establish absence', () => {
  assert.deepEqual(parentPresence(1234, () => { throw Error('private synthetic text'); }), {state: 'unknown', code: 'UNKNOWN'});
  assert.deepEqual(parentPresence(1234, () => { throw {code: 'private synthetic text'}; }), {state: 'unknown', code: 'UNKNOWN'});
  assert.deepEqual(parentPresence(1234, () => false), {state: 'unknown', code: 'UNEXPECTED_PROBE_RESULT'});
});
function fixture(probe) {
  let tick, closes = 0, clears = 0, unrefs = 0; const events = [];
  const timer = {unref() { unrefs++; }};
  const stop = watchParent(1234, () => { closes++; }, {probe, onUnknown: row => events.push(row),
    schedule(callback, interval) { assert.equal(interval, 5000); tick = callback; return timer; },
    unschedule(value) { assert.equal(value, timer); clears++; },
  });
  return {tick: () => tick(), stop, events, counts: () => ({closes, clears, unrefs})};
}
test('unknown observations keep the same original watcher and close only once on verified absence', () => {
  let count = 0;
  const f = fixture(() => { count++; if (count <= 2) throw Object.assign(Error('synthetic timeout'), {code: 'ETIMEDOUT'});
    if (count === 3) return true; throw Object.assign(Error('synthetic absence'), {code: 'ESRCH'}); });
  f.tick(); f.tick(); assert.equal(f.counts().closes, 0); assert.equal(f.events.length, 1);
  assert.deepEqual(f.events[0], {state: 'unknown', code: 'ETIMEDOUT', parentExited: false, automaticReplay: false});
  f.tick(); f.tick(); f.tick(); assert.equal(count, 4); assert.deepEqual(f.counts(), {closes: 1, clears: 1, unrefs: 1});
});
test('unknown event throttles repeats but reports a new uncertainty after a successful read', () => {
  let present = false; const f = fixture(() => { if (present) return true; throw Object.assign(Error('synthetic'), {code: 'EPERM'}); });
  f.tick(); f.tick(); assert.equal(f.events.length, 1); present = true; f.tick(); present = false; f.tick();
  assert.equal(f.events.length, 2); assert.equal(f.counts().closes, 0); f.stop();
});
test('explicit watcher disposal is idempotent and does not stop the parent or service', () => {
  let probes = 0; const f = fixture(() => { probes++; return true; }); f.stop(); f.stop(); f.tick();
  assert.equal(probes, 0); assert.deepEqual(f.counts(), {closes: 0, clears: 1, unrefs: 1});
});
test('unsafe process-group IDs cannot reach a probe or scheduler', () => {
  let calls = 0;
  for (const pid of [0, -1, NaN, Infinity, 1.5, 4294967296]) {
    assert.throws(() => parentPresence(pid, () => { calls++; return true; }));
    assert.throws(() => watchParent(pid, () => {}, {schedule() { calls++; }}));
  }
  assert.equal(calls, 0);
});
