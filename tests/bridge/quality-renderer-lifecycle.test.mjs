import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {rendererLifecycle} from '../../scripts/quality-renderer-lifecycle.mjs';

function fixture(overrides={}){
 const child=new EventEmitter();child.pid=123;const calls={stop:0,close:0,saved:[]};let time=0;
 const processIdentity={instanceId:'isolated-instance',pid:456,startedAt:1};
 const api=rendererLifecycle({child,root:'isolated-fixture',now:()=>time,stopTimeoutMs:20,
  wait:async ms=>{time+=ms;},readFailure:async()=>null,
  sendStop:async()=>{calls.stop++;child.emit('close',0);},closeLog:async()=>{calls.close++;},
  readReceipt:async()=>({result:'passed',worldLoaded:false,assetOnly:true,generationSubmittedByClient:false,visible:true,processIdentity}),
  readProcessIdentity:async()=>processIdentity,isProcessAlive:async()=>false,
  saveOutcome:async result=>{calls.saved.push(structuredClone(result));},...overrides});
 return {api,child,calls};
}
test('renderer clean stop is idempotent and preserves one validated exit receipt',async()=>{
 const {api,calls}=fixture();const [a,b]=await Promise.all([api.stop(),api.stop()]);assert.deepEqual(a,b);
 assert.equal(a.result,'passed');assert.equal(a.nativeClientExitVerified,true);assert.equal(calls.stop,1);assert.equal(calls.close,1);assert.equal(calls.saved.length,1);
});
test('native exit failure is retained and repeated cleanup never masks it with a second close',async()=>{
 const {api,child,calls}=fixture();child.emit('close',1);await assert.rejects(api.check(),/stopped: 1/);
 const outcome=await api.settle();assert.equal(outcome.result,'failed');assert.equal(outcome.launcherExited,true);assert.equal(outcome.worldLoaded,null);assert.equal(outcome.nativeClientExitVerified,true);
 await assert.rejects(api.stop(),e=>e.rendererOutcome===outcome&&/client exited 1/.test(e.message));
 assert.equal(calls.close,1);assert.equal(calls.saved.length,1);assert.equal(calls.stop,0);
});
test('unresponsive renderer remains unconfirmed and is never killed or given a success receipt',async()=>{
 const {api,calls}=fixture({sendStop:async()=>{}});const outcome=await api.settle();
 assert.equal(outcome.result,'failed');assert.equal(outcome.launcherExited,false);assert.equal(outcome.logClosed,false);assert.equal(calls.close,0);
 assert.match(outcome.errors.join(' '),/no process was killed/);assert.equal(outcome.worldLoaded,null);
});
test('missing or invalid client receipt is failure even after launcher exit zero',async()=>{
 for(const readReceipt of [async()=>{throw Error('ENOENT');},async()=>({result:'passed',worldLoaded:true})]){
  const {api}=fixture({readReceipt});const outcome=await api.settle();assert.equal(outcome.result,'failed');assert.equal(outcome.nativeClientExitVerified,true);assert.equal(outcome.worldLoaded,null);
 }
});
test('failure to save exit receipt is visible and does not cause repeated native stop attempts',async()=>{
 const {api,calls}=fixture({saveOutcome:async()=>{throw Error('disk full');}});await assert.rejects(api.stop(),/disk full/);await assert.rejects(api.stop(),/disk full/);assert.equal(calls.stop,1);assert.equal(calls.close,1);
});
test('spawn failure is retained without asserting a Minecraft exit receipt',async()=>{
 const {api,child}=fixture({readProcessIdentity:async()=>{throw Error('ENOENT');}});child.pid=undefined;child.emit('error',Error('spawn failed'));const outcome=await api.settle();assert.equal(outcome.result,'failed');assert.equal(outcome.launcherExited,true);assert.equal(outcome.nativeClientExitVerified,false);
});
test('launcher exit cannot certify a still-running or inaccessible exact JVM',async()=>{
 for(const isProcessAlive of [async()=>true,async()=>{throw Error('EPERM');}]){
  const {api}=fixture({isProcessAlive});const outcome=await api.settle();assert.equal(outcome.nativeClientExitVerified,false);assert.equal(outcome.result,'failed');
 }
});
test('missing instance identity blocks restart even with a nominal passed receipt',async()=>{
 const {api}=fixture({readProcessIdentity:async()=>{throw Error('instance mismatch');}});const outcome=await api.settle();assert.equal(outcome.nativeClientExitVerified,false);assert.equal(outcome.result,'failed');
});
