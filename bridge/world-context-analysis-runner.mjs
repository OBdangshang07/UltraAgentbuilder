import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {exactKeys} from '../contracts/world-selection.mjs';
import {contextAnalysisSchema, validateContextAnalysis} from '../contracts/context-analysis.schema.mjs';
import {contextHash} from '../src/world/context-snapshot.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {openAssemblyJournal, readRecoveryJson} from './assembly-durability.mjs';
import {validateContextTaskIntent} from './world-context-task.mjs';
import {CONTEXT_ANALYSIS_PROTOCOL_HASH} from './world-context-analysis-input.mjs';

const digest = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const policy = {assembly: {maximumCalls: 1}};
const stageOptions = {outputSchema: contextAnalysisSchema, stageName: 'context-analysis', stageCount: 1};
export const CONTEXT_ANALYSIS_JOB_LIMITS = Object.freeze({records: 32, responseBytes: 2 * 1024 ** 2});
const failure = (message, statusCode = 409) => Object.assign(new Error(message), {statusCode});
/** A journal read and the in-memory dispatch state must describe one stable
 * lifecycle interval. A completed write may race the async disk read; never
 * combine its old pending record with a new idle flag into false UNKNOWN. */
export async function readStableAnalysisState({readRecord, revision, active}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = revision(), record = await readRecord();
    if (before === revision()) return {record, active: active()};
  }
  throw failure('Analysis lifecycle changed during status read; query the original task, never resend');
}
const bindingOf = input => { const {consentId, ...binding} = input; return binding; };
function validateSubmission(input) {
  exactKeys(input, ['contextId', 'consentId', 'requestHash', 'disclosureHash', 'intent', 'explicitSend'], 'analysis submission');
  if (!uuid.test(input.contextId) || !uuid.test(input.consentId) || !digest.test(input.requestHash) || !digest.test(input.disclosureHash)
      || input.explicitSend !== true) throw failure('One explicit, exact read-only send confirmation is required', 400);
  validateContextTaskIntent(input.intent);
  if (input.intent.version !== 2) throw failure('Legacy preparation-only confirmation cannot authorize an analysis send', 400);
  return structuredClone(input);
}
async function directory(target, create = false) {
  if (create) try { await fs.mkdir(target, {mode: 0o700}); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.resolve(await fs.realpath(target)).toLowerCase() !== path.resolve(target).toLowerCase()) throw failure('Analysis directory link/type rejected');
}
async function ancestors(target) {
  let current = path.parse(target).root;
  await directory(current);
  for (const part of path.relative(current, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part); const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure('Analysis ancestor link/type rejected');
  }
}
async function checked(file) {
  const envelope = await readRecoveryJson(file);
  exactKeys(envelope, ['value', 'sha256'], 'analysis evidence');
  if (hash(envelope.value) !== envelope.sha256) throw failure('Analysis evidence hash changed');
  return envelope.value;
}
async function immutable(file, value) {
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify({value, sha256: hash(value)})); await handle.sync(); } finally { await handle.close(); }
}
function diagnostic(error) {
  const value = error?.diagnostic;
  const reason = ['completed', 'failed', 'interrupted', 'aborted', 'cancelled', 'not-submitted'].includes(value?.reason) ? value.reason : 'unknown';
  return {provider: ['codex', 'claude', 'deepseek'].includes(value?.provider) ? value.provider : 'unknown', reason, automaticRetries: 0,
    ...(['model-preflight', 'evidence-storage', 'data-only-config', 'thread-setup', 'thread-binding'].includes(value?.phase) ? {phase: value.phase} : {}),
    ...(['EPERM', 'EACCES', 'EBUSY', 'ENOENT', 'ENOSPC', 'EIO'].includes(value?.code) ? {code: value.code} : {})};
}

/** Experimental process-owned backend; normal player sending remains disabled.
 * New sends require v2 protocol-bound approval. Legacy durable results remain
 * readable, but preparation-only v1 confirmations cannot authorize new calls.
 * Reuses the tested write-ahead journal, NOT a retry queue.
 * Results are unverified prose and can never authorize a world transaction. */
export async function createContextAnalysisRunner({dataDir, contexts, consents, adapterFor}) {
  const supplied = path.resolve(dataDir); await ancestors(supplied);
  const root = path.join(await fs.realpath(supplied), 'context-analysis'); await directory(root, true);
  const lockFile = path.join(root, '_runner.json'), owner = {format: 'ContextAnalysisRunnerLock', version: 1, pid: process.pid, id: randomUUID()};
  try { await immutable(lockFile, owner); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const old = await checked(lockFile); exactKeys(old, ['format', 'version', 'pid', 'id'], 'analysis runner lock');
    if (old.format !== owner.format || old.version !== 1 || !Number.isSafeInteger(old.pid) || old.pid <= 1 || !uuid.test(old.id)) throw failure('Analysis runner lock is unverified; preserved');
    try { process.kill(old.pid, 0); throw failure('Analysis runner already owns this data directory'); }
    catch (check) { if (check.code !== 'ESRCH') throw check; }
    await fs.unlink(lockFile); await immutable(lockFile, owner);
  }
  const preparing = new Map(), running = new Map(), stops = new Map(), revisions = new Map(); let closed = false;
  const changed = id => revisions.set(id, (revisions.get(id) ?? 0) + 1);
  const jobDirectory = id => { if (!digest.test(id)) throw failure('Invalid analysis task identity', 400); return path.join(root, id); };
  async function manifest(id) {
    await directory(root); const dir = jobDirectory(id);
    try { await directory(dir); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const value = await checked(path.join(dir, 'request.json'));
    exactKeys(value, ['format', 'version', 'request', 'requestHash', 'disclosureHash', 'submissionHash', 'consent', 'protocolHash', 'promptHash', 'createdAt', 'maximumCalls', 'canAuthorizePlacement'], 'saved analysis task');
    const request = value.request;
    exactKeys(request, ['format', 'version', 'contextId', 'snapshotHash', 'summaryHash', 'selectionHash', 'identity', 'intent',
      ...(request.version === 2 ? ['protocol', 'protocolHash'] : [])], 'saved analysis request');
    validateContextTaskIntent(request.intent);
    const binding = {contextId: request.contextId, requestHash: id, disclosureHash: value.disclosureHash, intent: request.intent, explicitSend: true};
    if (value.format !== 'SavedContextAnalysisTask' || ![1, 2].includes(value.version) || request.format !== 'WorldContextTask' || request.version !== value.version || request.intent.version !== request.version
        || !uuid.test(request.contextId) || value.requestHash !== id || contextHash(request) !== id || value.submissionHash !== contextHash(binding)
        || !digest.test(value.disclosureHash) || !digest.test(value.promptHash) || value.protocolHash !== CONTEXT_ANALYSIS_PROTOCOL_HASH
        || value.maximumCalls !== 1 || value.canAuthorizePlacement !== false || !Number.isSafeInteger(value.createdAt)) throw failure('Saved analysis task identity/protocol/budget changed');
    if (request.version === 2 && (request.protocolHash !== CONTEXT_ANALYSIS_PROTOCOL_HASH || contextHash(request.protocol) !== CONTEXT_ANALYSIS_PROTOCOL_HASH)) throw failure('Confirmed analysis rules/protocol changed');
    const consent = value.consent;
    exactKeys(consent, ['format', 'version', 'id', 'contextId', 'disclosureHash', 'snapshotHash', 'summaryHash', 'selectionHash', 'recipient', 'createdAt', 'expiresAt', 'state', 'modelSent', 'canAuthorizePlacement'], 'saved analysis consent');
    exactKeys(consent.recipient, ['agent', 'model', 'requestHash'], 'saved analysis recipient');
    if (consent.format !== 'WorldContextConsent' || consent.version !== 1 || !uuid.test(consent.id) || consent.contextId !== request.contextId
        || consent.state !== 'confirmed-not-sent' || consent.modelSent !== false || consent.canAuthorizePlacement !== false
        || consent.disclosureHash !== value.disclosureHash || consent.snapshotHash !== request.snapshotHash || consent.summaryHash !== request.summaryHash || consent.selectionHash !== request.selectionHash
        || consent.recipient.agent !== request.intent.agent || consent.recipient.model !== request.intent.model || consent.recipient.requestHash !== id
        || !Number.isSafeInteger(consent.createdAt) || !Number.isSafeInteger(consent.expiresAt) || value.createdAt < consent.createdAt || value.createdAt >= consent.expiresAt
        || consent.expiresAt > consent.createdAt + 300000) throw failure('Saved analysis consent identity/lifetime changed');
    return {dir, value};
  }
  async function promptAt(saved) {
    const prompt = await checked(path.join(saved.dir, 'prompt.json'));
    if (typeof prompt !== 'string' || Buffer.byteLength(prompt) > 2 * 1024 ** 2 || contextHash(prompt) !== saved.value.promptHash) throw failure('Original analysis prompt changed');
    return prompt;
  }
  async function recordAt(saved) {
    const journalRoot = path.join(saved.dir, 'assembly-journal');
    try { await directory(journalRoot); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    let record;
    try { record = await checked(path.join(journalRoot, 'call-1.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let identity;
    try { identity = await checked(path.join(journalRoot, 'identity.json')); } catch (error) { if (error.code !== 'ENOENT' || record) throw error; return null; }
    if (hash(identity) !== hash({version: 1, requestHash: saved.value.requestHash, policyHash: hash(policy), runtimeHash: CONTEXT_ANALYSIS_PROTOCOL_HASH, maximumCalls: 1})) throw failure('Analysis journal identity changed');
    const prompt = await promptAt(saved), fingerprint = hash({prompt, index: 1, schema: contextAnalysisSchema, phase: 'context-analysis', maximum: 1, images: []});
    if (record && (record.index !== 1 || record.fingerprint !== fingerprint || !['pending', 'response', 'error'].includes(record.state))) throw failure('Original analysis invocation changed');
    const names = await fs.readdir(journalRoot);
    if (names.some(name => /^call-\d+\.json$/.test(name) && name !== 'call-1.json')) throw failure('Analysis call budget exceeded');
    let dispatched = 0;
    try { dispatched = (await checked(path.join(journalRoot, 'dispatched.json'))).count; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (![0, 1].includes(dispatched) || dispatched === 1 && !record || record && record.state !== 'pending' && dispatched !== 1) throw failure('Analysis reservation evidence changed');
    if (record?.providerBinding && (record.providerBinding.model !== saved.value.request.intent.model
        || saved.value.request.intent.effort !== 'default' && record.providerBinding.effort !== saved.value.request.intent.effort)) throw failure('Original analysis provider/model changed');
    return record ?? null;
  }
  async function get(id) {
    const saved = await manifest(id); if (!saved) return null;
    const {record, active} = await readStableAnalysisState({readRecord: () => recordAt(saved), revision: () => revisions.get(id) ?? 0, active: () => running.has(id)});
    let state = record ? active ? 'running' : 'unknown' : 'not-dispatched';
    let analysis = null, rejection = null;
    if (record?.state === 'response') {
      try { analysis = validateContextAnalysis(record.response.spec, {requestHash: id, request: saved.value.request}); state = 'completed'; }
      catch { state = 'completed-rejected'; rejection = 'analysis-contract-rejected'; }
    } else if (record?.state === 'error') {
      const reason = record.error?.diagnostic?.reason;
      state = reason === 'completed' ? 'completed-rejected' : ['failed', 'interrupted', 'aborted', 'cancelled', 'not-submitted'].includes(reason) ? 'failed' : 'unknown';
    }
    return {format: 'WorldContextAnalysisStatus', version: 1, id, contextId: saved.value.request.contextId,
      requestVersion: saved.value.request.version, protocolHash: saved.value.protocolHash,
      requestHash: id, snapshotHash: saved.value.request.snapshotHash, summaryHash: saved.value.request.summaryHash,
      recipient: {agent: saved.value.request.intent.agent, model: saved.value.request.intent.model, effort: saved.value.request.intent.effort},
      state, callsReserved: record ? 1 : 0, maximumCalls: 1, automaticRetries: 0,
      canObserveOriginal: !active && record?.state === 'pending' && record.providerBinding?.provider === 'codex' && !!record.providerBinding.turnId,
      modelSent: record ? 'possibly-or-confirmed' : false, analysis, rejection, analysisClaimsVerified: false,
      localStop: stops.get(id) ?? (record?.error?.diagnostic?.code ? {category: 'provider-outcome', code: diagnostic({diagnostic: record.error.diagnostic}).code ?? 'unspecified', type: 'Error'} : null), canAuthorizePlacement: false};
  }
  async function run(saved, prompt, observing, ready) {
    if (closed) { ready.reject(failure('Context analysis runner closed before dispatch', 503)); return; }
    const id = saved.value.requestHash, controller = new AbortController();
    const current = {controller, done: null}; changed(id); running.set(id, current);
    current.done = (async () => {
      try {
        const journal = await openAssemblyJournal({directory: saved.dir, requestHash: id, policy, runtimeHash: CONTEXT_ANALYSIS_PROTOCOL_HASH});
        const intent = saved.value.request.intent;
        const dispatch = async (text, index, options, providerBinding) => {
          if (observing !== !!providerBinding) throw failure('Original analysis cannot be resubmitted');
          controller.signal.throwIfAborted(); ready.resolve();
          try {
            const adapter = adapterFor(intent.agent), operation = observing ? adapter.recoverOriginal?.bind(adapter) : adapter.generate?.bind(adapter);
            if (!operation) throw failure('Original provider observation unavailable; no replacement call');
            const output = await operation({prompt: text, model: intent.model, ...(intent.effort === 'default' ? {} : {effort: intent.effort}),
              outputSchema: contextAnalysisSchema, images: [], cwd: saved.dir, signal: controller.signal,
              ...(observing ? {binding: providerBinding} : {onProviderBinding: async binding => {
                if (binding.model !== intent.model || intent.effort !== 'default' && binding.effort !== intent.effort) throw failure('Context provider changed selected model/effort');
                await options.onProviderBinding(binding);
              }})});
            if (Buffer.byteLength(JSON.stringify(output.spec) ?? '') > CONTEXT_ANALYSIS_JOB_LIMITS.responseBytes) {
              const error = new Error('Analysis receipt byte quota exceeded'); error.diagnostic = {provider: intent.agent, reason: 'completed'}; throw error;
            }
            // Original JSON is retained even if its analysis contract is wrong.
            // Provider reasoning, account data and arbitrary errors are not copied.
            return {spec: output.spec};
          } catch (original) {
            const error = new Error('Context provider outcome recorded; no automatic retry');
            error.diagnostic = diagnostic(original);
            if (error.diagnostic.code) error.code = error.diagnostic.code;
            throw error;
          }
        };
        await journal.invoke(prompt, 1, stageOptions,
          (text, index, options) => dispatch(text, index, options),
          (text, index, options, binding) => dispatch(text, index, options, binding));
        ready.resolve();
      } catch (error) {
        stops.set(id, {category: error.diagnostic ? 'provider-outcome' : 'local-journal-or-invariant',
          code: ['EPERM', 'EACCES', 'EBUSY', 'ENOENT', 'ENOSPC', 'EIO'].includes(error.code) ? error.code : 'unspecified',
          type: ['Error', 'TypeError', 'ReferenceError', 'SyntaxError'].includes(error.name) ? error.name : 'Error'});
        ready.reject(error);
      }
      finally { if (running.get(id) === current) { changed(id); running.delete(id); } }
    })();
    return current.done;
  }
  function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; }
  async function reserve(input) {
    const id = input.requestHash, previous = await manifest(id);
    if (previous) { if (previous.value.submissionHash !== contextHash(bindingOf(input))) throw failure('Existing analysis input differs; not resubmitted'); return get(id); }
    if (closed || running.size) throw failure('Context analysis lane closed or busy; no model invoked', 429);
    await directory(root);
    if ((await fs.readdir(root)).filter(name => name !== '_runner.json').length >= CONTEXT_ANALYSIS_JOB_LIMITS.records) throw failure('Analysis record quota reached; no history evicted', 429);
    const preparedInput = await contexts.operation('analysis-input', input.contextId, Buffer.from(JSON.stringify(input.intent)));
    const {prepared, prompt, promptHash, protocolHash} = preparedInput;
    if (protocolHash !== CONTEXT_ANALYSIS_PROTOCOL_HASH || prepared.requestHash !== id || prepared.disclosure.disclosureHash !== input.disclosureHash || contextHash(prompt) !== promptHash) throw failure('Exact analysis context, task or disclosure changed');
    if (closed || running.size) throw failure('Context analysis lane closed or busy; no model invoked', 429);
    const consent = consents.consume(input.consentId, prepared.disclosure), createdAt = Date.now();
    if (createdAt >= consent.expiresAt) throw failure('Context send consent expired');
    const value = {format: 'SavedContextAnalysisTask', version: 2, request: prepared.request, requestHash: id,
      disclosureHash: input.disclosureHash, submissionHash: contextHash(bindingOf(input)), consent, protocolHash, promptHash,
      createdAt, maximumCalls: 1, canAuthorizePlacement: false};
    // Complete immutable request/prompt before publishing the directory. A
    // leftover pending directory is preserved, never adopted as an empty job.
    const pending = path.join(root, '.pending-' + randomUUID()); await directory(pending, true);
    await immutable(path.join(pending, 'request.json'), value); await immutable(path.join(pending, 'prompt.json'), prompt);
    await fs.rename(pending, jobDirectory(id));
    const saved = await manifest(id), ready = deferred();
    void run(saved, prompt, false, ready); await ready.promise;
    return get(id);
  }
  async function submit(raw) {
    const input = validateSubmission(raw), id = input.requestHash;
    if (closed) throw failure('Context analysis runner closed', 503);
    if (preparing.has(id)) {
      await preparing.get(id); const saved = await manifest(id);
      if (saved?.value.submissionHash !== contextHash(bindingOf(input))) throw failure('Concurrent exact task changed');
      return get(id);
    }
    if (preparing.size) throw failure('Context analysis reservation lane busy; no model invoked', 429);
    const work = reserve(input); preparing.set(id, work);
    try { return await work; } finally { if (preparing.get(id) === work) preparing.delete(id); }
  }
  async function observeOriginal(id) {
    if (closed || preparing.size || running.size) throw failure('Context observation lane closed or busy', 429);
    jobDirectory(id);
    const work = (async () => {
      const status = await get(id); if (!status?.canObserveOriginal) throw failure('No original persistent pending turn to observe; no generation submitted');
      const saved = await manifest(id), prompt = await promptAt(saved), ready = deferred();
      void run(saved, prompt, true, ready); await ready.promise; return get(id);
    })();
    // Claim the lane synchronously, before any status/prompt read completes.
    preparing.set(id, work);
    try { return await work; } finally { if (preparing.get(id) === work) preparing.delete(id); }
  }
  async function idle() { await Promise.allSettled([...preparing.values(), ...[...running.values()].map(task => task.done)]); }
  async function close() {
    closed = true; for (const task of running.values()) task.controller.abort(); await idle();
    try { if (hash(await checked(lockFile)) !== hash(owner)) throw failure('Analysis runner ownership changed; lock preserved'); await fs.unlink(lockFile); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return {submit, get, observeOriginal, idle, close, busy: () => !!(preparing.size || running.size)};
}
