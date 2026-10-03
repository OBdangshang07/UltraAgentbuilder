import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../../src/generation/compiler.mjs';
import {retireQualityCrash,readQualityCrashRetirement,CRASH_RETIREMENT_AUTHORIZATION} from '../../scripts/quality-crash-retirement.mjs';

async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-retirement-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const directory=path.join(root,'claims'),data=path.join(root,'data'),asset=path.join(data,'jobs','job');await fs.mkdir(directory);await fs.mkdir(asset,{recursive:true});
 const protocol={attempt:'r1'},job={id:'job',state:'interrupted',assemblyCallsReserved:2,assemblyStages:[{}, {invocationOutcome:'unknown'}],generations:[{diagnostic:{reason:'completed'}},{diagnostic:{reason:'aborted'}}],generationDiagnostic:{reason:'aborted'}};
 const ledger={protocol,protocolHash:hash(protocol),maximumCalls:26,reservedCalls:2,results:[{key:'unique',jobId:'job',state:'generating',dataDirectory:data,assetDirectory:asset}]};
 const files=new Map([[path.join(root,'ledger.json'),ledger],[path.join(asset,'job.json'),job],[path.join(directory,'active.json'),{root,key:'unique',protocolHash:hash(protocol),pid:200}]]);
 for(const [f,v]of files)await fs.writeFile(f,JSON.stringify(v));
 const report={type:'native-renderer-crash-forensics',originalLedger:path.join(root,'ledger.json'),jobId:'job',reservedCalls:2,completedReplies:1,
  renderer:{pid:100,bridgePid:200},lastAccepted:{diagnosticOnly:true},additionalModelCalls:0,unknownOutcomeResolved:false,canAuthorizePlacement:false,
  interruptedCall:{stage:2,diagnostic:{threadId:'thread',turnId:'turn'}},inputs:[...files].map(([file,v])=>({file,sha256:hash(JSON.stringify(v))}))};
 const reportFile=path.join(root,'forensics.json');await fs.writeFile(reportFile,JSON.stringify(report));
 return {root,ledger,job,files,reportFile,args:{directory,reportFile,authorization:CRASH_RETIREMENT_AUTHORIZATION,isAlive:async()=>false}};
}
test('explicit abandonment archives exact lease, retains unknown and original records, and never restores budget',async t=>{
 const f=await fixture(t),before=await fs.readFile(path.join(f.root,'ledger.json'));const result=await retireQualityCrash(f.args);
 assert.equal(result.disposition.reservedCalls,2);assert.equal(result.disposition.unknownOutcomeResolved,false);assert.equal(result.disposition.oldInvocationMayResubmit,false);
 assert.deepEqual(await fs.readFile(path.join(f.root,'ledger.json')),before);await assert.rejects(fs.access(path.join(f.args.directory,'active.json')),/ENOENT/);
 const settled=await readQualityCrashRetirement(path.join(f.root,'ledger.json'),{isAlive:async()=>false});assert.equal(settled.state,'failed-abandoned');assert.equal(settled.receipts,1);
 assert.deepEqual((await retireQualityCrash(f.args)).disposition,result.disposition);
});
test('live JVM or Bridge blocks retirement and leaves exclusive lease intact',async t=>{
 const f=await fixture(t);for(const pid of [100,200])await assert.rejects(retireQualityCrash({...f.args,isAlive:async id=>id===pid}),/still exists/);
 await fs.access(path.join(f.args.directory,'active.json'));
});
test('changed historical evidence cannot be abandoned or certified',async t=>{
 const f=await fixture(t);await fs.appendFile(path.join(f.root,'ledger.json'),' ');await assert.rejects(retireQualityCrash(f.args),/evidence changed/);
 await fs.access(path.join(f.args.directory,'active.json'));
});
test('stale connection, wrong authority or another lease owner cannot be bypassed',async t=>{
 const f=await fixture(t);await assert.rejects(retireQualityCrash({...f.args,authorization:'old budget'}));
 await fs.writeFile(path.join(f.root,'data/connection.json'),'{}');await assert.rejects(retireQualityCrash(f.args),/connection/);
 await fs.unlink(path.join(f.root,'data/connection.json'));
 const active=path.join(f.args.directory,'active.json');await fs.writeFile(active,JSON.stringify({...f.files.get(active),key:'another'}));await assert.rejects(retireQualityCrash(f.args));
});
test('archived evidence cannot be changed to resolve unknown or grant placement',async t=>{
 const f=await fixture(t),result=await retireQualityCrash(f.args);result.disposition.canAuthorizePlacement=true;
 await fs.writeFile(result.dispositionPath,JSON.stringify(result.disposition));await assert.rejects(readQualityCrashRetirement(path.join(f.root,'ledger.json'),{isAlive:async()=>false}));
});
