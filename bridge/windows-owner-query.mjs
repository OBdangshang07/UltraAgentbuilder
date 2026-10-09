// Collect ONLY our already-spawned diagnostic helper. There is no queried PID
// here: a timeout may stop this helper, never an owner/provider/game process.
// A closed helper is not proof the observed owner exited or permission to retry.
// Cold Windows/CIM startup can outlast 15 seconds on a hosted or loaded system.
// Allow one bounded 30-second observation, without another query or SEND. Data
// is still accepted only after the original helper closes successfully; a
// timeout remains a failure even if that helper eventually exits with code 0.
export const WINDOWS_OWNER_QUERY_LIMITS = Object.freeze({timeoutMs: 30000, stdoutBytes: 8192, stderrBytes: 8192});
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

export function collectWindowsOwnerQuery(child, {setTimer = setTimeout, clearTimer = clearTimeout} = {}) {
  return new Promise((resolve, reject) => {
    let stdoutBytes = 0, stderrBytes = 0, stdout = [], stderr = [];
    let reason = null, phase = null, failurePhase = null, spawnCode = null, started = false;
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
        if (match && phases.has(match[1])) phase = match[1];
      }
    });
    child.stdout.once('error', () => fail('stream-error'));
    child.stderr.once('error', () => fail('stream-error'));
    const timer = setTimer(() => fail('timeout'), WINDOWS_OWNER_QUERY_LIMITS.timeoutMs);
    timer?.unref?.();
    child.once('close', (code, signal) => {
      clearTimer(timer);
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
