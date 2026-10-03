import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {exactKeys} from '../contracts/world-selection.mjs';
import {worldPatchProposalSchema, WORLD_PATCH_LIMITS} from '../contracts/world-patch.mjs';
import {contextHash} from '../src/world/context-snapshot.mjs';
import {checkWorldPatchBaseline} from '../src/world/world-patch.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {openAssemblyJournal, readRecoveryJson, assemblyRuntimeIdentity} from '../bridge/assembly-durability.mjs';
import {prepareWorldPatchDesignInput, compileWorldPatchDesignResponse} from './world-patch-design-input.mjs';
import {validateWorldPatchDesignTask, validateWorldPatchDesignReview} from './world-patch-design-task.mjs';
import {saveNewWorldPatchDesignCandidate, readWorldPatchDesignCandidate} from './world-patch-design-candidate.mjs';
import {createWorldPatchOwnerReference, inspectWorldPatchOwnerProcess, observeWindowsOwnerProcess,
  validateWorldPatchOwnerReference} from './world-patch-owner-observation.mjs';

// Single-task standalone development harness, NOT registered in the Bridge.
// Callers supply the independently retained original snapshot/task/review.
// Uses the existing write-ahead journal: a pending attempt is NEVER resent.
const policy = Object.freeze({assembly: Object.freeze({maximumCalls: 1})});
const stage = Object.freeze({outputSchema: worldPatchProposalSchema, stageName: 'world-patch-design', stageCount: 1});
const knownReasons = ['completed', 'failed', 'interrupted', 'aborted', 'cancelled', 'not-submitted'];
const safeCodes = ['EPERM', 'EACCES', 'EBUSY', 'ENOENT', 'ENOSPC', 'EIO', 'ENAMETOOLONG'];
// Recovery authorization is a process-local opaque capability, not a JSON
// flag supplied by a client. Old primary ownership evidence stays untouched.
const recoveryTickets = new WeakMap();
async function physicalDirectory(value) {
  const full = path.resolve(value), stat = await fs.lstat(full);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(full) !== full) throw Error('Patch experiment directory may not redirect');
  return full;
}
async function immutable(file, value) {
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify({value, sha256: hash(value)})); await handle.sync(); } finally { await handle.close(); }
}
async function checked(file) {
  const envelope = await readRecoveryJson(file); exactKeys(envelope, ['value', 'sha256'], 'patch experiment record');
  if (hash(envelope.value) !== envelope.sha256) throw Error('Patch experiment record integrity mismatch');
  return envelope.value;
}
async function runtimeIdentity() {
  const files = ['world-patch-design-input.mjs', 'world-patch-design-task.mjs', 'world-patch-design-candidate.mjs',
    'world-patch-design-experiment.mjs', 'world-patch-owner-observation.mjs'];
  const sources = []; for (const name of files) sources.push([name, hash(await fs.readFile(new URL('./' + name, import.meta.url)))]);
  for (const name of ['context-snapshot', 'context-summary', 'world-patch', 'world-patch-design-input', 'world-patch-design-task']) sources.push(['src/world/' + name + '.mjs', hash(await fs.readFile(new URL('../src/world/' + name + '.mjs', import.meta.url)))]);
  return hash({version: 1, assembly: await assemblyRuntimeIdentity(), sources});
}
function cleanError(original, agent) {
  const diagnostic = original?.diagnostic, reason = knownReasons.includes(diagnostic?.reason) ? diagnostic.reason : 'unknown';
  const error = Error('Patch provider outcome recorded; no automatic retry');
  error.diagnostic = {provider: agent, reason, automaticRetries: 0,
    ...(['model-preflight', 'evidence-storage', 'data-only-config', 'thread-setup', 'thread-binding'].includes(diagnostic?.phase) ? {phase: diagnostic.phase} : {}),
    ...(safeCodes.includes(diagnostic?.code) ? {code: diagnostic.code} : {})};
  return error;
}

/** Construction does not generate. dispatch requires its OWN exact send
 * confirmation; a saved reviewed-not-sent artifact alone is insufficient.
 * File publication is local evidence, not a current server attestation. */
export async function openWorldPatchDesignExperiment({directory, snapshot: snapshotValue, task: taskValue, review: reviewValue,
  adapter, readOnly = false, recordOwnerProcess = false, recoveryTicket}) {
  if (typeof readOnly !== 'boolean' || readOnly && adapter !== undefined) throw Error('Read-only patch inspection cannot receive a provider adapter');
  if (typeof recordOwnerProcess !== 'boolean' || readOnly && (recordOwnerProcess || recoveryTicket !== undefined)) throw Error('Read-only patch inspection cannot acquire process ownership');
  const recovered = recoveryTickets.get(recoveryTicket);
  if (recoveryTicket !== undefined && (!recovered?.active || recordOwnerProcess)) throw Error('Invalid opaque patch recovery capability');
  const snapshot = structuredClone(snapshotValue), input = prepareWorldPatchDesignInput(snapshot);
  const task = validateWorldPatchDesignTask(snapshot, input, taskValue), review = validateWorldPatchDesignReview(snapshot, input, task, reviewValue);
  const root = await physicalDirectory(directory), runtimeHash = await runtimeIdentity();
  const identity = {format: 'WorldPatchDesignExperiment', version: 1, requestHash: task.requestHash, taskHash: task.taskHash,
    reviewHash: review.reviewHash, snapshotHash: input.snapshotHash, selectionHash: input.selectionHash,
    promptSha256: task.request.promptSha256, protocolHash: input.protocolHash, runtimeHash, maximumCalls: 1,
    canAuthorizePlacement: false, productionEndpoint: false};
  const lockFile = path.join(root, '_owner.json'); let owner = {pid: process.pid, id: randomUUID()}, originalProcessReference = null;
  // Do not auto-remove a crash-ambiguous process lock or a foreign owner. A
  // recovery controller must first verify ownership and exact process exit.
  if (recovered) {
    if (recovered.root !== root || recovered.requestHash !== task.requestHash) throw Error('Recovered patch owner belongs to another original task');
    owner = recovered.owner;
  } else if (!readOnly && recordOwnerProcess) {
    // Experimental first construction only: the helper creates the NEW lock
    // in an empty directory. Never attach identity to an old PID-only lock.
    originalProcessReference = await createWorldPatchOwnerReference({directory: root}); owner = originalProcessReference.reference.owner;
  } else if (!readOnly) await immutable(lockFile, owner);
  let active = null, closed = false, revision = 0, preparing = false, closeWork = null;
  let preparationDone = Promise.resolve(), finishPreparation = () => {};
  try {
    try { if (contextHash(await checked(path.join(root, 'experiment.json'))) !== contextHash(identity)) throw Error('Patch experiment original request/runtime changed'); }
    catch (error) { if (error.code !== 'ENOENT' || readOnly) throw error;
      if ((await fs.readdir(root)).some(name => name !== '_owner.json')) throw Error('Patch experiment incomplete prior evidence preserved');
      await immutable(path.join(root, 'experiment.json'), identity); }
  } catch (error) { if (!readOnly && !recovered && contextHash(await checked(lockFile)) === contextHash(owner)) await fs.unlink(lockFile); throw error; }
  async function verifyRecoveredOwner() {
    if (!recovered) return;
    await physicalDirectory(root);
    for (const file of [lockFile, recovered.claimFile]) {
      const info = await fs.lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 8192 || await fs.realpath(file) !== file) throw Error('Recovered patch owner evidence redirected; original records preserved');
    }
    if (!recovered.active || recovered.root !== root || recovered.requestHash !== task.requestHash
      || hash(await fs.readFile(lockFile)) !== recovered.reference.ownerFileSha256
      || contextHash(await checked(recovered.claimFile)) !== contextHash(recovered.owner)) throw Error('Recovered patch ownership changed; original records preserved');
  }
  await verifyRecoveredOwner();
  const expectedFingerprint = hash({prompt: task.disclosure.modelPrompt, index: 1, schema: worldPatchProposalSchema,
    phase: stage.stageName, maximum: 1, images: []});
  async function recordAt({allowLocalReservationPreparation = false} = {}) {
    await verifyRecoveredOwner();
    const journal = path.join(root, 'assembly-journal');
    try { await physicalDirectory(journal); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const names = await fs.readdir(journal); if (names.some(name => /^call-\d+\.json$/.test(name) && name !== 'call-1.json')) throw Error('Patch one-call budget changed');
    let record; try { record = await checked(path.join(journal, 'call-1.json')); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // This directory is created only when invocation preparation has begun.
      // Even a zero/missing dispatched counter cannot prove no provider call:
      // the pending record or counter may have been lost at a crash boundary.
      // Do not turn an incomplete journal (including an empty one) into a new
      // one-call authorization. Preserve it for independent recovery review.
      // A status read during THIS owner's first write-ahead preparation is
      // different: provider invocation has not begun, active still disables
      // dispatch, and no restart/observation path receives this exception.
      if (allowLocalReservationPreparation && active?.initialReservationInProgress) return null;
      throw Error('Patch reservation exists without original call; never resubmit');
    }
    const meta = await checked(path.join(journal, 'identity.json'));
    if (contextHash(meta) !== contextHash({version: 1, requestHash: task.requestHash, policyHash: hash(policy), runtimeHash, maximumCalls: 1})) throw Error('Patch journal request/budget/runtime changed');
    if (record.index !== 1 || record.fingerprint !== expectedFingerprint || !['pending', 'response', 'error'].includes(record.state)) throw Error('Patch original call ledger changed');
    let count = 0; try { count = (await checked(path.join(journal, 'dispatched.json'))).count; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (![0, 1].includes(count) || record.state !== 'pending' && count !== 1) throw Error('Patch reservation ledger changed');
    const send = await checked(path.join(root, 'explicit-send.json'));
    if (contextHash(send) !== contextHash({format: 'WorldPatchDesignExplicitSend', version: 1, confirmed: true,
      requestHash: task.requestHash, disclosureHash: task.disclosure.disclosureHash, promptSha256: task.request.promptSha256, maximumCalls: 1})) throw Error('Original explicit patch send confirmation changed');
    if (record.providerBinding) {
      const binding = record.providerBinding;
      exactKeys(binding, ['version', 'provider', 'storage', 'threadId', 'turnId', 'requestHash', 'model', 'effort'], 'original patch provider binding');
      if (binding.version !== 1 || task.request.intent.agent !== 'codex' || binding.provider !== 'codex' || binding.storage !== 'persistent-single-turn'
        || !/^[-\w]{1,128}$/.test(binding.threadId ?? '') || binding.turnId !== null && !/^[-\w]{1,128}$/.test(binding.turnId ?? '')
        || !/^[a-f0-9]{64}$/.test(binding.requestHash ?? '') || binding.model !== task.request.intent.model
        || typeof binding.effort !== 'string' || task.request.intent.effort !== 'default' && binding.effort !== task.request.intent.effort) throw Error('Patch original provider/model changed');
    }
    return record;
  }
  async function status() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = revision, record = await recordAt({allowLocalReservationPreparation: true}); if (before !== revision) continue;
      let state = record ? active ? 'running' : 'unknown' : active || preparing ? 'preparing' : 'not-dispatched', patch = null;
      if (record?.state === 'response') {
        try { patch = compileWorldPatchDesignResponse(snapshot, input, record.response.spec); state = 'completed'; }
        catch { state = 'completed-rejected'; }
      } else if (record?.state === 'error') state = record.error?.diagnostic?.reason === 'completed' ? 'completed-rejected'
        : knownReasons.includes(record.error?.diagnostic?.reason) ? 'failed' : 'unknown';
      return {format: 'WorldPatchDesignExperimentStatus', version: 1, requestHash: task.requestHash, snapshotHash: input.snapshotHash,
        state, callsReserved: record ? 1 : 0, maximumCalls: 1, automaticRetries: 0,
        canDispatch: !readOnly && !recovered && !closed && !preparing && !active && !record,
        canObserveOriginal: !readOnly && !closed && !preparing && !active && state === 'unknown' && record?.state === 'pending'
          && record.providerBinding?.provider === 'codex' && !!record.providerBinding.turnId,
        readOnlyInspection: readOnly, ownershipRecovered: !!recovered && !closed,
        ownerProcessIdentityVerified: !!recovered, originalOwnerLockRetained: !!recovered,
        recoveryReferenceHash: recovered?.referenceHash ?? null,
        modelSent: record ? 'possibly-or-confirmed' : false, modelOriginIndependentlyVerified: false,
        proposal: record?.state === 'response' ? record.response.spec : null, patch,
        serverBaselineVerified: false, canAuthorizePlacement: false};
    }
    throw Error('Patch lifecycle changed during status read; never resend');
  }
  async function invoke(observing, current) {
    try {
      await verifyRecoveredOwner();
      const journal = await openAssemblyJournal({directory: root, requestHash: task.requestHash, policy, runtimeHash});
      const intent = task.request.intent;
      async function operation(prompt, options, binding) {
        try {
          current.initialReservationInProgress = false;
          current.controller.signal.throwIfAborted();
          const method = binding ? adapter?.recoverOriginal : adapter?.generate;
          if (typeof method !== 'function' || !!binding !== observing) throw Error('Original patch provider observation unavailable; no replacement call');
          const output = await method.call(adapter, {prompt, model: intent.model, ...(intent.effort === 'default' ? {} : {effort: intent.effort}),
            outputSchema: worldPatchProposalSchema, images: [], cwd: root, signal: current.controller.signal,
            ...(binding ? {binding} : {onProviderBinding: async value => {
              if (intent.agent !== 'codex' || value.provider !== 'codex' || value.model !== intent.model
                || intent.effort !== 'default' && value.effort !== intent.effort) throw Error('Patch provider changed exact selected provider/model/effort');
              await options.onProviderBinding(value);
            }})});
          // Serialized-receipt quota, NOT an output-token ceiling. Reserve
          // room for the write-ahead envelope; never keep a truncated response.
          const specBytes = Buffer.byteLength(JSON.stringify(output.spec) ?? '');
          if (!specBytes || specBytes > WORLD_PATCH_LIMITS.bytes - 65536) {
            const error = Error('Patch completed response evidence byte quota exceeded'); error.diagnostic = {reason: 'completed'}; throw error;
          }
          return {spec: output.spec};
        } catch (error) { throw cleanError(error, intent.agent); }
      }
      await journal.invoke(task.disclosure.modelPrompt, 1, stage,
        (prompt, index, options) => operation(prompt, options, null),
        (prompt, index, options, binding) => operation(prompt, options, binding));
    } catch { /* Persisted journal determines status; no repair or retry. */ }
    finally { if (active === current) { active = null; revision++; } }
    return status();
  }
  function start(observing) {
    const current = {controller: new AbortController(), done: null, initialReservationInProgress: !observing}; active = current; revision++;
    current.done = invoke(observing, current); return current.done;
  }
  async function dispatch(confirmation) {
    if (readOnly) throw Error('Read-only patch inspection cannot dispatch');
    if (recovered) throw Error('Recovered patch ownership cannot dispatch a replacement generation; observe only the original turn');
    exactKeys(confirmation, ['format', 'version', 'confirmed', 'requestHash', 'disclosureHash', 'promptSha256', 'maximumCalls'], 'patch explicit send');
    if (confirmation.format !== 'WorldPatchDesignExplicitSend' || confirmation.version !== 1 || confirmation.confirmed !== true
      || confirmation.requestHash !== task.requestHash || confirmation.disclosureHash !== task.disclosure.disclosureHash
      || confirmation.promptSha256 !== task.request.promptSha256 || confirmation.maximumCalls !== 1) throw Error('Independent exact patch SEND confirmation required');
    if (closed) throw Error('Patch experiment closed');
    if (preparing || active) return status();
    preparing = true; revision++; preparationDone = new Promise(resolve => { finishPreparation = resolve; });
    try {
      if (await recordAt()) return status();
      if (closed) throw Error('Patch experiment closed before dispatch');
      try { await immutable(path.join(root, 'explicit-send.json'), confirmation); }
      catch (error) { if (error.code !== 'EEXIST') throw error;
        if (contextHash(await checked(path.join(root, 'explicit-send.json'))) !== contextHash(confirmation)) throw Error('Original patch send confirmation changed'); }
      if (closed) throw Error('Patch experiment closed before dispatch');
      return start(false);
    }
    finally { preparing = false; revision++; finishPreparation(); }
  }
  async function observeOriginal() {
    if (readOnly) throw Error('Read-only patch inspection cannot observe a provider; recover ownership separately');
    if (closed || preparing || active) throw Error('Patch observation lane closed or busy'); preparing = true; revision++;
    preparationDone = new Promise(resolve => { finishPreparation = resolve; });
    try {
      const record = await recordAt();
      if (closed || record?.state !== 'pending' || record.providerBinding?.provider !== 'codex' || !record.providerBinding.turnId) throw Error('No original persistent pending patch turn; no generation submitted');
      return start(true);
    }
    finally { preparing = false; revision++; finishPreparation(); }
  }
  let publishing = false, publicationWork = null;
  function persistCandidate(directory) {
    if (readOnly || closed || preparing || active || publishing) return Promise.reject(Error('Patch candidate publication lane closed or busy'));
    publishing = true;
    let current; current = (async () => { try {
      const record = await recordAt();
      if (record?.state !== 'response') throw Error('No completed original patch response to persist; never generate a replacement');
      compileWorldPatchDesignResponse(snapshot, input, record.response.spec);
      const full = path.resolve(directory), referenceFile = path.join(root, 'candidate-reference.json');
      let existing = null; try { existing = await checked(referenceFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (existing) {
        if (existing.requestHash !== task.requestHash || existing.responseHash !== hash(record.response)
          || existing.directory !== full || existing.canAuthorizePlacement !== false) throw Error('Patch candidate publication identity changed');
        return readWorldPatchDesignCandidate(full, snapshot, task, existing.candidateHash);
      }
      if (closed) throw Error('Patch experiment closed before candidate publication');
      const saved = await saveNewWorldPatchDesignCandidate(full, snapshot, task, review, record.response.spec);
      await immutable(referenceFile, {format: 'WorldPatchDesignCandidateReference', version: 1, requestHash: task.requestHash,
        responseHash: hash(record.response), candidateHash: saved.candidate.candidateHash, patchHash: saved.patch.patchHash,
        directory: full, callsReserved: 1, modelOriginIndependentlyVerified: false, canAuthorizePlacement: false});
      return saved;
    } finally { publishing = false; if (publicationWork === current) publicationWork = null; } })();
    publicationWork = current; return current;
  }
  function close() {
    if (closeWork) return closeWork;
    closed = true; active?.controller.abort();
    if (readOnly) { closeWork = Promise.resolve(); return closeWork; }
    closeWork = (async () => {
      await Promise.allSettled([active?.done, publicationWork, preparationDone].filter(Boolean));
      if (recovered) {
        await verifyRecoveredOwner();
        await fs.unlink(recovered.claimFile); recovered.active = false;
        return; // Primary owner/receipt evidence remains byte-for-byte intact.
      }
      if (contextHash(await checked(lockFile)) !== contextHash(owner)) throw Error('Patch experiment ownership changed; lock preserved');
      await fs.unlink(lockFile);
    })();
    return closeWork;
  }
  async function compareCurrentCapture(currentSnapshot) {
    if (closed || preparing || active) throw Error('Patch baseline comparison lane closed or busy');
    const record = await recordAt();
    if (record?.state !== 'response') throw Error('No completed original patch response for baseline comparison');
    const patch = compileWorldPatchDesignResponse(snapshot, input, record.response.spec);
    // Caller-provided block data is NOT authoritative ServerWorld observation.
    // Reuse the strict entire-C fence check; do not silently rebase or apply.
    return checkWorldPatchBaseline(snapshot, patch, currentSnapshot);
  }
  return {dispatch, status, observeOriginal, persistCandidate, compareCurrentCapture, close,
    ownerProcessReference: () => originalProcessReference ? structuredClone(originalProcessReference) : null};
}

/** Acquire a secondary observation/publication lane only after LOCAL exact
 * original exit is verified and the SAME durable request is validated. No
 * deletion or replacement of the primary lock, no new generation budget.
 * A crashed secondary claim is retained; it is NOT auto-aged or PID-cleared.
 * This remains an independent experiment, not a production Bridge endpoint. */
export async function openRecoveredWorldPatchDesignExperiment(options) {
  exactKeys(options, ['directory', 'snapshot', 'task', 'review', 'adapter', 'originalOwnerReference', 'expectedOwnerReferenceHash'], 'patch recovery options');
  const {directory, snapshot, task, review, adapter, originalOwnerReference, expectedOwnerReferenceHash} = options;
  const reference = validateWorldPatchOwnerReference(originalOwnerReference, expectedOwnerReferenceHash), root = await physicalDirectory(directory);
  if (reference.directory !== root) throw Error('Recovery reference belongs to another original directory');
  const exit = await inspectWorldPatchOwnerProcess({directory: root, reference, expectedReferenceHash: expectedOwnerReferenceHash});
  if (!exit.exactOriginalProcessExitedAtObservation) throw Error('Exact original patch process exit is not verified; ownership preserved');
  const view = await openWorldPatchDesignExperiment({directory: root, snapshot, task, review, readOnly: true});
  let prior; try { prior = await view.status(); } finally { await view.close(); }
  if (prior.callsReserved !== 1) throw Error('Patch recovery requires the original persisted reservation; never submit a new call');
  const self = await observeWindowsOwnerProcess(process.pid);
  if (!self.process || self.process.executablePathHash !== hash(path.resolve(process.execPath).toLowerCase())) throw Error('Recovery controller process identity unavailable');
  const claimFile = path.join(root, '_recovery-owner.json'), owner = {format: 'WorldPatchRecoveryOwner', version: 1,
    pid: process.pid, id: randomUUID(), requestHash: task.requestHash,
    originalOwnerReferenceHash: expectedOwnerReferenceHash, originalOwnerFileSha256: reference.ownerFileSha256,
    processObservation: self, canAuthorizePlacement: false};
  // wx enforces mutual exclusion with another recovery controller. The
  // unchanged primary lock continues to exclude all legacy normal openers.
  // Repeat the directory check after OS observation; never create a claim
  // through a path that was redirected while the diagnostic helper ran.
  await physicalDirectory(root); await immutable(claimFile, owner);
  const ticket = {}, lease = {active: true, root, requestHash: task.requestHash, claimFile, owner,
    reference, referenceHash: expectedOwnerReferenceHash}; recoveryTickets.set(ticket, lease);
  try {
    if (hash(await fs.readFile(path.join(root, '_owner.json'))) !== reference.ownerFileSha256) throw Error('Original owner changed during recovery acquisition');
    return await openWorldPatchDesignExperiment({directory: root, snapshot, task, review, adapter, recoveryTicket: ticket});
  } catch (error) {
    // No provider operation started. Clear only THIS controller's exact
    // secondary claim; a foreign or damaged claim is always preserved.
    if (contextHash(await checked(claimFile)) === contextHash(owner)) { await fs.unlink(claimFile); lease.active = false; }
    throw error;
  }
}

/** Inspect a locked or closed original experiment without acquiring, deleting
 * or aging its owner lock, creating metadata or contacting a provider. A
 * present PID is NOT original-process identity or crash-recovery permission. */
export async function inspectWorldPatchDesignExperiment(options) {
  if (['adapter', 'readOnly', 'recordOwnerProcess', 'recoveryTicket'].some(key => Object.hasOwn(options, key))) throw Error('Inspection accepts no adapter or mode override');
  const root = await physicalDirectory(options.directory), lockFile = path.join(root, '_owner.json');
  const readOwner = async () => {
    let value; try { value = await checked(lockFile); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    exactKeys(value, ['pid', 'id'], 'patch original owner');
    if (!Number.isSafeInteger(value.pid) || value.pid <= 1 || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.id ?? '')) throw Error('Invalid original patch owner; preserved');
    return value;
  };
  const ownerBefore = await readOwner(), handle = await openWorldPatchDesignExperiment({...options, readOnly: true});
  try {
    const status = await handle.status(), ownerAfter = await readOwner();
    if (contextHash(ownerBefore) !== contextHash(ownerAfter)) throw Error('Patch owner changed during read-only inspection');
    return {...status, ownerLockPresent: ownerAfter !== null, ownerProcessIdentityVerified: false,
      ownerLockRemoved: false, originalRecordsModified: false, additionalModelCalls: 0, worldWrites: 0};
  } finally { await handle.close(); }
}
