import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectOriginalStatus,observeOriginalTurn} from '../../bridge/codex-turn-observer.mjs';

const identity={threadId:'thread-original',turnId:'turn-original'};
const result=(status='active')=>({thread:{id:identity.threadId,ephemeral:true,status:{type:status}}});

test('original ephemeral status observations never manufacture a terminal receipt',()=>{
 for(const status of ['active','idle','systemError','notLoaded']){
  const r=result(status);r.thread.turns=[{id:identity.turnId,status:'completed',items:[{text:'PRIVATE'}]}];
  const checked=inspectOriginalStatus(r,identity);
  assert.equal(checked.terminal,false);assert.equal(checked.completionRecoveryAvailable,false);
  assert.equal(checked.runtimeStatus,status);assert.ok(!JSON.stringify(checked).includes('PRIVATE'));
  assert.equal(checked.receiptState,status==='active'?'awaiting-original-notification':'unresolved-terminal-receipt');
 }
});

test('status observation rejects foreign threads and unknown runtime states',()=>{
 for(const r of [{thread:{...result().thread,id:'foreign'}},result('unknown'),{thread:{id:identity.threadId}}])assert.throws(()=>inspectOriginalStatus(r,identity));
});

test('observer uses only summary thread/read supported by actual ephemeral CLI',async()=>{
 const calls=[],seen=[];
 const watch=observeOriginalTurn({...identity,intervalMs:60000,
  request:async(method,params)=>{calls.push({method,params});return result('idle');},
  onObservation:e=>seen.push(e),onUnavailable:()=>assert.fail('Read is supported')});
 try{await watch.poll();await watch.poll();}
 finally{watch.stop();}
 assert.equal(calls.length,2);assert.ok(calls.every(c=>c.method==='thread/read'));
 assert.deepEqual(calls[0].params,{threadId:identity.threadId,includeTurns:false});
 assert.equal(seen.length,2);assert.ok(seen.every(e=>e.terminal===false&&e.receiptState==='unresolved-terminal-receipt'));
});

test('late read after stop is ignored; callback failures cannot escape polling',async()=>{
 let complete,observed=0;
 const watch=observeOriginalTurn({...identity,intervalMs:60000,request:()=>new Promise(resolve=>{complete=resolve;}),
  onObservation:()=>observed++,onUnavailable:()=>{throw Error('Diagnostic failure');}});
 const pending=watch.poll();watch.stop();complete(result('idle'));await pending;
 assert.equal(observed,0);
 const failed=observeOriginalTurn({...identity,intervalMs:60000,request:async()=>{throw Error('No service');},
  onObservation:()=>{},onUnavailable:()=>{throw Error('Diagnostic failure');}});
 try{await failed.poll();}finally{failed.stop();}
});
