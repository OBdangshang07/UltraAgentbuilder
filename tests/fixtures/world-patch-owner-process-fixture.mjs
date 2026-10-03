import fs from 'node:fs/promises';
import path from 'node:path';
import {createWorldPatchOwnerReference} from '../../scripts/world-patch-owner-observation.mjs';

// A NEW free metadata-only fixture. Deliberately leaves its own lock after
// exact normal exit to exercise observation; never creates a model or world.
const directory = path.resolve(process.argv[2]);
if (!process.send || await fs.realpath(directory) !== directory || (await fs.readdir(directory)).length) throw Error('Expected empty physical IPC test fixture');
process.on('message', message => { if (message === 'close-owned-test-fixture') process.exit(0); });
process.once('disconnect', () => process.exit(1));
setTimeout(() => process.exit(2), 45000).unref();
try { process.send({result: 'passed', ...(await createWorldPatchOwnerReference({directory}))}); }
catch { process.send({result: 'failed'}); process.exitCode = 1; process.disconnect(); }
