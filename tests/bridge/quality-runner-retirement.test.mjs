import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {hash} from '../../src/generation/compiler.mjs';
import {retireExitedQualityRunner,readExitedQualityRetirement} from '../../scripts/quality-runner-retirement.mjs';
import {settledQualityAttempt,claimQualityGoal} from '../../scripts/quality-goal-authorization.mjs';

const authorization='2026-09-28 / 用户：授权在目标达成前的所有调用';
async function fixture({runnerPid=10001,codexChildPid=10002}={}){
 const project=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-runner-incident-'));
 const root=path.join(project,'build/quality-native-original'),data=path.join(root,'data'),dir=path.join(data,'jobs/job-original');
 await fs.mkdir(path.join(dir,'assembly-journal'),{recursive:true});await fs.mkdir(path.join(project,'build/quality-goal-authorizations'));
 const write=async(file,data)=>fs.writeFile(file,JSON.stringify(data));
 const protocol={attempt:'incident-original'},record={state:'generating',jobId:'job-original',key:'original-key',dataDirectory:data,assetDirectory:dir,assemblyCallsReserved:1,generations:[]};
 const ledger={type:'authorized-goal-quality-v4',protocol,protocolHash:hash(protocol),maximumCalls:26,reservedCalls:1,results:[record],rendererProgress:{active:false,sessions:[{nativeClientExitVerified:true,launcherExited:true,logClosed:true,worldLoaded:false}]}};
 const ledgerFile=path.join(root,'ledger.json');await write(ledgerFile,ledger);
 const jobFile=path.join(dir,'job.json');await write(jobFile,{id:record.jobId,key:record.key,state:'generating',assemblyCallsReserved:1});
 const call={index:1,state:'pending'};await write(path.join(dir,'assembly-journal/call-1.json'),{value:call,sha256:hash(call)});
 await write(path.join(data,'bridge.lock'),{pid:runnerPid});await write(path.join(data,'connection.json'),{port:9,token:'offline-private-do-not-print'});
 await write(path.join(project,'build/quality-goal-authorizations/active.json'),{root,key:record.key,protocolHash:ledger.protocolHash,pid:runnerPid});
 const logFile=path.join(project,'build/original-runner.log');await fs.writeFile(logFile,'Debugger attached.\nERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING\n');
 const incidentFile=path.join(project,'incident.json'),incident={type:'engineering-diagnostic-induced-runner-exit',runnerExitCode:1,runnerFailure:'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING during diagnostic inspector evaluation',
  unknownOutcomeResolved:false,originalInvocationMayResubmit:false,additionalModelCalls:0,worldModified:false,originalLedger:ledgerFile,originalJobId:record.jobId,
  originalInvocationReserved:1,completedReceipts:0,runnerPid,codexChildPid,runnerLog:logFile,providerThreadId:'unknown-thread',providerTurnId:'unknown-turn'};
 await write(incidentFile,incident);
 return {project,root,data,dir,ledgerFile,jobFile,incidentFile,incident,ledger,write};
}

test('engineering runner retirement retains originals, reservations and unknown outcome',async()=>{
 const f=await fixture(),before=await fs.readFile(f.ledgerFile),jobBefore=await fs.readFile(f.jobFile);
 const result=await retireExitedQualityRunner({incidentFile:f.incidentFile,authorization,isAlive:()=>false});
 const d=JSON.parse(await fs.readFile(result.dispositionFile,'utf8'));
 assert.equal(d.state,'failed-abandoned');assert.equal(d.unknownOutcomeResolved,false);assert.equal(d.oldInvocationMayResubmit,false);
 assert.equal(d.reservedCalls,1);assert.equal(d.completedReplies,0);assert.equal(d.providerTerminalVerified,false);
 assert.deepEqual(await fs.readFile(f.ledgerFile),before);assert.deepEqual(await fs.readFile(f.jobFile),jobBefore);
 const read=await readExitedQualityRetirement(f.ledgerFile,{isAlive:()=>false});assert.equal(read.reservedCalls,1);
 await assert.rejects(fs.access(path.join(f.data,'connection.json')),/ENOENT/);
 assert.equal(JSON.parse(await fs.readFile(path.join(f.root,'orphaned-runner/connection.json'),'utf8')).token,'offline-private-do-not-print');
 assert.ok(!JSON.stringify(d).includes('offline-private-do-not-print'));
 // Pure reader checks live PIDs in production; fixture passes only the tested
 // injected reader. No budget reset is possible through its disposition.
 assert.equal(d.budgetReset,false);
});

test('retirement stops for live processes, changed state or actual returned response',async()=>{
 for(const variant of ['alive','complete','response']){
  const f=await fixture();
  if(variant==='complete'){f.ledger.results[0].state='preview-ready';await f.write(f.ledgerFile,f.ledger);}
  if(variant==='response'){const call={index:1,state:'response',response:{}};await f.write(path.join(f.dir,'assembly-journal/call-1.json'),{value:call,sha256:hash(call)});}
  await assert.rejects(retireExitedQualityRunner({incidentFile:f.incidentFile,authorization,isAlive:()=>variant==='alive'}));
  await fs.access(path.join(f.project,'build/quality-goal-authorizations/active.json'));
 }
});

test('retirement rejects changed forensic bytes and a reappearing live connection',async()=>{
 for(const variant of ['job','connection']){
  const f=await fixture();await retireExitedQualityRunner({incidentFile:f.incidentFile,authorization,isAlive:()=>false});
  if(variant==='job')await fs.appendFile(f.jobFile,' ');
  else await f.write(path.join(f.data,'connection.json'),{port:9});
  await assert.rejects(readExitedQualityRetirement(f.ledgerFile,{isAlive:()=>false}));
 }
});

test('production liveness reader refuses the actual live test process and preserves its fixture lease',async()=>{
 const f=await fixture({runnerPid:process.pid}),before=await fs.readFile(f.ledgerFile),jobBefore=await fs.readFile(f.jobFile);
 await assert.rejects(retireExitedQualityRunner({incidentFile:f.incidentFile,authorization}),/Original runner remains active/);
 assert.deepEqual(await fs.readFile(f.ledgerFile),before);assert.deepEqual(await fs.readFile(f.jobFile),jobBefore);
 assert.equal(JSON.parse(await fs.readFile(path.join(f.project,'build/quality-goal-authorizations/active.json'))).pid,process.pid);
 await assert.rejects(fs.access(path.join(f.root,'orphaned-runner')),{code:'ENOENT'});
 await assert.rejects(fs.access(path.join(f.root,'failure-retirement.json')),{code:'ENOENT'});
});

async function closedFixtureProcess(exitCode){
 const child=spawn(process.execPath,['-e','process.exit('+exitCode+')'],{windowsHide:true,stdio:'ignore'});
 const outcome=await new Promise((resolve,reject)=>{
  child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));
 });
 assert.equal(outcome.code,exitCode);assert.equal(outcome.signal,null);
 assert.ok(Number.isSafeInteger(child.pid)&&child.pid>1);return child.pid;
}

test('new exclusive claim can audit retired runner without mistaking its own lease for an old one',async()=>{
 // This path uses the production OS liveness reader. Fixed fictional PIDs
 // can resolve to live CI processes; bind two OWNED children and wait for
 // their original close events instead. All forensic answers remain synthetic.
 const [runnerPid,codexChildPid]=await Promise.all([closedFixtureProcess(1),closedFixtureProcess(0)]);
 assert.notEqual(runnerPid,codexChildPid);
 const f=await fixture({runnerPid,codexChildPid});await retireExitedQualityRunner({incidentFile:f.incidentFile,authorization});
 const before=await fs.readFile(f.ledgerFile),root=path.join(f.project,'build/new-independent-run');await fs.mkdir(root);
 const claim=await claimQualityGoal({directory:path.join(f.project,'build/quality-goal-authorizations'),attempt:'new-independent',root,key:'new-key',protocolHash:hash({new:true}),priorLedger:f.ledgerFile});
 assert.equal(claim.history[0].reservedCalls,1);assert.equal(claim.history[0].receipts,0);assert.equal(claim.history[0].unknownOutcomeResolved,false);
 assert.equal(claim.history[0].oldInvocationMayResubmit,false);assert.deepEqual(await fs.readFile(f.ledgerFile),before);
 await assert.rejects(claimQualityGoal({directory:path.join(f.project,'build/quality-goal-authorizations'),attempt:'overlap',root,key:'overlap',protocolHash:'other',priorLedger:f.ledgerFile}),/EEXIST/);
 await fs.writeFile(path.join(root,'ledger.json'),JSON.stringify({protocol:{test:true},protocolHash:hash({test:true}),maximumCalls:26,reservedCalls:0,cleanupCompleted:true,results:[{state:'allocated',dataDirectory:path.join(root,'data')}] }));
 await claim.release();
});

test('current-lease exception rejects foreign ownership, old ownership and any old Bridge resurrection',async()=>{
 for(const variant of ['foreign-owner','old-owner','connection']){
  const f=await fixture();await retireExitedQualityRunner({incidentFile:f.incidentFile,authorization,isAlive:()=>false});
  const file=path.join(f.project,'build/quality-goal-authorizations/active.json'),owner={pid:process.pid,authorization,maximumCalls:26,root:path.join(f.project,'build/new'),key:'new',attempt:'new'};
  await f.write(file,variant==='old-owner'?{...owner,root:f.root,key:'original-key',attempt:'incident-original'}:owner);
  if(variant==='connection')await f.write(path.join(f.data,'connection.json'),{port:9});
  await assert.rejects(readExitedQualityRetirement(f.ledgerFile,{isAlive:()=>false,currentLease:{file,owner:variant==='foreign-owner'?{...owner,key:'foreign'}:variant==='old-owner'?{...owner,root:f.root,key:'original-key',attempt:'incident-original'}:owner}}));
 }
});
