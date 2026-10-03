import {parentPort, workerData} from 'node:worker_threads';
import {readFrozenResponsePreview, readFrozenResponseCandidate} from './world-patch-preview-download.mjs';
try {
  if (!['preview', 'candidate'].includes(workerData.downloadKind)) throw Error('Invalid read-only download kind');
  const read = workerData.downloadKind === 'candidate' ? readFrozenResponseCandidate : readFrozenResponsePreview;
  parentPort.postMessage({ok: true, bytes: await read(workerData)});
}
catch {parentPort.postMessage({ok: false, error: 'Original candidate/source failed read-only preview verification'});}
