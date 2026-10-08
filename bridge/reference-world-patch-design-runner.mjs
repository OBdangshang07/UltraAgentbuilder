import fs from 'node:fs/promises';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';
import {exactKeys} from '../contracts/world-selection.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {contextHash} from '../src/world/context-snapshot.mjs';
import {createReferenceWorldPatchJobRegistry} from './reference-world-patch-job-registry.mjs';
import {assemblyRuntimeIdentity, openAssemblyJournal} from './assembly-durability.mjs';
import {codexRequestFingerprint} from './codex-persistent-receipt.mjs';
import {createWorldPatchOwnerReference, inspectWorldPatchOwnerProcess} from './world-patch-owner-observation.mjs';
import {prepareFrozenReferenceWorldPatchSendInput} from './reference-world-patch-send-input.mjs';
import {readReferenceWorldPatchTaskImages} from './reference-world-patch-task-images.mjs';
import {REFERENCE_PATCH_CALL_POLICY, REFERENCE_PATCH_RESPONSE_BYTES, jointInvocationDirectory,
  readJointInvocationEnvelope, writeJointInvocationEnvelope, readReferencePatchInvocation} from './reference-world-patch-invocation-data.mjs';

// Internal joint path, not a public endpoint or world writer. Its distinct
// write-ahead invocation journal never changes the original consume-once
// reservation, legacy text capsule, or original attachment/capture bytes.
export async function createReferenceWorldPatchDesignRunner(options) {
  exactKeys(options, ['dataDir','contexts','adapterFor'], 'internal joint design runner');
  if (typeof options.adapterFor !== 'function') throw Error('Internal selected adapter factory required');
  const registry = await createReferenceWorldPatchJobRegistry({dataDir: options.dataDir, contexts: options.contexts});
  const dataDir = await fs.realpath(path.resolve(options.dataDir)), root = path.join(dataDir, 'reference-world-patch-invocations');
  await jointInvocationDirectory(root, true);
  const runtimeHash = registry.runtimeHash, preparing = new Map(), running = new Map(), owned = new Map();
  let closed = false;
  const directory = id => {
    if (!/^[a-f0-9]{64}$/.test(id ?? '')) throw Error('Exact joint capsule identity required');
    return path.join(root, id);
  };
  const checkpoint = signal => {if (closed || signal?.aborted) throw Error('Joint design runner closed/cancelled; original evidence retained');};
  const metadata = async id => {
    const dir = directory(id); await jointInvocationDirectory(root);
    try {await jointInvocationDirectory(dir);} catch (error) {if (error.code === 'ENOENT') return null; throw error;}
    return readReferencePatchInvocation(dir, runtimeHash);
  };
  async function get(id) {
    const saved = await metadata(id); if (!saved) return null;
    const ledger = path.join(saved.directory, 'assembly-journal');
    try {
      await jointInvocationDirectory(ledger);
      if ((await fs.readdir(ledger)).some(name => /^call-\d+\.json$/.test(name) && name !== 'call-1.json'))
        throw Error('Joint invocation exceeded original one-call budget');
    } catch (error) {if (error.code !== 'ENOENT') throw error;}
    let call = null;
    try {call = await readJointInvocationEnvelope(path.join(saved.directory, 'assembly-journal/call-1.json'), REFERENCE_PATCH_RESPONSE_BYTES + 65536);}
    catch (error) {if (error.code !== 'ENOENT') throw error;}
    if (call && (call.index !== 1 || call.fingerprint !== saved.value.invocationFingerprint
      || !['pending','response','error'].includes(call.state))) throw Error('Original joint journal changed');
    if (call) {
      const identity = await readJointInvocationEnvelope(path.join(ledger, 'identity.json'));
      if (hash(identity) !== hash({version: 1, requestHash: saved.value.submissionHash,
        policyHash: hash(REFERENCE_PATCH_CALL_POLICY), runtimeHash, maximumCalls: 1})
        || (await readJointInvocationEnvelope(path.join(ledger, 'dispatched.json'))).count !== 1)
        throw Error('Joint invocation budget/runtime ledger changed');
      const binding = call.providerBinding;
      if (binding && (binding.provider !== 'codex' || binding.storage !== 'persistent-single-turn' || binding.version !== 1
        || binding.model !== saved.value.selected.model || binding.effort !== saved.value.selected.effort
        || !/^[-\w]{1,128}$/.test(binding.threadId ?? '') || binding.turnId !== null && !/^[-\w]{1,128}$/.test(binding.turnId ?? '')
        || !/^[a-f0-9]{64}$/.test(binding.requestHash ?? ''))) throw Error('Original joint provider binding changed');
    }
    const active = running.has(id); let state = active ? 'running' : call ? 'unknown' : 'reserved-not-dispatched', responseCheck = null;
    let localStop = null;
    try {
      const stop = await readJointInvocationEnvelope(path.join(saved.directory, 'controller-stop.json'));
      exactKeys(stop, ['format','version','id','submissionHash','runtimeHash','phase','reason','canAuthorizePlacement'], 'joint local stop');
      if (stop.format !== 'FrozenReferenceWorldPatchLocalStop' || stop.version !== 1 || stop.id !== id
        || stop.submissionHash !== saved.value.submissionHash || stop.runtimeHash !== runtimeHash
        || !['live-capability-preflight','original-source-preflight','provider-dispatch','response-compile'].includes(stop.phase)
        || stop.reason !== 'original-outcome-retained-no-resubmission' || stop.canAuthorizePlacement !== false)
        throw Error('Original joint local stop changed');
      localStop = {phase: stop.phase, reason: stop.reason, isProviderTerminalReceipt: false};
    } catch (error) {if (error.code !== 'ENOENT') throw error;}
    if (call?.state === 'response') {
      state = active ? 'checking' : 'response-retained';
      if (!active) try {
        const done = await readJointInvocationEnvelope(path.join(saved.directory, 'completion.json'));
        exactKeys(done, ['format','version','id','submissionHash','runtimeHash','responseHash','state','responseCheck','canAuthorizePlacement'], 'joint completion');
        if (done.format !== 'FrozenReferenceWorldPatchCompletion' || done.version !== 1 || done.id !== id
          || done.submissionHash !== saved.value.submissionHash || done.runtimeHash !== runtimeHash
          || done.responseHash !== contextHash(call.response.spec) || !['completed-checked','completed-rejected'].includes(done.state)
          || done.canAuthorizePlacement !== false) throw Error('Original joint completion changed');
        state = done.state; responseCheck = done.responseCheck;
        if (state === 'completed-rejected' && responseCheck !== null) throw Error('Rejected joint response cannot provide a candidate');
        if (state === 'completed-checked') exactKeys(responseCheck, ['format','version','capsuleId','manifestHash','responseHash',
          'snapshotHash','selectionHash','patchHash','candidateHash','previewHash','candidateSaved','sourceArchiveReverified',
          'serverBaselineVerified','canAuthorizePlacement','additionalModelCalls','worldWrites'], 'joint response check');
        if (state === 'completed-checked' && (responseCheck.format !== 'FrozenReferenceWorldPatchResponseCheck' || responseCheck.version !== 1
          || responseCheck.capsuleId !== id || responseCheck.responseHash !== done.responseHash
          || responseCheck.manifestHash !== saved.source.receipt.manifestHash || responseCheck.snapshotHash !== saved.source.receipt.snapshotHash
          || responseCheck.selectionHash !== saved.source.receipt.selectionHash || responseCheck.canAuthorizePlacement !== false
          || responseCheck.serverBaselineVerified !== false || responseCheck.worldWrites !== 0 || responseCheck.additionalModelCalls !== 0
          || responseCheck.candidateSaved !== true || responseCheck.sourceArchiveReverified !== true
          || ['patchHash','candidateHash','previewHash'].some(k => !/^[a-f0-9]{64}$/.test(responseCheck[k] ?? ''))))
          throw Error('Joint response authority or source changed');
      } catch (error) {if (error.code !== 'ENOENT') throw error;}
    }
    if (call?.state === 'error') state = call.error?.diagnostic?.reason === 'completed' ? 'completed-rejected'
      : ['failed','interrupted','not-submitted'].includes(call.error?.diagnostic?.reason) ? 'failed' : 'unknown';
    return {format: 'FrozenReferenceWorldPatchJobStatus', version: 1, id, capsuleId: id,
      submissionHash: saved.value.submissionHash, manifestHash: saved.source.receipt.manifestHash, runtimeHash,
      recipient: saved.source.receipt.recipient, state, callsReserved: call ? 1 : 0, maximumCalls: 1,
      automaticRetries: 0, modelSent: call ? 'possibly-or-confirmed' : false,
      responseCheck, localStop, canObserveOriginal: !active && call?.state === 'pending' && !!call.providerBinding?.turnId,
      candidatePublished: responseCheck?.candidateSaved === true,
      candidateHash: responseCheck?.candidateHash ?? null, candidateCurrentFilesReverified: false,
      serverBaselineVerified: false, canAuthorizePlacement: false, worldWrites: 0};
  }
  async function checkResponse(saved, spec, signal) {
    const responseHash = contextHash(spec);
    const result = await new Promise((resolve, reject) => {
      signal.throwIfAborted(); let settled = false, message;
      const worker = new Worker(new URL('./reference-world-patch-response-worker.mjs', import.meta.url), {
        workerData: {directory: saved.directory, runtimeHash, spec, responseHash},
        resourceLimits: {maxOldGenerationSizeMb: 512, stackSizeMb: 4}});
      const finish = (error, value) => {if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
        worker.terminate().then(() => error ? reject(error) : resolve(value), reject);};
      const abort = () => finish(Error('Joint response compilation cancelled; original response retained'));
      const timer = setTimeout(() => finish(Error('Joint response worker quota; original response retained')), 60000);
      signal.addEventListener('abort', abort, {once: true}); worker.once('message', value => {message = value;});
      worker.once('error', error => finish(error)); worker.once('exit', code => {
        if (signal.aborted) return abort();
        if (code !== 0 || !message) return finish(Error('Joint response worker exited without a complete receipt'));
        finish(null, message);
      });
    });
    if (result.ok !== true || (result.rejected ? result : result.result)?.responseHash !== responseHash
      || (result.rejected ? result : result.result)?.capsuleId !== saved.value.id) throw Error('Original joint source/response failed verification');
    const completion = {format: 'FrozenReferenceWorldPatchCompletion', version: 1, id: saved.value.id,
      submissionHash: saved.value.submissionHash, runtimeHash, responseHash,
      state: result.rejected ? 'completed-rejected' : 'completed-checked', responseCheck: result.rejected ? null : result.result,
      canAuthorizePlacement: false};
    await writeJointInvocationEnvelope(path.join(saved.directory, 'completion.json'), completion);
  }
  async function freshPacket(saved, signal) {
    checkpoint(signal);
    if (owned.get(saved.value.id) !== saved.value.ownerReferenceHash) throw Error('Exact original joint controller required; no adoption');
    if (await assemblyRuntimeIdentity() !== runtimeHash) throw Error('Joint runtime changed; no replacement SEND');
    const packet = await registry.readOwnedInput(saved.value.id);
    for (const key of ['inputHash','preparationHash','invocationFingerprint','transportHash'])
      if (packet[key] !== saved.value[key]) throw Error('Original joint provider packet changed');
    checkpoint(signal); return packet;
  }
  async function advertised(adapter, selected) {
    if (selected.agent !== 'codex' || typeof adapter?.models !== 'function' || typeof adapter?.generate !== 'function')
      throw Error('Joint SEND currently requires an explicitly advertised Codex image adapter');
    const current = (await adapter.models()).find(model => model.id === selected.model);
    const efforts = current?.efforts?.map(value => value.reasoningEffort ?? value);
    if (!current?.supportsImages || !efforts?.includes(selected.effort)
      || hash({id: current.id, supportsImages: current.supportsImages, efforts}) !== hash(selected.capability))
      throw Error('Live selected image/effort advertisement changed; no model submitted');
  }
  function start(saved, packet, observing = false) {
    const id = saved.value.id, controller = new AbortController();
    let readyResolve; const ready = new Promise(resolve => {readyResolve = resolve;});
    const item = {controller, done: null}; running.set(id, item);
    item.done = (async () => {
      let phase = 'live-capability-preflight';
      try {
        const adapter = options.adapterFor(saved.value.selected.agent);
        if (!observing) {await advertised(adapter, saved.value.selected); phase = 'original-source-preflight';
          await freshPacket(saved, controller.signal);}
        else if (typeof adapter?.recoverOriginal !== 'function') throw Error('Selected provider original-receipt observer unavailable');
        const journal = await openAssemblyJournal({directory: saved.directory, requestHash: saved.value.submissionHash,
          policy: REFERENCE_PATCH_CALL_POLICY, runtimeHash});
        const response = await journal.invoke(packet.prompt, 1, {outputSchema: packet.outputSchema, stageName: packet.stageName,
          stageCount: 1, images: packet.images, referenceInput: packet.referenceInput}, async (prompt, index, callOptions) => {
          if (observing) throw Error('Original receipt observation cannot dispatch');
          const exact = await freshPacket(saved, controller.signal); await advertised(adapter, saved.value.selected); checkpoint(controller.signal);
          phase = 'provider-dispatch';
          readyResolve();
          const expectedRequestHash = codexRequestFingerprint({prompt, model: saved.value.selected.model,
            effort: saved.value.selected.effort, outputSchema: exact.outputSchema, imageHashes: exact.imageHashes,
            referenceBindingHash: contextHash(exact.referenceInput)});
          const output = await adapter.generate({prompt, model: saved.value.selected.model, effort: saved.value.selected.effort,
            cwd: saved.directory, signal: controller.signal, images: [], referenceInput: exact.referenceInput,
            outputSchema: exact.outputSchema, onProviderBinding: async binding => {
              if (binding.model !== saved.value.selected.model || binding.effort !== saved.value.selected.effort
                || binding.requestHash !== expectedRequestHash) throw Error('Original joint provider request differs from exact source/pixels');
              // A null turn is the adapter's BEFORE-turn/start checkpoint.
              // A non-null turn is an original dispatched receipt, not new SEND.
              if (binding.turnId === null) {await freshPacket(saved, controller.signal);
                await advertised(adapter, saved.value.selected); checkpoint(controller.signal);}
              await callOptions.onProviderBinding(binding);
            }});
          if (Buffer.byteLength(JSON.stringify(output.spec) ?? '') > REFERENCE_PATCH_RESPONSE_BYTES) {
            const error = Error('Completed joint response exceeds local byte quota'); error.diagnostic = {provider: 'codex', reason: 'completed'}; throw error;
          }
          return {spec: output.spec};
        }, async (prompt, index, callOptions, binding) => {
          if (!observing) throw Error('New joint task cannot adopt a pending provider call');
          checkpoint(controller.signal); phase = 'provider-dispatch'; readyResolve();
          const output = await adapter.recoverOriginal({binding, prompt, model: saved.value.selected.model,
            effort: saved.value.selected.effort, cwd: saved.directory, signal: controller.signal,
            images: [], referenceInput: packet.referenceInput, outputSchema: packet.outputSchema});
          if (Buffer.byteLength(JSON.stringify(output.spec) ?? '') > REFERENCE_PATCH_RESPONSE_BYTES) {
            const error = Error('Completed original response exceeds local byte quota'); error.diagnostic = {provider: 'codex', reason: 'completed'}; throw error;
          }
          return {spec: output.spec};
        });
        phase = 'response-compile';
        await checkResponse(saved, response.spec, controller.signal);
      } catch {
        // No automatic provider retry, no substitute response. A bound unknown
        // stays pending in the original journal. Close does not refund a call.
        try {await writeJointInvocationEnvelope(path.join(saved.directory, 'controller-stop.json'), {
          format: 'FrozenReferenceWorldPatchLocalStop', version: 1, id, submissionHash: saved.value.submissionHash,
          runtimeHash, phase, reason: 'original-outcome-retained-no-resubmission', canAuthorizePlacement: false});}
        catch { /* Retain any original/partial stop receipt, never replace it. */ }
      } finally {readyResolve(); if (running.get(id) === item) running.delete(id);}
    })();
    return ready;
  }
  async function submit(value) {
    exactKeys(value, ['send','selected'], 'joint design SEND'); checkpoint();
    const id = value.send?.capsuleId; directory(id);
    const same = saved => {
      if (saved.value.submissionHash !== contextHash(value.send) || hash(saved.value.selected) !== hash(value.selected))
        throw Error('Duplicate joint SEND differs; original evidence retained');
    };
    if (preparing.has(id)) {await preparing.get(id); const saved = await metadata(id); same(saved); return get(id);}
    const old = await metadata(id); if (old) {same(old); return get(id);}
    // All concurrent callers can have observed a missing directory before the
    // first read resolves. Recheck this exact in-memory owner after that await.
    if (preparing.has(id)) {await preparing.get(id); const saved = await metadata(id); same(saved); return get(id);}
    if (preparing.size || running.size) throw Error('Joint design lane busy; no model submitted');
    const operation = (async () => {
      const reservation = await registry.reserve(value), packet = await registry.readOwnedInput(id); checkpoint();
      const dir = directory(id);
      const entries = await fs.readdir(root);
      if (entries.some(name => !/^[a-f0-9]{64}$/.test(name)) || entries.length >= 8)
        throw Error('Joint invocation history quota/unknown entry; nothing evicted');
      // Another invocation directory, including a partial crash remnant, is
      // never cleared or granted a new call by a different controller.
      await fs.mkdir(dir, {mode: 0o700}); await jointInvocationDirectory(dir);
      const owner = await createWorldPatchOwnerReference({directory: dir}); checkpoint();
      const originalReservation = await readJointInvocationEnvelope(path.join(dataDir, 'reference-world-patch-design', id, 'request.json'));
      const saved = {format: 'FrozenReferenceWorldPatchInvocation', version: 1, id, send: value.send, selected: value.selected,
        submissionHash: packet.submissionHash, inputHash: packet.inputHash, preparationHash: packet.preparationHash,
        invocationFingerprint: packet.invocationFingerprint, transportHash: packet.transportHash, imageHashes: [...packet.imageHashes], runtimeHash,
        registryRequestHash: hash(originalReservation), registryOwnerReferenceHash: originalReservation.ownerReferenceHash,
        ownerReference: owner.reference, ownerReferenceHash: owner.referenceHash, createdAt: Date.now(), maximumCalls: 1, canAuthorizePlacement: false};
      if (reservation.invocationFingerprint !== saved.invocationFingerprint || packet.recordExpiresAt <= saved.createdAt)
        throw Error('Joint source expired or changed during original owner creation');
      await writeJointInvocationEnvelope(path.join(dir, 'request.json'), saved); owned.set(id, saved.ownerReferenceHash);
      const checked = await metadata(id); await start(checked, packet); return get(id);
    })();
    preparing.set(id, operation); try {return await operation;} finally {if (preparing.get(id) === operation) preparing.delete(id);}
  }
  async function observeOriginal(id) {
    checkpoint();
    if (preparing.size || running.size) throw Error('Joint lane busy; original receipt only, no dispatch');
    directory(id);
    const operation = (async () => {
      const saved = await metadata(id), status = await get(id);
      if (!saved || !status.canObserveOriginal) throw Error('Only an exact pending original joint turn can be observed');
      if (owned.get(id) !== saved.value.ownerReferenceHash) {
        const original = await inspectWorldPatchOwnerProcess({directory: saved.directory, reference: saved.value.ownerReference,
          expectedReferenceHash: saved.value.ownerReferenceHash});
        if (!original.exactOriginalProcessExitedAtObservation) throw Error('Original joint owner live/inconclusive; no adoption');
      }
      checkpoint();
      const claimFile = path.join(saved.directory, '_observer.json'), claim = {format: 'ReferenceWorldPatchOriginalObserver',
        version: 1, id: randomUUID(), ownerReferenceHash: saved.value.ownerReferenceHash, originalCallOnly: true};
      await writeJointInvocationEnvelope(claimFile, claim);
      try {
        const input = await prepareFrozenReferenceWorldPatchSendInput({dataDir, capsuleId: id, send: saved.value.send, originalReceiptOnly: true});
        const images = await readReferenceWorldPatchTaskImages({dataDir, capsuleId: id, send: saved.value.send});
        if (input.invocationFingerprint !== saved.value.invocationFingerprint || input.submissionHash !== saved.value.submissionHash
          || images.manifest.transportHash !== saved.value.transportHash || hash(input.imageHashes) !== hash(saved.value.imageHashes))
          throw Error('Original joint observation input changed; no substituted prompt or pixels');
        await start(saved, {...input, images: images.images, outputSchema: (await import('../contracts/world-patch.mjs')).worldPatchProposalSchema,
          stageName: 'reference-world-patch-design', stageCount: 1}, true);
        await (running.get(id)?.done ?? Promise.resolve()); return get(id);
      } finally {
        if (hash(await readJointInvocationEnvelope(claimFile)) !== hash(claim)) throw Error('Original joint observation claim changed; preserved');
        await fs.unlink(claimFile); // this exact OWN read-only claim only
      }
    })();
    preparing.set(id, operation); try {return await operation;} finally {if (preparing.get(id) === operation) preparing.delete(id);}
  }
  return {runtimeHash, submit, get, observeOriginal, busy: () => preparing.size > 0 || running.size > 0,
    async close() {closed = true; for (const item of running.values()) item.controller.abort();
      await Promise.allSettled([...preparing.values()]);
      const active = [...running.values()]; for (const item of active) item.controller.abort();
      await Promise.allSettled(active.map(item => item.done)); await registry.close(); owned.clear();}};
}
