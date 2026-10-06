import fs from 'node:fs/promises';
import path from 'node:path';
import {workerData, parentPort} from 'node:worker_threads';
import {freezeReferenceWorldPatchTask} from '../../bridge/reference-world-patch-task-capsule.mjs';

// Synthetic-test worker only: stop at the actual write-once commit marker.
// Termination preserves original partial files/claim; production has no fault
// switch, injected model, clock override or adoption of unknown publishers.
const originalOpen = fs.open;
// A pending Promise alone does not keep a worker alive. Keep this fixture port
// referenced so the test proves explicit termination of a LIVE publisher.
parentPort.on('message', () => {});
fs.open = async function (target, ...args) {
  if (path.basename(target) === 'manifest.json' && args[0] === 'wx') {
    parentPort.postMessage({state: 'before-original-commit', capsuleDirectory: path.dirname(target)});
    await new Promise(() => {});
  }
  return originalOpen.call(fs, target, ...args);
};
try {parentPort.postMessage({state: 'unexpectedly-completed', receipt: await freezeReferenceWorldPatchTask(workerData)});}
catch (error) {parentPort.postMessage({state: 'unexpected-error', error: error.message});}
