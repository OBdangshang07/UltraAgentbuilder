import assert from 'node:assert/strict';

const terminal = new Set(['preview-ready', 'failed', 'cancelled', 'interrupted']);
const publicJob = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['requestHash', 'prompt', 'spec', 'repairOriginalPrompt'].includes(key)));

/** A captured original GET is required; a private job file alone is not one. */
export function checkClosedReferenceSnapshot({authorization, ledger, initial, savedGet, savedJob}) {
  assert.ok(terminal.has(savedGet.state), 'Original GET is not terminal');
  assert.deepEqual(publicJob(savedJob), savedGet, 'Original terminal GET and private job disagree');
  for (const field of ['id', 'key', 'agent', 'model', 'effort']) assert.equal(savedGet[field], initial[field], 'Original task identity changed');
  assert.equal(savedGet.key, authorization.ownerId);
  assert.equal(savedGet.model, authorization.model); assert.equal(savedGet.effort, authorization.effort);
  assert.equal(ledger.jobId, savedGet.id); assert.equal(ledger.ownerId, authorization.ownerId);
  assert.equal(ledger.root, authorization.root); assert.equal(ledger.runtimeHash, authorization.runtimeHash);
  assert.equal(ledger.maximumCalls, authorization.maximumCalls); assert.equal(ledger.state, savedGet.state);
  assert.equal(ledger.callsReserved, savedGet.assemblyCallsReserved);
  assert.ok(Number.isSafeInteger(ledger.callsReserved) && ledger.callsReserved >= (initial.assemblyCallsReserved ?? 0)
    && ledger.callsReserved <= authorization.maximumCalls, 'Reservation count changed or exceeded original authority');
  assert.equal(savedGet.preflight.maximumCalls, authorization.maximumCalls);
  assert.deepEqual(savedGet.preflight, initial.preflight, 'Original policy changed');
  assert.deepEqual(savedGet.referenceGeneration, initial.referenceGeneration, 'Original reference binding changed');
  assert.ok(['generated-awaiting-independent-visual-review', 'original-task-terminal-non-success', 'failed-or-unknown'].includes(ledger.result), 'Missing original runner outcome');
  if (ledger.result !== 'failed-or-unknown') assert.equal(savedGet.state === 'preview-ready', ledger.result === 'generated-awaiting-independent-visual-review', 'Runner result disagrees with model outcome');
  if (savedGet.state === 'preview-ready') assert.ok(savedGet.error === undefined || savedGet.error === null, 'Successful task has an error');
  return {state: savedGet.state, jobId: savedGet.id, success: savedGet.state === 'preview-ready'};
}

/** Match process lifetime, never just PID, and never terminate a recycled PID. */
export function assertClosedOriginalProcesses(identities, current) {
  assert.equal(identities.length, 2, 'Two original process identities required');
  assert.equal(new Set(identities.map(row => row.ProcessId)).size, 2);
  for (const original of identities) {
    assert.ok(Number.isSafeInteger(original.ProcessId) && original.ProcessId > 1);
    assert.ok(Number.isFinite(Date.parse(original.CreatedUtc)) && typeof original.ExecutablePath === 'string' && original.ExecutablePath.length
      && typeof original.CommandLine === 'string' && original.CommandLine.length);
    const now = current.find(row => row.ProcessId === original.ProcessId);
    if (!now) continue;
    assert.ok(Number.isFinite(Date.parse(now.CreatedUtc)), 'Current process birth is unknown');
    const sameBirth = Math.abs(Date.parse(now.CreatedUtc) - Date.parse(original.CreatedUtc)) < 2000;
    if (sameBirth) {
      assert.ok(typeof now.ExecutablePath === 'string' && now.ExecutablePath.length && typeof now.CommandLine === 'string' && now.CommandLine.length, 'Current process identity is incomplete');
      assert.equal(now.ExecutablePath, original.ExecutablePath, 'Current process lifetime identity changed');
      assert.equal(now.CommandLine, original.CommandLine, 'Current process lifetime identity changed');
    }
    assert.equal(sameBirth && now.ExecutablePath === original.ExecutablePath && now.CommandLine === original.CommandLine,
      false, 'Exact original process is still alive');
  }
}

export function checkClosedReferenceExit({processes, exit, identities, current}) {
  assert.equal(processes.entry, 'normal-packaged-cli');
  assert.equal(exit.originalExited, true); assert.equal(exit.bridgePid, processes.bridgePid);
  assert.equal(exit.bridge.code, 0); assert.equal(exit.sentinel.code, 0);
  assert.ok(exit.bridge.signal === undefined || exit.bridge.signal === null);
  assert.ok(exit.sentinel.signal === undefined || exit.sentinel.signal === null);
  assert.equal(exit.worldWrites, 0);
  assert.deepEqual(identities.map(row => row.ProcessId).sort((a, b) => a - b), [processes.bridgePid, processes.parentSentinelPid].sort((a, b) => a - b));
  assert.ok(Number.isFinite(Date.parse(processes.startedAt)));
  for (const row of identities) assert.ok(Math.abs(Date.parse(row.CreatedUtc) - Date.parse(processes.startedAt)) < 2000, 'Original process birth was not bound to startup');
  assertClosedOriginalProcesses(identities, current);
}

export function checkClosedReferenceCalls(calls, dispatchedCount) {
  assert.ok(Array.isArray(calls) && calls.length > 0);
  assert.equal(dispatchedCount, calls.length, 'Original dispatch and reservation counts differ');
  const reasons = new Set(['completed', 'failed', 'interrupted', 'aborted', 'not-submitted']);
  for (const [index, call] of calls.entries()) {
    assert.equal(call.index, index + 1, 'Original reservation sequence changed');
    assert.equal(call.unresolved, false, 'Unknown original call cannot be certified');
    assert.equal(call.originalProviderReceiptVerified, true, 'Original provider receipt not verified');
    if (call.state === 'response') assert.equal(call.originalResponseVerified, true);
    else {
      assert.equal(call.state, 'error', 'Pending original call cannot be certified');
      assert.ok(reasons.has(call.errorClosureReason), 'Provider error is not a closed original outcome');
    }
  }
}

/** Rendering eligibility is not image quality or permission to place blocks. */
export function checkClosedReferencePreview({audit, authorization, job, exit}) {
  assert.equal(audit.type, 'read-only-closed-original-reference-terminal-audit');
  assert.equal(audit.result, 'passed'); assert.equal(audit.root, authorization.root);
  assert.equal(audit.jobId, job.id); assert.equal(audit.state, 'preview-ready', 'Closed task has no successful final asset');
  assert.equal(job.state, 'preview-ready'); assert.ok(job.error === undefined || job.error === null);
  assert.equal(job.key, authorization.ownerId); assert.equal(job.model, authorization.model); assert.equal(job.effort, authorization.effort);
  assert.ok(['single', 'multi'].includes(authorization.mode));
  assert.equal(authorization.syntheticTransportFixture === true, false, 'Synthetic fixture is not a real final preview subject');
  assert.equal(audit.syntheticTransportFixture, false, 'Synthetic fixture is not a real final preview subject');
  assert.equal(audit.observationSource, 'original-runner-terminal-get-and-exited-lifetimes');
  for (const field of ['originalProcessesRetired', 'originalFilesUnchanged', 'jobTerminal']) assert.equal(audit[field], true);
  assert.equal(audit.originalServiceRestarted, false); assert.equal(audit.requestResent, false);
  assert.equal(audit.additionalModelCalls, 0); assert.equal(audit.worldWrites, 0); assert.equal(audit.canAuthorizePlacement, false);
  assert.equal(audit.runtimeHash, authorization.runtimeHash);
  assert.equal(audit.final.nativeSourceIdentityVerified, true); assert.equal(audit.final.finalTextReviewAccepted, true);
  assert.equal(audit.final.assetHash, job.assetHash); assert.equal(audit.final.sourceHash, job.assemblySummary.sourceHash);
  checkClosedReferenceCalls(audit.calls, job.assemblyCallsReserved);
  assert.ok(audit.calls.every(call => call.state === 'response'), 'Preview requires an entirely accepted original generation');
  assert.equal(exit.originalExited, true); assert.equal(exit.bridge.code, 0); assert.equal(exit.sentinel.code, 0);
  assert.ok(exit.bridge.signal === undefined || exit.bridge.signal === null); assert.ok(exit.sentinel.signal === undefined || exit.sentinel.signal === null);
  assert.equal(exit.worldWrites, 0);
}
