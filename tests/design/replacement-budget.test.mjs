import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {hash} from '../../src/generation/compiler.mjs';
import {inspectReplacement,claimReplacement,verifyReplacementBudget} from '../../scripts/scene-replacement-budget.mjs';

const write=(file,value)=>fs.writeFile(file,JSON.stringify(value,null,2));
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-replacement-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const id='cancelled-job',dir=path.join(root,'data/jobs',id),journal=path.join(dir,'assembly-journal');await fs.mkdir(journal,{recursive:true});
 const request={key:'old-key'},stages=[{index:1,state:'rejected'},{index:2,state:'failed'},{index:3,state:'cancelled',invocationOutcome:'unknown'}];
 const job={id,key:request.key,state:'cancelled',recoveryEnabled:true,recovery:{state:'cancelled'},assemblyCallsReserved:3,assemblyStages:stages,generations:[{stage:1}]};
 const protocol={maximumCalls:26,model:'gpt-6-luna',effort:'max',brief:{id:'cbd224'}};
 const record={jobId:id,key:request.key,requestHash:hash(request),state:'cancelled',finishedAt:'2026-09-26T09:22:02Z',model:protocol.model,effort:protocol.effort,assetDirectory:dir,assemblyCallsReserved:3,assemblyStages:stages,generations:job.generations};
 const ledger={protocol,protocolHash:hash(protocol),maximumCalls:26,reservedCalls:3,finishedAt:record.finishedAt,results:[record]};
 const ledgerFile=path.join(root,'ledger.json'),jobFile=path.join(dir,'job.json');await write(ledgerFile,ledger);await write(jobFile,job);await write(path.join(root,'request.json'),request);
 for(const [name,value] of [['identity',{maximumCalls:26}],['dispatched',{count:3}],...stages.map((_,i)=>['call-'+(i+1),{index:i+1,state:i===2?'error':'response'}])])await write(path.join(journal,name+'.json'),{value,sha256:hash(value)});
 const options={ledgerFile,expectedLedgerSha256:hash(await fs.readFile(ledgerFile)),expectedJobId:id,expectedPriorCalls:3,maximumCalls:26};
 return {root,dir,journal,ledgerFile,jobFile,ledger,job,options,refresh:async()=>{await write(ledgerFile,ledger);options.expectedLedgerSha256=hash(await fs.readFile(ledgerFile));}};
}
test('replacement counts failed and unknown calls, caps new job at 23, and verifies cumulative budget',async t=>{
 const f=await fixture(t),p=await claimReplacement(f.options,{destination:path.join(f.root,'new'),key:'new-key'});
 assert.equal(p.priorCalls,3);assert.equal(p.maximumCalls,23);
 const ledger={replacement:p,protocol:{maximumCalls:23,model:p.model,effort:p.effort,brief:f.ledger.protocol.brief,replacement:p},maximumCalls:23,reservedCalls:23,cumulativeReservedCalls:26,results:[{key:p.key,maximumCalls:23,jobId:'new-job',assetDirectory:path.join(p.destination,'data/jobs/new-job')}]};
 assert.deepEqual(await verifyReplacementBudget(ledger),{priorCalls:3,cumulativeMaximumCalls:26,cumulativeReservedCalls:26});
 await assert.rejects(verifyReplacementBudget({...ledger,reservedCalls:24,cumulativeReservedCalls:27}),/cumulative budget/);
 await assert.rejects(verifyReplacementBudget({...ledger,cumulativeReservedCalls:23}),/cumulative budget/);
 await assert.rejects(verifyReplacementBudget({...ledger,maximumCalls:26}),/protocol mismatch/);
 await assert.rejects(claimReplacement(f.options,{destination:path.join(f.root,'another'),key:'third-key'}),/EEXIST/);
 await write(f.jobFile,{...f.job,error:'changed after claim'});await assert.rejects(verifyReplacementBudget(ledger),/original evidence changed/);
});
test('replacement rejects changed approved ledger, active task and replacement chains',async t=>{
 const f=await fixture(t);await write(f.ledgerFile,{...f.ledger,reservedCalls:2});await assert.rejects(inspectReplacement(f.options),/approved ledger changed/);
 f.ledger.results[0].state='generating';await f.refresh();await assert.rejects(inspectReplacement(f.options),/completed cancellation/);
 f.ledger.results[0].state='cancelled';f.ledger.replacement={};await f.refresh();await assert.rejects(inspectReplacement(f.options),/chaining/);
});
test('replacement rejects omitted reservation, durable count mismatch and bad journal hashes',async t=>{
 const f=await fixture(t);f.ledger.reservedCalls=2;await f.refresh();await assert.rejects(inspectReplacement(f.options),/reservation count/);
 f.ledger.reservedCalls=3;await f.refresh();const value={count:2};await write(path.join(f.journal,'dispatched.json'),{value,sha256:hash(value)});await assert.rejects(inspectReplacement(f.options),/durable reservation/);
 await write(path.join(f.journal,'dispatched.json'),{value:{count:3},sha256:'wrong'});await assert.rejects(inspectReplacement(f.options),/journal hash/);
});
test('replacement refuses a Bridge that has not cleanly closed',async t=>{
 const f=await fixture(t);await write(path.join(f.root,'data/bridge.lock'),{pid:123});await assert.rejects(claimReplacement(f.options,{destination:path.join(f.root,'new'),key:'new-key'}),/cleanly closed/);
});
test('unlinked 23-call ledgers cannot bypass cumulative authorization',async()=>{
 await assert.rejects(verifyReplacementBudget({maximumCalls:23,reservedCalls:1}),/unlinked/);
 assert.equal((await verifyReplacementBudget({maximumCalls:26,reservedCalls:3})).cumulativeReservedCalls,3);
});
