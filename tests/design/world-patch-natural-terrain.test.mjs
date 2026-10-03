import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionChunks} from '../../contracts/world-selection.mjs';
import {createContextSnapshot,readSnapshotBlockFact} from '../../src/world/context-snapshot.mjs';
import {compileWorldPatch} from '../../src/world/world-patch.mjs';
import {prepareWorldPatchDesignInput,buildWorldPatchDesignPrompt} from '../../src/world/world-patch-design-input.mjs';

function ground(changes=[],protect=false){
  const selection={format:'WorldSelection',version:1,world:{worldId:'natural-ground',dimension:'minecraft:overworld',minY:-64,maxY:320},revision:2,
    context:{min:[-3,-63,-3],max:[4,-53,4]},edit:{min:[-2,-61,-2],max:[3,-54,3]},
    protected:protect?[{min:[-1,-61,0],max:[0,-60,1]}]:[]};
  const chunks=selectionChunks(selection).map(c=>{
    const palette=[],runs=[];
    for(let y=c.region.min[1];y<c.region.max[1];y++)for(let z=c.region.min[2];z<c.region.max[2];z++)for(let x=c.region.min[0];x<c.region.max[0];x++){
      const fact=changes.find(row=>row.position.join(',')===[x,y,z].join(','))?.fact??{state:y<-61?'minecraft:dirt':y===-61?'minecraft:grass_block[snowy=false]':'minecraft:air',blockEntity:false};
      let id=palette.findIndex(p=>p.state===fact.state&&p.blockEntity===fact.blockEntity);if(id<0){id=palette.length;palette.push(fact);}
      if(runs.at(-1)?.[0]===id)runs.at(-1)[1]++;else runs.push([id,1]);
    }return {x:c.x,z:c.z,coverage:'known',palette,runs};
  });return createContextSnapshot(selection,{fence:{start:0,end:0},chunks});
}
const proposal=(snapshot,operations)=>({format:'WorldPatchProposal',version:1,snapshotHash:snapshot.snapshotHash,selectionHash:snapshot.selectionHash,operations});
const paving={op:'set',position:[0,-61,0],before:'minecraft:grass_block[snowy=false]',after:'minecraft:smooth_stone'};
const bench={op:'set',position:[1,-60,0],before:'minecraft:air',after:'minecraft:quartz_block'};

test('ordinary flat-world soil and grass are consistently classified, disclosed and compiled',()=>{
  const s=ground(),input=prepareWorldPatchDesignInput(s);
  for(const state of ['minecraft:dirt','minecraft:grass_block[snowy=false]']){
    const fact=input.exactBaseline.palette.find(row=>row.state===state);assert.ok(fact);assert.equal(fact.blockProtection,null);assert.equal(fact.patchStateRestriction,null);
  }
  assert.ok(input.targetCatalog.some(row=>row.id==='minecraft:grass_block'&&row.properties.snowy.join(',')==='false'));
  const patch=compileWorldPatch(s,proposal(s,[paving,bench]));assert.equal(patch.writes.length,2);assert.equal(patch.summary.counts.replaced,1);assert.equal(patch.summary.counts.added,1);
  assert.equal(patch.serverBaselineVerified,false);assert.equal(patch.canAuthorizePlacement,false);assert.equal(patch.physicsVerified,false);
  assert.ok(patch.guards.some(row=>row.before==='minecraft:dirt'));assert.ok(patch.guards.some(row=>row.before==='minecraft:grass_block[snowy=false]'));
});
test('protected grass stays protected but can be the unchanged neighbor of approved paving',()=>{
  const s=ground([],true);assert.equal(compileWorldPatch(s,proposal(s,[paving])).writes.length,1);
  assert.equal(readSnapshotBlockFact(s,[-1,-61,0]).state,'minecraft:grass_block[snowy=false]');
  assert.throws(()=>compileWorldPatch(s,proposal(s,[{...paving,position:[-1,-61,0]}])),/protected/);
});
test('soil support does not relax exact BEFORE, W, P or the explicit-change requirement',()=>{
  const s=ground();assert.throws(()=>compileWorldPatch(s,proposal(s,[{...paving,before:'minecraft:dirt'}])),/BEFORE/);
  assert.throws(()=>compileWorldPatch(s,proposal(s,[{...paving,position:[3,-61,0]}])),/outside approved W/);
  assert.throws(()=>compileWorldPatch(s,proposal(s,[{op:'keep',position:paving.position,before:paving.before}])),/no explicit changes/);
});
test('snowy, malformed, fluid, gravity, entity and unknown neighbors remain rejected',()=>{
  for(const fact of [
    {state:'minecraft:grass_block',blockEntity:false},{state:'minecraft:grass_block[snowy=true]',blockEntity:false},
    {state:'minecraft:grass_block[snowy=false,unknown=true]',blockEntity:false},{state:'minecraft:water[level=0]',blockEntity:false},
    {state:'minecraft:sand',blockEntity:false},{state:'testmod:soil',blockEntity:false},{state:'minecraft:chest[facing=north,type=single,waterlogged=false]',blockEntity:true},
  ]){const s=ground([{position:[1,-61,0],fact}]);assert.throws(()=>compileWorldPatch(s,proposal(s,[paving])),undefined,fact.state);}
});
test('ordinary ground targets retain exact properties and do not allow unspecified snow variants',()=>{
  const s=ground();assert.throws(()=>compileWorldPatch(s,proposal(s,[{...bench,after:'minecraft:grass_block'}])),/Unsupported/);
  assert.throws(()=>compileWorldPatch(s,proposal(s,[{...bench,after:'minecraft:grass_block[snowy=true]'}])),/Unsupported/);
});
test('model instructions request real coordinated changes without weakening original world checks',()=>{
  const s=ground(),input=prepareWorldPatchDesignInput(s),prompt=buildWorldPatchDesignPrompt(s,input,'Design paving and low seats.').prompt;
  assert.match(prompt,/propose actual coordinated changes/);assert.match(prompt,/preservation alone does not fulfill/);
  assert.match(prompt,/all neighbor checks/);assert.match(prompt,/separate explicit player world-write confirmation/);
});
