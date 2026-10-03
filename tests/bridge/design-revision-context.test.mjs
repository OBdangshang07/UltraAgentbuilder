import test from 'node:test';
import assert from 'node:assert/strict';
import {designRevisionContext,VISUAL_DESIGN_REVISION} from '../../bridge/design-revision-context.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyPlan} from '../design/assembly-fixtures.mjs';

const issue=criterion=>({criterion,evidence:'Offline evidence for '+criterion,change:'Fix actual '+criterion+' geometry, not a visual-quality proof'});
function fixture(){
  const plan=assemblyPlan(),evidence={sourceHash:hash(plan.scene),evidenceHash:'a'.repeat(64)};
  const review=(round,criteria,current=false)=>({phase:'concept-review',round,planHash:current?hash(plan):hash({round}),sourceHash:current?hash(plan.scene):hash({source:round}),evidenceHash:current?evidence.evidenceHash:hash({evidence:round}),verdict:'revise',issues:criteria.map(issue)});
  const history=[{phase:'select-concept',selected:'offline'},review(1,['facade','entry']),review(2,['facade','composition']),review(3,['facade','composition'],true)];
  const budget={remaining:12,mandatoryCalls:3,reservedHeadroom:5,maximumPackages:4};
  return {plan,evidence,history,budget};
}
test('revision context binds current visual baseline and tracks recurring categories without treating them as scores',()=>{
  const {plan,evidence,history,budget}=fixture(),before=hash({plan,evidence,history,budget});
  const c=designRevisionContext(plan,evidence,history,budget);
  assert.equal(c.version,1);assert.equal(c.baselinePlanHash,hash(plan));assert.equal(c.baselineSourceHash,hash(plan.scene));
  assert.deepEqual(c.activeConcerns.map(i=>[i.criterion,i.consecutiveRounds]),[['facade',3],['composition',2]]);
  assert.equal(c.activeConcerns[0].earlierRequests.length,2);
  assert.equal(c.activeConcerns[1].earlierRequests[0].sourceHash,history[2].sourceHash);
  assert.deepEqual(c.reviewTrail.map(r=>r.round),[1,2,3]);
  assert.equal(c.budgetOutlook.spareCallsAfterPlannedRound,2);
  assert.equal(hash({plan,evidence,history,budget}),before);
  assert.match(c.limitations.join(' '),/do not prove/);
  assert.equal(c.canAuthorizePlacement,undefined);
});
test('a concern reappearing after an absent round is not counted as consecutive stagnation',()=>{
  const {plan,evidence,history,budget}=fixture();history[2].issues=[issue('entry')];
  const c=designRevisionContext(plan,evidence,history,budget);
  assert.deepEqual(c.activeConcerns.map(i=>i.consecutiveRounds),[1,1]);
  assert.equal(c.activeConcerns[0].earlierRequests.length,1);
});
test('changed current source, plan, evidence or verdict is rejected, never rebound silently',()=>{
  for(const field of ['sourceHash','planHash','evidenceHash','verdict']){
    const {plan,evidence,history,budget}=fixture();history.at(-1)[field]='wrong';
    assert.throws(()=>designRevisionContext(plan,evidence,history,budget),/stale/);
  }
  const {plan,evidence,history,budget}=fixture();evidence.sourceHash='wrong';
  assert.throws(()=>designRevisionContext(plan,evidence,history,budget),/stale/);
  assert.throws(()=>designRevisionContext(plan,evidence,[],budget),/stale/);
});
test('visual revision instructions preserve scope and demand a new independent review, not forced acceptance',()=>{
  assert.match(VISUAL_DESIGN_REVISION,/same verified views/);
  assert.match(VISUAL_DESIGN_REVISION,/not a render of your proposed changes/);
  assert.match(VISUAL_DESIGN_REVISION,/next compile and independent image review/);
  assert.match(VISUAL_DESIGN_REVISION,/never raises the call limit/);
  assert.match(VISUAL_DESIGN_REVISION,/explicit voids, reservations, core\/roof routes/);
});
