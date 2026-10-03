import test from 'node:test';
import assert from 'node:assert/strict';
import {waitRendererReady} from '../../scripts/quality-renderer-startup.mjs';

const instanceId='11111111-2222-3333-4444-555555555555';
const identity={instanceId,pid:123,startedAt:1};
const ready={ready:true,assetOnly:true,visible:true};
const missing=()=>{throw Object.assign(Error('missing'),{code:'ENOENT'});};
function fixture(overrides={}){
 let time=0;const observations=[],checks=[];
 const options={instanceId,startupTimeoutMs:3000,reportEveryMs:2000,now:()=>time,wait:async ms=>{time+=ms;},
  lifecycle:{check:async()=>{checks.push(time);}},onObservation:o=>observations.push(o),
  readProcessIdentity:async()=>time>=6000?identity:missing(),readReady:async()=>time>=8000?ready:missing(),...overrides};
 return {options,observations,checks};
}
test('cold launcher preparation exceeding readiness budget does not stop or restart the client',async()=>{
 const {options,observations,checks}=fixture();const result=await waitRendererReady(options);
 assert.deepEqual(result.processIdentity,identity);assert.equal(result.clientReadinessElapsedMs,2000);
 assert.ok(checks.includes(8000));assert.ok(observations.some(o=>o.phase==='launcher-preparing'));
 assert.ok(observations.every(o=>o.terminal===false&&o.replayAllowed===false));
});
test('actual identified client readiness remains bounded',async()=>{
 const {options}=fixture({readProcessIdentity:async()=>identity,readReady:async()=>missing()});
 await assert.rejects(waitRendererReady(options),/client readiness timed out/);
});
test('launcher failure while preparing is preserved without a readiness timeout',async()=>{
 const {options}=fixture({lifecycle:{check:async()=>{throw Error('original launcher exit 1');}}});
 await assert.rejects(waitRendererReady(options),/original launcher exit 1/);
});
test('readiness without a bound exact process is not acceptance',async()=>{
 const {options}=fixture({readProcessIdentity:async()=>missing(),readReady:async()=>ready});
 await assert.rejects(waitRendererReady(options),/no exact renderer process identity/);
});
test('wrong instance and invalid pid or start time are rejected',async()=>{
 for(const change of [{instanceId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'},{pid:0},{startedAt:null}]){
  const {options}=fixture({readProcessIdentity:async()=>({...identity,...change})});
  await assert.rejects(waitRendererReady(options));
 }
});
test('changed or disappeared process identity cannot reset the timer',async()=>{
 for(const second of [()=>({...identity,pid:124}),()=>missing()]){
  let reads=0;const {options}=fixture({readProcessIdentity:async()=>++reads===1?identity:second()});
  await assert.rejects(waitRendererReady(options),/identity changed|identity disappeared/);
 }
});
test('invalid readiness and non-ENOENT read failures are preserved',async()=>{
 for(const bad of [()=>({...ready,assetOnly:false}),()=>{throw Error('invalid JSON');}]){
  const {options}=fixture({readProcessIdentity:async()=>identity,readReady:async()=>bad()});
  await assert.rejects(waitRendererReady(options));
 }
});
test('present null, primitive or array records are corruption, never a missing-file wait',async()=>{
 for(const value of [null,undefined,false,0,'invalid',[]])for(const field of ['readProcessIdentity','readReady']){
  const {options}=fixture({readProcessIdentity:async()=>identity,[field]:async()=>value});
  await assert.rejects(waitRendererReady(options),/Invalid renderer (process|readiness) record/);
 }
});
test('client failure concurrent with ready is not accepted',async()=>{
 let checks=0;const {options}=fixture({readProcessIdentity:async()=>identity,readReady:async()=>ready,
  lifecycle:{check:async()=>{if(++checks===2)throw Error('client failed before readiness acceptance');}}});
 await assert.rejects(waitRendererReady(options),/client failed/);
});
test('timeout and observation configuration cannot silently disable bounds',async()=>{
 for(const change of [{startupTimeoutMs:0},{startupTimeoutMs:NaN},{reportEveryMs:0},{instanceId:'not-a-nonce'}]){
  await assert.rejects(waitRendererReady(fixture(change).options));
 }
});
