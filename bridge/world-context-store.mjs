import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Worker} from 'node:worker_threads';
import {WORLD_SELECTION_LIMITS} from '../contracts/world-selection.mjs';
import {PATCH_CAPSULE_ID} from './world-patch-task-capsule.mjs';

const workerFile = fileURLToPath(new URL('./world-context-worker.mjs', import.meta.url));
export const CONTEXT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const CONTEXT_STORE_LIMITS = Object.freeze({records: 8, bytes: 128 * 1024 ** 2, lifetimeMs: 24 * 60 * 60 * 1000,
  queue: 2, operationMs: 60000, inputBytes: WORLD_SELECTION_LIMITS.snapshotBytes});
const failure = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});

/** One bounded worker lane, separate from jobs and all model adapters. Large
 * JSON parse, hashing, LOD and disk verification never run on the HTTP loop. */
export class WorldContextStore {
  constructor({dataDir}) { this.root = path.join(path.resolve(dataDir), 'world-contexts'); this.queue = []; this.active = null; this.closed = false; }
  operation(operation, id, payload, {signal} = {}) {
    if (!(['patch-frozen-task', 'patch-send-input', 'patch-original-input', 'reference-patch-frozen-task'].includes(operation) ? PATCH_CAPSULE_ID : CONTEXT_ID).test(id)) return Promise.reject(failure('Invalid context capture/capsule identity'));
    if (!['capture', 'get', 'discard', 'disclosure', 'task-disclosure', 'analysis-input', 'patch-task-disclosure', 'patch-review-task', 'patch-freeze-task', 'patch-frozen-task', 'patch-send-input', 'patch-original-input', 'reference-patch-task-disclosure', 'reference-patch-review-task', 'reference-patch-freeze-task', 'reference-patch-frozen-task'].includes(operation)) return Promise.reject(failure('Invalid context operation'));
    if (this.closed) return Promise.reject(failure('Context store closed', 503));
    if (signal?.aborted) return Promise.reject(failure('Context operation cancelled', 409));
    if (operation === 'capture' && (!(payload instanceof Uint8Array) || payload.byteLength > CONTEXT_STORE_LIMITS.inputBytes)) return Promise.reject(failure('Context payload byte quota exceeded', 413));
    if (operation === 'disclosure' && (!(payload instanceof Uint8Array) || !payload.byteLength || payload.byteLength > 4096)) return Promise.reject(failure('Context task binding quota exceeded', 413));
    if (['patch-send-input', 'patch-original-input'].includes(operation) && (!(payload instanceof Uint8Array) || !payload.byteLength || payload.byteLength > 4096)) return Promise.reject(failure('Patch SEND byte quota exceeded', 413));
    if (['task-disclosure', 'analysis-input', 'patch-task-disclosure', 'patch-review-task', 'patch-freeze-task', 'reference-patch-task-disclosure', 'reference-patch-review-task', 'reference-patch-freeze-task'].includes(operation) && (!(payload instanceof Uint8Array) || !payload.byteLength || payload.byteLength > 32768)) return Promise.reject(failure('Context task intent quota exceeded', 413));
    if (this.active && this.queue.length >= CONTEXT_STORE_LIMITS.queue) return Promise.reject(failure('Context worker queue full; no model invoked', 429));
    return new Promise((resolve, reject) => {
      const task = {operation, id, payload, resolve, reject, signal, settled: false};
      task.abort = () => this.stop(task, failure('Context operation cancelled', 409));
      signal?.addEventListener('abort', task.abort, {once: true}); this.queue.push(task); this.pump();
    });
  }
  pump() {
    if (this.closed || this.active || !this.queue.length) return;
    const task = this.active = this.queue.shift();
    try { task.worker = new Worker(workerFile, {workerData: {root: this.root, operation: task.operation, id: task.id,
      payload: task.payload, limits: CONTEXT_STORE_LIMITS}, resourceLimits: {maxOldGenerationSizeMb: 512, stackSizeMb: 4}}); }
    catch (error) { this.finish(task, error); return; }
    task.timer = setTimeout(() => this.stop(task, failure('Context worker time quota exceeded', 503)), CONTEXT_STORE_LIMITS.operationMs);
    task.worker.once('message', message => this.finish(task, message.ok ? null : failure(message.error, message.statusCode), message.result));
    task.worker.once('error', error => this.finish(task, error));
    task.worker.once('exit', code => { if (!task.settled) this.finish(task, failure(`Context worker exited ${code}`, 503)); });
  }
  finish(task, error, result) {
    if (task.settled) return; task.settled = true; clearTimeout(task.timer); task.signal?.removeEventListener('abort', task.abort);
    this.queue = this.queue.filter(item => item !== task);
    const terminated = task.worker ? task.worker.terminate() : Promise.resolve();
    // Do not let the next writer race with a worker being terminated.
    if (this.active === task) terminated.finally(() => { if (this.active === task) this.active = null; this.pump(); });
    error ? task.reject(error) : task.resolve(result);
  }
  stop(task, error) { this.finish(task, error); }
  async cancel(id) {
    if (!CONTEXT_ID.test(id)) throw failure('Invalid context capture identity');
    const tasks = [...this.queue, ...(this.active ? [this.active] : [])].filter(task => task.id === id);
    for (const task of tasks) this.stop(task, failure('Context operation explicitly cancelled', 409));
    await Promise.allSettled(tasks.map(task => task.worker?.terminate()));
    return {id, cancelledOperations: tasks.length, publishedRecordMayExist: true, modelSent: false, canAuthorizePlacement: false};
  }
  async close() { this.closed = true; const tasks = [...this.queue, ...(this.active ? [this.active] : [])];
    for (const task of tasks) this.stop(task, failure('Context store closed', 503));
    await Promise.allSettled(tasks.map(task => task.worker?.terminate())); }
}
