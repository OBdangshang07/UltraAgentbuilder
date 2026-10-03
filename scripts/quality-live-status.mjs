import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

// Read exactly the authorized job; never submit, resume, cancel or replace it.
const project=await fs.realpath(fileURLToPath(new URL('../',import.meta.url)));
export async function inspectQualityJobStatus(arg,{projectRoot=project,fetcher=fetch}={}){
const root=await fs.realpath(path.resolve(arg));assert.match(path.basename(root),/^quality-native-[a-f0-9]{32}$/);
assert.equal(path.dirname(root),path.join(await fs.realpath(projectRoot),'build'));
const ledger=JSON.parse(await fs.readFile(path.join(root,'ledger.json'),'utf8'));assert.equal(ledger.results.length,1);
const jobId=ledger.results[0].jobId;assert.match(jobId,/^[a-f0-9-]{36}$/);
let connection,job,observationSource='live-loopback-get';
try{connection=JSON.parse(await fs.readFile(path.join(root,'data','connection.json'),'utf8'));}catch(error){
 if(error.code!=='ENOENT')throw error;
 assert.equal(ledger.cleanupCompleted,true,'Bridge unavailable without a closed runner receipt; saved state is not liveness evidence');
 assert.ok(['preview-ready','failed','cancelled'].includes(ledger.results[0].state),'No checked terminal state; do not resume or resubmit');
 job=JSON.parse(await fs.readFile(path.join(root,'data','jobs',jobId,'job.json'),'utf8'));
 assert.equal(job.id,jobId);assert.equal(job.state,ledger.results[0].state);assert.equal(job.assemblyCallsReserved,ledger.reservedCalls);observationSource='saved-terminal-receipt';
}
if(connection){
assert.equal(connection.protocol,1);assert.ok(Number.isSafeInteger(connection.port)&&connection.port>=1&&connection.port<=65535);assert.match(connection.token,/^[a-f0-9]{64}$/);
const response=await fetcher('http://127.0.0.1:'+connection.port+'/v1/jobs/'+jobId,{headers:{Authorization:'Bearer '+connection.token},redirect:'error',signal:AbortSignal.timeout(10000)});
assert.equal(response.status,200);job=await response.json();assert.equal(job.id,jobId);
}
assert.ok(Number.isSafeInteger(job.assemblyCallsReserved)&&job.assemblyCallsReserved<=ledger.maximumCalls);
const stages=job.assemblyStages??[];
const receipts=[];const directory=path.join(root,'data','jobs',jobId);
for(const name of await fs.readdir(directory))if(/^codex-response-[A-Za-z0-9_-]+$/.test(name)){
 const file=path.join(directory,name,'receipt.json');try{
  const saved=JSON.parse(await fs.readFile(file,'utf8'));
  receipts.push({reason:saved.reason??null,failureKind:saved.failureKind??null,completionSource:saved.completionSource??null});
 }catch(error){if(error.code!=='ENOENT')throw error;}
}
return {type:'read-only-live-quality-job-status',observedAt:new Date().toISOString(),observationSource,liveObservation:observationSource==='live-loopback-get',jobId,state:job.state,phase:stages.at(-1)?.phase??null,
 reserved:job.assemblyCallsReserved,receiptFiles:receipts.length,completeReceipts:receipts.filter(r=>r.reason==='completed'&&!r.failureKind).length,maximumCalls:ledger.maximumCalls,error:job.error??null,
 stages:stages.map(s=>({index:s.index,phase:s.phase,state:s.state})),receipts,model:ledger.model,runtimeHash:ledger.runtimeHash,
 additionalModelCalls:0,worldWrites:0,terminalTaskAssessment:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [arg,...extra]=process.argv.slice(2);assert.ok(arg&&!extra.length,'Explicit quality root required');console.log(JSON.stringify(await inspectQualityJobStatus(arg)));
}
