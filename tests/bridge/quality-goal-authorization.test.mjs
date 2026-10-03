import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {hash} from '../../src/generation/compiler.mjs';
import {claimQualityGoal,settledQualityAttempt} from '../../scripts/quality-goal-authorization.mjs';

async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-goal-claim-')),prior=path.join(root,'prior');await fs.mkdir(prior);
 const protocol={type:'fixture'},ledger={protocol,protocolHash:hash(protocol),maximumCalls:26,reservedCalls:2,finishedAt:'2026-09-28',renderer:{result:'passed',worldLoaded:false},results:[{state:'failed',dataDirectory:path.join(prior,'data'),generations:[{},{}]}]};
 const priorLedger=path.join(prior,'ledger.json');await fs.writeFile(priorLedger,JSON.stringify(ledger));
 const next=path.join(root,'next');await fs.mkdir(next);
 return {root,ledger,priorLedger,args:{directory:path.join(root,'claims'),attempt:'r1',root:next,key:'unique',protocolHash:hash(protocol),priorLedger}};
}
test('goal authorization keeps historical failure and enforces an exclusive persistent claim',async()=>{
 const f=await fixture(),bytes=await fs.readFile(f.priorLedger),claim=await claimQualityGoal(f.args);
 assert.equal(claim.history[0].reservedCalls,2);assert.equal(claim.history[0].state,'failed');
 await assert.rejects(claimQualityGoal({...f.args,attempt:'r2'}),/EEXIST/);
 await assert.rejects(claim.release(),/ENOENT/);
 await fs.writeFile(path.join(f.args.root,'ledger.json'),JSON.stringify({...f.ledger,results:[{...f.ledger.results[0],dataDirectory:path.join(f.args.root,'data')}]}));
 await claim.release();await assert.rejects(claimQualityGoal(f.args),/EEXIST/);
 assert.deepEqual(await fs.readFile(f.priorLedger),bytes);
});
test('unknown, unclosed and over-budget prior tasks cannot be replaced',async()=>{
 for(const kind of ['unknown','connection','renderer','budget']){
  const f=await fixture();
  if(kind==='unknown')f.ledger.results[0].state='generating';
  if(kind==='renderer')f.ledger.renderer=null;
  if(kind==='budget')f.ledger.reservedCalls=27;
  if(kind==='connection'){await fs.mkdir(f.ledger.results[0].dataDirectory);await fs.writeFile(path.join(f.ledger.results[0].dataDirectory,'connection.json'),'{}');}
  await fs.writeFile(f.priorLedger,JSON.stringify(f.ledger));await assert.rejects(claimQualityGoal(f.args));
 }
});
test('zero-call preflight failure may settle only after verified cleanup and no submission',async()=>{
 const f=await fixture();Object.assign(f.ledger,{finishedAt:null,renderer:null,reservedCalls:0,cleanupCompleted:true});f.ledger.results[0].state='allocated';
 await fs.writeFile(f.priorLedger,JSON.stringify(f.ledger));assert.equal((await settledQualityAttempt(f.priorLedger)).reservedCalls,0);
 f.ledger.results[0].startedAt='ambiguous';await fs.writeFile(f.priorLedger,JSON.stringify(f.ledger));await assert.rejects(settledQualityAttempt(f.priorLedger));
});
