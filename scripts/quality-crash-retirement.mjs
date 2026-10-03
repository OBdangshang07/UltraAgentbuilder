import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {hash} from '../src/generation/compiler.mjs';

const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
export const CRASH_RETIREMENT_AUTHORIZATION='2026-09-28 / 用户：授权在目标达成前的所有调用';
function alive(pid){assert.ok(Number.isSafeInteger(pid)&&pid>0);try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}}
async function absent(file){try{await fs.access(file);throw Error('Live Bridge connection still exists');}catch(error){if(error.code!=='ENOENT')throw error;}}

async function evidence(reportFile,{activePath,archivePath,isAlive=alive,archived=false}){
 const report=await read(reportFile);assert.equal(report.type,'native-renderer-crash-forensics');
 assert.equal(report.unknownOutcomeResolved,false);assert.equal(report.additionalModelCalls,0);assert.equal(report.canAuthorizePlacement,false);
 const ledger=await read(report.originalLedger),record=ledger.results?.[0],root=path.dirname(report.originalLedger);
 assert.equal(ledger.results.length,1);assert.equal(hash(ledger.protocol),ledger.protocolHash);
 const jobFile=path.join(record.assetDirectory,'job.json'),job=await read(jobFile);
 assert.equal(job.id,report.jobId);assert.equal(job.state,'interrupted');assert.equal(record.jobId,job.id);
 assert.equal(report.reservedCalls,ledger.reservedCalls);assert.equal(job.assemblyCallsReserved,report.reservedCalls);
 assert.equal(ledger.maximumCalls,26);assert.ok(ledger.reservedCalls<=26);
 assert.equal(job.assemblyStages.length,ledger.reservedCalls);assert.equal(job.assemblyStages.at(-1).invocationOutcome,'unknown');
 assert.equal(job.generationDiagnostic.reason,'aborted');assert.equal(job.generations.filter(g=>g.diagnostic?.reason==='completed').length,report.completedReplies);
 assert.ok(!job.assetHash&&!job.manifest);assert.equal(report.lastAccepted.diagnosticOnly,true);
 const owner=await read(archived?archivePath:activePath);
 assert.equal(owner.root,root);assert.equal(owner.key,record.key);assert.equal(owner.protocolHash,ledger.protocolHash);
 assert.equal(owner.pid,report.renderer.bridgePid);
 // The archive substitutes only for the lease file. Every other input remains
 // at its original path and must have its original forensic checksum.
 for(const file of [report.originalLedger,jobFile,activePath])assert.ok(report.inputs.some(i=>i.file===file));
 for(const input of report.inputs){
  const file=archived&&input.file===activePath?archivePath:input.file;
  assert.equal(hash(await fs.readFile(file)),input.sha256,'Original failure evidence changed: '+input.file);
 }
 assert.equal(await isAlive(report.renderer.pid),false,'Old renderer JVM still exists');
 assert.equal(await isAlive(report.renderer.bridgePid),false,'Old Bridge still exists');
 await absent(path.join(record.dataDirectory,'connection.json'));
 return {report,ledger,record,owner};
}

// Explicit engineering disposition, never automatic retry or a claim that the
// provider finished. The old task/key/turn remains permanently non-resumable.
export async function retireQualityCrash({directory,reportFile,authorization,isAlive=alive}){
 assert.equal(authorization,CRASH_RETIREMENT_AUTHORIZATION);
 directory=path.resolve(directory);reportFile=path.resolve(reportFile);
 const report=await read(reportFile),root=path.dirname(report.originalLedger),ledger=await read(report.originalLedger);
 const attempt=ledger.protocol.attempt;assert.match(attempt,/^[a-z0-9][a-z0-9-]{0,47}$/);
 const activePath=path.join(directory,'active.json'),archiveDir=path.join(directory,'retired'),archivePath=path.join(archiveDir,attempt+'-lease.json');
 const dispositionPath=path.join(root,'failure-retirement.json');
 let archived=false;try{await fs.access(archivePath);archived=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 const checked=await evidence(reportFile,{activePath,archivePath,isAlive,archived});
 if(!archived){
  await fs.mkdir(archiveDir,{recursive:true});
  assert.equal(await fs.realpath(archiveDir),archiveDir);assert.equal(await fs.realpath(activePath),activePath);
  assert.equal(hash(await read(activePath)),hash(checked.owner));
  await fs.rename(activePath,archivePath); // Exact lease only, retained verbatim.
 }
 const disposition={type:'abandoned-native-crash-test',version:1,authorization,attempt,
  ledger:report.originalLedger,ledgerSha256:hash(await fs.readFile(report.originalLedger)),reportFile,reportSha256:hash(await fs.readFile(reportFile)),
  activePath,archivePath,archiveSha256:hash(await fs.readFile(archivePath)),jobId:report.jobId,key:checked.record.key,
  reservedCalls:report.reservedCalls,completedReplies:report.completedReplies,
  unknownOutcomeResolved:false,unknownCallRetained:report.interruptedCall.stage,
  providerThreadId:report.interruptedCall.diagnostic.threadId,providerTurnId:report.interruptedCall.diagnostic.turnId,
  oldTaskMayResume:false,oldInvocationMayResubmit:false,budgetReset:false,canAuthorizePlacement:false,
  additionalModelCalls:0,state:'failed-abandoned',newIndependentTestsAuthorized:true};
 try{await fs.writeFile(dispositionPath,JSON.stringify(disposition,null,2),{flag:'wx'});}
 catch(error){if(error.code!=='EEXIST'||hash(await read(dispositionPath))!==hash(disposition))throw error;}
 return {dispositionPath,disposition};
}

export async function readQualityCrashRetirement(ledgerFile,{isAlive=alive}={}){
 const file=path.join(path.dirname(path.resolve(ledgerFile)),'failure-retirement.json'),d=await read(file);
 assert.equal(d.type,'abandoned-native-crash-test');assert.equal(d.authorization,CRASH_RETIREMENT_AUTHORIZATION);
 assert.equal(d.ledger,path.resolve(ledgerFile));assert.equal(d.ledgerSha256,hash(await fs.readFile(ledgerFile)));
 assert.equal(d.reportSha256,hash(await fs.readFile(d.reportFile)));assert.equal(d.archiveSha256,hash(await fs.readFile(d.archivePath)));
 for(const field of ['unknownOutcomeResolved','oldTaskMayResume','oldInvocationMayResubmit','budgetReset','canAuthorizePlacement'])assert.equal(d[field],false);
 assert.equal(d.newIndependentTestsAuthorized,true);assert.equal(d.additionalModelCalls,0);assert.equal(d.state,'failed-abandoned');
 const checked=await evidence(d.reportFile,{activePath:d.activePath,archivePath:d.archivePath,isAlive,archived:true});
 assert.equal(d.reservedCalls,checked.ledger.reservedCalls);assert.equal(d.key,checked.record.key);assert.equal(d.jobId,checked.record.jobId);
 return {file:path.resolve(ledgerFile),sha256:d.ledgerSha256,state:d.state,reservedCalls:d.reservedCalls,receipts:d.completedReplies,
  disposition:file,dispositionSha256:hash(await fs.readFile(file)),unknownOutcomeResolved:false,oldInvocationMayResubmit:false};
}
