import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {exactKeys} from '../contracts/world-selection.mjs';
import {worldPatchProposalSchema} from '../contracts/world-patch.mjs';
import {validateFrozenWorldPatchExplicitSend, bindFrozenWorldPatchSend} from '../contracts/world-patch-send.mjs';
import {contextHash} from '../src/world/context-snapshot.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {openAssemblyJournal, assemblyRuntimeIdentity} from './assembly-durability.mjs';
import {createWorldPatchOwnerReference, validateWorldPatchOwnerReference, inspectWorldPatchOwnerProcess} from './world-patch-owner-observation.mjs';
import {WORLD_PATCH_PREVIEW_DOWNLOAD_BYTES, WORLD_PATCH_CANDIDATE_DOWNLOAD_BYTES} from './world-patch-preview-download.mjs';

const digest = /^[a-f0-9]{64}$/;
const policy = {assembly: {maximumCalls: 1}};
const options = {outputSchema: worldPatchProposalSchema, stageName: 'world-patch-design', stageCount: 1};
export const WORLD_PATCH_SEND_LIMITS = Object.freeze({records: 8, responseBytes: 2 * 1024 ** 2, workerMs: 60000});
const fail = (message, statusCode = 409) => Object.assign(Error(message), {statusCode});
async function directory(file, create = false) {
  if (create) try { await fs.mkdir(file, {mode: 0o700}); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const stat = await fs.lstat(file);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(file) !== file) throw fail('Patch job directory redirected; preserved');
}
async function checked(file, maximum = 65536, journalReplacement = false) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maximum || await fs.realpath(file) !== file) throw fail('Patch job evidence type/link/size rejected');
  const handle = await fs.open(file, 'r');
  let bytes;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.size > maximum) throw fail('Patch job opened evidence type/link/size rejected');
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) {
      const error = fail('Patch job evidence changed before open');
      // Only the mutable invocation record has a legitimate atomic writer.
      // Links, malformed content and integrity failures never get this code.
      if (journalReplacement) error.code = 'PATCH_JOURNAL_READ_RACE';
      throw error;
    }
    bytes = await handle.readFile(); const after = await handle.stat();
    if (bytes.length !== stat.size || after.size !== stat.size || after.mtimeMs !== opened.mtimeMs) throw fail('Patch job evidence changed while reading');
  } finally { await handle.close(); }
  const envelope = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  exactKeys(envelope, ['value', 'sha256'], 'patch job envelope');
  if (hash(envelope.value) !== envelope.sha256) throw fail('Patch job integrity rejected');
  return envelope.value;
}
async function immutable(file, value) {
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify({value, sha256: hash(value)})); await handle.sync(); } finally { await handle.close(); }
}
function providerDiagnostic(error) {
  const d = error?.diagnostic;
  return {provider: ['codex', 'claude', 'deepseek'].includes(d?.provider) ? d.provider : 'unknown',
    // A local abort is not a provider terminal receipt. It remains unknown,
    // allowing only exact-turn observation when a binding was persisted.
    reason: ['completed', 'failed', 'interrupted', 'not-submitted'].includes(d?.reason) ? d.reason : 'unknown', automaticRetries: 0};
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject}; }

/** Shared backend for versioned player SEND and the legacy process-opt-in lane.
 * Exact independent SEND,
 * one write-ahead reservation, immutable original owner reference and source
 * pins. Duplicate sends NEVER dispatch. Crash remnants are preserved; only a
 * released/exactly-exited primary owner may be replaced by an observation-only
 * claim. A crashed observation claim is not aged out or taken over. */
export async function createWorldPatchDesignRunner({dataDir, contexts, adapterFor}) {
  let parent = path.resolve(dataDir), ancestor = path.parse(parent).root;
  for (const part of path.relative(ancestor, parent).split(path.sep).filter(Boolean)) {
    ancestor = path.join(ancestor, part); await directory(ancestor);
  }
  parent = await fs.realpath(parent);
  const root = path.join(parent, 'world-patch-design'); await directory(root, true);
  const runtimeHash = await assemblyRuntimeIdentity();
  const preparing = new Map(), running = new Map(), owned = new Map(), revisions = new Map(), localStops = new Map(), cleanups = new Set(), readers = new Map();
  let closed = false;
  const changed = id => revisions.set(id, (revisions.get(id) ?? 0) + 1);
  const jobDir = id => { if (!digest.test(id)) throw fail('Invalid frozen patch job identity', 400); return path.join(root, id); };
  async function metadata(id) {
    await directory(root); const dir = jobDir(id);
    try { await directory(dir); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    // An existing partial directory never means a fresh unspent budget.
    const value = await checked(path.join(dir, 'request.json'));
    exactKeys(value, ['format', 'version', 'id', 'send', 'receipt', 'submissionHash', 'inputHash', 'protocolHash',
      'invocationFingerprint', 'runtimeHash', 'ownerReference', 'ownerReferenceHash', 'createdAt', 'maximumCalls', 'canAuthorizePlacement'], 'saved frozen patch job');
    bindFrozenWorldPatchSend(value.receipt, value.send);
    const owner = validateWorldPatchOwnerReference(value.ownerReference, value.ownerReferenceHash);
    if (value.format !== 'SavedFrozenWorldPatchJob' || value.version !== 1 || value.id !== id || value.send.capsuleId !== id
      || value.submissionHash !== contextHash(value.send) || ![value.inputHash, value.protocolHash, value.invocationFingerprint].every(v => digest.test(v))
      || value.runtimeHash !== runtimeHash || owner.directory !== dir || !Number.isSafeInteger(value.createdAt)
      || value.createdAt < value.receipt.frozenAt || value.createdAt >= value.receipt.recordExpiresAt
      || value.maximumCalls !== 1 || value.canAuthorizePlacement !== false) throw fail('Original patch job pins/runtime/budget differ');
    await checked(path.join(dir, '_owner.json'));
    if (hash(await fs.readFile(path.join(dir, '_owner.json'))) !== owner.ownerFileSha256) throw fail('Original patch owner evidence changed');
    return {dir, value};
  }
  async function recordAt(saved, allowPreparing = false) {
    const dir = path.join(saved.dir, 'assembly-journal');
    let names;
    try { await directory(dir); names = await fs.readdir(dir); }
    catch (e) { if (e.code === 'ENOENT' && allowPreparing) return null; throw fail('Original invocation journal missing; no resend or observation'); }
    if (names.some(n => /^call-\d+\.json$/.test(n) && n !== 'call-1.json')) throw fail('Patch invocation budget exceeded');
    let record;
    try { record = await checked(path.join(dir, 'call-1.json'), WORLD_PATCH_SEND_LIMITS.responseBytes + 65536, true); }
    catch (e) { if (e.code === 'ENOENT' && allowPreparing) return null; throw e; }
    const identity = await checked(path.join(dir, 'identity.json'));
    if (hash(identity) !== hash({version: 1, requestHash: saved.value.submissionHash, policyHash: hash(policy), runtimeHash, maximumCalls: 1})
      || record.index !== 1 || record.fingerprint !== saved.value.invocationFingerprint || !['pending', 'response', 'error'].includes(record.state)) throw fail('Original patch invocation identity changed');
    let dispatched;
    try { dispatched = await checked(path.join(dir, 'dispatched.json')); }
    catch (e) { if (e.code !== 'ENOENT' || record.state !== 'pending' || !allowPreparing) throw e; }
    if (dispatched && dispatched.count !== 1) throw fail('Original patch dispatched counter changed');
    const b = record.providerBinding, intent = saved.value.receipt.recipient;
    if (b && (b.provider !== 'codex' || b.storage !== 'persistent-single-turn' || b.version !== 1 || b.model !== intent.model
      || intent.effort !== 'default' && b.effort !== intent.effort || !/^[-\w]{1,128}$/.test(b.threadId ?? '')
      || b.turnId !== null && !/^[-\w]{1,128}$/.test(b.turnId ?? '') || !digest.test(b.requestHash ?? ''))) throw fail('Original provider binding changed');
    return record;
  }
  async function status(id) {
    const saved = await metadata(id); if (!saved) return null;
    let record, active;
    for (let i = 0; i < 3; i++) {
      const before = revisions.get(id) ?? 0;
      const writer = running.get(id);
      try { record = await recordAt(saved, writer?.phase === 'preparing'); }
      catch (error) {
        // Re-observe only a writer captured by THIS query. Its legitimate
        // final rename may finish just as the controller retires. Waiting for
        // that exact local controller to settle does not adopt an inactive
        // crash remnant or dispatch a call. The next read still verifies all
        // source, owner, journal and budget pins; corruption never gets here.
        if (error.code !== 'PATCH_JOURNAL_READ_RACE' || !writer || i === 2) throw error;
        if (running.get(id) !== writer) {
          if (running.has(id) || owned.get(id) !== saved.value.ownerReferenceHash || before === (revisions.get(id) ?? 0)) throw error;
          await writer.done;
          if (running.has(id) || owned.get(id) !== saved.value.ownerReferenceHash) throw error;
        }
        continue;
      }
      active = running.has(id);
      if (before === (revisions.get(id) ?? 0)) break;
      if (i === 2) throw fail('Patch lifecycle changed; query the same job');
    }
    let state = active ? record ? 'running' : 'preparing' : 'unknown', responseCheck = null;
    if (record?.state === 'error') state = record.error?.diagnostic?.reason === 'completed' ? 'completed-rejected'
      : ['failed', 'interrupted', 'aborted', 'not-submitted'].includes(record.error?.diagnostic?.reason) ? 'failed' : 'unknown';
    if (record?.state === 'response') {
      state = active ? 'checking' : 'response-retained';
      // This controller may still be syncing completion.json. Do not observe
      // its partial wx publication as corrupt finished evidence.
      if (!active) try {
        const completion = await checked(path.join(saved.dir, 'completion.json'));
        exactKeys(completion, ['format', 'version', 'id', 'submissionHash', 'runtimeHash', 'responseHash', 'state', 'responseCheck', 'canAuthorizePlacement'], 'patch completion');
        if (completion.format !== 'FrozenWorldPatchCompletion' || completion.version !== 1 || completion.id !== id
          || completion.submissionHash !== saved.value.submissionHash || completion.runtimeHash !== runtimeHash
          || completion.responseHash !== contextHash(record.response.spec) || !['completed-checked', 'completed-rejected'].includes(completion.state)
          || completion.canAuthorizePlacement !== false) throw fail('Original patch completion changed');
        responseCheck = completion.responseCheck; state = completion.state;
        if (state === 'completed-rejected' && responseCheck !== null) throw fail('Rejected response cannot supply a compiled artifact');
        if (state === 'completed-checked') {
          exactKeys(responseCheck, ['format', 'version', 'capsuleId', 'manifestHash', 'responseHash', 'patchHash', 'snapshotHash', 'selectionHash',
            'candidateHash', 'previewHash', 'candidateSaved', 'result', 'sourceArchiveReverified', 'serverBaselineVerified', 'canAuthorizePlacement', 'additionalModelCalls', 'worldWrites'], 'patch response check');
          if (responseCheck.format !== 'FrozenWorldPatchResponseCheck' || responseCheck.version !== 2 || responseCheck.capsuleId !== id
            || responseCheck.manifestHash !== saved.value.receipt.manifestHash || responseCheck.responseHash !== completion.responseHash
            || !digest.test(responseCheck.patchHash) || !digest.test(responseCheck.candidateHash) || !digest.test(responseCheck.previewHash)
            || responseCheck.candidateSaved !== true || responseCheck.snapshotHash !== saved.value.receipt.snapshotHash
            || responseCheck.selectionHash !== saved.value.receipt.selectionHash || responseCheck.result !== 'compiled-against-archived-capture'
            || responseCheck.sourceArchiveReverified !== true || responseCheck.serverBaselineVerified !== false || responseCheck.canAuthorizePlacement !== false
            || responseCheck.additionalModelCalls !== 0 || responseCheck.worldWrites !== 0) throw fail('Compiled response check authority/pins changed');
        }
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    return {format: 'FrozenWorldPatchJobStatus', version: 2, id, capsuleId: id, manifestHash: saved.value.receipt.manifestHash, runtimeHash,
      submissionHash: saved.value.submissionHash, state, recipient: saved.value.receipt.recipient,
      callsReserved: record ? 1 : 0, maximumCalls: 1, automaticRetries: 0,
      modelSent: record ? 'possibly-or-confirmed' : false,
      canObserveOriginal: !active && record?.state === 'pending' && record.providerBinding?.provider === 'codex' && !!record.providerBinding.turnId,
      responseCheck, localStop: localStops.get(id) ?? null,
      candidatePublished: responseCheck?.candidateSaved === true, candidateHash: responseCheck?.candidateHash ?? null,
      candidateCurrentFilesReverified: false, serverBaselineVerified: false, canAuthorizePlacement: false, worldWrites: 0};
  }
  async function originalInput(saved, fresh) {
    const input = await contexts.operation(fresh ? 'patch-send-input' : 'patch-original-input', saved.value.id,
      Buffer.from(JSON.stringify(saved.value.send)));
    if (input.inputHash !== saved.value.inputHash || input.submissionHash !== saved.value.submissionHash
      || input.invocationFingerprint !== saved.value.invocationFingerprint) throw fail('Frozen original input changed; no substitute prompt');
    return input;
  }
  async function requireOriginalOwner(saved) {
    const id = saved.value.id;
    if (owned.get(id) === saved.value.ownerReferenceHash) return;
    let release;
    try {release = await checked(path.join(saved.dir, 'owner-released.json'));} catch (error) {if (error.code !== 'ENOENT') throw error;}
    const expected = {format: 'FrozenWorldPatchOwnerReleased', version: 1, id, ownerReferenceHash: saved.value.ownerReferenceHash, originalCallOnly: true};
    if (release) {if (contextHash(release) !== contextHash(expected)) throw fail('Original owner release changed');}
    else {
      const observation = await inspectWorldPatchOwnerProcess({directory: saved.dir, reference: saved.value.ownerReference, expectedReferenceHash: saved.value.ownerReferenceHash});
      if (!observation.exactOriginalProcessExitedAtObservation) throw fail('Exact original owner is live/inconclusive; claim preserved');
    }
  }
  async function checkResponse(saved, spec, signal) {
    const responseHash = contextHash(spec);
    const result = await new Promise((resolve, reject) => {
      signal.throwIfAborted(); let settled = false, message;
      const worker = new Worker(new URL('./world-patch-response-worker.mjs', import.meta.url), {workerData: {
        root: path.join(parent, 'world-patch-tasks'), capsuleId: saved.value.id, send: saved.value.send, spec, responseHash,
        directory: saved.dir, runtimeHash},
        resourceLimits: {maxOldGenerationSizeMb: 512, stackSizeMb: 4}});
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
        worker.terminate().then(() => error ? reject(error) : resolve(value), reject); };
      const abort = () => finish(fail('Patch response check cancelled; original response retained'));
      const timer = setTimeout(() => finish(fail('Patch response worker quota; original response retained')), WORLD_PATCH_SEND_LIMITS.workerMs);
      signal.addEventListener('abort', abort, {once: true});
      worker.once('message', value => { message = value; });
      worker.once('error', error => finish(error));
      worker.once('exit', code => {
        if (signal.aborted) { abort(); return; }
        if (code !== 0 || !message) { finish(fail('Patch response worker exited without a complete receipt')); return; }
        finish(null, message);
      });
    });
    if (!result.ok) throw fail('Frozen source verification failed; original response retained, not blamed on the model');
    if (result.rejected && (result.responseHash !== responseHash || result.capsuleId !== saved.value.id
      || result.manifestHash !== saved.value.receipt.manifestHash || result.sourceArchiveReverified !== true || result.canAuthorizePlacement !== false)) throw fail('Invalid rejected response source pins');
    if (!result.rejected && (result.result?.responseHash !== responseHash || result.result.capsuleId !== saved.value.id
      || result.result.manifestHash !== saved.value.receipt.manifestHash || result.result.canAuthorizePlacement !== false)) throw fail('Invalid patch response worker pins');
    const completion = {format: 'FrozenWorldPatchCompletion', version: 1, id: saved.value.id, submissionHash: saved.value.submissionHash,
      runtimeHash, responseHash, state: result.rejected ? 'completed-rejected' : 'completed-checked', responseCheck: result.rejected ? null : result.result,
      canAuthorizePlacement: false};
    try { await immutable(path.join(saved.dir, 'completion.json'), completion); }
    catch (e) { if (e.code !== 'EEXIST' || contextHash(await checked(path.join(saved.dir, 'completion.json'))) !== contextHash(completion)) throw e; }
  }
  function start(saved, input, observing) {
    const id = saved.value.id, ready = deferred(), controller = new AbortController();
    const current = {controller, phase: 'preparing', done: null}; changed(id); running.set(id, current);
    current.done = (async () => {
      try {
        const journal = await openAssemblyJournal({directory: saved.dir, requestHash: saved.value.submissionHash, policy, runtimeHash});
        const intent = input.intent;
        const dispatch = async (prompt, index, callOptions, binding) => {
          if (observing !== !!binding) throw fail('An original patch call cannot be resubmitted');
          controller.signal.throwIfAborted();
          if (!observing && Date.now() >= input.receipt.recordExpiresAt) throw fail('Patch capture expired before dispatch');
          current.phase = 'dispatched'; changed(id); ready.resolve();
          try {
            const adapter = adapterFor(intent.agent), operation = observing ? adapter.recoverOriginal?.bind(adapter) : adapter.generate?.bind(adapter);
            if (!operation) throw fail('Selected provider operation unavailable; no replacement call');
            const output = await operation({prompt, model: intent.model, ...(intent.effort === 'default' ? {} : {effort: intent.effort}),
              cwd: saved.dir, signal: controller.signal, images: [], outputSchema: worldPatchProposalSchema,
              ...(observing ? {binding} : {onProviderBinding: async value => {
                if (value.model !== intent.model || intent.effort !== 'default' && value.effort !== intent.effort) throw fail('Selected patch model/effort changed');
                changed(id);
                try { await callOptions.onProviderBinding(value); }
                finally { changed(id); }
              }})});
            if (Buffer.byteLength(JSON.stringify(output.spec) ?? '') > WORLD_PATCH_SEND_LIMITS.responseBytes) {
              const error = fail('Completed patch response exceeds byte quota'); error.diagnostic = {provider: intent.agent, reason: 'completed'}; throw error;
            }
            return {spec: output.spec};
          } catch (original) { const error = fail('Patch provider outcome retained; no automatic retry'); error.diagnostic = providerDiagnostic(original); throw error; }
        };
        const response = await journal.invoke(input.prompt, 1, options,
          (p, i, o) => dispatch(p, i, o), (p, i, o, b) => dispatch(p, i, o, b));
        current.phase = 'checking'; changed(id); ready.resolve();
        await checkResponse(saved, response.spec, controller.signal);
      } catch { localStops.set(id, 'original-outcome-retained-no-resubmission'); ready.resolve(); }
      finally { changed(id); if (running.get(id) === current) running.delete(id); }
    })();
    return ready.promise;
  }
  async function reserve(send) {
    const id = send.capsuleId, old = await metadata(id);
    if (old) { if (contextHash(send) !== old.value.submissionHash) throw fail('Existing exact patch SEND differs'); return status(id); }
    if (closed || running.size || readers.size) throw fail('Patch design lane closed/busy; no model invoked', 429);
    const input = await contexts.operation('patch-send-input', id, Buffer.from(JSON.stringify(send)));
    bindFrozenWorldPatchSend(input.receipt, send);
    if (closed || running.size || readers.size) throw fail('Patch lane changed before reservation');
    if (Date.now() >= input.receipt.recordExpiresAt) throw fail('Patch capture expired before reservation');
    if ((await fs.readdir(root)).length >= WORLD_PATCH_SEND_LIMITS.records) throw fail('Patch history quota; no eviction', 429);
    const dir = jobDir(id); await fs.mkdir(dir); await directory(dir);
    const owner = await createWorldPatchOwnerReference({directory: dir});
    const value = {format: 'SavedFrozenWorldPatchJob', version: 1, id, send, receipt: input.receipt,
      submissionHash: input.submissionHash, inputHash: input.inputHash, protocolHash: input.protocolHash,
      invocationFingerprint: input.invocationFingerprint, runtimeHash, ownerReference: owner.reference, ownerReferenceHash: owner.referenceHash,
      createdAt: Date.now(), maximumCalls: 1, canAuthorizePlacement: false};
    await immutable(path.join(dir, 'request.json'), value); owned.set(id, owner.referenceHash);
    const saved = await metadata(id); await start(saved, input, false); return status(id);
  }
  async function submit(raw) {
    const send = validateFrozenWorldPatchExplicitSend(raw), id = send.capsuleId;
    if (closed) throw fail('Patch runner closed', 503);
    if (preparing.has(id)) { await preparing.get(id); const old = await metadata(id);
      if (old?.value.submissionHash !== contextHash(send)) throw fail('Concurrent patch SEND differs'); return status(id); }
    if (preparing.size) throw fail('Patch preparation busy', 429);
    const pending = reserve(send); preparing.set(id, pending);
    try { return await pending; } finally { if (preparing.get(id) === pending) preparing.delete(id); }
  }
  async function observeOriginal(id) {
    if (closed || running.size || preparing.size || readers.size) throw fail('Patch lane closed/busy; no replacement call');
    const operation = (async () => {
      const saved = await metadata(id); if (!saved) throw fail('Original patch job not found', 404);
      const record = await recordAt(saved);
      if (record.state !== 'pending' || record.providerBinding?.provider !== 'codex' || !record.providerBinding.turnId) throw fail('Only the exact pending original Codex turn may be observed');
      await requireOriginalOwner(saved);
      const claimFile = path.join(saved.dir, '_observer.json'), claim = {id: randomUUID(), ownerReferenceHash: saved.value.ownerReferenceHash, originalCallOnly: true};
      await immutable(claimFile, claim); // no age/PID takeover of an old claim
      try {
        const input = await originalInput(saved, false); await start(saved, input, true);
        const done = running.get(id)?.done ?? Promise.resolve();
        const cleanup = done.finally(async () => { if (contextHash(await checked(claimFile)) === contextHash(claim)) await fs.unlink(claimFile); });
        cleanups.add(cleanup); void cleanup.finally(() => cleanups.delete(cleanup)).catch(() => {});
        return status(id);
      } catch (e) { if (contextHash(await checked(claimFile)) === contextHash(claim)) await fs.unlink(claimFile); throw e; }
    })();
    preparing.set(id, operation); try { return await operation; } finally { if (preparing.get(id) === operation) preparing.delete(id); }
  }
  // Local recovery of a COMPLETED original response. No adapter/journal.invoke
  // is reachable here, no second reservation, no guessed or substituted spec.
  async function recheckResponse(id) {
    if (closed || running.size || preparing.size || readers.size) throw fail('Patch lane closed/busy; original response retained');
    const operation = (async () => {
      const saved = await metadata(id); if (!saved) throw fail('Original patch job not found', 404);
      const record = await recordAt(saved);
      if (record.state !== 'response') throw fail('Only a saved original completed response can be rechecked');
      await requireOriginalOwner(saved);
      try {await fs.lstat(path.join(saved.dir, '_observer.json')); throw fail('Original observation claim unresolved; preserved');}
      catch (error) {if (error.code !== 'ENOENT') throw error;}
      if (closed) throw fail('Patch runner closed; original response retained');
      const claimFile = path.join(saved.dir, '_response-check.json'), claim = {id: randomUUID(), ownerReferenceHash: saved.value.ownerReferenceHash, originalResponseOnly: true};
      await immutable(claimFile, claim);
      const controller = new AbortController(), current = {controller, phase: 'checking', done: null};
      changed(id); running.set(id, current);
      current.done = (async () => {
        try {await checkResponse(saved, record.response.spec, controller.signal); localStops.delete(id);}
        finally {
          try {
            if (contextHash(await checked(claimFile)) !== contextHash(claim)) throw fail('Original response-check claim changed; preserved');
            await fs.unlink(claimFile);
          } finally {changed(id); if (running.get(id) === current) running.delete(id);}
        }
      })();
      await current.done; return status(id);
    })();
    preparing.set(id, operation);
    try {return await operation;} finally {if (preparing.get(id) === operation) preparing.delete(id);}
  }
  async function download(id, candidateHash, downloadKind) {
    if (closed) throw fail('Patch runner closed', 503);
    if (!digest.test(candidateHash ?? '')) throw fail('Exact independently retained candidate hash required', 400);
    jobDir(id);
    const existing = readers.get(id);
    if (existing) {if (existing.candidateHash !== candidateHash || existing.downloadKind !== downloadKind) throw fail('Concurrent candidate preview identity differs'); return existing.promise;}
    if (readers.size || preparing.size || running.size) throw fail('Patch preview read lane busy; no fallback or model invoked', 429);
    const controller = new AbortController(), reader = {controller, candidateHash, downloadKind, promise: null};
    reader.promise = (async () => {
      const saved = await metadata(id), before = await status(id);
      if (!saved || before?.state !== 'completed-checked' || before.candidateHash !== candidateHash) throw fail('Original completed candidate not available');
      const record = await recordAt(saved);
      if (record.state !== 'response') throw fail('Preview requires original completed response');
      const responseHash = contextHash(record.response.spec);
      if (responseHash !== before.responseCheck.responseHash) throw fail('Original candidate response changed');
      const bytes = await new Promise((resolve, reject) => {
        controller.signal.throwIfAborted(); let settled = false, message;
        const worker = new Worker(new URL('./world-patch-preview-download-worker.mjs', import.meta.url), {workerData: {
          root: path.join(parent, 'world-patch-tasks'), directory: path.join(saved.dir, 'candidate'), capsuleId: id,
          send: saved.value.send, runtimeHash, spec: record.response.spec, responseHash, candidateHash, downloadKind},
          resourceLimits: {maxOldGenerationSizeMb: 512, stackSizeMb: 4}});
        const finish = (error, result) => {if (settled) return; settled = true; clearTimeout(timer); controller.signal.removeEventListener('abort', abort);
          worker.terminate().then(() => error ? reject(error) : resolve(result), reject);};
        const abort = () => finish(fail('Preview read cancelled; original candidate preserved'));
        const timer = setTimeout(() => finish(fail('Preview read worker quota; original candidate preserved')), WORLD_PATCH_SEND_LIMITS.workerMs);
        controller.signal.addEventListener('abort', abort, {once: true});
        worker.once('message', value => {message = value;}); worker.once('error', error => finish(error));
        worker.once('exit', code => {
          if (controller.signal.aborted) return abort();
          if (code !== 0 || message?.ok !== true || !(message.bytes instanceof Uint8Array)
            || !message.bytes.length || message.bytes.length > (downloadKind === 'candidate' ? WORLD_PATCH_CANDIDATE_DOWNLOAD_BYTES : WORLD_PATCH_PREVIEW_DOWNLOAD_BYTES)) return finish(fail('Original candidate/source failed read-only preview verification'));
          finish(null, Buffer.from(message.bytes));
        });
      });
      controller.signal.throwIfAborted();
      const after = await status(id);
      if (after?.state !== 'completed-checked' || after.candidateHash !== candidateHash || after.responseCheck.responseHash !== responseHash) throw fail('Candidate lifecycle changed during preview read');
      return bytes;
    })();
    readers.set(id, reader);
    try {return await reader.promise;} finally {if (readers.get(id) === reader) readers.delete(id);}
  }
  const downloadPreview = (id, candidateHash) => download(id, candidateHash, 'preview');
  const downloadCandidate = (id, candidateHash) => download(id, candidateHash, 'candidate');
  return {runtimeHash, submit, get: status, observeOriginal, recheckResponse, downloadPreview, downloadCandidate, busy: () => preparing.size > 0 || running.size > 0 || readers.size > 0,
    async close() {
      closed = true;
      for (const item of readers.values()) item.controller.abort();
      await Promise.allSettled([...readers.values()].map(item => item.promise));
      for (const item of running.values()) item.controller.abort();
      await Promise.allSettled([...preparing.values()]);
      const active = [...running.values()]; for (const item of active) item.controller.abort();
      await Promise.allSettled(active.map(item => item.done));
      await Promise.allSettled([...cleanups]);
      for (const [id, referenceHash] of owned) {
        const saved = await metadata(id), release = {format: 'FrozenWorldPatchOwnerReleased', version: 1, id, ownerReferenceHash: referenceHash, originalCallOnly: true};
        try { await immutable(path.join(saved.dir, 'owner-released.json'), release); }
        catch (e) { if (e.code !== 'EEXIST' || contextHash(await checked(path.join(saved.dir, 'owner-released.json'))) !== contextHash(release)) throw e; }
      }
    }};
}
