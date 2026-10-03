import {validateScene} from '../../contracts/scene-spec.schema.mjs';
import {compileScene,inspectPartialConstructionOwnership} from './compiler.mjs';
import {inspectConstruction} from './construction-feedback.mjs';
import {inspectSceneNavigation} from './navigation-feedback.mjs';
import {hash} from '../generation/compiler.mjs';

export function dimensions(compiled){
  const {width:w,height:h,length:d}=compiled.manifest.dimensions,min=[w,h,d],max=[-1,-1,-1];let solids=0;
  for(let i=0;i<compiled.cells.length;i++)if(compiled.cells[i]>=2){solids++;const p=[i%w,Math.floor(i/(w*d)),Math.floor(i/w)%d];for(let a=0;a<3;a++){min[a]=Math.min(min[a],p[a]);max[a]=Math.max(max[a],p[a]);}}
  return {solidCount:solids,occupiedBounds:solids?{min,max,size:max.map((v,a)=>v-min[a]+1)}:null};
}
export function checkRequestedSize(compiled,policy,occupied){
  for(const axis of ['width','height','length'])if(policy.maximumBounds&&compiled.manifest.dimensions[axis]>policy.maximumBounds[axis])throw new Error('Checkpoint exceeds original '+axis+' boundary; no automatic resize');
  if(policy.worldHeight&&compiled.manifest.dimensions.height>policy.worldHeight)throw new Error('Checkpoint exceeds selected dimension height');
  if(policy.minimumHeight&&(occupied.occupiedBounds?.size[1]??0)<policy.minimumHeight)throw new Error('Checkpoint actual height is below original requirement '+policy.minimumHeight+'; no shortened prototype');
}
// Material table order and unused entries are not visible refinement. Normalize
// only the states actually present; retain KEEP versus CLEAR as distinct intent.
export function checkpointGeometryHash(compiled){
  const states=[...new Set(compiled.cells)].map(id=>compiled.manifest.palette[id]).sort();
  const ids=new Map(states.map((state,index)=>[state,index]));
  const remap=compiled.manifest.palette.map(state=>ids.get(state));
  const binary=Buffer.allocUnsafe(compiled.cells.length*2);
  for(let i=0;i<compiled.cells.length;i++)binary.writeUInt16LE(remap[compiled.cells[i]],i*2);
  return hash({cellsHash:hash(binary),palette:states,dimensions:compiled.manifest.dimensions});
}
/** Same compiler as final placement. Intermediate geometry is always rejected
 * by native import, including when this particular checkpoint compiles cleanly. */
export function assessSceneCheckpoint(scene,policy={}){
  const report={version:1,sourceHash:hash(scene),schemaValid:false,constructionFeedback:inspectConstruction(scene),geometryPassed:false,canAuthorizePlacement:false,
    error:null,quality:null,diagnostics:[],limitations:['Intermediate draft, never a completed or approved building.','Navigation warnings are not resolved by compilation; doors and partial collisions may remain unverified.','No image was supplied to a model by this textual feedback.']};
  let compiled;
  try{
    validateScene(scene);report.schemaValid=true;
    if(scene.constraints.interior!==true||scene.constraints.walkable!==true||!scene.constraints.passages.length)throw new Error('Checkpoint workflow requires interior, walkable and explicit passage probes at every stage');
    try{compiled=compileScene(scene,{navigationPolicy:policy.navigationPolicy??'review'});report.geometryPassed=true;}
    catch(error){report.error=error.message;if(error.designConflicts)compiled=compileScene(scene,{navigationPolicy:policy.navigationPolicy??'review',diagnosticOnly:true});else throw error;}
    const occupied=dimensions(compiled);Object.assign(report,occupied);checkRequestedSize(compiled,policy,occupied);
  }catch(error){
    report.geometryPassed=false;report.error=error.message;
    if(report.schemaValid&&!compiled&&report.constructionFeedback.issueGroups.some(i=>i.code.startsWith('facade-')))report.supplementalOwnership=inspectPartialConstructionOwnership(scene);
  }
  if(compiled){
    report.navigationFeedback=inspectSceneNavigation(scene,compiled);
    report.quality=compiled.manifest.quality;report.diagnostics=compiled.manifest.scene.diagnostics;
    report.geometryHash=checkpointGeometryHash(compiled);
    const {assetHash,...metadata}=compiled.manifest;
    const marked={...metadata,diagnosticOnly:true,checkpointOnly:true};compiled={...compiled,manifest:{...marked,assetHash:hash(marked)}};
    report.diagnosticAssetHash=compiled.manifest.assetHash;
  }
  return {report,compiled};
}
