import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {exactKeys} from '../contracts/world-selection.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {collectWindowsOwnerQuery} from '../bridge/windows-owner-query.mjs';

// Independent P4 development evidence, not a recovery controller. Issuance
// only creates a NEW owner in an empty directory. Inspection never creates or
// deletes a lock, adopts ownership, calls a model, or grants world writes.
// Retain the issued reference hash independently. A PID-only legacy record
// cannot be upgraded by a later process that happens to reuse the same PID.
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function pid(value) {
  if (!Number.isSafeInteger(value) || value <= 1 || value > 0xffffffff) throw Error('Invalid Windows owner PID');
  return value;
}
function ticks(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/.test(value)) throw Error('Invalid exact Windows UTC instant');
  const whole = Date.parse(value.slice(0, 19) + 'Z');
  if (!Number.isFinite(whole) || new Date(whole).toISOString().slice(0, 19) !== value.slice(0, 19)) throw Error('Invalid exact Windows UTC instant');
  return BigInt(whole) * 10000n + BigInt(value.slice(20, 27));
}
function processFacts(value) {
  exactKeys(value, ['pid', 'startedUtc', 'executablePathHash'], 'Windows process facts');
  pid(value.pid); ticks(value.startedUtc);
  if (!digest(value.executablePathHash)) throw Error('Invalid Windows process executable identity');
  return structuredClone(value);
}
export function validateWindowsOwnerObservation(value) {
  exactKeys(value, ['format', 'version', 'machineHash', 'bootUtc', 'observedUtc', 'queriedPid', 'process'], 'Windows owner observation');
  if (value.format !== 'WindowsOwnerObservation' || value.version !== 1 || !digest(value.machineHash)) throw Error('Invalid Windows owner observation');
  pid(value.queriedPid);
  if (ticks(value.bootUtc) > ticks(value.observedUtc)) throw Error('Windows boot after observation');
  if (value.process !== null) {
    const found = processFacts(value.process);
    if (found.pid !== value.queriedPid || ticks(found.startedUtc) < ticks(value.bootUtc) || ticks(found.startedUtc) > ticks(value.observedUtc)) throw Error('Inconsistent Windows process observation');
  }
  return structuredClone(value);
}
function owner(value) {
  exactKeys(value, ['pid', 'id'], 'original patch owner'); pid(value.pid);
  if (typeof value.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.id)) throw Error('Invalid original patch owner');
  return structuredClone(value);
}
export function validateWorldPatchOwnerReference(value, expectedReferenceHash) {
  if (!digest(expectedReferenceHash) || hash(value) !== expectedReferenceHash) throw Error('Independent original owner reference hash required');
  exactKeys(value, ['format', 'version', 'directory', 'owner', 'ownerFileSha256', 'observation'], 'original patch owner reference');
  if (value.format !== 'WorldPatchOwnerReference' || value.version !== 1 || typeof value.directory !== 'string'
    || !path.isAbsolute(value.directory) || path.resolve(value.directory) !== value.directory || !digest(value.ownerFileSha256)) throw Error('Invalid original patch owner reference');
  const identity = owner(value.owner), observation = validateWindowsOwnerObservation(value.observation);
  if (!observation.process || observation.queriedPid !== identity.pid) throw Error('Original owner must have been observed live');
  return structuredClone(value);
}
export function compareWorldPatchOwnerProcess(referenceValue, expectedReferenceHash, observationValue) {
  const reference = validateWorldPatchOwnerReference(referenceValue, expectedReferenceHash), observed = validateWindowsOwnerObservation(observationValue);
  const original = reference.observation, oldProcess = original.process;
  if (observed.queriedPid !== reference.owner.pid) throw Error('Observation queried another owner PID');
  let state = 'inconclusive', exactOriginalProcessExitedAtObservation = false;
  if (observed.machineHash !== original.machineHash) state = 'different-machine';
  else if (ticks(observed.observedUtc) < ticks(original.observedUtc)) state = 'stale-observation';
  else if (observed.bootUtc !== original.bootUtc) {
    // A different/older boot value is not enough; a later local boot must
    // follow the original LIVE capture. Do not use a lock's age or a timeout.
    if (ticks(observed.bootUtc) > ticks(original.observedUtc)) {
      state = 'system-restarted'; exactOriginalProcessExitedAtObservation = true;
    }
  } else if (observed.process === null) {
    state = 'process-absent'; exactOriginalProcessExitedAtObservation = true;
  } else if (observed.process.startedUtc === oldProcess.startedUtc) {
    state = observed.process.executablePathHash === oldProcess.executablePathHash ? 'same-process' : 'inconsistent-executable';
  } else if (ticks(observed.process.startedUtc) > ticks(oldProcess.startedUtc)) {
    state = 'pid-reused'; exactOriginalProcessExitedAtObservation = true;
  }
  return {format: 'WorldPatchOwnerProcessComparison', version: 1, state, originalReferenceHash: expectedReferenceHash,
    observationHash: hash(observed), exactOriginalProcessExitedAtObservation,
    observationOnly: true, ownershipRecovered: false, ownerLockRemoved: false, canRecoverOwnership: false,
    canDispatch: false, canObserveOriginal: false, canAuthorizePlacement: false, additionalModelCalls: 0, worldWrites: 0};
}

// MachineGuid and executable paths stay inside the local helper; only hashes
// are returned. No command line, environment, account or token is collected.
export async function observeWindowsOwnerProcess(processId) {
  pid(processId);
  if (process.platform !== 'win32') throw Error('Exact Windows owner observation unavailable on this platform');
  const script = `
$ErrorActionPreference = 'Stop'
function Write-VoxelStage([string] $phase) { [Console]::Error.WriteLine('VOXEL_OWNER_STAGE:' + $phase) }
$voxelOwnerPid = ${processId}
function Get-VoxelDigest([string] $value) {
  $voxelDigest = [Security.Cryptography.SHA256]::Create()
  try { return -join ($voxelDigest.ComputeHash([Text.Encoding]::UTF8.GetBytes($value)) | ForEach-Object { $_.ToString('x2') }) }
  finally { $voxelDigest.Dispose() }
}
Write-VoxelStage 'machine'
$voxelMachine = (Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid -ErrorAction Stop).MachineGuid
if ([string]::IsNullOrWhiteSpace($voxelMachine)) { throw 'Missing local machine identity' }
Write-VoxelStage 'boot-before'
$voxelBoot = (Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).LastBootUpTime.ToUniversalTime().ToString('o')
Write-VoxelStage 'process'
$voxelProcesses = @(Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $voxelOwnerPid) -ErrorAction Stop)
if ($voxelProcesses.Count -gt 1) { throw 'Ambiguous process query' }
$voxelFound = $null
if ($voxelProcesses.Count -eq 1) {
  $voxelProcess = $voxelProcesses[0]
  if ([string]::IsNullOrWhiteSpace($voxelProcess.ExecutablePath) -or $null -eq $voxelProcess.CreationDate) { throw 'Incomplete process identity' }
  $voxelFound = @{ pid = [long]$voxelProcess.ProcessId; startedUtc = $voxelProcess.CreationDate.ToUniversalTime().ToString('o'); executablePathHash = (Get-VoxelDigest ([IO.Path]::GetFullPath($voxelProcess.ExecutablePath).ToLowerInvariant())) }
}
Write-VoxelStage 'boot-after'
$voxelBootAfter = (Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).LastBootUpTime.ToUniversalTime().ToString('o')
if ($voxelBoot -cne $voxelBootAfter) { throw 'Boot changed during observation' }
Write-VoxelStage 'serialize'
@{ format = 'WindowsOwnerObservation'; version = 1; machineHash = (Get-VoxelDigest $voxelMachine.Trim().ToLowerInvariant()); bootUtc = $voxelBoot; observedUtc = [DateTime]::UtcNow.ToString('o'); queriedPid = $voxelOwnerPid; process = $voxelFound } | ConvertTo-Json -Compress -Depth 4
`;
  const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe']});
  const output = await collectWindowsOwnerQuery(child);
  let value; try { value = JSON.parse(output.replace(/^\uFEFF/, '')); } catch { throw Error('Invalid exact Windows owner observation; no recovery authorized'); }
  return validateWindowsOwnerObservation(value);
}
async function originalLock(directoryValue) {
  const directory = path.resolve(directoryValue);
  if (await fs.realpath(directory) !== directory || !(await fs.lstat(directory)).isDirectory()) throw Error('Redirected patch owner directory');
  const file = path.join(directory, '_owner.json'), info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4096 || await fs.realpath(file) !== file) throw Error('Invalid original patch owner file');
  const raw = await fs.readFile(file); if (raw.length > 4096) throw Error('Oversized original patch owner file');
  const envelope = JSON.parse(raw.toString('utf8')); exactKeys(envelope, ['value', 'sha256'], 'original patch owner envelope');
  const identity = owner(envelope.value); if (hash(identity) !== envelope.sha256) throw Error('Original patch owner integrity mismatch');
  return {directory, owner: identity, ownerFileSha256: hash(raw)};
}
export async function createWorldPatchOwnerReference({directory: directoryValue}) {
  const directory = path.resolve(directoryValue);
  if (await fs.realpath(directory) !== directory || !(await fs.lstat(directory)).isDirectory()) throw Error('Redirected new owner directory');
  if ((await fs.readdir(directory)).length) throw Error('Only a new empty owner directory may issue a process reference; legacy PID cannot be upgraded');
  const observation = await observeWindowsOwnerProcess(process.pid);
  if (!observation.process || observation.process.executablePathHash !== hash(path.resolve(process.execPath).toLowerCase())) throw Error('Original self process identity could not be verified');
  // We CREATE this owner, rather than trusting a read-back PID that may have
  // been reused. wx defeats concurrent acquisition; an incomplete creation
  // remains evidence, never permission for a subsequent issuance or retry.
  const identity = {pid: process.pid, id: randomUUID()}, file = path.join(directory, '_owner.json');
  const raw = Buffer.from(JSON.stringify({value: identity, sha256: hash(identity)}));
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); }
  const before = {directory, owner: identity, ownerFileSha256: hash(raw)};
  const after = await originalLock(directory);
  if (hash(before) !== hash(after)) throw Error('Original owner changed during capture');
  const reference = {format: 'WorldPatchOwnerReference', version: 1, ...before, observation};
  return {reference, referenceHash: hash(reference), newOwnerLockCreated: true,
    originalRecordsModified: false, additionalModelCalls: 0, worldWrites: 0, canAuthorizePlacement: false};
}
export async function inspectWorldPatchOwnerProcess({directory, reference: referenceValue, expectedReferenceHash}) {
  const reference = validateWorldPatchOwnerReference(referenceValue, expectedReferenceHash), before = await originalLock(directory);
  if (before.directory !== reference.directory || before.ownerFileSha256 !== reference.ownerFileSha256 || hash(before.owner) !== hash(reference.owner)) throw Error('Original owner reference does not bind this unchanged lock');
  const observation = await observeWindowsOwnerProcess(reference.owner.pid), after = await originalLock(directory);
  if (hash(before) !== hash(after)) throw Error('Original owner changed during observation; lock preserved');
  return {...compareWorldPatchOwnerProcess(reference, expectedReferenceHash, observation),
    originalRecordsModified: false, ownerLockPresent: true, ownerLockUnchangedDuringObservation: true};
}
