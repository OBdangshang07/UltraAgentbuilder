import test from 'node:test';
import assert from 'node:assert/strict';
import {stairBoundsProblem} from '../../src/design/stair-bounds.mjs';
import {inspectConstruction} from '../../src/design/construction-feedback.mjs';
import {lowerScene} from '../../src/design/compiler.mjs';
import {basicScene,mass,at,once} from './fixtures.mjs';

function scene(){
  const s=basicScene('stairs-world-box');
  s.components=[mass('core',[4,0,4],[6,16,10],[4,8,12]),{id:'flight',kind:'stairs',host:'core',at:at([2,0,1],'core'),size:[6,7,2],repeat:once,allowOverwrite:[],style:'straight',rotation:1,width:2,rise:4,material:'stairs'}];
  return s;
}
test('reports actual world-X breach and odd-rotation local run without modifying a model scene',()=>{
  const s=scene(),before=JSON.stringify(s),r=inspectConstruction(s),p=r.issues.find(i=>i.code==='stairs-host-bounds');
  assert.equal(p.component,'flight');assert.deepEqual(p.worldSize,[6,7,2]);assert.equal(p.localRun,2);assert.equal(p.localBreadth,6);
  assert.deepEqual(p.violations,[{axis:'x',origin:6,endExclusive:12,allowedMin:5,allowedEndExclusive:9,belowBy:0,aboveBy:3}]);
  assert.throws(()=>lowerScene(s),e=>e.stairBoundsFeedback.message===p.message&&e.message.includes('WORLD-axis'));
  assert.equal(r.canAuthorizePlacement,false);assert.equal(JSON.stringify(s),before);
});
test('explicit world-size correction fits without changing rotation, function, material or compiler rules',()=>{
  const s=scene();s.components[1].size=[2,7,6];
  assert.equal(inspectConstruction(s).status,'passed');assert.doesNotThrow(()=>lowerScene(s));
});
test('last repeated reservation checks headroom above the upper landing, not just the landing slab',()=>{
  const s=scene();s.components[1].size=[2,7,6];s.components[1].repeat={count:4,step:[0,4,0]};
  const p=inspectConstruction(s).issues.find(i=>i.code==='stairs-host-bounds');
  assert.equal(p.instance,3);assert.equal(p.violations[0].axis,'y');assert.equal(p.violations[0].aboveBy,3);
  assert.throws(()=>lowerScene(s),e=>e.stairBoundsFeedback.instance===3);
});
test('containment is unchanged for every rotation; no automatic size swap or boundary waiver',()=>{
  for(let rotation=0;rotation<4;rotation++){
    const c={id:'flight',host:'core',rotation},host={thickness:2},hr={origin:[8,0,8],size:[16,20,16]};
    assert.equal(stairBoundsProblem(c,host,hr,[10,0,10],[12,20,12]),null);
    for(let axis=0;axis<3;axis++){
      const p=[10,0,10];p[axis]--;assert.ok(stairBoundsProblem(c,host,hr,p,[12,20,12]));
      const size=[12,20,12];size[axis]++;assert.ok(stairBoundsProblem(c,host,hr,[10,0,10],size));
    }
  }
});
test('diagnostic work exhaustion remains incomplete, never an implicit pass',()=>{
  const s=scene();s.components[1].size=[2,7,6];s.components[1].repeat={count:3,step:[0,4,0]};
  const r=inspectConstruction(s,{maxPrimitiveChecks:1});assert.equal(r.checksComplete,false);assert.equal(r.status,'incomplete');assert.equal(r.canAuthorizePlacement,false);
});
