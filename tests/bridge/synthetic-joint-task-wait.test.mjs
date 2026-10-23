import test from 'node:test';
import assert from 'node:assert/strict';
import {syntheticJointTaskWait} from './synthetic-joint-task-wait.mjs';

test('synthetic HTTP heartbeats and unchanged polls cannot keep a stalled task alive',()=>{
  let n=1000;const wait=syntheticJointTaskWait({clock:()=>n}),s={state:'running',stageEventsObserved:1,reservedCalls:1};wait.observe(s);
  for(let i=0;i<180;i++){n+=1000;wait.observe(s);}assert.equal(wait.snapshot().reason,'no-observed-progress');
  wait.observe({...s,stageEventsObserved:2});assert.equal(wait.expired(),true,'A timed-out observation cannot be resurrected');
});
test('actual new stage events let a progressing Ultra fixture exceed three total minutes',()=>{
  let n=1000;const wait=syntheticJointTaskWait({clock:()=>n});
  for(let i=0;i<5;i++){n+=150000;wait.observe({state:'running',stageEventsObserved:i,reservedCalls:i});assert.equal(wait.expired(),false);}
  assert.equal(wait.snapshot().elapsedMs,750000);assert.equal(wait.snapshot().noProgressMs,0);
});
test('absolute fifteen-minute synthetic ceiling remains even with continuous progress',()=>{
  let n=0;const wait=syntheticJointTaskWait({clock:()=>n});for(let i=0;i<9;i++){n=i*100000;wait.observe({state:'running',stageEventsObserved:i});}
  n=900000;wait.observe({state:'preview-ready',stageEventsObserved:10,candidate:{candidateHash:'synthetic'}});assert.equal(wait.snapshot().reason,'absolute-test-budget');
});
test('real native/candidate/call evidence advances progress but no-op polls do not',()=>{
  let n=0;const wait=syntheticJointTaskWait({clock:()=>n}),s={state:'running',reservedCalls:1};wait.observe(s);
  n=100000;wait.observe({...s,nativeEvidence:{id:'synthetic-original',state:'waiting'}});n=200000;wait.observe({...s,nativeEvidence:{id:'synthetic-original',state:'complete'}},{syntheticCalls:1,uploadedNativeRequests:1});
  n=300000;wait.observe({...s,candidate:{candidateHash:'synthetic-complete'}},{syntheticCalls:2,uploadedNativeRequests:1});assert.equal(wait.expired(),false);
  n=480000;assert.equal(wait.snapshot().reason,'no-observed-progress');
});
test('regressed or invalid clock is explicit and cannot reset a test lifetime',()=>{
  let n=100;const wait=syntheticJointTaskWait({clock:()=>n});n=99;assert.equal(wait.snapshot().reason,'clock-invalid');n=200;wait.observe({state:'running'});assert.equal(wait.expired(),true);
  let bad=0;const invalid=syntheticJointTaskWait({clock:()=>bad});bad=NaN;assert.equal(invalid.snapshot().reason,'clock-invalid');
});
test('synthetic observer budgets cannot become unbounded or alter any model/world authority',()=>{
  for(const options of [{maximumMs:900001},{maximumMs:1000,noProgressMs:2000},{noProgressMs:0},{clock:null}])assert.throws(()=>syntheticJointTaskWait(options));
  assert.throws(()=>syntheticJointTaskWait({clock:()=>-1}));assert.deepEqual(Object.keys(syntheticJointTaskWait()).sort(),['expired','observe','snapshot']);
});
