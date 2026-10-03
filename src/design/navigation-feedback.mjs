import {walkingGrid} from '../generation/walking-grid.mjs';
import {transformPoint} from '../generation/groups.mjs';
import {hash} from '../generation/compiler.mjs';
import {MATERIALS} from '../generation/materials.mjs';
import {fullSupport} from '../generation/block-states.mjs';

/** Additional bounded diagnostics only. Never modifies geometry, changes the
 * compiler's quality verdict, or treats a local seed as an exterior entrance. */
export function inspectSceneNavigation(scene,compiled,{maxVisits=2000000,maxStairs=256,maxProbeCells=262144,maxIssues=32}={}){
  if(!Number.isSafeInteger(maxVisits)||maxVisits<1||maxVisits>8388608||!Number.isSafeInteger(maxStairs)||maxStairs<1||maxStairs>512||!Number.isSafeInteger(maxProbeCells)||maxProbeCells<1||maxProbeCells>8388608||!Number.isSafeInteger(maxIssues)||maxIssues<1||maxIssues>128)throw new Error('Invalid scene navigation feedback budget');
  if(hash(scene)!==compiled.manifest.scene?.sourceHash)throw new Error('Navigation feedback source mismatch');
  const {width:w,height:h,length:d}=compiled.manifest.dimensions,grid=walkingGrid({cells:compiled.cells,palette:compiled.manifest.palette,width:w,height:h,length:d,staticOpenDoors:true});
  const report={version:1,canAuthorizePlacement:false,geometryChanged:false,checksComplete:true,visits:0,probeCellsChecked:0,
    movementModel:{fullSupportGrid:true,partialStepCollisionModeled:false,checksCompleteMeans:'bounded traversal finished, not complete Minecraft collision coverage',unverifiedIsBlockedProof:false},
    entry:null,passages:[],stairs:{total:0,checked:0,localTwoWayPaths:0,unverified:0,skipped:0,groups:[]},issues:[],issueCount:0,truncated:false,
    limitations:['The first model-declared passage origin is NOT a verified outdoor entrance.','Local stair paths do not prove entry, room or whole-floor connectivity. No independent egress/fire-code certification.','Paired supported open doors use native-verified static edge collisions and level centred sweeps only. No actuation/closing or other partial-block walking simulation; KEEP remains unknown. No block edits, retries or placement permission.','Only declared passage boxes and semantic stairs are covered; unlisted rooms/floors are not certified. Budget exhaustion means unknown, not pass.']};
  if(grid.staticOpenDoorCells)report.staticOpenDoors={model:'minecraft-java-1.20.1-edge-slabs-v1',pairedSupportedCells:grid.staticOpenDoorCells,playerWidth:.6,levelDoorCrossingsOnly:true,doorActuation:false,canAuthorizePlacement:false};
  const issue=data=>{report.issueCount++;if(report.issues.length<maxIssues)report.issues.push(data);else report.truncated=true;};
  const state=p=>grid.inside(...p)?compiled.manifest.palette[compiled.cells[grid.index(...p)]]:'@outside';
  const witness=p=>({feet:p,support:state([p[0],p[1]-1,p[2]]),body:state(p),head:state([p[0],p[1]+1,p[2]])});
  const run=(origin,region)=>{
    if(report.visits>=maxVisits){report.checksComplete=false;return null;}
    const result=grid.trace(origin,{...(region?{region}:{}),maxVisits:Math.min(maxVisits-report.visits,compiled.cells.length)});
    report.visits+=result.visits;if(!result.complete)report.checksComplete=false;return result;
  };
  const probes=scene.constraints.passages,entry=probes.length?run(probes[0].origin):null;
  if(entry){
    report.entry={passage:0,origin:probes[0].origin,startValid:entry.startValid,searchComplete:entry.complete,reachableFeet:entry.reachable};
    if(!entry.startValid)issue({code:'entry-unverified',...witness(probes[0].origin)});
  }
  for(const [index,p] of probes.entries()){
    const detail={index,origin:p.origin,size:p.size,checked:0,totalFootCells:p.size[0]*p.size[2],standable:0,reachableFromEntry:0,clearanceObstructions:0,checksComplete:true};
    let firstFailure;
    if(p.origin[1]<1||p.size[1]<2){detail.checksComplete=false;report.checksComplete=false;firstFailure={code:'passage-invalid-standing-declaration',...witness(p.origin)};}
    scan:for(let z=p.origin[2];z<p.origin[2]+p.size[2];z++)for(let x=p.origin[0];x<p.origin[0]+p.size[0];x++){
      const point=[x,p.origin[1],z];
      // Charge every declared clearance cell, not just its 2-cell player capsule.
      if(report.probeCellsChecked+Math.max(2,p.size[1])>maxProbeCells){detail.checksComplete=false;report.checksComplete=false;break scan;}
      report.probeCellsChecked+=Math.max(2,p.size[1]);detail.checked++;
      const canStand=grid.stand(...point);if(canStand)detail.standable++;
      if(entry?.startValid&&entry.has(point))detail.reachableFromEntry++;
      let clear=true;for(let y=point[1];y<point[1]+p.size[1];y++)if(!grid.air(compiled.cells[grid.index(x,y,z)])){clear=false;detail.clearanceObstructions++;}
      if(!firstFailure&&(!canStand||!clear))firstFailure={code:'passage-unverified',...witness(point)};
    }
    detail.entryRelation=!entry?.startValid?'entry-unverified':!entry.complete||!detail.checksComplete?'incomplete':detail.reachableFromEntry===detail.totalFootCells?'reachable':'disconnected';
    report.passages.push(detail);
    if(firstFailure)issue({passage:index,...firstFailure});
    if(detail.entryRelation==='disconnected')issue({code:'passage-disconnected-from-declared-entry',passage:index,origin:p.origin,reachable:detail.reachableFromEntry,total:detail.totalFootCells});
  }
  for(const c of scene.components.filter(c=>c.kind==='stairs')){
    const boxes=compiled.designSources.componentBounds[c.id],local=c.rotation%2?[c.size[2],c.size[1],c.size[0]]:c.size;
    const stepMaterial=MATERIALS[scene.palette.find(p=>p.role===c.material)?.material??c.material];
    const stepCollisionModeled=!!stepMaterial&&fullSupport(stepMaterial);
    const group={component:c.id,stepMaterial,stepCollisionModeled,checkedLowerFloors:[],localTwoWayPaths:0,unverifiedFloors:[],skippedFloors:[]};report.stairs.groups.push(group);report.stairs.total+=boxes.length;
    for(const [instance,box] of boxes.entries()){
      const lowerFloor=box.origin[1];
      if(report.stairs.checked>=maxStairs||report.visits>=maxVisits){report.stairs.skipped++;group.skippedFloors.push(lowerFloor);report.checksComplete=false;continue;}
      const point=p=>transformPoint(p,local,c.rotation,false).map((v,i)=>v+box.origin[i]);
      const lower=Array.from({length:c.style==='switchback'?2*c.width+1:c.width},(_,z)=>point([0,1,z]));
      const upper=Array.from({length:c.style==='switchback'?2*c.width+1:c.width},(_,z)=>point([c.style==='switchback'?0:c.rise+1,c.rise+1,z]));
      const start=lower.find(p=>grid.stand(...p)),end=upper.find(p=>grid.stand(...p));
      const up=start?run(start,box):null,down=end?run(end,box):null;
      const upFound=!!up&&upper.some(p=>up.has(p)),downFound=!!down&&lower.some(p=>down.has(p));
      report.stairs.checked++;group.checkedLowerFloors.push(lowerFloor);
      if(upFound&&downFound){report.stairs.localTwoWayPaths++;group.localTwoWayPaths++;}
      else{
        report.stairs.unverified++;group.unverifiedFloors.push(lowerFloor);
        issue({code:'stair-local-route-unverified',component:c.id,instance,lowerFloor,upperFloor:lowerFloor+c.rise,upFound,downFound,
          reason:stepCollisionModeled?'no-local-path-in-conservative-grid':'partial-step-collision-not-modeled',provesBlockedRoute:false,
          searchComplete:(!start||up?.complete===true)&&(!end||down?.complete===true),lower:witness(start??lower[0]),upper:witness(end??upper[0])});
      }
    }
  }
  return report;
}
