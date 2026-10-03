import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeViewsForQualityV4} from '../../src/design/quality-v4-evidence.mjs';
import {nativeViewsForQualityV3} from '../../src/design/quality-v3-evidence.mjs';
import {panelWorldHighrise} from './fixtures.mjs';
import {hash} from '../../src/generation/compiler.mjs';

function portal(){
  const scene=panelWorldHighrise();
  const at={relativeTo:null,anchor:'min',offset:[14,1,0]},repeat={count:1,step:[0,0,0]};
  scene.components.push({kind:'void',id:'portal_void',at,size:[2,2,1],repeat,allowOverwrite:[]},
    {kind:'doorway',id:'actual_portal',host:'portal_void',at,repeat,face:'north',width:2,door:'door',hinge:'left',open:true,allowOverwrite:[]});
  scene.constraints.passages=[{origin:[15,1,3],size:[1,2,1]}];return scene;
}
test('v4 focuses semantic door portals whose source nodes omit generated halves; v3 stays identical',()=>{
  const scene=portal(),identity=hash(scene),old=nativeViewsForQualityV3(scene,'ultra');
  const views=nativeViewsForQualityV4(scene,'ultra'),entry=views.find(v=>v.purpose==='entry');
  assert.match(entry.framing,/Source door group actual_portal/);assert.equal(entry.pitch,15);assert.equal(entry.yaw,160);
  assert.doesNotMatch(old.find(v=>v.purpose==='entry').framing??'',/actual_portal/);
  assert.ok(entry.max[0]-entry.min[0]<scene.bounds.width);assert.equal(hash(scene),identity);assert.deepEqual(nativeViewsForQualityV3(scene,'ultra'),old);
  const crown=views.find(v=>v.id==='upper-termination');assert.deepEqual([crown.min[1],crown.max[1]],[200,224]);
});
test('v4 revision cameras retain the baseline rather than cropping a new asset into a more flattering view',()=>{
  const scene=portal(),baseline=nativeViewsForQualityV4(scene,'ultra');scene.components.find(c=>c.id==='actual_portal').at.offset[0]=17;
  const identity=hash(scene),next=nativeViewsForQualityV4(scene,'ultra',null,baseline);assert.deepEqual(next,baseline);assert.notEqual(next,baseline);
  next[0].yaw=99;assert.notEqual(next[0].yaw,baseline[0].yaw);assert.equal(hash(scene),identity);
});
