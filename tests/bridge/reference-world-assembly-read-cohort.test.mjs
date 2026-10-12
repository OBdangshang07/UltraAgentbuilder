import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {hash} from '../../src/generation/compiler.mjs';
import {JointReadCohort,jointReadCohortKey,JOINT_READ_COHORT_LIMITS} from '../../bridge/reference-world-assembly-read-cohort.mjs';

const payload=(extra={})=>Buffer.from(JSON.stringify({referenceInput:{ownerId:'synthetic-only'},
  preparationHash:'a'.repeat(64),candidateHash:'b'.repeat(64),...extra}));
const key=jointReadCohortKey('metadata','synthetic-only',payload());
function receipt(keyValue=key){
  const patchSet={format:'AssemblyWorldPatchSet',version:2,partCount:1,operationCount:1,partHashes:['synthetic']};
  const completeSet={...patchSet,patchSetHash:hash(patchSet)};
  const candidate={format:'ReferenceWorldAssemblyCandidate',version:2,partCount:1,operationCount:1,patchSetHash:completeSet.patchSetHash};
  return {kind:'original-complete-rebuild',key:keyValue,patchSet:completeSet,candidate:{...candidate,candidateHash:hash(candidate)}};
}

test('read cohort key binds original job, references, preparation and candidate, not the chosen part',()=>{
  assert.equal(jointReadCohortKey('part','synthetic-only',payload({partIndex:31})),key);
  for(const altered of [{preparationHash:'c'.repeat(64)},{candidateHash:'c'.repeat(64)},{referenceInput:{ownerId:'other'}}])
    assert.notEqual(jointReadCohortKey('metadata','synthetic-only',payload(altered)),key);
  assert.notEqual(jointReadCohortKey('metadata','other',payload()),key);
  for(const operation of ['prepare','native-upload','job-status','bind','apply'])assert.equal(jointReadCohortKey(operation,'synthetic-only',payload()),null);
  for(const bytes of [Buffer.from([255]),Buffer.from('{}'),Buffer.from('null')])assert.equal(jointReadCohortKey('metadata','synthetic-only',bytes),null);
});

test('private cohort is empty until full receipt and owns one immutable bounded entry',()=>{
  const c=new JointReadCohort(),r=receipt();assert.equal(c.acquire(key,1),null);
  c.accept(key,r,10);const kept=c.acquire(key,11);
  assert.equal(Object.isFrozen(kept.candidate),true);assert.equal(Object.isFrozen(kept.patchSet.partHashes),true);
  r.candidate.partCount=99;r.patchSet.partHashes[0]='mutated';assert.equal(kept.candidate.partCount,1);
  assert.equal(kept.patchSet.partHashes[0],'synthetic');assert.equal(c.acquire('other',11),null);
  c.accept('other',receipt('other'),12);assert.equal(c.acquire(key,13),null);assert.equal(c.acquire('other',13).key,'other');
  c.clear();assert.equal(c.acquire('other',14),null);assert.equal(JOINT_READ_COHORT_LIMITS.entries,1);
});

test('read activity cannot extend cohort hard lifetime; clock reversal also invalidates it',()=>{
  const c=new JointReadCohort();c.accept(key,receipt(),10);
  assert.ok(c.acquire(key,10+JOINT_READ_COHORT_LIMITS.lifetimeMs-1));
  assert.equal(c.acquire(key,10+JOINT_READ_COHORT_LIMITS.lifetimeMs),null);
  c.accept(key,receipt(),10);assert.equal(c.acquire(key,9),null);assert.equal(c.acquire(key,11),null);
  c.accept(key,receipt(),10);assert.equal(c.acquire(key,NaN),null);
});

test('partial, unknown, mutated and oversized worker receipts cannot seed a cohort',()=>{
  for(const change of [r=>({...r,kind:'cached-disk-hash'}),r=>({...r,key:'other'}),r=>({...r,candidate:null}),
    r=>({...r,candidate:{...r.candidate,operationCount:2}}),r=>({...r,patchSet:{...r.patchSet,partCount:2}}),
    r=>({...r,padding:'x'.repeat(JOINT_READ_COHORT_LIMITS.bytes+1)})]){
    const c=new JointReadCohort();assert.throws(()=>c.accept(key,change(receipt()),10));assert.equal(c.acquire(key,11),null);
  }
  for(const at of [-1,1.5,NaN])assert.throws(()=>new JointReadCohort().accept(key,receipt(),at));
});

test('cohort transport stays owner-private, is retired on failures/close, and retains fixed worker bounds',async()=>{
  const owner=await fs.readFile(new URL('../../bridge/reference-world-assembly-resources.mjs',import.meta.url),'utf8');
  const worker=await fs.readFile(new URL('../../bridge/reference-world-assembly-resource-worker.mjs',import.meta.url),'utf8');
  assert.match(owner,/#readCohort=new JointReadCohort/);assert.match(owner,/if\(error\)this\.#readCohort\.clear/);
  assert.match(owner,/operationMs:120000,oldGenerationMb:512/);assert.match(owner,/if\(message\.ok===true&&message\.verification\)/);
  assert.match(owner,/item\.resolve\(freeze\(result\)\)/);assert.doesNotMatch(owner,/item\.resolve\(.*verification/);
  assert.match(owner,/if\(item\.settled\|\|this\.closed\)return;[\s\S]*?this\.#readCohort\.accept/);
  assert.match(owner,/item\.worker\.on\('message',[\s\S]*?multiple receipts/);
  assert.match(worker,/exactKeys\(input,\['referenceInput','preparationHash','candidateHash'/);
  assert.match(worker,/cohort===null\s*\?await readReferenceWorldAssemblyCandidate/);
  assert.match(worker,/const reply=\{operation,id,ok:true,result,verification\}/);
  assert.match(worker,/Buffer\.byteLength\(JSON\.stringify\(reply\)\)>JOINT_ASSEMBLY_RESOURCE_LIMITS\.outputBytes/);
  assert.match(worker,/parentPort\.postMessage\(reply\)/);
});
