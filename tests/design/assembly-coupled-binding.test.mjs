import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../../src/generation/compiler.mjs';
import {coupledNative,coupledSnapshot,coupledBoundaryEntries} from '../fixtures/assembly-coupled-native.mjs';
import {compileCoupledAssemblyPlan,streamCoupledAssemblyParts,coupledAssemblyNativeData} from '../../src/world/assembly-coupled-plan.mjs';
import {prepareCoupledAssemblyPreview} from '../../src/world/assembly-coupled-preview.mjs';
import {prepareCoupledAssemblyBinding} from '../../src/world/assembly-coupled-binding.mjs';

async function fixture(entries,options={}){
  const {snapshot}=coupledSnapshot(options),native=coupledNative(entries,options.dimensions),sourceHash=hash('synthetic-source');
  native.manifest.scene={sourceHash};const {assetHash,...metadata}=native.manifest;native.manifest.assetHash=hash(metadata);
  const plan=compileCoupledAssemblyPlan(snapshot,native),parts=[],previews=[],set=await streamCoupledAssemblyParts(plan,{onPart:async p=>{parts.push(p);previews.push(prepareCoupledAssemblyPreview(plan,p));}});
  const source={captureId:'eeeeeeee-0000-4000-8000-000000000001',selection:snapshot.selection,jobId:'dddddddd-0000-4000-8000-000000000002',sourceHash};
  for(const key of ['worldContextHash','preparationHash','requestHash','runtimeHash','referenceSetHash','contextRecordHash','referenceBindingHash','currentNativeEvidenceHash','candidateHash'])source[key]=hash('synthetic-'+key);
  return {snapshot,native,plan,parts,previews,set,source};
}

test('complete original set/previews/source prepare an explicit readonly binding, not old v2 consent',async()=>{
  const f=await fixture(),b=prepareCoupledAssemblyBinding(f.plan,f.set,f.previews,f.source);
  assert.equal(b.format,'CoupledAssemblyBinding');assert.equal(b.version,1);assert.equal(b.couplingPlanHash,f.plan.planHash);assert.equal(b.couplingPolicyHash,f.plan.policyHash);
  assert.equal(b.analysisHash,f.plan.analysisHash);assert.equal(b.scheduleHash,f.plan.scheduleHash);assert.equal(b.snapshotHash,f.snapshot.snapshotHash);assert.equal(b.contextRevision,f.snapshot.fence.end);
  assert.deepEqual(b.partHashes,f.set.partHashes);assert.deepEqual(b.previewHashes,f.previews.map(p=>p.previewHash));assert.deepEqual(b.origin,f.snapshot.selection.edit.min);
  for(const k of ['movable','canAuthorizePlacement','canAuthorizeModelSend','serverBaselineVerified','physicsVerified'])assert.equal(b[k],false);assert.equal(b.worldWrites,0);
  assert.equal(b.sourceAuthority,'client-submitted-facts-not-server-attestation');assert.ok(Object.isFrozen(b.partHashes));
});

test('copies of sets/previews and another opaque plan cannot prepare a bound complete input',async()=>{
  const f=await fixture(),g=await fixture();
  for(const [set,previews]of [[structuredClone(f.set),f.previews],[g.set,f.previews],[f.set,structuredClone(f.previews)],[f.set,g.previews]])
    assert.throws(()=>prepareCoupledAssemblyBinding(f.plan,set,previews,f.source),/Original/);
});

test('every part and preview must remain present and ordered across a native door boundary',async()=>{
  const {entries,dimensions}=coupledBoundaryEntries(),f=await fixture(entries,{dimensions});
  assert.equal(prepareCoupledAssemblyBinding(f.plan,f.set,f.previews,f.source).partHashes.length,2);
  assert.throws(()=>prepareCoupledAssemblyBinding(f.plan,f.set,f.previews.slice(0,1),f.source),/All original/);
  assert.throws(()=>prepareCoupledAssemblyBinding(f.plan,f.set,[...f.previews].reverse(),f.source),/Original/);
  assert.throws(()=>prepareCoupledAssemblyBinding(f.plan,f.set,[f.previews[0],f.previews[0]],f.source),/Original/);
});

test('source selection and native SceneSpec identity are retained without caller rebasing',async()=>{
  const f=await fixture();
  for(const change of [s=>s.selection.revision++,s=>s.selection.world.worldId='other_world',s=>s.sourceHash='0'.repeat(64)]){
    const s=structuredClone(f.source);change(s);assert.throws(()=>prepareCoupledAssemblyBinding(f.plan,f.set,f.previews,s),/original|exact native/);
  }
});

test('source identity cannot add write flags, omit fields or provide malformed UUID/hash values',async()=>{
  const f=await fixture();
  for(const change of [s=>s.canAuthorizePlacement=true,s=>delete s.runtimeHash,s=>s.captureId='not-a-uuid',s=>s.candidateHash='not-a-hash']){
    const s=structuredClone(f.source);change(s);assert.throws(()=>prepareCoupledAssemblyBinding(f.plan,f.set,f.previews,s));
  }
});

test('exported native input owns defensive copies and cannot alter the checked plan',async()=>{
  const f=await fixture(),n=coupledAssemblyNativeData(f.plan);n.binary.fill(0);n.manifest.palette.fill('minecraft:air');
  const actual=coupledAssemblyNativeData(f.plan);assert.deepEqual(actual.binary,f.native.binary);assert.deepEqual(actual.manifest,f.native.manifest);
  assert.equal(prepareCoupledAssemblyBinding(f.plan,f.set,f.previews,f.source).assetHash,f.native.manifest.assetHash);
  assert.throws(()=>coupledAssemblyNativeData(structuredClone(f.plan)),/Original complete/);
});

test('cancelled or failed stream cannot fabricate a completed-set identity',async()=>{
  const f=await fixture(),c=new AbortController();c.abort();
  assert.throws(()=>prepareCoupledAssemblyBinding(f.plan,f.set,f.previews,f.source,{signal:c.signal}),{name:'AbortError'});
  let forged;await assert.rejects(streamCoupledAssemblyParts(f.plan,{onPart:async p=>{forged={...f.set,partHashes:[p.partHash]};throw Error('no receipt');}}),/no receipt/);
  assert.throws(()=>prepareCoupledAssemblyBinding(f.plan,forged,f.previews,f.source),/Original completed/);
});
