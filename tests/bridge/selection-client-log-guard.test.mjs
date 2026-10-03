import test from 'node:test';
import assert from 'node:assert/strict';
import {assertHealthySelectionClientLog} from '../../scripts/selection-client-log-guard.mjs';
test('a passed fixture cannot override an unhandled client callback',()=>{
  assert.throws(()=>assertHealthySelectionClientLog('[Render thread/ERROR] Error executing task on Client\nIllegalStateException\nfixture result=passed'),/invalidates/);
  assert.throws(()=>assertHealthySelectionClientLog('VOXEL_STUDIO_SELECTION_TEST FAILED'),/invalidates/);
  assert.throws(()=>assertHealthySelectionClientLog('VOXEL_SELECTION_TEST FAILED'),/invalidates/);
});
test('shader compatibility warnings are not silently classified as client callback failures',()=>{
  assert.doesNotThrow(()=>assertHealthySelectionClientLog('[Iris/WARN] shader compatibility warning\nBUILD SUCCESSFUL'));
});
