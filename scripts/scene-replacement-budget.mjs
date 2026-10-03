import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../src/generation/compiler.mjs';

const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const fail=message=>{throw new Error('Replacement budget: '+message);};
const exists=async file=>{try{await fs.access(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const checked=async file=>{const e=await read(file);if(hash(e.value)!==e.sha256)fail('journal hash mismatch');return e.value;};

// A replacement is a new job, NOT a replay or a refund. Pin the explicitly
// approved terminal evidence and claim its remaining authorization only once.
export async function inspectReplacement({ledgerFile,expectedLedgerSha256,expectedJobId,expectedPriorCalls,maximumCalls}){
 ledgerFile=path.resolve(ledgerFile);
 const bytes=await fs.readFile(ledgerFile),ledger=JSON.parse(bytes),r=ledger.results?.[0];
 if(hash(bytes)!==expectedLedgerSha256)fail('approved ledger changed');
 if(ledger.replacement||ledger.resumedFrom||ledger.interruptionObservation)fail('replacement chaining is not authorized');
 if(!ledger.finishedAt||ledger.results?.length!==1||r?.state!=='cancelled'||!r.finishedAt)fail('requires a completed cancellation');
 if(hash(ledger.protocol)!==ledger.protocolHash||ledger.maximumCalls!==maximumCalls||ledger.protocol.maximumCalls!==maximumCalls)fail('original protocol mismatch');
 if(!Number.isSafeInteger(expectedPriorCalls)||expectedPriorCalls<1||expectedPriorCalls>=maximumCalls||ledger.reservedCalls!==expectedPriorCalls||r.assemblyCallsReserved!==expectedPriorCalls)fail('reservation count mismatch');
 if(r.jobId!==expectedJobId||ledger.protocol.model!=='gpt-6-luna'||ledger.protocol.effort!=='max'||r.model!=='gpt-6-luna'||r.effort!=='max')fail('job/model identity mismatch');
 const expectedDirectory=path.join(path.dirname(ledgerFile),'data','jobs',expectedJobId);
 if(path.resolve(r.assetDirectory)!==expectedDirectory)fail('job directory mismatch');
 const jobFile=path.join(expectedDirectory,'job.json'),jobBytes=await fs.readFile(jobFile),job=JSON.parse(jobBytes);
 const requestFile=path.join(path.dirname(ledgerFile),'request.json'),requestBytes=await fs.readFile(requestFile),request=JSON.parse(requestBytes);
 if(job.id!==expectedJobId||job.key!==r.key||request.key!==r.key||hash(request)!==r.requestHash||job.state!=='cancelled'||job.assemblyCallsReserved!==expectedPriorCalls||!job.recoveryEnabled||job.recovery?.state!=='cancelled')fail('job/request identity mismatch');
 if(hash(job.assemblyStages)!==hash(r.assemblyStages)||hash(job.generations)!==hash(r.generations)||job.assemblyStages.length!==expectedPriorCalls||job.assemblyStages.some((s,i)=>s.index!==i+1||!['accepted','rejected','failed','cancelled','interrupted'].includes(s.state)))fail('failed/unknown reservations cannot be dropped');
 const journal=path.join(expectedDirectory,'assembly-journal'),names=(await fs.readdir(journal)).filter(n=>/^call-\d+\.json$/.test(n));
 if(names.length!==expectedPriorCalls||(await checked(path.join(journal,'dispatched.json'))).count!==expectedPriorCalls||(await checked(path.join(journal,'identity.json'))).maximumCalls!==maximumCalls)fail('durable reservation mismatch');
 const journalFiles=[];
 for(let i=1;i<=expectedPriorCalls;i++){
  const file=path.join(journal,`call-${i}.json`),record=await checked(file);
  if(record.index!==i||!['pending','response','error'].includes(record.state))fail('invalid durable call');
  journalFiles.push({file,sha256:hash(await fs.readFile(file))});
 }
 return {version:1,type:'authorized-single-replacement',originalLedger:ledgerFile,originalLedgerSha256:hash(bytes),originalJob:jobFile,originalJobSha256:hash(jobBytes),originalRequest:requestFile,originalRequestSha256:hash(requestBytes),originalJobId:expectedJobId,priorCalls:expectedPriorCalls,cumulativeMaximumCalls:maximumCalls,maximumCalls:maximumCalls-expectedPriorCalls,model:r.model,effort:r.effort,briefHash:hash(ledger.protocol.brief),journalFiles,unknownCallsRefunded:0,maximumReplacementJobs:1};
}

export async function claimReplacement(options,{destination,key}){
 const proof=await inspectReplacement(options),data=path.join(path.dirname(proof.originalLedger),'data');
 // Clean shutdown removes both files. Never infer a stopped provider from age.
 if(await exists(path.join(data,'bridge.lock'))||await exists(path.join(data,'connection.json')))fail('old Bridge has not cleanly closed');
 destination=path.resolve(destination);
 if(!key||destination===path.dirname(proof.originalLedger))fail('new destination and stable key required');
 const claimFile=path.join(path.dirname(proof.originalLedger),'replacement-claim.json');
 const claim={...proof,destination,key,claimedAt:new Date().toISOString(),authorization:'User approved one replacement; both jobs total at most 26 calls; unknown calls count.'};
 const handle=await fs.open(claimFile,'wx',0o600);
 try{await handle.writeFile(JSON.stringify(claim,null,2));await handle.sync();}finally{await handle.close();}
 // Deliberately never release this claim on errors or uncertain submission.
 return {...claim,claimFile,claimHash:hash(claim)};
}

export async function verifyReplacementBudget(ledger){
 if(!ledger.replacement){if(ledger.maximumCalls!==26)fail('unlinked nonstandard budget');return {priorCalls:0,cumulativeMaximumCalls:26,cumulativeReservedCalls:ledger.reservedCalls};}
 const p=ledger.replacement,claim=await read(p.claimFile),r=ledger.results?.[0];
 if(hash(claim)!==p.claimHash||hash({...claim,claimFile:p.claimFile,claimHash:p.claimHash})!==hash(p))fail('claim identity mismatch');
 const original=await inspectReplacement({ledgerFile:p.originalLedger,expectedLedgerSha256:p.originalLedgerSha256,expectedJobId:p.originalJobId,expectedPriorCalls:p.priorCalls,maximumCalls:p.cumulativeMaximumCalls});
 for(const [key,value] of Object.entries(original))if(hash(value)!==hash(p[key]))fail('original evidence changed: '+key);
 if(p.cumulativeMaximumCalls!==26||ledger.maximumCalls!==p.maximumCalls||ledger.protocol.maximumCalls!==p.maximumCalls||ledger.protocol.model!==p.model||ledger.protocol.effort!==p.effort||hash(ledger.protocol.brief)!==p.briefHash||hash(ledger.protocol.replacement)!==hash(p))fail('replacement protocol mismatch');
 if(r&&(r.key!==p.key||r.maximumCalls!==p.maximumCalls||path.resolve(r.assetDirectory??path.join(p.destination,'data/jobs',r.jobId??''))!==path.join(p.destination,'data/jobs',r.jobId??'')))fail('replacement job identity mismatch');
 if(!Number.isSafeInteger(ledger.reservedCalls)||ledger.reservedCalls<0||ledger.reservedCalls>p.maximumCalls||ledger.cumulativeReservedCalls!==p.priorCalls+ledger.reservedCalls)fail('cumulative budget exceeded/mismatched');
 return {priorCalls:p.priorCalls,cumulativeMaximumCalls:p.cumulativeMaximumCalls,cumulativeReservedCalls:p.priorCalls+ledger.reservedCalls};
}
