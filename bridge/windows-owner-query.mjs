// Collect ONLY our already-spawned diagnostic helper. There is no queried PID
// here: a timeout may stop this helper, never an owner/provider/game process.
// A closed helper is not proof the observed owner exited or permission to retry.
// Cold Windows/CIM startup can outlast 15 seconds on a hosted or loaded system.
// A loaded host may not deliver its first phase marker within 30 seconds.
// Give the ONE helper at most45s overall, but at most30s after its first
// recognized phase. Later markers never renew either bound. No retry or SEND.
// Data is still accepted only after the original helper closes successfully; a
// timeout remains a failure even if that helper eventually exits with code 0.
import {performance} from 'node:perf_hooks';
export const WINDOWS_OWNER_QUERY_LIMITS = Object.freeze({timeoutMs: 45000, activeTimeoutMs: 30000, stdoutBytes: 8192, stderrBytes: 8192});
const phases = new Set(['machine', 'boot-before', 'process', 'boot-after', 'serialize']);
const spawnCodes = new Set(['ENOENT', 'EACCES', 'EPERM']);
const failureReasons = new Set(['spawn-error', 'stdout-limit', 'stderr-limit', 'stream-error', 'timeout', 'query-failed']);
const diagnosticKeys = ['format', 'version', 'reason', 'phase', 'helperStarted', 'helperClosed',
  'helperExitCode', 'helperExitSignal', 'spawnCode', 'ownershipRecovered', 'canAuthorizePlacement'];

// Paired HTTP may disclose ONLY this fixed diagnostic contract, not an Error,
// stderr, paths, process facts or its message. A failed/closed QUERY HELPER is
// never evidence the observed owner stopped and never authorizes a new SEND.
export function publicWindowsOwnerQueryFailure(error) {
  try {
    const value = error?.observationDiagnostic;
    if (error?.code !== 'WINDOWS_OWNER_QUERY_FAILED' || !value || typeof value !== 'object'
      || Object.keys(value).length !== diagnosticKeys.length || diagnosticKeys.some(key => !Object.hasOwn(value, key))
      || value.format !== 'WindowsOwnerQueryFailure' || value.version !== 1 || !failureReasons.has(value.reason)
      || value.phase !== null && !phases.has(value.phase) || typeof value.helperStarted !== 'boolean'
      || value.helperClosed !== true || value.ownershipRecovered !== false || value.canAuthorizePlacement !== false
      || value.helperExitCode !== null && !Number.isSafeInteger(value.helperExitCode)
      || value.helperExitSignal !== null && !['SIGTERM', 'SIGKILL'].includes(value.helperExitSignal)
      || value.spawnCode !== null && !spawnCodes.has(value.spawnCode) && value.spawnCode !== 'OTHER') return null;
    return Object.fromEntries(diagnosticKeys.map(key => [key, value[key]]));
  } catch { return null; }
}

export function collectWindowsOwnerQuery(child, {setTimer = setTimeout, clearTimer = clearTimeout, now = () => performance.now(),
  timeoutMs = WINDOWS_OWNER_QUERY_LIMITS.timeoutMs, activeTimeoutMs = WINDOWS_OWNER_QUERY_LIMITS.activeTimeoutMs} = {}) {
  // Internal test/control injection only; production observation supplies no
  // options. The independent legacy CIM control already has a60s ceiling.
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000
    || !Number.isSafeInteger(activeTimeoutMs) || activeTimeoutMs < 1 || activeTimeoutMs > timeoutMs) throw Error('Invalid bounded owner query allowance');
  const began = now();
  return new Promise((resolve, reject) => {
    let stdoutBytes = 0, stderrBytes = 0, stdout = [], stderr = [];
    let reason = null, phase = null, failurePhase = null, spawnCode = null, started = false;
    let activeTimer = null, activeBegan = null;
    const fail = (value, stopHelper = true) => {
      if (reason) return;
      reason = value; failurePhase = phase;
      if (stopHelper) child.kill();
    };
    child.once('spawn', () => { started = true; });
    child.once('error', error => {
      spawnCode = spawnCodes.has(error?.code) ? error.code : 'OTHER';
      fail('spawn-error', false);
    });
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > WINDOWS_OWNER_QUERY_LIMITS.stdoutBytes) fail('stdout-limit');
      else if (!reason) stdout.push(chunk);
    });
    child.stderr.on('data', chunk => {
      stderrBytes += chunk.length;
      if (stderrBytes > WINDOWS_OWNER_QUERY_LIMITS.stderrBytes) { fail('stderr-limit'); return; }
      if (reason) return;
      stderr.push(chunk);
      // Only fixed markers emitted by our script are interpreted. Never attach
      // raw stderr, exception messages, paths, MachineGuid or command lines.
      for (const line of Buffer.concat(stderr).toString('utf8').split(/\r?\n/).slice(0, -1)) {
        const match = /^VOXEL_OWNER_STAGE:([a-z-]+)$/.exec(line);
        if (match && phases.has(match[1])) {
          phase = match[1];
          if (activeBegan === null) {
            activeBegan = now();
            activeTimer = setTimer(() => fail('timeout'), activeTimeoutMs);
            activeTimer?.unref?.();
          }
        }
      }
    });
    child.stdout.once('error', () => fail('stream-error'));
    child.stderr.once('error', () => fail('stream-error'));
    const timer = setTimer(() => fail('timeout'), timeoutMs);
    timer?.unref?.();
    child.once('close', (code, signal) => {
      clearTimer(timer);
      if (activeTimer !== null) clearTimer(activeTimer);
      // A busy event loop can deliver close before an expired timer callback.
      // Recheck monotonic elapsed time, without trying to stop a CLOSED helper.
      const closedAt = now();
      if (!reason && (!Number.isFinite(closedAt - began) || closedAt < began
        || activeBegan !== null && (!Number.isFinite(activeBegan - began) || activeBegan < began || closedAt < activeBegan))) fail('query-failed', false);
      if (!reason && (closedAt - began >= timeoutMs || activeBegan !== null && closedAt - activeBegan >= activeTimeoutMs)) fail('timeout', false);
      if (code !== 0 || reason) {
        const diagnostic = {format: 'WindowsOwnerQueryFailure', version: 1,
          reason: reason ?? 'query-failed', phase: reason ? failurePhase : phase,
          helperStarted: started, helperClosed: true,
          helperExitCode: Number.isSafeInteger(code) ? code : null,
          helperExitSignal: ['SIGTERM', 'SIGKILL'].includes(signal) ? signal : null,
          spawnCode, ownershipRecovered: false, canAuthorizePlacement: false};
        reject(Object.assign(Error(`Exact Windows owner observation unavailable (${diagnostic.reason}; phase=${diagnostic.phase ?? 'unknown'}); no recovery authorized`),
          {code: 'WINDOWS_OWNER_QUERY_FAILED', observationDiagnostic: diagnostic}));
      } else resolve(Buffer.concat(stdout).toString('utf8').trim());
    });
  });
}
