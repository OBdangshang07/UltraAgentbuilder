import {exactKeys} from '../contracts/world-selection.mjs';
import {contextHash} from '../src/world/context-snapshot.mjs';
import {validateReferenceWorldPatchDesignIntent} from '../src/world/reference-world-patch-design-task.mjs';
import {validateFrozenReferenceWorldPatchExplicitSend, bindFrozenReferenceWorldPatchSend} from '../contracts/reference-world-patch-send.mjs';
import {createReferenceWorldPatchDesignRunner} from './reference-world-patch-design-runner.mjs';

const prefix = '/v1/reference-world-patch';
const uuid = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', digest = '[a-f0-9]{64}';
const contextRoute = new RegExp(`^${prefix}/contexts/(${uuid})/(disclosure|review|freeze)$`);
const taskRoute = new RegExp(`^${prefix}/tasks/(${digest})(?:/(images))?$`);
const jobRoute = new RegExp(`^${prefix}/jobs/(${digest})(?:/(send|observe-original|preview|candidate))?$`);
const fail = (message, statusCode = 409) => {throw Object.assign(Error(message), {statusCode, publicMessage:message});};
const raw = value => {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > 32768) fail('Joint worker input quota; no truncation or model invoked', 413);
  return bytes;
};
async function body(req, maximum, signal) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) fail('Expected UTF-8 application/json', 400);
  if (Number(req.headers['content-length']) > maximum) fail('Joint request byte quota', 413);
  signal.throwIfAborted();
  let size = 0; const chunks = [], abort = () => req.destroy();
  signal.addEventListener('abort', abort, {once:true});
  try {for await (const chunk of req) {
      signal.throwIfAborted(); size += chunk.length;
      if (size > maximum) fail('Joint request byte quota', 413);
      chunks.push(chunk);
    }} finally {signal.removeEventListener('abort', abort);}
  signal.throwIfAborted();
  if (!size) fail('Exact independent joint request required', 400);
  try {return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(Buffer.concat(chunks, size)));}
  catch {fail('Joint request must be valid fatal-decoded UTF-8 JSON', 400);}
}

/** Called only AFTER Bridge's exact loopback Host/no-Origin/Bearer checks.
 * Process opt-in is immutable. No request may supply capabilities, runtime,
 * accounts, files, a worker operation, fresh-world facts or placement rights. */
export async function createReferenceWorldPatchHttpService({dataDir, contexts, adapterFor, enabled = false, state}) {
  if (typeof enabled !== 'boolean' || typeof state !== 'function') throw Error('Process-owned joint service state required');
  const runner = enabled ? await createReferenceWorldPatchDesignRunner({dataDir, contexts, adapterFor}) : null;
  const active = new Set(); let closed = false;
  const checkpoint = signal => {
    const current = state();
    if (closed || current.closing || signal?.aborted) fail('Joint service closed/cancelled; original evidence retained', 503);
    if (current.changingConfig) fail('Joint model configuration changed; no new model invoked');
    if (current.busy) fail('Finish other model/attachment/context work before the joint action', 429);
  };
  async function advertisement(intent, signal) {
    checkpoint(signal);
    const adapter = adapterFor(intent.agent);
    if (intent.agent !== 'codex' || typeof adapter?.models !== 'function') fail('Joint references require an advertised Codex image model');
    // Read-only discovery may time out, but that never means a model SEND
    // failed or authorizes a resend. Check configuration again after awaiting.
    let timer, abort;
    const models = await Promise.race([adapter.models(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(Error('Joint capability discovery quota'), {statusCode:503})), 15000);
      abort = () => reject(Object.assign(Error('Joint discovery cancelled'), {statusCode:503}));
      signal.addEventListener('abort', abort, {once:true});
    })]).finally(() => {clearTimeout(timer); signal.removeEventListener('abort', abort);});
    checkpoint(signal);
    const selected = models.find(model => model.id === intent.model), efforts = selected?.efforts?.map(e => e.reasoningEffort ?? e);
    if (selected?.supportsImages !== true || !efforts?.includes(intent.effort))
      fail('Selected model must advertise image input and the exact requested effort');
    return {id:selected.id, supportsImages:true, efforts};
  }
  async function handle(req, res, url) {
    if (url.pathname !== prefix && !url.pathname.startsWith(prefix + '/')) return false;
    const json = (status, value) => {
      res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
      res.end(JSON.stringify(value));
    };
    let item;
    try {
      const context = contextRoute.exec(url.pathname), task = taskRoute.exec(url.pathname), job = jobRoute.exec(url.pathname);
      const capabilities = url.pathname === prefix + '/capabilities';
      if (!context && !task && !job && !capabilities) fail('Unknown independent joint route', 404);
      const download = job && ['preview','candidate'].includes(job[2]);
      if (download ? [...url.searchParams.keys()].length !== 1 || url.searchParams.getAll('candidateHash').length !== 1
        || !/^[a-f0-9]{64}$/.test(url.searchParams.get('candidateHash') ?? '') : url.search)
        fail('Only the exact retained candidateHash query is allowed on joint downloads', 400);
      const method = context || task?.[2] || job && ['send','observe-original'].includes(job[2]) ? 'POST' : 'GET';
      if (req.method !== method) fail('Unsupported independent joint method', 405);
      if (method === 'GET' && (req.headers['transfer-encoding'] || Number(req.headers['content-length']) > 0))
        fail('Read-only joint requests cannot carry a body', 400);
      if (capabilities) {
        json(200, {format:'ReferenceWorldPatchCapabilities', version:1, purpose:'reference-world-patch-design',
          preparationImplemented:true, preparationEnabled:enabled && !closed && !state().closing,
          sendingImplemented:true, sendingEnabled:enabled && !closed && !state().closing && !state().changingConfig,
          runtimeHash:runner?.runtimeHash ?? null, maximumCalls:1, automaticRetries:0, agents:['codex'],
          jointConfirmationRequired:true, legacyConsentTransferable:false, previewDownloadVersion:1,
          playerUiImplemented:false, placementImplemented:false, serverBaselineVerified:false, canAuthorizePlacement:false});
        return true;
      }
      if (!runner) fail('Independent joint protocol is disabled in this process; no model invoked');
      checkpoint();
      if (active.size) fail('Joint HTTP preparation lane busy; no duplicate action invoked', 429);
      if ((context || task?.[2]) && runner.busy()) fail('Finish the original joint job before changing joint preparation', 429);
      const controller = new AbortController(); let resolveDone;
      item = {controller, done:new Promise(resolve => {resolveDone = resolve;}), resolveDone}; active.add(item);
      const abort = () => controller.abort(); req.once('aborted', abort); item.detach = () => req.off('aborted', abort);
      const signal = controller.signal;
      if (context) {
        const input = await body(req, 32768, signal), reviewing = context[2] !== 'disclosure';
        exactKeys(input, reviewing ? ['intent','confirmation'] : ['intent'], 'joint HTTP intent');
        const intent = validateReferenceWorldPatchDesignIntent(input.intent), capability = await advertisement(intent, signal);
        const operation = {disclosure:'reference-patch-task-disclosure', review:'reference-patch-review-task', freeze:'reference-patch-freeze-task'}[context[2]];
        checkpoint(signal);
        const value = await contexts.operation(operation, context[1], raw({intent, capability, runtimeHash:runner.runtimeHash,
          ...(reviewing ? {confirmation:input.confirmation} : {})}), {signal});
        checkpoint(signal); json(200, value);
      } else if (task) {
        if (!task[2]) {
          const value = await contexts.operation('reference-patch-frozen-task', task[1], undefined, {signal});
          checkpoint(signal); json(200, value);
        }
        else {
          const send = validateFrozenReferenceWorldPatchExplicitSend(await body(req, 4096, signal));
          if (send.capsuleId !== task[1]) fail('Joint image route and capsule differ', 400);
          checkpoint(signal);
          const manifest = await contexts.operation('reference-patch-freeze-images', task[1], raw(send), {signal});
          checkpoint(signal);
          json(200, {format:'ReferenceWorldPatchImageFreezeStatus',version:1,capsuleId:manifest.capsuleId,
            transportHash:manifest.transportHash,imageHashes:manifest.imageHashes,state:manifest.state,
            modelSent:false,canAuthorizePlacement:false});
        }
      } else if (job[2] === 'send') {
        const send = validateFrozenReferenceWorldPatchExplicitSend(await body(req, 4096, signal));
        if (send.capsuleId !== job[1]) fail('Joint SEND route and capsule differ', 400);
        const old = await runner.get(job[1]); checkpoint(signal);
        if (old) {
          if (old.submissionHash !== contextHash(send)) fail('Existing independent joint SEND differs');
          json(200, old); // no capability query, new reservation or dispatch
        } else {
          const receipt = await contexts.operation('reference-patch-frozen-task', job[1], undefined, {signal});
          bindFrozenReferenceWorldPatchSend(receipt, send);
          const capability = await advertisement(receipt.recipient, signal); checkpoint(signal);
          json(202, await runner.submit({send, selected:{...receipt.recipient, capability, runtimeHash:runner.runtimeHash}}));
        }
      } else if (job[2] === 'observe-original') {
        const input = await body(req, 1024, signal); exactKeys(input, ['confirmed'], 'original joint observation');
        if (input.confirmed !== true) fail('Explicit original-only receipt observation required', 400);
        checkpoint(signal); json(202, await runner.observeOriginal(job[1], {waitForCompletion:false}));
      } else if (download) {
        const bytes = await (job[2] === 'candidate' ? runner.downloadCandidate : runner.downloadPreview)(job[1], url.searchParams.get('candidateHash'));
        checkpoint(signal);
        res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Content-Length':bytes.length,
          'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(bytes);
      } else {
        const value = await runner.get(job[1]); checkpoint(signal); json(value ? 200 : 404, value ?? {error:'Original joint job not found'});
      }
    } catch (error) {
      if (!res.destroyed && !res.headersSent) json([400,404,405,409,413,429,503].includes(error.statusCode) ? error.statusCode : 409,
        {error:error.publicMessage ?? 'Joint request rejected; original evidence retained; no automatic resubmission'});
    } finally {if (item) {item.detach(); active.delete(item); item.resolveDone();}}
    return true;
  }
  return {handle, busy:() => active.size > 0 || runner?.busy() === true,
    async close() {closed = true; for (const item of active) item.controller.abort();
      await runner?.close(); await Promise.allSettled([...active].map(item => item.done));}};
}
