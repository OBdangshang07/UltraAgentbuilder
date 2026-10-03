import {selectionChunks, regionCells} from '../contracts/world-selection.mjs';
import {createContextSnapshot, contextHash} from '../src/world/context-snapshot.mjs';
import {compileWorldPatch} from '../src/world/world-patch.mjs';
import {prepareWorldPatchPreview} from '../src/world/world-patch-preview-data.mjs';

// A free multi-batch data fixture, not model generation or world execution.
export function makeJournalFixture() {
  const selection={format:'WorldSelection',version:1,
    world:{worldId:'journal_fixture',dimension:'minecraft:overworld',minY:-64,maxY:320},revision:7,
    context:{min:[-6,-6,-6],max:[6,6,6]},edit:{min:[-5,-5,-5],max:[5,5,5]},protected:[]};
  const capture={fence:{start:9,end:9},chunks:selectionChunks(selection).map(c=>({x:c.x,z:c.z,coverage:'known',
    palette:[{state:'minecraft:stone',blockEntity:false}],runs:[[0,regionCells(c.region)]]}))};
  const snapshot=createContextSnapshot(selection,capture),operations=[];
  for(let y=-5;y<5;y++)for(let z=-5;z<5;z++)for(let x=-5;x<5;x++)operations.push({op:'set',position:[x,y,z],before:'minecraft:stone',after:'minecraft:glass'});
  const raw={format:'WorldPatchProposal',version:1,snapshotHash:snapshot.snapshotHash,selectionHash:snapshot.selectionHash,operations};
  const patch=compileWorldPatch(snapshot,raw);
  return {name:'thousand-static-changes',selection,capture,raw,responseHash:contextHash(raw),patch,preview:prepareWorldPatchPreview(snapshot,patch),realModelCalls:0,worldWrites:0};
}
