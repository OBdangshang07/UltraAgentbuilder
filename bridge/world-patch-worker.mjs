import {parentPort, workerData} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {exactKeys} from '../contracts/world-selection.mjs';
import {WORLD_PATCH_LIMITS} from '../contracts/world-patch.mjs';
import {compileWorldPatch, checkWorldPatchBaseline} from '../src/world/world-patch.mjs';

// CPU-only. No files, accounts, HTTP, adapters, world access or write API.
try {
  const started = performance.now(), heapUsedBefore = process.memoryUsage().heapUsed;
  const {operation, payload} = workerData;
  const inputSha256 = createHash('sha256').update(payload).digest('hex');
  const text = new TextDecoder('utf-8', {fatal: true}).decode(payload), input = JSON.parse(text);
  let result;
  if (operation === 'compile') {
    exactKeys(input, ['snapshot', 'proposal'], 'patch worker compile');
    result = compileWorldPatch(input.snapshot, input.proposal);
  } else if (operation === 'check') {
    exactKeys(input, ['snapshot', 'patch', 'currentSnapshot'], 'patch worker baseline check');
    result = checkWorldPatchBaseline(input.snapshot, input.patch, input.currentSnapshot);
  } else throw new Error('Unsupported patch worker operation');
  const bytes = new TextEncoder().encode(JSON.stringify(result));
  if (bytes.byteLength > WORLD_PATCH_LIMITS.bytes) throw new Error('Patch worker output byte quota exceeded');
  parentPort.postMessage({ok: true, payload: bytes, inputSha256, operation,
    patchHash: result.patchHash, result: operation === 'check' ? result.result : 'compiled', canAuthorizePlacement: false,
    measurements: {processingMs: performance.now() - started, heapUsedBefore, heapUsedAfter: process.memoryUsage().heapUsed,
      heapMeasurement: 'samples-not-peak'}}, [bytes.buffer]);
} catch (error) {
  parentPort.postMessage({ok: false, error: error.message});
}
