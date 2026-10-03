import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {hash} from '../src/generation/compiler.mjs';

const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
function alive(pid){assert.ok(Number.isSafeInteger(pid)&&pid>0);try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}}
const AUTHORISED='2026-09-28 / 用户：授权在目标达成前的所有调用';

// Forensic engineering disposition, NOT a model terminal receipt. Retain every
// original byte, reservation and unknown outcome. Never restart the old key.
async function verify(incidentFile,{isAlive=alive,archived=false}={}){
 const incident=await read(incidentFile);
 assert.equal(incident.type,'engineering-diagnostic-induced-runner-exit');
 assert.equal(incident.runnerExitCode,1);assert.equal(incident.runnerFailure,'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING during diagnostic inspector evaluation');
 assert.equal(incident.unknownOutcomeResolved,false);assert.equal(incident.originalInvocationMayResubmit,false);
 assert.equal(incident.additionalModelCalls,0);assert.equal(incident.worldModified,false);
 const ledgerFile=path.resolve(incident.originalLedger),root=path.dirname(ledgerFile),ledger=await read(ledgerFile),record=ledger.results?.[0];
 assert.equal(ledger.type,'authorized-goal-quality-v4');assert.equal(ledger.results.length,1);
 assert.equal(hash(ledger.protocol),ledger.protocolHash);assert.equal(ledger.maximumCalls,26);
 assert.equal(record.state,'generating');assert.equal(record.jobId,incident.originalJobId);
 assert.equal(record.assemblyCallsReserved,1);assert.equal(ledger.reservedCalls,1);
 assert.equal(record.generations.length,0);assert.equal(incident.originalInvocationReserved,1);assert.equal(incident.completedReceipts,0);
 assert.equal(path.resolve(record.dataDirectory),path.join(root,'data'));
 const jobFile=path.join(record.assetDirectory,'job.json'),job=await read(jobFile);
 assert.equal(path.resolve(record.assetDirectory),path.join(record.dataDirectory,'jobs',record.jobId));
 assert.equal(job.id,record.jobId);assert.equal(job.key,record.key);assert.equal(job.state,'generating');
 assert.equal(job.assemblyCallsReserved,1);assert.ok(!job.assetHash&&!job.manifest&&!job.generations?.length);
 const callFile=path.join(record.assetDirectory,'assembly-journal/call-1.json'),call=await read(callFile);
 assert.equal(hash(call.value),call.sha256);assert.equal(call.value.state,'pending');assert.equal(call.value.index,1);
 assert.equal(await isAlive(incident.runnerPid),false,'Original runner remains active');
 assert.equal(await isAlive(incident.codexChildPid),false,'Original Codex child remains active');
 assert.equal(ledger.rendererProgress.active,false);
 assert.ok(ledger.rendererProgress.sessions.length>0&&ledger.rendererProgress.sessions.every(s=>s.nativeClientExitVerified&&s.launcherExited&&s.logClosed&&s.worldLoaded===false));
 const logFile=path.resolve(incident.runnerLog),log=await fs.readFile(logFile,'utf8');
 assert.equal(path.dirname(logFile),path.resolve(root,'..'));assert.match(log,/Debugger attached/);assert.match(log,/ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING/);
 const project=path.resolve(root,'../..'),active=path.join(project,'build/quality-goal-authorizations/active.json'),archive=path.join(root,'orphaned-runner');
 const inputs=[ledgerFile,jobFile,callFile,logFile,incidentFile];
 const targets=[
  {source:active,destination:path.join(archive,'lease.json')},
  {source:path.join(record.dataDirectory,'connection.json'),destination:path.join(archive,'connection.json')},
  {source:path.join(record.dataDirectory,'bridge.lock'),destination:path.join(archive,'bridge.lock')},
 ];
 const actual=target=>archived?target.destination:target.source;
 const owner=await read(actual(targets[0]));
 assert.equal(owner.root,root);assert.equal(owner.key,record.key);assert.equal(owner.protocolHash,ledger.protocolHash);assert.equal(owner.pid,incident.runnerPid);
 const lock=await read(actual(targets[2]));assert.equal(lock.pid,incident.runnerPid);
 const connection=await read(actual(targets[1]));assert.ok(Number.isSafeInteger(connection.port)&&connection.port>0&&connection.port<65536);
 // A reused port owned by another process is still a stop condition. No token
// is sent, and no request is made to an unknown service.
 try{const r=await fetch('http://127.0.0.1:'+connection.port+'/v1/health',{signal:AbortSignal.timeout(500)});if(r)throw Error('Original Bridge port is still responding');}
 catch(e){if(e.name!=='TypeError')throw e;}
 for(const file of [...inputs,...targets.map(actual)]){
  const stat=await fs.lstat(file);assert.equal(stat.isFile(),true);assert.equal(stat.isSymbolicLink(),false);
 }
 return {incident,ledger,record,root,archive,inputs,targets,owner};
}

export async function retireExitedQualityRunner({incidentFile,authorization,isAlive=alive}){
 assert.equal(authorization,AUTHORISED);incidentFile=path.resolve(incidentFile);
 const checked=await verify(incidentFile,{isAlive});
 const files=[];for(const file of checked.inputs)files.push({file,sha256:hash(await fs.readFile(file))});
 const moves=[];for(const t of checked.targets)moves.push({...t,sha256:hash(await fs.readFile(t.source))});
 const root=checked.root,reportFile=path.join(root,'runner-exit-forensics.json'),dispositionFile=path.join(root,'failure-retirement.json');
 for(const file of [reportFile,dispositionFile,checked.archive])try{await fs.access(file);throw Error('Incident already reconciled or archive occupied');}catch(e){if(e.code!=='ENOENT')throw e;}
 const report={type:'orphaned-quality-runner-forensics',version:1,observedAt:new Date().toISOString(),incidentFile,files,moves,
  originalLedger:path.join(root,'ledger.json'),originalJobId:checked.record.jobId,
  originalLedgerState:'generating',runnerExitVerified:true,providerTerminalVerified:false,
  reservedCalls:1,completedReplies:0,unknownOutcomeResolved:false,additionalModelCalls:0,canAuthorizePlacement:false};
 await fs.writeFile(reportFile,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
 await fs.mkdir(checked.archive,{mode:0o700});assert.equal(await fs.realpath(checked.archive),checked.archive);
 for(const t of moves){assert.equal(hash(await fs.readFile(t.source)),t.sha256);await fs.rename(t.source,t.destination);}
 const disposition={type:'abandoned-engineering-runner-exit',version:1,authorization,
  ledger:report.originalLedger,ledgerSha256:files[0].sha256,reportFile,reportSha256:hash(await fs.readFile(reportFile)),
  incidentFile,jobId:checked.record.jobId,key:checked.record.key,attempt:checked.ledger.protocol.attempt,
  reservedCalls:1,completedReplies:0,unknownCallRetained:1,unknownOutcomeResolved:false,providerTerminalVerified:false,
  providerThreadId:checked.incident.providerThreadId,providerTurnId:checked.incident.providerTurnId,
  oldTaskMayResume:false,oldInvocationMayResubmit:false,budgetReset:false,canAuthorizePlacement:false,
  additionalModelCalls:0,state:'failed-abandoned',newIndependentTestsAuthorized:true};
 await fs.writeFile(dispositionFile,JSON.stringify(disposition,null,2),{flag:'wx',mode:0o600});
 return {dispositionFile,reservedCalls:1,completedReplies:0,unknownOutcomeResolved:false,additionalModelCalls:0};
}

export async function readExitedQualityRetirement(ledgerFile,{isAlive=alive,currentLease}={}){
 ledgerFile=path.resolve(ledgerFile);const dispositionFile=path.join(path.dirname(ledgerFile),'failure-retirement.json'),d=await read(dispositionFile);
 assert.equal(d.type,'abandoned-engineering-runner-exit');assert.equal(d.authorization,AUTHORISED);assert.equal(d.ledger,ledgerFile);
 assert.equal(d.ledgerSha256,hash(await fs.readFile(ledgerFile)));assert.equal(d.reportSha256,hash(await fs.readFile(d.reportFile)));
 const report=await read(d.reportFile);assert.equal(report.type,'orphaned-quality-runner-forensics');
 for(const input of report.files)assert.equal(hash(await fs.readFile(input.file)),input.sha256);
 for(const t of report.moves){
  assert.equal(hash(await fs.readFile(t.destination)),t.sha256);
  try{
   await fs.access(t.source);
   // The claimant atomically owns a NEW exclusive lease before auditing old
   // attempts. Only that precise lease may exist; old Bridge files never may.
   const active=path.join(path.resolve(path.dirname(ledgerFile),'../..'),'build/quality-goal-authorizations/active.json');
   if(!currentLease||t.source!==active||path.resolve(currentLease.file)!==active)throw Error('Stale live identity reappeared');
   const stat=await fs.lstat(active);assert.ok(stat.isFile()&&!stat.isSymbolicLink());
   const owner=await read(active);assert.equal(hash(owner),hash(currentLease.owner),'Current lease ownership changed');
   assert.equal(owner.pid,process.pid);assert.equal(owner.authorization,AUTHORISED);assert.equal(owner.maximumCalls,26);
   assert.notEqual(owner.root,path.dirname(ledgerFile));assert.notEqual(owner.key,d.key);assert.notEqual(owner.attempt,d.attempt);
  }catch(e){if(e.code!=='ENOENT')throw e;}
 }
 const checked=await verify(d.incidentFile,{isAlive,archived:true});assert.equal(checked.record.key,d.key);assert.equal(checked.record.jobId,d.jobId);
 assert.equal(report.originalLedger,ledgerFile);assert.equal(report.originalJobId,d.jobId);
 assert.deepEqual(report.files.map(f=>f.file),checked.inputs);assert.deepEqual(report.moves.map(({sha256,...t})=>t),checked.targets);
 assert.equal(d.newIndependentTestsAuthorized,true);
 for(const field of ['unknownOutcomeResolved','providerTerminalVerified','oldTaskMayResume','oldInvocationMayResubmit','budgetReset','canAuthorizePlacement'])assert.equal(d[field],false);
 assert.equal(d.reservedCalls,1);assert.equal(d.completedReplies,0);assert.equal(d.unknownCallRetained,1);assert.equal(d.additionalModelCalls,0);assert.equal(d.state,'failed-abandoned');
 return {file:ledgerFile,sha256:d.ledgerSha256,state:d.state,reservedCalls:1,receipts:0,disposition:dispositionFile,
  dispositionSha256:hash(await fs.readFile(dispositionFile)),unknownOutcomeResolved:false,oldInvocationMayResubmit:false};
}
