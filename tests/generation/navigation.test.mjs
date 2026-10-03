import test from 'node:test';
import assert from 'node:assert/strict';
import {compileSpec} from '../../src/generation/compiler.mjs';
import {sampleSpec} from '../../src/generation/sample.mjs';
import {inspectNavigation} from '../../src/generation/navigation.mjs';

test('opt-in offline reachability traces cannot waive disconnected passage checks',()=>{
 const c=compileSpec(sampleSpec()),args={cells:c.cells,palette:c.manifest.palette,...c.manifest.dimensions,passages:sampleSpec().constraints.passages};
 const plain=inspectNavigation(args),detailed=inspectNavigation({...args,includeReachability:true});
 assert.equal(plain.reachableCells,undefined);assert.ok(detailed.reachableCells instanceof Uint8Array);
 const {reachableCells,...stats}=detailed;assert.deepEqual(plain,stats);assert.equal(reachableCells.reduce((a,b)=>a+b,0),plain.reachable);
 assert.throws(()=>inspectNavigation({...args,includeReachability:true,passages:[args.passages[0],{origin:[0,2,0],size:[1,2,1]}]}),/disconnected/);
});

const add=(s,id,op,origin,size,material='wall')=>s.nodes.push({nodeId:id,op,origin,size,material});
test('furniture tops are warnings, with identical geometry and unchanged constraints',()=>{
  const s=sampleSpec();add(s,'table','box',[4,2,7],[3,2,3],'beam');
  const original=JSON.stringify(s),a=compileSpec(s),raw=compileSpec({...s,constraints:{interior:false,walkable:false,passages:[]}});
  assert.equal(JSON.stringify(s),original);assert.deepEqual(a.binary,raw.binary);
  assert.equal(a.manifest.navigation.unclaimedSurfaces,9);assert.equal(a.manifest.navigation.disconnectedFloorCells,0);
  assert.ok(a.manifest.validationNotes.some(n=>n.includes('高处表面')));
});
test('floor role is authoritative even when furniture has the identical palette material',()=>{
  const s=sampleSpec();s.palette.beam=s.palette.floor;add(s,'table','box',[4,2,7],[3,2,3],'beam');
  assert.doesNotThrow(()=>compileSpec(s));s.nodes.at(-1).material='floor';assert.throws(()=>compileSpec(s),/disconnected floor cells/);
});
test('single-cell recess is warned, never filled or counted as a reachable room',()=>{
  const s=sampleSpec();add(s,'side','box',[4,2,13],[1,4,1]);add(s,'front','box',[3,2,12],[1,4,1]);
  const a=compileSpec(s);assert.deepEqual(a.manifest.navigation.isolatedPockets,[[3,2,13]]);
  assert.equal(a.cells[3+13*19+2*19*17],1);assert.ok(a.manifest.validationNotes.some(n=>n.includes('单格死角')));
  s.constraints.passages.push({origin:[3,2,13],size:[1,2,1]});assert.throws(()=>compileSpec(s),/Passages are disconnected/);
});
test('multi-cell room, missing upstairs stairs and declared blocked door still fail',()=>{
  const s=sampleSpec();add(s,'partition','box',[11,2,3],[1,5,11]);assert.throws(()=>compileSpec(s),/disconnected floor cells/);
  add(s,'door','clear',[11,2,5],[1,2,2]);assert.doesNotThrow(()=>compileSpec(s));
  const upper=sampleSpec();add(upper,'upper-floor','box',[4,4,7],[3,1,3],'floor');assert.throws(()=>compileSpec(upper),/disconnected floor cells/);
  const door=sampleSpec();add(door,'obstruction','box',[8,2,2],[3,3,1]);assert.throws(()=>compileSpec(door),/Passage obstructed/);
});
test('separate singleton floor level cannot use the recess exception',()=>{
  const s=sampleSpec();add(s,'small-deck','box',[4,4,7],[1,1,1],'floor');assert.throws(()=>compileSpec(s),/disconnected floor cells/);
});
test('isolated platform at the same level is not a furniture recess',()=>{
  const s=sampleSpec();add(s,'remote-platform','box',[0,1,0],[1,1,1],'floor');add(s,'remote-clear','clear',[0,2,0],[1,2,1]);
  assert.throws(()=>compileSpec(s),/disconnected floor cells/);
});
