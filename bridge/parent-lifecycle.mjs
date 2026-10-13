import assert from 'node:assert/strict';

function validatePid(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0 && pid <= 0xffffffff,
    'An explicit positive parent process ID is required');
}

export function parseParentPid(argv) {
  assert.ok(Array.isArray(argv));
  const args = argv.slice(2), indices = [];
  for (let i = 0; i < args.length; i++) if (args[i] === '--parent-pid') indices.push(i);
  if (!indices.length) return null;
  assert.equal(indices.length, 1, 'Duplicate parent process argument');
  const value = args[indices[0] + 1];
  assert.ok(typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value),
    'An explicit positive parent process ID is required');
  const pid = Number(value); validatePid(pid); return pid;
}

// Signal zero is a read-only existence probe. Only ESRCH establishes absence;
// permissions, transport errors and unexpected results remain UNKNOWN. This
// does not prove creation identity, restart a parent, or authorize model replay.
export function parentPresence(pid, probe = (id, signal) => process.kill(id, signal)) {
  validatePid(pid);
  try {
    return probe(pid, 0) === true ? {state: 'present'}
      : {state: 'unknown', code: 'UNEXPECTED_PROBE_RESULT'};
  } catch (error) {
    if (error?.code === 'ESRCH') return {state: 'absent'};
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code)
      ? error.code : 'UNKNOWN';
    return {state: 'unknown', code};
  }
}

export function watchParent(pid, close, {
  probe, onUnknown = () => {}, intervalMs = 5000,
  schedule = setInterval, unschedule = clearInterval,
} = {}) {
  validatePid(pid); assert.equal(typeof close, 'function'); assert.equal(typeof onUnknown, 'function');
  assert.ok(Number.isSafeInteger(intervalMs) && intervalMs >= 1000);
  let stopped = false, previousUnknown = null, timer;
  const stop = () => { if (!stopped) { stopped = true; unschedule(timer); } };
  const tick = () => {
    if (stopped) return;
    const observation = parentPresence(pid, probe);
    if (observation.state === 'absent') { stop(); close(); return; }
    if (observation.state === 'unknown') {
      if (previousUnknown !== observation.code) {
        previousUnknown = observation.code;
        onUnknown({state: 'unknown', code: observation.code, parentExited: false, automaticReplay: false});
      }
    } else previousUnknown = null;
  };
  timer = schedule(tick, intervalMs); timer.unref(); return stop;
}
