import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../../src/generation/compiler.mjs';
import {compileScene} from '../../src/design/compiler.mjs';
import {applyPrototypeExpansion} from '../../contracts/scene-prototype-expansion.mjs';
import {checkDecomposedResponsibilities} from '../../contracts/scene-decomposed-prototypes.mjs';
import {DESIGN_ALLOCATION_POLICY,stagedDesignAllocationEnabled,checkStagedDesignAllocation} from '../../contracts/scene-design-allocation.mjs';
import {designAllocationCoverage,designAllocationFreeze} from '../../bridge/assembly-design-allocation.mjs';
import {PROTOTYPE_ROLES} from '../../contracts/scene-decomposition-roles.mjs';
import {assemblyPlan} from './assembly-fixtures.mjs';
import {shape} from './fixtures.mjs';

// Hand-authored protocol/authority probes, not CBD quality or live AI evidence.
const tier={maxPackages:5,prototypes:{version:5,mode:'staged',designAllocation:structuredClone(DESIGN_ALLOCATION_POLICY)}};
function fixture(){
 const plan=assemblyPlan(true),roles=PROTOTYPE_ROLES.map((role,i)=>({role,task:'task'+i})),representatives={};
 plan.packages=roles.map(({task},i)=>({id:task,name:'Fixture '+i,purpose:'Protocol witness and explicitly deferred upper/rear work',dependsOn:i?['task'+(i-1)]:[],
  regions:[{origin:[12+i*2,0,20],size:[2,183,2]}],editableComponents:[task+'__a',task+'__b'],interfaces:[0]}));
 for(const [i,{role,task}] of roles.entries()){
  plan.scene.components.push(shape(task+'__a',[12+i*2,1,20],[1,1,1]),shape(task+'__b',[12+i*2,1,21],[1,1,1]));
  representatives[role]=[{kind:'synthetic-a',components:[task+'__a']},{kind:'synthetic-b',components:[task+'__b']}];
 }
 return {plan,roles,representatives};
}
test('explicit v5 pre-freeze allocation accepts upper/rear work delta without upgrading frozen legacy semantics',()=>{
 const {plan,representatives}=fixture(),before=hash(plan),next=structuredClone(plan);
 next.packages[1].regions[0].size[1]=224;next.packages[1].regions.push({origin:[14,0,26],size:[2,224,2]});next.packages[1].purpose+='; include upper and rear refinement';
 assert.throws(()=>checkDecomposedResponsibilities(plan,next,representatives),/frozen/);
 assert.throws(()=>checkStagedDesignAllocation(plan,next,representatives,{...tier,prototypes:{version:4,mode:'staged'}}),/frozen/);
 const receipt=checkStagedDesignAllocation(plan,next,representatives,tier);
 assert.equal(receipt.deltas.length,1);assert.deepEqual(receipt.deltas[0].fields,['purpose','regions']);
 assert.equal(receipt.worldAuthorityChanged,false);assert.equal(receipt.componentOwnershipTransferred,false);assert.equal(receipt.canAuthorizePlacement,false);
 assert.equal(receipt.basePlanHash,before);assert.equal(receipt.candidatePlanHash,hash(next));assert.equal(hash(plan),before);
 const {allocationHash,...data}=receipt;assert.equal(allocationHash,hash(data));
 assert.throws(()=>stagedDesignAllocationEnabled({...tier,prototypes:{...tier.prototypes,version:4}}),/Legacy/);
 assert.throws(()=>stagedDesignAllocationEnabled({...tier,prototypes:{...tier.prototypes,designAllocation:{version:1,mode:'unbounded'}}}),/Invalid/);
});
test('allocation never drops responsibilities, existing workspace, ownership, scale, protections or witnesses',()=>{
 for(const change of [
  p=>p.packages.pop(),p=>p.packages.reverse(),p=>p.packages[1].id='newtask',p=>p.packages[1].dependsOn=[],p=>p.packages[1].interfaces=[1],
  p=>p.packages[1].regions[0].size[1]=182,p=>p.packages[1].regions[0].size[1]=225,p=>p.packages[1].editableComponents=[],
  p=>{p.packages[0].editableComponents.push(p.packages[1].editableComponents.shift());},p=>p.scene.bounds.height=223,p=>p.designIntent='Changed',
  p=>p.scene.components=p.scene.components.filter(c=>c.id!=='task0__a'),p=>p.scene.components=p.scene.components.filter(c=>c.id!=='flights'),
  p=>p.scene.reservations.push({id:'newReservation',at:{relativeTo:null,anchor:'min',offset:[12,1,20]},size:[1,1,1],allowedComponents:[]})
 ]){
  const {plan,representatives}=fixture(),before=hash(plan),next=structuredClone(plan);change(next);
  assert.throws(()=>checkStagedDesignAllocation(plan,next,representatives,tier));assert.equal(hash(plan),before);
 }
});
test('every actual last-floor instance is checked against allocation, not just first-seed bounds or witness names',()=>{
 const {plan,roles,representatives}=fixture(),recipes=[{component:'task1__a',mode:'repeat',count:44,step:[0,5,0]}];
 const seed=compileScene(plan.scene,{navigationPolicy:'review'});
 assert.equal(designAllocationCoverage(plan,seed,roles,representatives,recipes).allRequiredSourceCellsCovered,true);
 const expanded={...plan,scene:applyPrototypeExpansion(plan.scene,{format:'ScenePrototypeExpansion',version:1,seedSourceHash:hash(plan.scene),recipes})};
 const compiled=compileScene(expanded.scene,{navigationPolicy:'review'});
 assert.throws(()=>designAllocationCoverage(expanded,compiled,roles,representatives,recipes),/misses actual witness\/expanded cell.*task1/);
 expanded.packages=structuredClone(plan.packages);expanded.packages[1].regions[0].size[1]=224;
 const evidence=designAllocationCoverage(expanded,compiled,roles,representatives,recipes);
 assert.equal(evidence.sources.find(s=>s.id==='task1__a').cells,44);assert.equal(evidence.futureWorkComplete,false);
 const wrong=structuredClone(expanded);wrong.packages[1].regions[0].origin[0]++;
 assert.throws(()=>designAllocationCoverage(wrong,compiled,roles,representatives,recipes),/misses actual/);
 const other=structuredClone(plan);other.scene.seed++;
 assert.throws(()=>designAllocationCoverage(other,seed,roles,representatives,recipes),/source mismatch/);
});
test('manufacturing freeze binds the exact allocation, accepted review and checked expansion, never placement',()=>{
 const {plan}=fixture(),seedHash=hash(plan),programHash='a'.repeat(64),assetHash='b'.repeat(64),review={verdict:'accept',planHash:seedHash};
 const receipt={receiptHash:'c'.repeat(64),authority:{candidatePlanHash:seedHash},expandedPlanHash:seedHash,programHash,expanded:{assetHash}};
 const transition={seedPlanHash:seedHash,programHash,expandedAssetHash:assetHash,reviewHash:hash(review),transitionHash:'d'.repeat(64)};
 const frozen=designAllocationFreeze(receipt,{plan,review,transition});assert.equal(frozen.manufacturingScopeFrozen,true);assert.equal(frozen.canAuthorizePlacement,false);
 for(const change of [r=>r.authority.candidatePlanHash='0'.repeat(64),r=>r.programHash='0'.repeat(64),r=>r.expanded.assetHash='0'.repeat(64)]){
  const wrong=structuredClone(receipt);change(wrong);assert.throws(()=>designAllocationFreeze(wrong,{plan,review,transition}),/exact accepted/);
 }
 assert.throws(()=>designAllocationFreeze(receipt,{plan,review:{...review,verdict:'revise'},transition}),/exact accepted/);
});
