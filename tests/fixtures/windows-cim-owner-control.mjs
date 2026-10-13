import path from 'node:path';
import {spawn} from 'node:child_process';
import {collectWindowsOwnerQuery} from '../../bridge/windows-owner-query.mjs';
import {validateWindowsOwnerObservation} from '../../bridge/world-patch-owner-observation.mjs';

// Read-only independent LEGACY control for compatibility tests, never called
// by production. One real CIM query, with a 60s fixture-only allowance because
// the old provider can exceed 30s on a loaded Windows machine. No retries,
// synthetic process facts, owner adoption, models or world authority.
export async function observeCimOwnerControl(processId){
  if(!Number.isSafeInteger(processId)||processId<=1||processId>0xffffffff)throw Error('Exact control PID required');
  const script=`
$ErrorActionPreference='Stop'
function Write-VoxelStage([string] $phase) { [Console]::Error.WriteLine('VOXEL_OWNER_STAGE:'+$phase) }
function Get-VoxelDigest([string] $value) {
  $voxelDigest=[Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($voxelDigest.ComputeHash([Text.Encoding]::UTF8.GetBytes($value))).Replace('-','').ToLowerInvariant() }
  finally { $voxelDigest.Dispose() }
}
$voxelControlPid=${processId}
Write-VoxelStage 'machine'
$voxelMachine=(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid -ErrorAction Stop).MachineGuid
if([string]::IsNullOrWhiteSpace($voxelMachine)){throw 'Missing machine identity'}
Write-VoxelStage 'boot-before'
$voxelBoot=(Get-CimInstance Win32_OperatingSystem -Property LastBootUpTime -ErrorAction Stop).LastBootUpTime.ToUniversalTime().ToString('o')
Write-VoxelStage 'process'
$voxelProcesses=@(Get-CimInstance Win32_Process -Property ProcessId,CreationDate,ExecutablePath -Filter ('ProcessId = '+$voxelControlPid) -ErrorAction Stop)
if($voxelProcesses.Count-ne 1){throw 'One actual live control process required'}
$voxelProcess=$voxelProcesses[0]
if([string]::IsNullOrWhiteSpace($voxelProcess.ExecutablePath)-or$null-eq$voxelProcess.CreationDate){throw 'Incomplete control identity'}
$voxelStarted=$voxelProcess.CreationDate.ToUniversalTime().ToString('o')
$voxelPathHash=Get-VoxelDigest ([IO.Path]::GetFullPath($voxelProcess.ExecutablePath).ToLowerInvariant())
Write-VoxelStage 'boot-after'
$voxelBootAfter=(Get-CimInstance Win32_OperatingSystem -Property LastBootUpTime -ErrorAction Stop).LastBootUpTime.ToUniversalTime().ToString('o')
if($voxelBoot-cne$voxelBootAfter){throw 'Boot changed during control'}
Write-VoxelStage 'serialize'
@{format='WindowsOwnerObservation';version=1;machineHash=(Get-VoxelDigest $voxelMachine.Trim().ToLowerInvariant());bootUtc=$voxelBoot;observedUtc=[DateTime]::UtcNow.ToString('o');queriedPid=$voxelControlPid;process=@{pid=[long]$voxelProcess.ProcessId;startedUtc=$voxelStarted;executablePathHash=$voxelPathHash}}|ConvertTo-Json -Compress -Depth 4
`;
  const child=spawn(path.join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
  const output=await collectWindowsOwnerQuery(child,{setTimer:callback=>setTimeout(callback,60000)});
  return validateWindowsOwnerObservation(JSON.parse(output.replace(/^\uFEFF/,'')));
}
