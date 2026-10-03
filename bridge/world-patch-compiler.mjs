import {Worker} from 'node:worker_threads';
import {WORLD_PATCH_LIMITS} from '../contracts/world-patch.mjs';

export const WORLD_PATCH_WORKER_LIMITS = Object.freeze({queue: 2, operationMs: 60000, heapMb: 512,
  compileInputBytes: 2 * WORLD_PATCH_LIMITS.bytes + 4096,
  checkInputBytes: 3 * WORLD_PATCH_LIMITS.bytes + 4096});
const failure = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});

/** One bounded CPU lane. Parse, normalize, hash and diff inside a worker.
 * Accept/return raw UTF8 bytes so the HTTP/UI thread needn't parse large JSON.
 * One bounded owned byte copy is necessary at submission; no caller buffers
 * are detached or reused after dispatch. No models, persistence or placement. */
export class WorldPatchCompiler {
  constructor() { this.queue = []; this.active = null; this.closed = false; this.stopping = new Set(); }
  operation(operation, payload, {signal} = {}) {
    if (!['compile', 'check'].includes(operation)) return Promise.reject(failure('Invalid patch compiler operation'));
    if (this.closed) return Promise.reject(failure('Patch compiler closed', 503));
    if (signal?.aborted) return Promise.reject(failure('Patch calculation cancelled', 409));
    const maximum = operation === 'compile' ? WORLD_PATCH_WORKER_LIMITS.compileInputBytes : WORLD_PATCH_WORKER_LIMITS.checkInputBytes;
    if (!(payload instanceof Uint8Array) || !payload.byteLength || payload.byteLength > maximum) return Promise.reject(failure('Patch compiler input byte quota exceeded', 413));
    if (this.active && this.queue.length >= WORLD_PATCH_WORKER_LIMITS.queue) return Promise.reject(failure('Patch compiler queue full; no model invoked', 429));
    return new Promise((resolve, reject) => {
      const task = {operation, payload: new Uint8Array(payload), signal, resolve, reject, settled: false};
      task.abort = () => this.finish(task, failure('Patch calculation cancelled', 409));
      signal?.addEventListener('abort', task.abort, {once: true});
      this.queue.push(task); this.pump();
    });
  }
  pump() {
    if (this.closed || this.active || !this.queue.length) return;
    const task = this.active = this.queue.shift();
    try {
      task.worker = new Worker(new URL('./world-patch-worker.mjs', import.meta.url), {
        workerData: {operation: task.operation, payload: task.payload}, transferList: [task.payload.buffer],
        resourceLimits: {maxOldGenerationSizeMb: WORLD_PATCH_WORKER_LIMITS.heapMb, stackSizeMb: 4},
      });
    } catch (error) { this.finish(task, error); return; }
    task.timer = setTimeout(() => this.finish(task, failure('Patch calculation time quota exceeded', 503)), WORLD_PATCH_WORKER_LIMITS.operationMs);
    task.worker.once('message', message => {
      if (!message?.ok) { this.finish(task, failure(message?.error ?? 'Invalid patch worker receipt')); return; }
      if (!(message.payload instanceof Uint8Array) || message.payload.byteLength > WORLD_PATCH_LIMITS.bytes
          || message.operation !== task.operation || !/^[a-f0-9]{64}$/.test(message.inputSha256)
          || !/^[a-f0-9]{64}$/.test(message.patchHash) || message.canAuthorizePlacement !== false) {
        this.finish(task, failure('Invalid patch worker output')); return;
      }
      this.finish(task, null, {payload: message.payload, inputSha256: message.inputSha256, patchHash: message.patchHash,
        operation: task.operation, result: message.result, measurements: message.measurements,
        additionalModelCalls: 0, worldWrites: 0, canAuthorizePlacement: false});
    });
    task.worker.once('error', error => this.finish(task, error));
    task.worker.once('exit', code => { if (!task.settled) this.finish(task, failure('Patch worker exited without receipt: ' + code, 503)); });
  }
  finish(task, error, result) {
    if (task.settled) return; task.settled = true;
    clearTimeout(task.timer); task.signal?.removeEventListener('abort', task.abort);
    this.queue = this.queue.filter(item => item !== task);
    const stopped = task.worker ? task.worker.terminate() : Promise.resolve();
    this.stopping.add(stopped);
    stopped.then(() => error ? task.reject(error) : task.resolve(result), stopError => task.reject(error ?? stopError)).finally(() => {
      this.stopping.delete(stopped);
      if (this.active === task) this.active = null;
      this.pump();
    });
  }
  async close() {
    this.closed = true;
    for (const task of [...this.queue, ...(this.active ? [this.active] : [])]) this.finish(task, failure('Patch compiler closed', 503));
    await Promise.allSettled([...this.stopping]);
  }
}
