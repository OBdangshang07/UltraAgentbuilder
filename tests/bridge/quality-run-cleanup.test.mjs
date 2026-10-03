import test from 'node:test';
import assert from 'node:assert/strict';
import {finalizeQualityRun,observeQualityJob} from '../../scripts/quality-run-cleanup.mjs';

function fixture(){
 const record={jobId:'job',state:'generating',assemblyCallsReserved:2};
 const ledger={results:[record],reservedCalls:2,maximumCalls:26,runnerError:'original crash'};
 const calls=[];const job={id:'job',state:'interrupted',assemblyCallsReserved:3,assemblyStages:[{invocationOutcome:'unknown'}]};
 const options={ledger,record,rendererAttempted:true,
  renderer:{settle:async()=>{calls.push('renderer');return {result:'passed',nativeClientExitVerified:true,launcherExited:true};}},
  bridge:{close:async()=>{calls.push('bridge');}},readJob:async()=>{calls.push('read');return job;},
  persist:async()=>{calls.push('persist');},release:async()=>{calls.push('release');}};
 return {record,ledger,calls,job,options};
}
test('cleanup observes final persisted job after Bridge shutdown without clearing unknown invocation',async()=>{
 const f=fixture();await finalizeQualityRun(f.options);
 assert.deepEqual(f.calls,['renderer','bridge','read','persist','release']);assert.equal(f.ledger.reservedCalls,3);
 assert.equal(f.record.state,'interrupted');assert.equal(f.record.assemblyStages[0].invocationOutcome,'unknown');
 assert.equal(f.ledger.runnerError,'original crash');assert.equal(f.ledger.cleanupCompleted,true);
});
test('renderer cleanup throwing does not suppress Bridge close, final observation or persistence',async()=>{
 const f=fixture();f.options.renderer.settle=async()=>{throw Error('renderer crash');};await finalizeQualityRun(f.options);
 assert.deepEqual(f.calls,['bridge','read','persist','persist']);assert.equal(f.ledger.cleanupCompleted,false);
 assert.equal(f.record.state,'interrupted');assert.equal(f.ledger.runnerError,'original crash');assert.match(f.ledger.cleanupErrors[0].error,/renderer crash/);
});
test('failed renderer exit is preserved, not promoted to a passed receipt',async()=>{
 const f=fixture();f.options.renderer.settle=async()=>({result:'failed',nativeClientExitVerified:false,launcherExited:true,errors:['native crash']});
 await finalizeQualityRun(f.options);assert.equal(f.ledger.renderer.result,'failed');assert.equal(f.ledger.cleanupCompleted,false);assert.ok(!f.calls.includes('release'));
});
test('Bridge close error still preserves final observed evidence but retains lease',async()=>{
 const f=fixture();f.options.bridge.close=async()=>{throw Error('close failed');};await finalizeQualityRun(f.options);
 assert.equal(f.record.state,'interrupted');assert.equal(f.ledger.cleanup.bridgeClosed,false);assert.ok(!f.calls.includes('release'));
});
test('persistence failure is reported and never releases the lease even if next write succeeds',async()=>{
 const f=fixture();let writes=0;f.options.persist=async()=>{if(++writes===1)throw Error('disk full');};await finalizeQualityRun(f.options);
 assert.equal(writes,2);assert.equal(f.ledger.cleanupErrors[0].step,'persist');assert.ok(!f.calls.includes('release'));
});
test('unreadable final job cannot be assumed terminal',async()=>{
 const f=fixture();f.options.readJob=async()=>{throw Error('bad job');};await finalizeQualityRun(f.options);
 assert.equal(f.record.state,'generating');assert.equal(f.ledger.finishedAt,undefined);assert.equal(f.ledger.cleanupCompleted,false);
});
test('lease denial is recorded after all other cleanup without hiding primary failure',async()=>{
 const f=fixture();f.options.release=async()=>{throw Error('unknown outcome');};await finalizeQualityRun(f.options);
 assert.equal(f.ledger.runnerError,'original crash');assert.equal(f.ledger.leaseRetainedReason,'unknown outcome');
});
test('accounting cannot decrease or exceed per-task budget',()=>{
 const f=fixture();for(const count of [1,27,-1,2.5])assert.throws(()=>observeQualityJob(f.ledger,f.record,{...f.job,assemblyCallsReserved:count}));
 assert.equal(f.ledger.reservedCalls,2);
});
