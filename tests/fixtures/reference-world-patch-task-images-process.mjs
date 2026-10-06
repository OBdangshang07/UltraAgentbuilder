import fs from 'node:fs/promises';
import path from 'node:path';
import {workerData, parentPort} from 'node:worker_threads';
import {freezeReferenceWorldPatchTaskImages} from '../../bridge/reference-world-patch-task-images.mjs';

// Synthetic-test worker only. Stop before the actual write-once commit marker;
// termination is evidence of an unknown publisher, not a production fault flag.
const open = fs.open;
parentPort.on('message', () => {}); // keep the original worker alive at the barrier
fs.open = async function (file, ...args) {
  if (path.basename(file) === 'manifest.json' && args[0] === 'wx') {
    parentPort.postMessage({state: 'before-original-image-commit', taskDirectory: path.dirname(file)});
    await new Promise(() => {});
  }
  return open(file, ...args);
};
try {parentPort.postMessage({state: 'unexpectedly-completed', manifest: await freezeReferenceWorldPatchTaskImages(workerData)});}
catch (error) {parentPort.postMessage({state: 'unexpected-error', error: error.message});}
