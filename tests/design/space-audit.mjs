import {inspectNavigation} from '../../src/generation/navigation.mjs';
import {hash} from '../../src/generation/compiler.mjs';

/** Fixture-specific read-only audit. Fault injection uses private copies only.
 * Does not waive whole-asset navigation warnings or certify real-world safety.
 */
export function auditSpaceTower(compiled){
 const {width,height,length}=compiled.manifest.dimensions,plane=width*length,index=([x,y,z])=>x+z*width+y*plane;
 const entry=[31,1,0],floors=Array.from({length:45},(_,i)=>i*5);
 const probes=floors.flatMap(y=>[
  {kind:'lobby',floor:y,feet:[31,y+1,25]},
  {kind:'southLobby',floor:y,feet:[31,y+1,39]},
  {kind:'stairA',floor:y,feet:[28,y+1,25]},
  {kind:'stairB',floor:y,feet:[35,y+1,38]},
  ...y>0&&y<220?[{kind:'office',floor:y,feet:[31,y+1,16]},{kind:'meeting',floor:y,feet:[46,y+1,32]},{kind:'quiet',floor:y,feet:[17,y+1,32]},{kind:'shared',floor:y,feet:[31,y+1,46]},{kind:'service',floor:y,feet:[37,y+1,28]}]:[]
 ]);
 const nav=cells=>inspectNavigation({cells,palette:compiled.manifest.palette,width,height,length,passages:[{origin:entry,size:[1,2,1]}],includeReachability:true});
 const originalHash=hash(compiled.binary),base=nav(compiled.cells),checkpoints=probes.map(p=>({...p,reachable:base.reachableCells[index(p.feet)]===1}));
 const cases=[];
 for(const blocked of [['stairA'],['stairB'],['stairA','stairB']]){
  const cells=compiled.cells.slice(),solid=compiled.manifest.palette.indexOf('minecraft:stone_bricks');let changedCells=0;
  for(const id of blocked){const box=compiled.designSources.componentBounds[id][0],o=box.origin;
   // Close the entire stair footprint above its base, not doors or office corridors.
   for(let y=1;y<223;y++)for(let z=o[2];z<o[2]+box.size[2];z++)for(let x=o[0];x<o[0]+box.size[0];x++){
    const i=index([x,y,z]);if(cells[i]!==solid)changedCells++;cells[i]=solid;
   }
  }
  const n=nav(cells),targets=probes.filter(p=>!blocked.includes(p.kind)),unreachable=targets.filter(p=>!n.reachableCells[index(p.feet)]);
  cases.push({blocked,changedCells,targetCount:targets.length,reachable:targets.length-unreachable.length,unreachable});
 }
 const shafts=[];
 for(const z0 of [29,35]){
  let clear=0,nonAir=0,enclosureHoles=0;
  for(let y=1;y<223;y++)for(let z=z0+1;z<z0+4;z++)for(let x=24;x<27;x++)compiled.cells[index([x,y,z])]===1?clear++:nonAir++;
  for(let y=0;y<224;y++)for(let z=z0;z<z0+5;z++)for(let x=23;x<28;x++)if(y===0||y===223||z===z0||z===z0+4||x===23||x===27){
   const value=compiled.cells[index([x,y,z])],name=compiled.manifest.palette[value];
   if(value<2||name.includes('_door[')||name.includes('_trapdoor['))enclosureHoles++;
  }
  shafts.push({z:z0,clear,nonAir,enclosureHoles});
 }
 if(hash(compiled.binary)!==originalHash)throw new Error('Audit changed original binary');
 return {assetHash:compiled.manifest.assetHash,sourceCellsHash:originalHash,fixture:'hand-authored, not an AI output',scope:'Exterior entry and explicitly enumerated occupied-floor checkpoints. Full-block walking only; open stair portals are not fire doors. Shafts are inert, not working lifts. Original navigation acknowledgement remains required.',geometryChanged:false,additionalLiveModelCalls:0,entry,checkpoints,faultInjection:cases,shafts,quality:compiled.manifest.quality,stairAccessCount:compiled.designSources.stairAccess.length,unverifiedStairAccess:compiled.designSources.stairAccess.filter(a=>a.status==='unverified').length};
}
