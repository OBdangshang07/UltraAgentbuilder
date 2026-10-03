import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash} from '../src/generation/compiler.mjs';
import {copyAssemblyResumeEvidence} from '../bridge/scene-assembly-resume.mjs';

const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const write = async (file, value) => {
  const fd = await fs.open(file, 'wx', 0o600);
  try { await fd.writeFile(JSON.stringify(value, null, 2)); await fd.sync(); } finally { await fd.close(); }
};
const fail = message => { throw new Error('Interruption observation: ' + message); };
const exists = async file => { try { await fs.access(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
function processExists(pid) { try { process.kill(pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; } }
async function endpointResponds(connection, jobId) {
  try { await fetch(`http://127.0.0.1:${connection.port}/v1/jobs/${jobId}`, {headers: {Authorization: 'Bearer ' + connection.token}, signal: AbortSignal.timeout(4000)}); return true; }
  catch (error) { if (!['TypeError', 'TimeoutError', 'AbortError'].includes(error.name)) throw error; return false; }
}
function interruptedJob(job, at) {
  const result = structuredClone(job), last = result.assemblyStages.at(-1);
  Object.assign(last, {state: 'interrupted', invocationOutcome: 'unknown', responseReceived: false, error: 'Observed Bridge process absent; original response unknown; reservation retained'});
  Object.assign(result, {state: 'interrupted', error: 'External observation of process loss; original files preserved; no automatic resubmission', observedInterruptedAt: at});
  return result;
}

// Creates an explicitly derived terminal VIEW. Never repairs or rewrites the source.
// Dependency injection is for free unit tests; CLI always uses real OS/HTTP checks.
export async function snapshotInterruptedAssembly({ledgerFile, destination}, probes = {}) {
  ledgerFile = path.resolve(ledgerFile); destination = path.resolve(destination);
  const parent = await read(ledgerFile), record = parent.results?.[0];
  if (parent.finishedAt || parent.results?.length !== 1 || parent.maximumCalls !== 26 || hash(parent.protocol) !== parent.protocolHash) fail('requires one unfinished 26-call ledger');
  const sourceDirectory = path.resolve(record.assetDirectory), jobFile = path.join(sourceDirectory, 'job.json'), job = await read(jobFile);
  if (job.resumedFrom) fail('ancestral interrupted tasks need their existing provenance-aware recovery');
  const last = job.assemblyStages?.at(-1);
  if (!['generating', 'validating'].includes(job.state) || job.state !== record.state || job.manifest || job.assemblySummary || !last || last.state !== 'reserved' || last.responseReceived || !['component', 'correct-component'].includes(last.phase)) fail('not an unreceived component reservation');
  if (job.id !== record.jobId || job.assemblyCallsReserved !== parent.reservedCalls || record.assemblyCallsReserved !== parent.reservedCalls || job.assemblyStages.length !== parent.reservedCalls || parent.reservedCalls >= 26 || hash(job.assemblyStages) !== hash(record.assemblyStages) || hash(job.generations) !== hash(record.generations)) fail('ledger/job mismatch');
  if (job.generations?.some(g => g.stage === last.index) || await exists(path.join(sourceDirectory, 'assembly', String(last.index), 'response.json'))) fail('response evidence exists; inspect it instead');
  const connection = await read(path.join(path.dirname(ledgerFile), 'data/connection.json'));
  if (!Number.isSafeInteger(connection.pid) || connection.pid <= 0 || !Number.isSafeInteger(connection.port) || connection.port < 1 || connection.port > 65535 || typeof connection.token !== 'string') fail('invalid exact connection identity');
  const alive = probes.processExists ?? processExists, responds = probes.endpointResponds ?? endpointResponds;
  if (await alive(connection.pid)) fail('recorded process still exists; never infer interruption from elapsed time');
  if (await responds(connection, job.id)) fail('exact endpoint responds; do not snapshot a potentially live service');
  const at = new Date().toISOString(), derivedJob = interruptedJob(job, at);
  await fs.mkdir(destination, {recursive: false});
  const jobDirectory = path.join(destination, 'data/jobs', job.id); await fs.mkdir(jobDirectory, {recursive: true});
  const files = await copyAssemblyResumeEvidence({sourceDirectory, job}, jobDirectory);
  const requestFile = path.join(path.dirname(ledgerFile), 'request.json'), requestBytes = await fs.readFile(requestFile);
  await fs.writeFile(path.join(destination, 'request.json'), requestBytes, {flag: 'wx'});
  const proof = {version: 1, type: 'observed-process-loss-derived-view', observedAt: at, originalLedger: ledgerFile, originalLedgerHash: hash(parent), originalJob: jobFile, originalJobHash: hash(job), originalRequestHash: hash(requestBytes), sourceDirectory, jobDirectory, recordedProcessAbsent: true, exactEndpointUnavailable: true, recordedPid: connection.pid, endpointPort: connection.port, interruptedCall: last.index, originalStage: last, files, additionalModelCalls: 0, originalEvidenceModified: false, canAuthorizePlacement: false};
  await write(path.join(destination, 'interruption-observation.json'), proof);
  await write(path.join(jobDirectory, 'job.json'), derivedJob);
  const derived = structuredClone(parent);
  Object.assign(derived, {finishedAt: at, interruptionObservation: proof, completionTimeIsObservation: true});
  Object.assign(derived.results[0], {state: derivedJob.state, error: derivedJob.error, assetDirectory: jobDirectory, assemblyStages: derivedJob.assemblyStages, finishedAt: at});
  await write(path.join(destination, 'ledger.json'), derived);
  if (await alive(connection.pid)) fail('process appeared during copy; derived snapshot must not be used');
  await verifyInterruptionObservation(derived);
  return {ledger: path.join(destination, 'ledger.json'), jobId: job.id, reserved: parent.reservedCalls, remaining: 26 - parent.reservedCalls, additionalModelCalls: 0};
}

export async function verifyInterruptionObservation(ledger) {
  const proof = ledger.interruptionObservation;
  if (!proof) return;
  if (proof.type !== 'observed-process-loss-derived-view' || !proof.recordedProcessAbsent || !proof.exactEndpointUnavailable || proof.additionalModelCalls !== 0 || proof.canAuthorizePlacement !== false) fail('invalid observation proof');
  const original = await read(proof.originalLedger), job = await read(proof.originalJob);
  if (hash(original) !== proof.originalLedgerHash || hash(job) !== proof.originalJobHash || hash(await fs.readFile(path.join(path.dirname(proof.originalLedger), 'request.json'))) !== proof.originalRequestHash) fail('original identity changed');
  const expectedJob = interruptedJob(job, proof.observedAt), actual = await read(path.join(proof.jobDirectory, 'job.json'));
  if (hash(actual) !== hash(expectedJob)) fail('derived job differs beyond observed interruption');
  const expected = structuredClone(original);
  Object.assign(expected, {finishedAt: proof.observedAt, interruptionObservation: proof, completionTimeIsObservation: true});
  Object.assign(expected.results[0], {state: expectedJob.state, error: expectedJob.error, assetDirectory: proof.jobDirectory, assemblyStages: expectedJob.assemblyStages, finishedAt: proof.observedAt});
  if (hash(expected) !== hash(ledger)) fail('derived ledger differs beyond observed interruption');
  for (const file of proof.files) {
    if (!/^(assembly|(?:codex|deepseek|claude)-response-[\w-]+)\/[a-zA-Z0-9_./-]+$/.test(file.path) || file.path.split('/').includes('..')) fail('unsafe evidence path');
    for (const root of [proof.sourceDirectory, proof.jobDirectory]) if (hash(await fs.readFile(path.join(root, file.path))) !== file.sha256) fail('copied evidence changed');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), value = name => { const i = args.indexOf(name); if (i < 0 || !args[i + 1] || args[i + 1].startsWith('--')) fail('missing ' + name); return args[i + 1]; };
  if (!args.includes('--observe-stopped')) fail('requires --observe-stopped --from LEDGER --out NEW_DIRECTORY');
  const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), build = path.join(project, 'build');
  for (const p of [value('--from'), value('--out')]) { const rel = path.relative(build, path.resolve(p)); if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) fail('CLI inputs must be inside project build'); }
  console.log(JSON.stringify(await snapshotInterruptedAssembly({ledgerFile: value('--from'), destination: value('--out')}), null, 2));
}
