import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {hash} from '../src/generation/compiler.mjs';
import {readQualityCrashRetirement} from './quality-crash-retirement.mjs';
import {readExitedQualityRetirement} from './quality-runner-retirement.mjs';
import {verifyExitedProcessLifetime} from './quality-process-settlement.mjs';

export const QUALITY_GOAL_AUTHORIZATION='2026-09-28 / 用户：授权在目标达成前的所有调用';
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const processAlive=pid=>{assert.ok(Number.isSafeInteger(pid)&&pid>1);try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
async function absent(file){try{await fs.access(file);throw Error('Prior live connection still exists: '+file);}catch(error){if(error.code!=='ENOENT')throw error;}}

/** Closure is not a rendering pass. Failed/unverified sessions remain so. */
export async function verifyClosedRecoveredRenderer(ledger,file,{isAlive=processAlive,inspectProcess,platform}={}){
 const renderer=ledger.renderer,root=path.dirname(path.resolve(file)),build=path.dirname(root);
 assert.equal(renderer?.mode,'on-demand-native');assert.equal(renderer.result,'recovered');assert.equal(renderer.active,false);
 assert.equal(renderer.activeRoot,null);assert.equal(renderer.blocked,null);assert.equal(renderer.maxRecoveries,1);
 assert.equal(renderer.failures?.length,1);assert.equal(renderer.nativeClientExitVerified,true);assert.equal(renderer.launcherExited,true);
 assert.ok(Number.isSafeInteger(renderer.starts)&&renderer.starts>0&&renderer.starts<=renderer.maxStarts&&renderer.maxStarts<=27);
 assert.equal(renderer.sessions?.length,renderer.starts);assert.equal(ledger.cleanupCompleted,true);
 for(const key of ['rendererStopped','bridgeClosed','jobObserved'])assert.equal(ledger.cleanup?.[key],true);
 const proofs=[],processSettlements=[];
 for(const session of renderer.sessions){
  assert.equal(session.launcherExited,true);assert.equal(session.nativeClientExitVerified,true);assert.equal(session.logClosed,true);
  assert.ok(Number.isSafeInteger(session.exitCode));assert.ok(['passed','failed'].includes(session.result));
  const child=path.resolve(session.root);assert.equal(path.dirname(child),build);assert.match(path.basename(child),/^quality-native-[a-f0-9]{32}$/);
  assert.notEqual(child,root);assert.equal(await fs.realpath(child),child);
  const files=['renderer-owner.json','renderer-authorization.json','renderer-process.json','renderer-exit.json'];
  const values=[];
  for(const name of files){const absolute=path.join(child,name),stat=await fs.lstat(absolute);assert.ok(stat.isFile()&&!stat.isSymbolicLink());const raw=await fs.readFile(absolute);proofs.push({file:absolute,sha256:hash(raw)});values.push(JSON.parse(raw));}
  const [owner,authorization,identity,outcome]=values;
  assert.equal(path.resolve(owner.ownerRoot),root);assert.equal(owner.additionalModelCalls,0);
  assert.equal(authorization.assetOnly,true);assert.equal(authorization.visibleWindowAuthorized,true);
  assert.equal(identity.instanceId,authorization.instanceId);assert.ok(Number.isSafeInteger(identity.startedAt)&&identity.startedAt>0);
  assert.equal(hash(identity),hash(session.processIdentity));assert.equal(hash(outcome),hash(session));
  for(const pid of [identity.pid,session.launcherPid])processSettlements.push(await verifyExitedProcessLifetime(pid,{closedAt:outcome.observedAt,isAlive,inspectProcess,platform}));
  await absent(path.join(child,'data/connection.json'));
 }
 assert.ok(renderer.sessions.some(s=>s.result==='failed'),'Recovered outcome must retain its actual failure');
 assert.ok(renderer.sessions.some(s=>hash(s)===hash(renderer.failures[0].outcome)),'Missing original renderer failure outcome');
 return {rendererResult:'recovered',allChildProcessesExited:true,proofs,processSettlements,renderingPassed:false,worldLoadedVerified:false};
}

export async function settledQualityAttempt(file,{currentLease,isAlive=processAlive,inspectProcess,platform}={}){
 const ledger=await read(file),record=ledger.results?.[0];
 assert.equal(ledger.results?.length,1);assert.equal(hash(ledger.protocol),ledger.protocolHash);
 assert.ok(ledger.reservedCalls<=26&&ledger.maximumCalls===26,'Per-task budget remains 26');
 const terminal=ledger.finishedAt&&['preview-ready','failed','cancelled','interrupted'].includes(record.state);
 const noDispatch=ledger.cleanupCompleted&&record.state==='allocated'&&!record.startedAt&&!record.jobId&&ledger.reservedCalls===0;
 if(!terminal&&!noDispatch){
  // This explicit, forensic-backed abandonment is separate from a successful
  // terminal ledger. It cannot recover the old key/turn or erase its unknown call.
  const disposition=await read(path.join(path.dirname(file),'failure-retirement.json')).catch(()=>null);
  try{return disposition?.type==='abandoned-engineering-runner-exit'?await readExitedQualityRetirement(file,{currentLease}):await readQualityCrashRetirement(file);}catch(error){throw new Error('Prior outcome is unknown; never replace or resend: '+error.message);}
 }
 let rendererSettlement=null;
 if(!noDispatch){
  if(ledger.renderer?.result==='recovered')rendererSettlement=await verifyClosedRecoveredRenderer(ledger,file,{isAlive,inspectProcess,platform});
  else{assert.equal(ledger.renderer?.result,'passed');assert.equal(ledger.renderer?.worldLoaded,false);}
 }
 try{await fs.access(path.join(record.dataDirectory,'connection.json'));throw Error('Prior Bridge connection still exists');}catch(e){if(e.code!=='ENOENT')throw e;}
 return {file:path.resolve(file),sha256:hash(await fs.readFile(file)),state:record.state,reservedCalls:ledger.reservedCalls,receipts:record.generations?.length??0,
  ...(rendererSettlement?{rendererSettlement}: {})};
}

// A persistent, exclusive lease prevents overlapping/unknown paid attempts.
// Crashes retain it for evidence-based reconciliation; no timeout or PID guess.
export async function claimQualityGoal({directory,attempt,root,key,protocolHash,priorLedger}){
 assert.match(attempt,/^[a-z0-9][a-z0-9-]{0,47}$/);
 await fs.mkdir(directory,{recursive:true});
 const active=path.join(directory,'active.json'),claimFile=path.join(directory,attempt+'.json');
 const owner={attempt,root,key,protocolHash,pid:process.pid,authorization:QUALITY_GOAL_AUTHORIZATION,maximumCalls:26,claimedAt:new Date().toISOString()};
 await fs.writeFile(active,JSON.stringify(owner,null,2),{flag:'wx'});
 let claimed=false;
 try{
  const currentLease={file:active,owner};
  const history=[await settledQualityAttempt(priorLedger,{currentLease})];
  for(const name of (await fs.readdir(directory)).filter(n=>n.endsWith('.json')&&n!=='active.json')){
   const prior=await read(path.join(directory,name));history.push(await settledQualityAttempt(path.join(prior.root,'ledger.json'),{currentLease}));
  }
  assert.equal(hash(await read(active)),hash(owner),'Lease ownership changed during prior audit');
  await fs.writeFile(claimFile,JSON.stringify({...owner,history},null,2),{flag:'wx'});claimed=true;
  return {claimFile,history,async release(){
   await settledQualityAttempt(path.join(root,'ledger.json'));
   assert.equal(hash(await read(active)),hash(owner),'Lease owner changed');await fs.unlink(active);
  }};
 }finally{if(!claimed){assert.equal(hash(await read(active)),hash(owner));await fs.unlink(active);}}
}
