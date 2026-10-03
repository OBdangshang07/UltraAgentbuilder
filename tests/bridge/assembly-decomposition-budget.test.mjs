import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../../src/generation/compiler.mjs';
import {createDecompositionSchedule,decompositionBlueprintBudget,decompositionCallBudget,decompositionPreludeProgress} from '../../bridge/assembly-decomposition-budget.mjs';
const packages=n=>Array.from({length:n},(_,i)=>'task'+i);
const setup=(delta={})=>createDecompositionSchedule({maximumCalls:26,packageIds:packages(8),...delta});
const record=(schedule,records,outcome)=>{
 const b=decompositionCallBudget(schedule,records);assert.equal(b.canStart,true);
 return {index:records.length+1,stageId:b.nextStage.id,kind:b.nextKind,outcome};
};

test('three concepts, selection, blueprint, four prototypes, review, eight details and final review fund 19+7 calls',()=>{
 const s=setup(),before=structuredClone(s),records=[];
 assert.equal(s.stages.length,19);assert.equal(decompositionBlueprintBudget({maximumCalls:26}).maximumPackages,8);
 for(const stage of s.stages){const b=decompositionCallBudget(s,records);assert.equal(b.nextStage.id,stage.id);assert.equal(b.availableRecoveryCalls,7);records.push(record(s,records,'accepted'));}
 const final=decompositionCallBudget(s,records);assert.equal(final.finished,true);assert.equal(final.canStart,false);assert.equal(final.canAuthorizePlacement,false);assert.equal(records.length,19);
 assert.deepEqual(s,before);
});

test('reference schedule v2 explicitly funds one prelude, unchanged responsibilities and nine shared corrections',()=>{
 const s=setup({preludeCalls:1,packageIds:packages(5),recoveryReserve:9}),records=[];
 assert.equal(s.version,2);assert.equal(s.stages.length,17);assert.equal(s.stages[0].id,'reference-analysis');
 assert.equal(s.stages.filter(v=>v.phase==='prototype-role').length,4);
 for(let n=0;n<s.stages.length;n++){
  if(n<9)records.push(record(s,records,'rejected'));
  records.push(record(s,records,'accepted'));
 }
 const final=decompositionCallBudget(s,records);assert.equal(records.length,26);assert.equal(final.finished,true);
 assert.equal(final.version,2);assert.equal(final.availableRecoveryCalls,0);
});

test('reference prelude is mandatory progress, while only its rejected/format-correction calls consume recovery',()=>{
 const config={maximumCalls:26,maximumPackages:5,recoveryReserve:9,preludeCalls:1};
 const before=decompositionBlueprintBudget(config);assert.equal(before.maximumPackages,5);assert.equal(before.fixedCalls,12);
 for(let corrected=0;corrected<=9;corrected++){
  const after=decompositionBlueprintBudget(config,{reservedCalls:5+corrected,completedPrelude:1,completedCandidates:3,selectionAccepted:true});
  assert.equal(after.maximumPackages,5);assert.equal(after.consumedRecovery,corrected);
  assert.equal(after.remainingRecovery,9-corrected);assert.equal(after.version,2);
 }
 assert.throws(()=>decompositionBlueprintBudget(config,{reservedCalls:4,completedCandidates:3,selectionAccepted:true}),/prelude/);
 assert.throws(()=>decompositionBlueprintBudget(config,{reservedCalls:0,completedPrelude:1}),/exceeds reserved/);
 for(const preludeCalls of [-1,2,0.5])assert.throws(()=>decompositionBlueprintBudget({...config,preludeCalls}));
});

test('a rehashed schedule cannot remove, reorder or disguise reference analysis as legacy v1',()=>{
 const s=setup({preludeCalls:1,packageIds:packages(5),recoveryReserve:9});
 for(const change of [v=>v.stages.shift(),v=>v.stages.reverse(),v=>v.version=1,v=>v.preludeCalls=0,v=>delete v.preludeCalls]){
  const {scheduleHash,...data}=structuredClone(s);change(data);
  assert.throws(()=>decompositionCallBudget({...data,scheduleHash:hash(data)},[]),/Invalid decomposition schedule/);
 }
 const old=setup();assert.equal(old.version,1);assert.equal(Object.hasOwn(old,'preludeCalls'),false);
});

test('decomposition cannot start after an unknown, rejected or missing reference analysis',()=>{
 const tier={referenceAnalysis:{requiredCalls:1}};
 const accepted={phase:'correct-reference-analysis',state:'accepted',decompositionStageId:'reference-analysis'};
 assert.deepEqual(decompositionPreludeProgress(tier,[{...accepted,phase:'reference-analysis',state:'rejected'},accepted]),{completedPrelude:1});
 assert.deepEqual(decompositionPreludeProgress(tier,[{...accepted,phase:'reference-analysis',state:'failed',invocationOutcome:'completed-invalid-json'},accepted]),{completedPrelude:1});
 for(const records of [[],[{...accepted,state:'reserved'}],[{...accepted,state:'rejected'}],
  [{...accepted,state:'failed',invocationOutcome:'unknown'},accepted],[accepted,accepted],
  [{...accepted,decompositionStageId:'foreign'}],[{...accepted,phase:'plan'},accepted]])
  assert.throws(()=>decompositionPreludeProgress(tier,records),/accepted durable reference prelude/);
 assert.deepEqual(decompositionPreludeProgress({},[]),{});
});
test('all prefix progress/correction counts retain reserved headroom instead of borrowing the required tail',()=>{
 for(let candidates=1;candidates<=3;candidates++)for(let done=0;done<=candidates;done++)for(const selected of [false,true]){
  if(selected&&done!==candidates)continue;
  for(let corrections=0;corrections<=7;corrections++){
   const b=decompositionBlueprintBudget({maximumCalls:26,candidateCount:candidates},{reservedCalls:done+Number(selected)+corrections,completedCandidates:done,selectionAccepted:selected});
   assert.equal(b.maximumPackages,11-candidates);assert.equal(b.remainingRecovery,7-corrections);assert.equal(b.canStart,true);
  }
 }
 assert.throws(()=>decompositionBlueprintBudget({maximumCalls:26},{reservedCalls:2,completedCandidates:3}),/exceeds reserved/);
 assert.throws(()=>decompositionBlueprintBudget({maximumCalls:26},{selectionAccepted:true}),/selection progress/);
});
test('exhaustive permitted limits/counts fund every accepted schedule without deleting a stage',()=>{
 let accepted=0,rejected=0;
 for(let limit=1;limit<=26;limit++)for(let candidates=1;candidates<=3;candidates++)for(let count=4;count<=16;count++)for(const reserve of [0,1,7]){
  const required=candidates+8+count,args={maximumCalls:limit,candidateCount:candidates,packageIds:packages(count),recoveryReserve:reserve};
  if(required+reserve>limit){assert.throws(()=>createDecompositionSchedule(args),/cannot fund/);rejected++;continue;}
  const s=createDecompositionSchedule(args),records=[];assert.equal(s.stages.length,required);
  for(let n=0;n<required;n++)records.push(record(s,records,'accepted'));
  assert.equal(decompositionCallBudget(s,records).finished,true);accepted++;
 }
 assert.ok(accepted>0&&rejected>0);
});
test('seven rejected completed proposals can be corrected and still finish the full 26-call path',()=>{
 const s=setup(),records=[];
 for(let n=0;n<s.stages.length;n++){
  if(n<7)records.push(record(s,records,'rejected'));
  records.push(record(s,records,'accepted'));
 }
 assert.equal(records.length,26);const b=decompositionCallBudget(s,records);assert.equal(b.finished,true);assert.equal(b.availableRecoveryCalls,0);
});
test('correction feasibility is checked at every stage and spare count, including the final stage',()=>{
 const s=setup();
 for(let current=0;current<s.stages.length;current++)for(let failures=0;failures<=8;failures++){
  const records=[];for(let n=0;n<current;n++)records.push(record(s,records,'accepted'));
  for(let n=0;n<failures;n++)records.push(record(s,records,'rejected'));
  const b=decompositionCallBudget(s,records);assert.equal(b.canStart,failures<=7);
  if(failures<=7){while(decompositionCallBudget(s,records).canStart)records.push(record(s,records,'accepted'));assert.equal(decompositionCallBudget(s,records).finished,true);assert.ok(records.length<=26);}
  else{assert.equal(b.stopReason,'required-path-unfunded');assert.equal(b.mandatoryRemaining,s.stages.length-current);}
 }
});
test('unknown, pending, cancelled and failed provider outcomes never create a replacement call',()=>{
 const s=setup();for(const outcome of ['unknown','pending','cancelled','failed']){
  const records=[record(s,[],outcome)],b=decompositionCallBudget(s,records);
  assert.equal(b.canStart,false);assert.equal(b.stopReason,'provider-'+outcome);
  assert.throws(()=>decompositionCallBudget(s,[...records,{index:2,stageId:s.stages[0].id,kind:'correction',outcome:'accepted'}]),/order/);
 }
});
test('changed, rehashed, stale, skipped and disguised repeat schedules/ledgers are rejected',()=>{
 const s=setup(),tampered=structuredClone(s);tampered.stages.pop();assert.throws(()=>decompositionCallBudget(tampered,[]),/identity changed/);
 const {scheduleHash,...data}=tampered;assert.throws(()=>decompositionCallBudget({...data,scheduleHash:hash(data)},[]),/Invalid decomposition schedule/);
 for(const first of [{index:2,stageId:s.stages[0].id,kind:'primary',outcome:'accepted'},
  {index:1,stageId:s.stages[1].id,kind:'primary',outcome:'accepted'},
  {index:1,stageId:s.stages[0].id,kind:'correction',outcome:'accepted'}])assert.throws(()=>decompositionCallBudget(s,[first]),/order/);
 const rejected=record(s,[],'rejected');assert.throws(()=>decompositionCallBudget(s,[rejected,{...rejected,index:2,outcome:'accepted'}]),/order/);
 assert.throws(()=>setup({maximumCalls:27}),/call limit/);
 assert.throws(()=>setup({packageIds:['same','same','third','fourth']}),/packages/);
});
