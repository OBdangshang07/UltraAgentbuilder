import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

// A launcher may still be compiling a fresh source fork. That is not elapsed
// Minecraft readiness time and does not authorize stop/restart or job replay.
export async function waitRendererReady({lifecycle,readProcessIdentity,readReady,instanceId,
 startupTimeoutMs=180000,now=Date.now,wait=delay,onObservation=()=>{},reportEveryMs=60000}){
 assert.ok(Number.isSafeInteger(startupTimeoutMs)&&startupTimeoutMs>0);
 assert.ok(Number.isSafeInteger(reportEveryMs)&&reportEveryMs>0);
 assert.match(instanceId,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
 let identity=null,observedAt=null,lastReported=now();
 const missing=Symbol('missing');
 const optional=async read=>{try{return await read();}catch(error){if(error.code==='ENOENT')return missing;throw error;}};
 for(;;){
  await lifecycle.check();
  const current=await optional(readProcessIdentity);
  if(current!==missing){
   assert.ok(current!==null&&typeof current==='object'&&!Array.isArray(current),'Invalid renderer process record');
   assert.equal(current.instanceId,instanceId,'Renderer startup instance changed');
   assert.ok(Number.isSafeInteger(current.pid)&&current.pid>0);
   assert.ok(Number.isSafeInteger(current.startedAt)&&current.startedAt>0);
   if(identity)assert.deepEqual(current,identity,'Exact renderer process identity changed during startup');
   else{identity=structuredClone(current);observedAt=now();}
  }else if(identity)throw Error('Exact renderer process identity disappeared during startup');
  const ready=await optional(readReady);
  if(ready!==missing){
   assert.ok(ready!==null&&typeof ready==='object'&&!Array.isArray(ready),'Invalid renderer readiness record');
   assert.ok(identity,'Readiness has no exact renderer process identity');
   assert.equal(ready.ready,true);assert.equal(ready.assetOnly,true);assert.equal(ready.visible,true);
   await lifecycle.check();
   return {processIdentity:identity,clientReadinessElapsedMs:now()-observedAt};
  }
  const time=now();
  if(identity&&time-observedAt>=startupTimeoutMs)throw Error('Exact renderer client readiness timed out');
  if(time-lastReported>=reportEveryMs){lastReported=time;onObservation({phase:identity?'client-readiness':'launcher-preparing',
   terminal:false,replayAllowed:false,clientReadinessElapsedMs:identity?time-observedAt:null});}
  await wait(1000);
 }
}
