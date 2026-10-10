import test from 'node:test';
import assert from 'node:assert/strict';
import {WORLD_SELECTION_LIMITS,validateWorldSelection,selectionChunks,regionCells} from '../../contracts/world-selection.mjs';
import {createContextSnapshot,readSnapshotCell} from '../../src/world/context-snapshot.mjs';
import {createContextReadSession} from '../../src/world/context-reader.mjs';
import {prepareAssemblyWorldContext,assemblyWorldContextData,WORLD_ASSEMBLY_PATCH_LIMITS} from '../../src/world/assembly-context.mjs';
import {WORLD_ASSEMBLY_LIMITS} from '../../contracts/world-assembly-limits.mjs';

// Capacity probes, not architectural designs or live-world performance claims.
const cbd = () => ({format:'WorldSelection',version:1,
  world:{worldId:'synthetic_cbd_capacity',dimension:'minecraft:overworld',minY:-64,maxY:320},revision:1,
  context:{min:[-40,-64,-40],max:[40,174,40]},edit:{min:[-32,-59,-32],max:[32,165,32]},protected:[]});
const uniform = selection => createContextSnapshot(selection,{fence:{start:7,end:7},
  chunks:selectionChunks(selection).map(c=>({x:c.x,z:c.z,coverage:'known',
    palette:[{state:'minecraft:air',blockEntity:false}],runs:[[0,regionCells(c.region)]]}))});
function source(selection) {
  let reads=0;
  return {identity:()=>({worldId:selection.world.worldId,dimension:selection.world.dimension,selectionRevision:1,contextRevision:7}),
    isChunkLoaded:()=>true,readBlock:()=>{reads++;return {state:'minecraft:air',blockEntity:false};},reads:()=>reads};
}
function finish(session) {
  let status;
  for(let i=0;i<2000;i++){status=session.step();if(status.state!=='reading')return status;}
  throw Error('Bounded synthetic scan did not terminate');
}

test('full 64x64x224 CBD keeps the exact W and eight-cell horizontal surroundings',()=>{
  const s=cbd(),checked=validateWorldSelection(s),snapshot=uniform(s);
  assert.deepEqual(checked,s);assert.equal(regionCells(s.edit),917504);assert.equal(regionCells(s.context),1523200);
  assert.equal(snapshot.chunks.reduce((n,c)=>n+regionCells(c.region),0),1523200);
  assert.equal(readSnapshotCell(snapshot,[-32,-59,-32]).reason,null);
  assert.equal(readSnapshotCell(snapshot,[31,164,31]).reason,null);
  assert.equal(readSnapshotCell(snapshot,[-33,-59,-32]).reason,'context-only');
  assert.equal(readSnapshotCell(snapshot,[32,164,31]).reason,'context-only');
  assert.equal(snapshot.canAuthorizePlacement,false);
});
test('bounded maximum volumes are accepted exactly; one extra layer remains rejected',()=>{
  const s=cbd();s.context={min:[-64,0,-64],max:[64,128,64]};s.edit={min:[-64,0,-64],max:[64,64,64]};
  assert.equal(regionCells(validateWorldSelection(s).context),WORLD_SELECTION_LIMITS.contextCells);
  assert.equal(regionCells(s.edit),WORLD_SELECTION_LIMITS.editCells);
  const edit=structuredClone(s);edit.edit.max[1]++;assert.throws(()=>validateWorldSelection(edit),/volume quota/);
  const context=structuredClone(s);context.context.max[1]++;assert.throws(()=>validateWorldSelection(context),/volume quota/);
  const override=structuredClone(s);override.limits={contextCells:Infinity};assert.throws(()=>validateWorldSelection(override),/fields/);
});
test('old smaller volume and original volume remain valid without relocating or mutating them',()=>{
  const s=cbd();s.context={min:[0,0,0],max:[128,32,128]};s.edit=structuredClone(s.context);
  assert.deepEqual(validateWorldSelection(s).edit,s.edit);
  s.context={min:[-128,0,-128],max:[128,16,128]};s.edit={min:[-64,0,-64],max:[64,16,64]};
  assert.equal(uniform(s).selectionHash.length,64);
});
test('full CBD background evidence contains every W cell and all six captured faces',()=>{
  const snapshot=uniform(cbd()),context=prepareAssemblyWorldContext(snapshot),data=assemblyWorldContextData(context);
  assert.deepEqual(data.maximumBounds,{width:64,height:224,length:64});assert.deepEqual(data.origin,[-32,-59,-32]);
  const regions=data.exactBaseline.regions;
  assert.equal(regions.length,7);assert.equal(regions[0].cells,917504);assert.equal(data.exactBaseline.missingFaces.length,0);
  for(const r of regions)assert.equal(r.runs.reduce((n,run)=>n+run[1],0),r.cells);
  assert.equal(data.exactBaseline.knownCells,regions.reduce((n,r)=>n+r.cells,0));
  assert.equal(data.exactBaseline.unknownCells,0);assert.equal(data.canAuthorizePlacement,false);
  assert.equal(data.serverBaselineVerified,false);assert.equal(data.physicsVerified,false);
  assert.ok(Buffer.byteLength(JSON.stringify(data))<8*1024**2);
});
test('full CBD reading stays at 4096 cells per scheduled step with separate finalization',()=>{
  const s=cbd(),reader=source(s),session=createContextReadSession(s,reader,{maxCellsPerStep:4096,maxMillisPerStep:2,clock:()=>0});
  let prior=0,status;
  for(let i=0;i<2000;i++){
    status=session.step();assert.ok(status.readCells-prior<=4096);prior=status.readCells;
    if(status.state!=='reading')break;
  }
  assert.equal(status.state,'captured');assert.equal(status.snapshot,null);assert.equal(reader.reads(),1523200);
  assert.equal(session.finishSnapshot().state,'ready');assert.equal(session.status().processedCells,1523200);
});
test('unloaded large context is explicit UNKNOWN with zero block reads or fabricated air',()=>{
  const s=cbd(),reader=source(s);reader.isChunkLoaded=()=>false;
  const session=createContextReadSession(s,reader,{clock:()=>0});assert.equal(finish(session).state,'captured');
  const result=session.finishSnapshot();assert.equal(result.state,'ready');assert.equal(reader.reads(),0);
  assert.equal(readSnapshotCell(result.snapshot,[0,0,0]).reason,'unknown');
  assert.ok(result.snapshot.chunks.every(c=>c.coverage==='unknown'&&c.palette.length===0&&c.runs.length===0));
});
test('large capture cancellation and protection do not produce a write capability',()=>{
  const s=cbd();s.protected=[{min:[-1,-59,-1],max:[1,-58,1]}];const reader=source(s);
  const session=createContextReadSession(s,reader,{clock:()=>0});session.step();session.cancel();
  assert.equal(session.step().state,'cancelled');assert.equal(session.finishSnapshot().snapshot,null);assert.equal(reader.reads(),4096);
  assert.equal(readSnapshotCell(uniform(s),[0,-59,0]).reason,'selection-protection');
});
test('high-entropy large scans retain the original byte guard and never publish partial captures',()=>{
  const s=cbd(),reader=source(s);let reads=0;
  reader.readBlock=()=>({state:++reads%2?'minecraft:air':'minecraft:stone',blockEntity:false});
  const session=createContextReadSession(s,reader,{clock:()=>0});const result=finish(session);
  assert.equal(result.state,'failed');assert.match(result.reason,/byte quota/);assert.ok(reads<regionCells(s.context));
  assert.equal(session.finishSnapshot().snapshot,null);assert.equal(session.step().totalReadCalls,reads);
});
test('part count follows bounded edit capacity; byte limits do not become unlimited',()=>{
  assert.equal(WORLD_ASSEMBLY_PATCH_LIMITS.parts,128);assert.equal(WORLD_ASSEMBLY_PATCH_LIMITS.operationsPerPart,8192);
  assert.equal(WORLD_ASSEMBLY_PATCH_LIMITS.bytes,WORLD_ASSEMBLY_LIMITS.patchBytes);
  assert.equal(WORLD_ASSEMBLY_PATCH_LIMITS.bytes,192*1024**2);
  assert.equal(WORLD_ASSEMBLY_LIMITS.proposalBytes,64*1024**2);assert.equal(WORLD_ASSEMBLY_LIMITS.previewBytes,64*1024**2);
  assert.equal(WORLD_SELECTION_LIMITS.snapshotBytes,16*1024**2);
  assert.equal(WORLD_SELECTION_LIMITS.chunks,1024);assert.equal(WORLD_SELECTION_LIMITS.paletteStates,4096);
});
