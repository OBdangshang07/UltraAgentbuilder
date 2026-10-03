import test from 'node:test';
import assert from 'node:assert/strict';
import {liveModelSelection} from '../../scripts/scene-live-model.mjs';

test('new continuing stability tests preserve exact Luna/Sol selection and individual call limits',()=>{
 const scope=['--stability-design-first','--authorized-stability-goal-20260926'];
 for(const name of ['luna','sol']){
  const result=liveModelSelection([...scope,`--codex-${name}-max`]);
  assert.equal(result.provider,'codex');assert.equal(result.model,`gpt-6-${name}`);assert.equal(result.effort,'max');
  assert.equal(result.goalAuthorization.perTaskMaximumCalls,26);assert.equal(result.goalAuthorization.deepseekAllowed,false);
 }
 assert.deepEqual(liveModelSelection(['--codex-luna-max']),{provider:'codex',model:'gpt-6-luna',effort:'max'});
 assert.throws(()=>liveModelSelection([...scope,'--codex-sol-max','--codex-luna-max']),/exactly one/);
 assert.throws(()=>liveModelSelection(['--codex-sol-max']),/require/);
 assert.throws(()=>liveModelSelection(scope),/new Codex stability/);
 assert.throws(()=>liveModelSelection([...scope,'--codex-luna-max','--replace-cancelled-ledger']),/budget rewrite/);
});
