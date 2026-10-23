import {exactKeys} from '../../contracts/world-selection.mjs';
import {WORLD_ASSEMBLY_LIMITS} from '../../contracts/world-assembly-limits.mjs';
import {contextHash} from './context-snapshot.mjs';
import {coupledAssemblyPreviewBinding,checkedCoupledAssemblyPart} from './assembly-coupled-plan.mjs';
import {encodeSparseWorldDifference} from './sparse-world-difference.mjs';

const fields=['format','version','policy','snapshotHash','selectionHash','patchHash','world','selectionRevision','contextRevision',
  'couplingPlanHash','couplingPolicyHash','coordinateSpace','movable','bounds','palette','sections','summary',
  'canAuthorizePlacement','serverBaselineVerified','physicsVerified','worldRendered','previewHash'];
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const originals=new WeakMap();
export function checkedCoupledAssemblyPreview(plan,value,index,partHash){
  coupledAssemblyPreviewBinding(plan);const origin=originals.get(value);
  if(origin?.plan!==plan||origin.index!==index||origin.partHash!==partHash)throw Error('Original whole-plan preview required; reports/hashes cannot grant identity');
  return value;
}

/** Version2 is an EXPLICIT whole-coupled display identity. It does not validate
 * a half-door as a legacy patch, certify a complete candidate or grant writes. */
export function prepareCoupledAssemblyPreview(plan,partValue,{signal}={}){
  signal?.throwIfAborted();const part=checkedCoupledAssemblyPart(plan,partValue),binding=coupledAssemblyPreviewBinding(plan);
  const geometry=encodeSparseWorldDifference(part.writes,{signal});
  const content={format:'WorldPatchPreview',version:2,policy:'coupled-assembly-preview-data-v1',
    snapshotHash:part.snapshotHash,selectionHash:part.selectionHash,patchHash:part.partHash,...binding,
    coordinateSpace:'original-world-absolute',movable:false,bounds:geometry.bounds,palette:geometry.palette,sections:geometry.sections,
    summary:{writes:part.writes.length,counts:geometry.counts,omittedCells:'keep',explicitKeeps:0},
    canAuthorizePlacement:false,serverBaselineVerified:false,physicsVerified:false,worldRendered:false};
  if(Buffer.byteLength(JSON.stringify(content))+128>WORLD_ASSEMBLY_LIMITS.partBytes)throw Error('Coupled preview part byte quota');
  signal?.throwIfAborted();const preview=freeze({...content,previewHash:contextHash(content)});originals.set(preview,{plan,index:part.index,partHash:part.partHash});return preview;
}

/** Rebuild from the SAME opaque complete plan/part. New modes cannot enter the
 * legacy validator, and a rehashed saved display is never trusted by itself. */
export function validateCoupledAssemblyPreview(plan,part,value,{signal}={}){
  signal?.throwIfAborted();
  if(Buffer.byteLength(JSON.stringify(value))>WORLD_ASSEMBLY_LIMITS.partBytes)throw Error('Saved coupled preview part byte quota');
  exactKeys(value,fields,'saved coupled preview');
  const rebuilt=prepareCoupledAssemblyPreview(plan,part,{signal});
  if(contextHash(rebuilt)!==contextHash(value))throw Error('Saved coupled preview differs from whole original plan/part');
  return rebuilt;
}
