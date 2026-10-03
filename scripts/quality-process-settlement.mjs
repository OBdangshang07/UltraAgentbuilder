import assert from 'node:assert/strict';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const runFile=promisify(execFile);

// Read only OS lifetime metadata. Never terminate a PID, inspect credentials,
// or assume that a different process name alone proves the old process exited.
export async function inspectWindowsProcess(pid){
 assert.ok(Number.isSafeInteger(pid)&&pid>1);
 assert.equal(process.platform,'win32');
 assert.ok(process.env.SystemRoot,'Missing Windows system directory');
 const shell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
 const command="$ErrorActionPreference='Stop'; $lifetimeProcess=Get-CimInstance Win32_Process -Filter 'ProcessId="+pid+"'; if ($null -eq $lifetimeProcess) { 'null' } else { [pscustomobject]@{pid=[int]$lifetimeProcess.ProcessId; name=$lifetimeProcess.Name; createdAt=([DateTimeOffset]$lifetimeProcess.CreationDate).ToUnixTimeMilliseconds()} | ConvertTo-Json -Compress }";
 const {stdout}=await runFile(shell,['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:15000,maxBuffer:65536});
 return JSON.parse(stdout.trim());
}

/** Existing exit receipts remain authoritative; PID reuse is separately proved. */
export async function verifyExitedProcessLifetime(pid,{closedAt,isAlive,inspectProcess=inspectWindowsProcess,platform=process.platform}){
 assert.ok(Number.isSafeInteger(pid)&&pid>1);
 if(!await isAlive(pid))return {pid,state:'not-running'};
 assert.equal(platform,'win32','Live PID without a supported OS lifetime proof');
 const closedMillis=Date.parse(closedAt);
 assert.ok(Number.isSafeInteger(closedMillis)&&closedMillis>0,'Live PID requires a dated, verified original exit receipt');
 const current=await inspectProcess(pid);
 if(current===null){
  assert.equal(await isAlive(pid),false,'Process disappeared from the OS query but is still live');
  return {pid,state:'not-running-after-query'};
 }
 assert.equal(current?.pid,pid,'OS process identity mismatch');
 assert.ok(Number.isSafeInteger(current.createdAt)&&current.createdAt>0,'Missing OS process creation timestamp');
 assert.ok(typeof current.name==='string'&&current.name.length>0&&current.name.length<=128,'Missing OS process name');
 assert.ok(current.createdAt>closedMillis,'Prior exact process lifetime may still be live');
 return {pid,state:'pid-reused',originalExitedAt:closedAt,current:{pid,name:current.name,createdAt:current.createdAt},observedAt:new Date().toISOString()};
}
