import test from 'node:test';
import assert from 'node:assert/strict';
import {assemblyCapacity,checkAssemblyCapacity,assemblyAdvisory} from '../../src/design/assembly-scope.mjs';
import {applyPackageEdit} from '../../contracts/scene-assembly.schema.mjs';
import {assessSceneCheckpoint} from '../../src/design/checkpoint.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyPlan,packageEdit} from './assembly-fixtures.mjs';
import {shape} from './fixtures.mjs';

test('pending construction reserves only absent owned components; refinement has no construction reserve',()=>{
  const p=assemblyPlan(),before=hash(p),task=p.packages[0];
  let c=assemblyCapacity(p,p.scene,[],task);
  assert.equal(c.assembly.minimumRequired,2);assert.equal(c.assembly.reservedForPendingConstruction,1);
  assert.equal(c.assembly.maximumNewComponentsAtTurn,254);assert.equal(hash(p),before);
  p.packages[1].editableComponents=['main'];
  assert.equal(assemblyCapacity(p,p.scene,[],task).assembly.reservedForPendingConstruction,0);
  p.packages[1].editableComponents=[];p.scene.components.push(shape('interior__saved',[8,1,8],[1,1,1]));
  assert.equal(assemblyCapacity(p,p.scene,[],task).assembly.reservedForPendingConstruction,0);
  assert.equal(assemblyCapacity(p,p.scene,['exterior'],p.packages[1]).assembly.minimumRequired,0);
  c=assemblyCapacity(p,p.scene,['exterior','interior'],task,'refine-component');
  assert.equal(c.assembly.reservedForPendingConstruction,0);assert.equal(c.assembly.maximumNewComponentsAtTurn,254);
  assert.throws(()=>assemblyCapacity(p,p.scene,[],task,'refine-component'),/completed/);
  assert.throws(()=>assemblyCapacity(p,p.scene,['foreign']),/context/);
});

test('capacity proves only minimum-slot impossibility and permits zero-growth replacement/removal credits',()=>{
  const p=assemblyPlan(),s=p.scene,task=p.packages[0];
  s.components.push(...Array.from({length:254},(_,i)=>shape('part'+i,[3,2,3],[1,1,1])));
  assert.equal(assemblyCapacity(p,s).assembly.feasible,false);
  p.packages[0].editableComponents=['part0'];
  const budget=assemblyCapacity(p,s,[],task);assert.equal(budget.assembly.feasible,true);assert.equal(budget.assembly.maximumNewComponentsAtTurn,0);
  const edit=packageEdit({previousDraft:s,task});
  assert.equal(checkAssemblyCapacity(budget,applyPackageEdit(s,edit,task)).accepted,false);
  edit.components.remove=['part0'];
  const funded=checkAssemblyCapacity(budget,applyPackageEdit(s,edit,task));
  assert.equal(funded.accepted,true);assert.equal(funded.netGrowth,0);assert.equal(funded.remainingAfter,1);
  const full=applyPackageEdit(s,packageEdit({previousDraft:s,task}),task).scene;
  const refine=assemblyCapacity(p,full,['exterior','interior'],task,'refine-component');
  assert.equal(refine.assembly.maximumNewComponentsAtTurn,0);
  assert.equal(checkAssemblyCapacity(refine,applyPackageEdit(full,packageEdit({previousDraft:full,task}),task)).accepted,true);
});

test('navigation uncertainty is advisory, source-bound and does not invent repair authority',()=>{
  const p=assemblyPlan(true),s=p.scene,report=assessSceneCheckpoint(s).report,before=hash({p,report});
  const good=assemblyAdvisory(p,s,report);assert.equal(good.navigationGate,false);assert.equal(good.canAuthorizePlacement,false);
  assert.ok(good.stairs.length);assert.ok(good.stairs.every(s=>s.status==='local-two-way'));
  assert.equal(hash({p,report}),before);
  const partial=structuredClone(report);partial.navigationFeedback.checksComplete=false;
  partial.navigationFeedback.passages[0].checksComplete=false;
  const g=partial.navigationFeedback.stairs.groups[0];g.unverifiedFloors=[g.checkedLowerFloors[0]];g.localTwoWayPaths--;
  const uncertain=assemblyAdvisory(p,s,partial);
  assert.equal(uncertain.interfaces[0].status,'incomplete');assert.ok(uncertain.unownedUnverifiedStairs.includes(g.component));
  assert.equal(uncertain.navigationGate,false);assert.equal(uncertain.geometryChanged,false);
  p.packages[1].editableComponents.push(g.component);
  assert.deepEqual(assemblyAdvisory(p,s,partial).stairs.find(x=>x.component===g.component).editableOwners,['interior']);
  const absent=assemblyAdvisory(p,s,{sourceHash:hash(s)});
  assert.equal(absent.evidenceAvailable,false);assert.ok(absent.stairs.every(s=>s.status==='incomplete'));
  assert.throws(()=>assemblyAdvisory(p,s,{sourceHash:'0'.repeat(64)}),/source mismatch/);
});
