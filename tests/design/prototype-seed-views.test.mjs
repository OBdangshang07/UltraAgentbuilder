import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../../src/generation/compiler.mjs';
import {preparePrototypeSeeds} from '../../src/design/prototype-expansion.mjs';
import {nativeViewsForPrototypeSeeds} from '../../src/design/prototype-seed-views.mjs';
import {floorStudy} from './floor-components-fixtures.mjs';

test('prototype typical-floor framing uses actual constructed irregular-floor seed instead of an empty middle floor',()=>{
 const scene=floorStudy();scene.components[1].floors.count=1;scene.components[1].floorMaterial='frame';
 const program={format:'ScenePrototypeExpansion',version:1,seedSourceHash:hash(scene),recipes:[{component:'rooms',mode:'storeys',count:4,step:[0,0,0]}]},seed=preparePrototypeSeeds(scene,program);
 const views=nativeViewsForPrototypeSeeds(scene,'ultra',null,seed.witness),typical=views.find(v=>v.purpose==='typical-floor');
 assert.equal(typical.min[1],2);assert.equal(typical.max[1],7);assert.match(typical.framing,/rooms/);assert.match(typical.framing,/not visually certified/);
 const frozen=hash(views),moved=structuredClone(scene);moved.components[1].floors.first=1;
 const nextProgram={...program,seedSourceHash:hash(moved)},next=preparePrototypeSeeds(moved,nextProgram);
 assert.deepEqual(nativeViewsForPrototypeSeeds(moved,'ultra',null,next.witness,views),views);assert.equal(hash(views),frozen);
 assert.throws(()=>nativeViewsForPrototypeSeeds(moved,'ultra',null,seed.witness,views),/current saved seed witness/);
});
