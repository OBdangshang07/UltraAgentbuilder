import fs from 'node:fs/promises';
import path from 'node:path';
import {WorldContextStore} from '../../bridge/world-context-store.mjs';
import {createReferenceWorldPatchJobRegistry} from '../../bridge/reference-world-patch-job-registry.mjs';

// Labelled synthetic fault fixture. No production hooks, providers or worlds.
// Hold the actual write-once request commit with the original publisher live.
// The actual child process, not a same-PID worker, retains its IPC handle.
process.on('message', () => {});
const originalOpen = fs.open;
fs.open = async function (file, ...args) {
  if (path.basename(file) === 'request.json' && path.basename(path.dirname(path.dirname(file))) === 'reference-world-patch-design' && args[0] === 'wx') {
    process.send({state: 'before-original-request-commit'});
    await new Promise(() => {});
  }
  return originalOpen.call(fs, file, ...args);
};
process.once('message', async value => {
  try {
    const contexts = new WorldContextStore({dataDir: value.dataDir});
    const registry = await createReferenceWorldPatchJobRegistry({dataDir: value.dataDir, contexts});
    process.send({state: 'unexpected-completion', receipt: await registry.reserve(value.request)});
  } catch (error) {process.send({state: 'unexpected-error', message: error.message});}
});
