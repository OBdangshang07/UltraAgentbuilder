import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCoupledAssemblyPlan,streamCoupledAssemblyParts} from '../../src/world/assembly-coupled-plan.mjs';
import {prepareCoupledAssemblyPreview,validateCoupledAssemblyPreview} from '../../src/world/assembly-coupled-preview.mjs';
import {encodeSparseWorldDifference} from '../../src/world/sparse-world-difference.mjs';
import {coupledNative,coupledSnapshot,coupledDoorEntries,coupledBoundaryEntries} from '../fixtures/assembly-coupled-native.mjs';
import {contextHash} from '../../src/world/context-snapshot.mjs';
import {compileWorldPatch} from '../../src/world/world-patch.mjs';
import {prepareWorldPatchPreview,validateWorldPatchPreview} from '../../src/world/world-patch-preview-data.mjs';

async function fixture(entries=coupledDoorEntries(),options={}){
  const {snapshot}=coupledSnapshot(options),native=coupledNative(entries,options.dimensions),plan=compileCoupledAssemblyPlan(snapshot,native),parts=[],previews=[];
  const set=await streamCoupledAssemblyParts(plan,{onPart:async part=>{parts.push(part);previews.push(prepareCoupledAssemblyPreview(plan,part));}});
  return {snapshot,native,plan,parts,previews,set};
}
function rows(p){return p.sections.flatMap(s=>s.rows.map(([i,b,a,d])=>({position:[s.x*16+i%16,s.y*16+Math.floor(i/256),s.z*16+Math.floor(i/16)%16],before:p.palette[b],after:p.palette[a],difference:['added','removed','replaced'][d]})));}

test('new preview binds complete plan and policy and retains exact absolute native part rows',async()=>{
  const f=await fixture(),p=f.previews[0];assert.equal(p.version,2);assert.equal(p.policy,'coupled-assembly-preview-data-v1');
  assert.equal(p.couplingPlanHash,f.plan.planHash);assert.equal(p.couplingPolicyHash,f.plan.policyHash);assert.equal(p.patchHash,f.parts[0].partHash);
  assert.equal(p.snapshotHash,f.snapshot.snapshotHash);assert.equal(p.contextRevision,f.snapshot.fence.end);assert.deepEqual(p.world,f.snapshot.selection.world);
  assert.deepEqual(rows(p),f.parts[0].writes.map(({position,before,after,difference})=>({position,before,after,difference})));
  for(const key of ['movable','canAuthorizePlacement','serverBaselineVerified','physicsVerified','worldRendered'])assert.equal(p[key],false);
  assert.deepEqual(p.summary,{writes:3,counts:{added:3,removed:0,replaced:0},omittedCells:'keep',explicitKeeps:0});
  const {previewHash,...content}=p;assert.equal(previewHash,contextHash(content));assert.ok(Object.isFrozen(p.sections[0].rows));
  assert.deepEqual(validateCoupledAssemblyPreview(f.plan,f.parts[0],structuredClone(p)),p);
});

test('each half may be displayed across an 8192 boundary only after full native coupling is checked',async()=>{
  const {entries,dimensions}=coupledBoundaryEntries(),f=await fixture(entries,{dimensions});
  assert.equal(f.previews.length,2);assert.deepEqual(f.previews.map(p=>p.summary.writes),[8192,1]);
  assert.equal(rows(f.previews[0]).at(-1).after.includes('half=lower'),true);assert.equal(rows(f.previews[1])[0].after.includes('half=upper'),true);
  assert.ok(f.previews.every(p=>p.couplingPlanHash===f.plan.planHash));
  const invalid=entries.slice(0,-1);assert.throws(()=>compileCoupledAssemblyPlan(f.snapshot,coupledNative(invalid,dimensions)),/both explicit matching/);
});

test('negative chunks and layers retain the original world coordinates without rotation or relocation',async()=>{
  const f=await fixture(undefined,{origin:[-20,-30,-20]}),p=f.previews[0];
  assert.deepEqual(p.bounds,{min:[-19,-30,-19],max:[-18,-27,-18]});
  assert.deepEqual(rows(p).map(r=>r.position),[[-19,-30,-19],[-19,-29,-19],[-19,-28,-19]]);
});

test('CLEAR displays original removed geometry and omission never creates excavation',async()=>{
  const f=await fixture([...coupledDoorEntries(),[[0,1,0],'minecraft:air']],{changes:[[[0,1,0],'minecraft:glass'],[[2,1,2],'minecraft:stone']]}),p=f.previews[0];
  assert.equal(p.summary.counts.removed,1);assert.deepEqual(rows(p).find(r=>r.position.join(',')==='0,1,0'),{position:[0,1,0],before:'minecraft:glass',after:'minecraft:air',difference:'removed'});
  assert.equal(rows(p).some(r=>r.position.join(',')==='2,1,2'),false);
});

test('copied part JSON, a part from another opaque plan and cloned plan reports cannot prepare a preview',async()=>{
  const f=await fixture(),g=await fixture();assert.equal(f.plan.planHash,g.plan.planHash);
  for(const [plan,part]of [[f.plan,structuredClone(f.parts[0])],[f.plan,g.parts[0]],[structuredClone(f.plan),f.parts[0]]])
    assert.throws(()=>prepareCoupledAssemblyPreview(plan,part),/Original complete/);
});

test('rehashing changed geometry, identity, summary or authority never validates the saved preview',async()=>{
  const f=await fixture(),p=f.previews[0];
  for(const change of [v=>v.couplingPlanHash='0'.repeat(64),v=>v.couplingPolicyHash='0'.repeat(64),v=>v.canAuthorizePlacement=true,
    v=>v.movable=true,v=>v.worldRendered=true,v=>v.summary.explicitKeeps=1,v=>v.sections[0].rows.pop(),v=>v.world.dimension='minecraft:the_nether']){
    const v=structuredClone(p);change(v);const {previewHash,...content}=v;v.previewHash=contextHash(content);
    assert.throws(()=>validateCoupledAssemblyPreview(f.plan,f.parts[0],v),/differs/);
  }
});

test('new/legacy preview protocols cannot silently adopt one another despite shared sparse layout',async()=>{
  const f=await fixture([[[1,1,1],'minecraft:glass']]),proposal={format:'WorldPatchProposal',version:1,snapshotHash:f.snapshot.snapshotHash,selectionHash:f.snapshot.selectionHash,
    operations:[{op:'set',position:[1,1,1],before:'minecraft:air',after:'minecraft:glass'}]},patch=compileWorldPatch(f.snapshot,proposal),legacy=prepareWorldPatchPreview(f.snapshot,patch);
  assert.deepEqual(legacy.palette,f.previews[0].palette);assert.deepEqual(legacy.sections,f.previews[0].sections);
  assert.equal(legacy.version,1);assert.equal(Object.hasOwn(legacy,'couplingPlanHash'),false);
  assert.throws(()=>validateWorldPatchPreview(f.snapshot,patch,f.previews[0]),/unexpected or missing/);
  assert.throws(()=>validateCoupledAssemblyPreview(f.plan,f.parts[0],legacy),/unexpected or missing/);
});

test('preview preparation and validation cancel without publishing a partial display',async()=>{
  const f=await fixture(),c=new AbortController();c.abort();
  assert.throws(()=>prepareCoupledAssemblyPreview(f.plan,f.parts[0],{signal:c.signal}),{name:'AbortError'});
  assert.throws(()=>validateCoupledAssemblyPreview(f.plan,f.parts[0],f.previews[0],{signal:c.signal}),{name:'AbortError'});
});

test('shared encoder rejects duplicate/no-op/misclassified rows and caller input stays unchanged',()=>{
  const writes=[{position:[-1,-1,-1],before:'minecraft:air',after:'minecraft:glass',difference:'added'}],before=structuredClone(writes),g=encodeSparseWorldDifference(writes);
  assert.deepEqual(writes,before);assert.deepEqual(g.bounds,{min:[-1,-1,-1],max:[0,0,0]});assert.equal(g.sections[0].rows[0][0],4095);
  assert.throws(()=>encodeSparseWorldDifference([...writes,...writes]),/duplicates/);
  assert.throws(()=>encodeSparseWorldDifference([{...writes[0],difference:'removed'}]),/classification/);
  assert.throws(()=>encodeSparseWorldDifference([{...writes[0],after:'minecraft:cave_air'}]),/no-op/);
  assert.throws(()=>encodeSparseWorldDifference([]),/quota/);
});
