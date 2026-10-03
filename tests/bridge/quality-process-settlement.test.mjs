import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {hash} from '../../src/generation/compiler.mjs';
import {verifyExitedProcessLifetime} from '../../scripts/quality-process-settlement.mjs';
import {verifyClosedRecoveredRenderer,settledQualityAttempt} from '../../scripts/quality-goal-authorization.mjs';

const closedAt='2026-10-01T13:43:26.151Z',closedMillis=Date.parse(closedAt),pid=92540;
const options={closedAt,platform:'win32',isAlive:()=>true,inspectProcess:async()=>({pid,name:'conhost.exe',createdAt:closedMillis+86400000})};

test('an absent PID needs no OS lookup and causes no mutation',async()=>{
 const result=await verifyExitedProcessLifetime(pid,{...options,platform:'linux',isAlive:()=>false,inspectProcess:()=>{throw Error('must not query');}});
 assert.deepEqual(result,{pid,state:'not-running'});
});
for(const name of ['conhost.exe','java.exe'])test('PID reuse is proved by the later OS creation time for '+name,async()=>{
 const result=await verifyExitedProcessLifetime(pid,{...options,inspectProcess:async()=>({pid,name,createdAt:closedMillis+1})});
 assert.equal(result.state,'pid-reused');assert.equal(result.originalExitedAt,closedAt);assert.equal(result.current.name,name);
});
for(const delta of [-1,0])test('a live lifetime created before or at the old exit cannot be treated as PID reuse '+delta,async()=>{
 await assert.rejects(verifyExitedProcessLifetime(pid,{...options,inspectProcess:async()=>({pid,name:'conhost.exe',createdAt:closedMillis+delta})}),/may still be live/);
});
test('missing old exit date cannot settle a live PID',async()=>{
 await assert.rejects(verifyExitedProcessLifetime(pid,{...options,closedAt:undefined}),/dated/);
});
test('OS query failure is not proof of exit',async()=>{
 await assert.rejects(verifyExitedProcessLifetime(pid,{...options,inspectProcess:async()=>{throw Error('query failed');}}),/query failed/);
});
test('a foreign PID or missing OS creation time is rejected',async()=>{
 for(const value of [{pid:pid+1,name:'java.exe',createdAt:closedMillis+1},{pid,name:'java.exe'},{pid,name:'',createdAt:closedMillis+1}])
  await assert.rejects(verifyExitedProcessLifetime(pid,{...options,inspectProcess:async()=>value}));
});
test('a query disappearance must be followed by verified absence',async()=>{
 let reads=0;const result=await verifyExitedProcessLifetime(pid,{...options,isAlive:()=>++reads===1,inspectProcess:async()=>null});
 assert.equal(result.state,'not-running-after-query');assert.equal(reads,2);
 await assert.rejects(verifyExitedProcessLifetime(pid,{...options,inspectProcess:async()=>null}),/still live/);
});
test('unsupported platforms cannot guess that a live PID was reused',async()=>{
 await assert.rejects(verifyExitedProcessLifetime(pid,{...options,platform:'linux'}),/supported OS/);
});

async function recoveredFixture(){
 const base=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'voxel-pid-reuse-'))),build=path.join(base,'build');await fs.mkdir(build);
 const root=path.join(build,'quality-native-'+'a'.repeat(32)),child=path.join(build,'quality-native-'+'b'.repeat(32));
 await fs.mkdir(root);await fs.mkdir(path.join(child,'data'),{recursive:true});
 const identity={instanceId:'instance-fixture',pid,startedAt:closedMillis-33000};
 const session={root:child,result:'failed',launcherPid:92541,launcherExited:true,nativeClientExitVerified:true,logClosed:true,exitCode:1,processIdentity:identity,observedAt:closedAt};
 const protocol={type:'free-lifetime-closure-fixture'},ledger={protocol,protocolHash:hash(protocol),reservedCalls:9,maximumCalls:26,finishedAt:closedAt,
  results:[{state:'failed',dataDirectory:path.join(root,'data'),generations:Array.from({length:9},()=>({}))}],cleanupCompleted:true,
  cleanup:{rendererStopped:true,bridgeClosed:true,jobObserved:true},renderer:{mode:'on-demand-native',result:'recovered',active:false,activeRoot:null,blocked:null,maxRecoveries:1,maxStarts:27,starts:1,
   sessions:[session],failures:[{outcome:session}],launcherExited:true,nativeClientExitVerified:true}};
 const values={'renderer-owner.json':{ownerRoot:root,additionalModelCalls:0},'renderer-authorization.json':{instanceId:identity.instanceId,assetOnly:true,visibleWindowAuthorized:true},'renderer-process.json':identity,'renderer-exit.json':session};
 for(const [name,value]of Object.entries(values))await fs.writeFile(path.join(child,name),JSON.stringify(value));
 const file=path.join(root,'ledger.json');await fs.writeFile(file,JSON.stringify(ledger));return {ledger,file};
}
test('historical recovered outcome and bytes stay unchanged while two reused process lifetimes are recorded',async()=>{
 const f=await recoveredFixture(),bytes=await fs.readFile(f.file);
 const result=await settledQualityAttempt(f.file,{...options,inspectProcess:async value=>({pid:value,name:'conhost.exe',createdAt:closedMillis+86400000})});
 assert.equal(result.state,'failed');assert.equal(result.reservedCalls,9);assert.equal(result.rendererSettlement.renderingPassed,false);
 assert.equal(result.rendererSettlement.processSettlements.length,2);assert.ok(result.rendererSettlement.processSettlements.every(s=>s.state==='pid-reused'));
 assert.deepEqual(await fs.readFile(f.file),bytes);
});
test('OS PID reuse proof does not bypass altered original exit proofs or unknown model outcomes',async()=>{
 const f=await recoveredFixture();f.ledger.renderer.sessions[0].observedAt='2026-10-02T00:00:00Z';
 await assert.rejects(verifyClosedRecoveredRenderer(f.ledger,f.file,options));
 const unknown=await recoveredFixture();unknown.ledger.results[0].state='generating';await fs.writeFile(unknown.file,JSON.stringify(unknown.ledger));
 await assert.rejects(settledQualityAttempt(unknown.file,options),/unknown/);
});
