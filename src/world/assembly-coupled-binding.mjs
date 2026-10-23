import {exactKeys,validateWorldSelection} from '../../contracts/world-selection.mjs';
import {patchHashField} from '../../contracts/world-patch.mjs';
import {WORLD_ASSEMBLY_LIMITS} from '../../contracts/world-assembly-limits.mjs';
import {contextHash} from './context-snapshot.mjs';
import {coupledAssemblyPlanData,coupledAssemblyPreviewBinding,coupledAssemblyNativeData,checkedCoupledAssemblyPatchSet} from './assembly-coupled-plan.mjs';
import {checkedCoupledAssemblyPreview} from './assembly-coupled-preview.mjs';

const sourceFields=['captureId','selection','jobId','worldContextHash','preparationHash','requestHash','runtimeHash','referenceSetHash',
  'contextRecordHash','referenceBindingHash','sourceHash','currentNativeEvidenceHash','candidateHash'];
const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};
const uuid=value=>{if(typeof value!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value))throw Error('Original coupled task/capture UUID required');return value;};

/** Complete data-only identity, not a candidate publisher or new SEND. Only a
 * completed ORIGINAL stream and its exact ORIGINAL previews can prepare this.
 * Client-supplied identity/hashes never become a server baseline attestation. */
export function prepareCoupledAssemblyBinding(plan,setValue,previews,sourceValue,{signal}={}){
  signal?.throwIfAborted();const data=coupledAssemblyPlanData(plan),set=checkedCoupledAssemblyPatchSet(plan,setValue),source=structuredClone(sourceValue);
  exactKeys(source,sourceFields,'coupled source identity');uuid(source.captureId);uuid(source.jobId);
  for(const key of sourceFields.filter(k=>!['captureId','jobId','selection'].includes(k)))patchHashField(source[key],key);
  const selection=validateWorldSelection(source.selection),expected=coupledAssemblyPreviewBinding(plan),native=coupledAssemblyNativeData(plan);
  if(contextHash(selection)!==data.selectionHash||contextHash(selection.world)!==contextHash(expected.world)||selection.revision!==expected.selectionRevision)
    throw Error('Coupled source must retain original selection/world identity');
  if(native.manifest.scene?.sourceHash!==source.sourceHash)throw Error('Coupled source must retain exact native SceneSpec source hash');
  if(!Array.isArray(previews)||previews.length!==set.partCount)throw Error('All original coupled previews required before binding');
  const previewHashes=previews.map((preview,index)=>{signal?.throwIfAborted();return checkedCoupledAssemblyPreview(plan,preview,index,set.partHashes[index]).previewHash;});
  const value={format:'CoupledAssemblyBinding',version:1,policy:data.policy,couplingPolicyHash:data.policyHash,couplingPlanHash:data.planHash,
    analysisHash:data.analysisHash,scheduleHash:data.scheduleHash,...source,selection,contextRevision:expected.contextRevision,
    snapshotHash:data.snapshotHash,selectionHash:data.selectionHash,assetHash:data.assetHash,cellsHash:data.cellsHash,
    patchSetHash:set.patchSetHash,origin:[...data.origin],partHashes:[...set.partHashes],previewHashes,totalWrites:data.operationCount,
    sourceAuthority:'client-submitted-facts-not-server-attestation',movable:false,canAuthorizePlacement:false,canAuthorizeModelSend:false,
    serverBaselineVerified:false,physicsVerified:false,worldWrites:0};
  if(Buffer.byteLength(JSON.stringify(value))>WORLD_ASSEMBLY_LIMITS.metadataBytes)throw Error('Coupled binding metadata byte quota');
  signal?.throwIfAborted();return freeze(value);
}
