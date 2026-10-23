import test from 'node:test';
import assert from 'node:assert/strict';
import {coupledSnapshot,coupledNative,coupledDoorEntries} from '../fixtures/assembly-coupled-native.mjs';
import {prepareAssemblyWorldContext,assemblyWorldContextData,WORLD_ASSEMBLY_RULES,compileAssemblyWorldPatch} from '../../src/world/assembly-context.mjs';
import {prepareCoupledAssemblyWorldContext,coupledAssemblyWorldContextData,assemblyGenerationContext,compileCoupledAssemblyContextPlan,COUPLED_ASSEMBLY_GENERATION_RULES,COUPLED_ASSEMBLY_GENERATION_PROTOCOL_HASH} from '../../src/world/assembly-coupled-context.mjs';
import {ASSEMBLY_COUPLING_POLICY_HASH} from '../../contracts/assembly-coupling-policy.mjs';
import {contextHash} from '../../src/world/context-snapshot.mjs';

test('new coupled generation context retains complete original exact baseline and immutable scope',()=>{
  const f=coupledSnapshot({origin:[-20,-30,-20]}),legacy=assemblyWorldContextData(prepareAssemblyWorldContext(f.snapshot)),c=prepareCoupledAssemblyWorldContext(f.snapshot),data=coupledAssemblyWorldContextData(c);
  assert.equal(data.format,'CoupledAssemblyWorldContext');assert.equal(data.version,1);assert.notEqual(data.worldContextHash,legacy.worldContextHash);
  for(const key of ['snapshotHash','selectionHash','origin','maximumBounds','context','edit','protected','world','contextRevision','contextSummary','exactBaseline'])assert.deepEqual(data[key],legacy[key],key);
  assert.equal(data.baselineEvidenceProtocolHash,legacy.protocolHash);assert.equal(data.protocolHash,COUPLED_ASSEMBLY_GENERATION_PROTOCOL_HASH);assert.equal(data.couplingPolicyHash,ASSEMBLY_COUPLING_POLICY_HASH);
  for(const key of ['canAuthorizePlacement','serverBaselineVerified','physicsVerified','legacyConsentTransferable'])assert.equal(data[key],false);
});
test('only original opaque context chooses new rules; JSON hashes and legacy context cannot acquire it',()=>{
  const f=coupledSnapshot(),old=prepareAssemblyWorldContext(f.snapshot),c=prepareCoupledAssemblyWorldContext(f.snapshot),native=coupledNative(coupledDoorEntries());
  assert.deepEqual(assemblyGenerationContext(old),{data:assemblyWorldContextData(old),rules:WORLD_ASSEMBLY_RULES});
  assert.equal(assemblyGenerationContext(c).rules,COUPLED_ASSEMBLY_GENERATION_RULES);
  for(const fake of [structuredClone(c),{...c},assemblyWorldContextData(old)]){assert.throws(()=>assemblyGenerationContext(fake),/Original opaque/);assert.throws(()=>compileCoupledAssemblyContextPlan(fake,native),/Original coupled/);}
  assert.throws(()=>coupledAssemblyWorldContextData(old),/opaque coupled/);assert.throws(()=>assemblyWorldContextData(c),/opaque assembly/);assert.throws(()=>compileAssemblyWorldPatch(c,native),/opaque assembly/);
});
test('catalog discloses exact new dry/unpowered special states and excluded target kinds',()=>{
  const c=prepareCoupledAssemblyWorldContext(coupledSnapshot().snapshot),data=coupledAssemblyWorldContextData(c),ids=data.targetCatalog.map(r=>r.id);
  for(const suffix of ['_door','_trapdoor','_stairs','_slab'])assert.ok(ids.some(id=>id.endsWith(suffix)));
  assert.equal(ids.some(id=>id.endsWith('_leaves')||id==='minecraft:light'||id==='minecraft:air'),false);
  for(const row of data.targetCatalog)for(const key of ['waterlogged','powered'])if(row.properties[key])assert.deepEqual(row.properties[key],['false']);
  assert.match(COUPLED_ASSEMBLY_GENERATION_RULES,/both matching lower\/upper/);assert.match(COUPLED_ASSEMBLY_GENERATION_RULES,/Existing coupled BEFORE/);assert.match(COUPLED_ASSEMBLY_GENERATION_RULES,/no invented attachment requirement/);
  assert.equal(COUPLED_ASSEMBLY_GENERATION_RULES.includes('The current static patch policy rejects unsupported coupled/dynamic states'),false);
});
test('whole native doors compile only from original new context; no candidate or write authority appears',()=>{
  const f=coupledSnapshot(),c=prepareCoupledAssemblyWorldContext(f.snapshot),plan=compileCoupledAssemblyContextPlan(c,coupledNative(coupledDoorEntries()));assert.equal(plan.operationCount,3);assert.equal(plan.pairCount,1);assert.equal(plan.canAuthorizePlacement,false);assert.equal(plan.worldWrites,0);
  assert.throws(()=>compileCoupledAssemblyContextPlan(c,coupledNative(coupledDoorEntries().slice(0,2))),/door|pair|upper/i);
});
test('defensive generation data cannot change checked original context or lowering origin',()=>{
  const f=coupledSnapshot(),c=prepareCoupledAssemblyWorldContext(f.snapshot),first=coupledAssemblyWorldContextData(c),hash=first.worldContextHash;
  first.origin[0]+=100;first.targetCatalog.length=0;first.exactBaseline.regions.length=0;
  const again=coupledAssemblyWorldContextData(c);assert.equal(again.worldContextHash,hash);assert.notEqual(again.origin[0],first.origin[0]);assert.ok(again.targetCatalog.length>0);assert.ok(again.exactBaseline.regions.length>0);
  const {worldContextHash,...content}=again;assert.equal(contextHash(content),worldContextHash);
});
test('cancelled preparation never returns a truncated or copied new context',()=>{
  const controller=new AbortController();controller.abort(Error('synthetic cancellation'));assert.throws(()=>prepareCoupledAssemblyWorldContext(coupledSnapshot().snapshot,{signal:controller.signal}),/synthetic cancellation/);
});
