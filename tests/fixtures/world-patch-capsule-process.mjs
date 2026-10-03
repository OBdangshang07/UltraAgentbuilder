import fs from 'node:fs/promises';
import path from 'node:path';
import {workerData, parentPort} from 'node:worker_threads';
import {freezeSavedWorldPatchTask} from '../../bridge/world-patch-task-capsule.mjs';

// Test-only crash barrier around real filesystem publication, not a runtime
// fault switch and not a mocked provider. Terminating this worker must leave
// the original unknown claim and partial files without adopting them.
const originalOpen = fs.open;
fs.open = async function (target, ...args) {
  if (path.basename(target) === 'manifest.json' && args[0] === 'wx') {
    parentPort.postMessage({state: 'before-original-commit', capsuleDirectory: path.dirname(target)});
    await new Promise(() => {});
  }
  return originalOpen.call(fs, target, ...args);
};
try { parentPort.postMessage({state: 'unexpectedly-completed', receipt: await freezeSavedWorldPatchTask(workerData)}); }
catch (error) { parentPort.postMessage({state: 'unexpected-error', error: error.message}); }
