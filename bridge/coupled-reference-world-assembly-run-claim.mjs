import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {exactKeys} from '../contracts/world-selection.mjs';
import {coupledReferenceAssemblyOriginalRequest} from '../contracts/coupled-reference-world-assembly-job.mjs';
import {coupledAssemblyWorldContextData} from '../src/world/assembly-coupled-context.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {writeJointInvocationEnvelope} from './reference-world-patch-invocation-data.mjs';
import {readJointAssemblyJobEnvelope} from './reference-world-assembly-job-data.mjs';

export const COUPLED_REFERENCE_ASSEMBLY_RUN_CLAIM='coupled-reference-world-assembly-run-claim.json';
function expected(original){
  const p=original.prepared,world=coupledAssemblyWorldContextData(original.worldContext);
  if(p.format!=='CoupledReferenceWorldAssemblyPreparation'||p.version!==1||world.worldContextHash!==p.worldContextHash)throw Error('Original new coupled preparation/context required');
  return {format:'CoupledReferenceWorldAssemblyInternalRunClaim',version:1,purpose:'coupled-reference-world-assembly',
    jobId:p.jobId,requestHash:hash(coupledReferenceAssemblyOriginalRequest(original)),preparationHash:p.preparationHash,
    referenceInputHash:hash(original.reference.input),runtimeHash:p.runtimeHash,maximumCalls:p.maximumCalls,
    captureExpiresAt:p.recordExpiresAt,authority:'internal-generation-claim-not-live-registry-or-server-owner',
    originalRegistryVerified:false,canAuthorizePlacement:false};
}
// Consumed BEFORE any model reservation. A lost/cancelled internal start cannot
// become a second run, and this disk record is never a live registry capability.
export async function claimCoupledReferenceAssemblyRun({directory,original}){
  const value={...expected(original),id:randomUUID(),createdAt:Date.now()};
  if(value.createdAt>=value.captureExpiresAt)throw Error('Original coupled capture expired before start; no refresh');
  await writeJointInvocationEnvelope(path.join(directory,COUPLED_REFERENCE_ASSEMBLY_RUN_CLAIM),value);return value;
}
export async function readCoupledReferenceAssemblyRunClaim({directory,original}){
  const value=await readJointAssemblyJobEnvelope(path.join(directory,COUPLED_REFERENCE_ASSEMBLY_RUN_CLAIM),4096),base=expected(original);
  exactKeys(value,[...Object.keys(base),'id','createdAt'],'original internal coupled run claim');
  const {id,createdAt,...content}=value;
  if(hash(content)!==hash(base)||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id??'')||!Number.isSafeInteger(createdAt)
    ||createdAt<0||createdAt>=base.captureExpiresAt||createdAt>Date.now())throw Error('Original internal coupled start changed; no task adoption');
  return value;
}
