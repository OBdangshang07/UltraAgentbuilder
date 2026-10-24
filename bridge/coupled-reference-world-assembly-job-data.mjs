import fs from 'node:fs/promises';
import {jointAssemblyJobBytes,readJointAssemblyJobEnvelope} from './reference-world-assembly-job-data.mjs';
import path from 'node:path';
import {exactKeys} from '../contracts/world-selection.mjs';
import {REFERENCE_OWNER} from '../contracts/reference-attachments.mjs';
import {validateCoupledReferenceWorldAssemblyJobRequest,COUPLED_REFERENCE_WORLD_ASSEMBLY_JOB_LIMITS} from '../contracts/coupled-reference-world-assembly-job.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {validateWorldPatchOwnerReference} from './world-patch-owner-observation.mjs';
import {jointInvocationDirectory} from './reference-world-patch-invocation-data.mjs';
import {readFrozenCoupledReferenceWorldAssembly,verifyCoupledReferenceWorldAssemblySend} from './coupled-reference-world-assembly-preparation.mjs';
import {validateCoupledAssemblyReferenceInput} from './coupled-reference-world-assembly-input.mjs';
import {COUPLED_REFERENCE_ASSEMBLY_ADMISSION_FAILURE_FILE,validateCoupledAssemblyAdmissionFailure,coupledAdmissionFailureError} from './coupled-reference-world-assembly-admission-failure.mjs';

export const COUPLED_REFERENCE_ASSEMBLY_DISPATCH_FILE='original-dispatch.json';
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
// The strong bounded file/envelope reader is shared, not a new permissive parser.
export {jointAssemblyJobBytes,readJointAssemblyJobEnvelope};
export async function coupledAssemblyJobRoot(dataDir,{create=false}={}) {
  dataDir=path.resolve(dataDir);let ancestor=path.parse(dataDir).root;await jointInvocationDirectory(ancestor);
  for(const part of path.relative(ancestor,dataDir).split(path.sep).filter(Boolean)){ancestor=path.join(ancestor,part);await jointInvocationDirectory(ancestor);}
  const root=path.join(dataDir,'coupled-reference-world-assembly-jobs');await jointInvocationDirectory(root,create);return root;
}
export function validateCoupledReferenceWorldAssemblyDispatchClaim(claim,value) {
  exactKeys(claim,['format','version','purpose','id','ticketId','requestHash','preparationHash','runtimeHash',
    'ownerReferenceHash','createdAt','maximumCalls','originalOwnerOnly','callsReservedAtClaim','canAuthorizePlacement'],'original full-task runner claim');
  if(claim.format!=='CoupledReferenceWorldAssemblyOriginalDispatchClaim'||claim.version!==1||claim.purpose!=='coupled-reference-world-assembly'
    ||claim.id!==value.id||typeof claim.ticketId!=='string'||!REFERENCE_OWNER.test(claim.ticketId)
    ||claim.requestHash!==value.requestHash||claim.preparationHash!==value.prepared.preparationHash
    ||claim.runtimeHash!==value.runtimeHash||claim.ownerReferenceHash!==value.ownerReferenceHash
    ||!Number.isSafeInteger(claim.createdAt)||claim.createdAt<value.createdAt||claim.createdAt>=value.prepared.recordExpiresAt
    ||claim.maximumCalls!==value.maximumCalls||claim.originalOwnerOnly!==true||claim.callsReservedAtClaim!==0
    ||claim.canAuthorizePlacement!==false)throw Error('Original complete joint dispatch claim changed; no ownership adoption');
  return claim;
}

/** Read-only ORIGINAL record plus copied pixels/context, no fresh draft,
 * expiry refresh, provider, compilation substitute, or task invocation.
 * Runtime mismatch is history, not permission to issue a replacement owner. */
export async function readCoupledReferenceWorldAssemblyJobRecord({dataDir,id,expectedRequestHash=null}) {
  if(typeof id!=='string'||!REFERENCE_OWNER.test(id)||expectedRequestHash!==null&&!digest(expectedRequestHash))throw Error('Original full joint job identity required');
  let root;
  try{root=await coupledAssemblyJobRoot(dataDir);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  const directory=path.join(root,id);
  try{await jointInvocationDirectory(directory);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  let value;
  try{value=await readJointAssemblyJobEnvelope(path.join(directory,'request.json'),COUPLED_REFERENCE_WORLD_ASSEMBLY_JOB_LIMITS.recordBytes);}
  catch(error){
    if(error.code!=='ENOENT')throw error;
    let diagnostic;try{diagnostic=validateCoupledAssemblyAdmissionFailure(await readJointAssemblyJobEnvelope(path.join(directory,COUPLED_REFERENCE_ASSEMBLY_ADMISSION_FAILURE_FILE),8192));}
    catch{throw error;}
    if(diagnostic.id!==id||diagnostic.directoryHash!==hash(directory)||expectedRequestHash!==null&&diagnostic.requestHash!==expectedRequestHash)
      throw Error('Original admission failure identity changed; no recovery');
    throw coupledAdmissionFailureError(diagnostic);
  }
  exactKeys(value,['format','version','purpose','id','request','requestHash','prepared','referenceInput','ownerReference','ownerReferenceHash',
    'runtimeHash','createdAt','maximumCalls','state','modelSentAtReservation','callsReservedAtReservation','canAuthorizePlacement'],'original complete joint job');
  const request=validateCoupledReferenceWorldAssemblyJobRequest(value.request),input=validateCoupledAssemblyReferenceInput(value.referenceInput);
  const owner=validateWorldPatchOwnerReference(value.ownerReference,value.ownerReferenceHash);
  if(value.format!=='CoupledReferenceWorldAssemblyJobReservation'||value.version!==1||value.purpose!=='coupled-reference-world-assembly'
    ||value.id!==id||request.referenceOwnerId!==id||hash(request)!==value.requestHash||!digest(value.requestHash)
    ||expectedRequestHash!==null&&expectedRequestHash!==value.requestHash||owner.directory!==directory
    ||hash(await jointAssemblyJobBytes(path.join(directory,'_owner.json'),4096))!==owner.ownerFileSha256
    ||input.ownerId!==id||input.preparationHash!==value.prepared?.preparationHash
    ||value.runtimeHash!==value.prepared?.runtimeHash||value.maximumCalls!==value.prepared?.maximumCalls
    ||!Number.isSafeInteger(value.createdAt)||value.createdAt<Date.parse(owner.observation.observedUtc)
    ||value.createdAt<0||value.createdAt>=value.prepared?.recordExpiresAt||value.state!=='send-consumed-not-dispatched'
    ||value.modelSentAtReservation!==false||value.callsReservedAtReservation!==0||value.canAuthorizePlacement!==false)
    throw Error('Original full-task request, process owner, policy or reservation changed');
  const original=await readFrozenCoupledReferenceWorldAssembly({directory,referenceInput:input});
  verifyCoupledReferenceWorldAssemblySend(request.send,original.prepared);
  if(hash(original.prepared)!==hash(value.prepared)||hash(original.send)!==hash(request.send)
    ||request.contextId!==original.prepared.contextId||request.referenceSetHash!==original.prepared.referenceSetHash
    ||hash(request.generation)!==hash(original.reference.preparation.generation)
    ||value.createdAt<original.manifest.frozenAt)throw Error('Full joint job differs from ORIGINAL independent frozen source');
  let dispatchClaim=null;
  try{dispatchClaim=validateCoupledReferenceWorldAssemblyDispatchClaim(await readJointAssemblyJobEnvelope(path.join(directory,COUPLED_REFERENCE_ASSEMBLY_DISPATCH_FILE),
    COUPLED_REFERENCE_WORLD_ASSEMBLY_JOB_LIMITS.dispatchBytes),value);}catch(error){if(error.code!=='ENOENT')throw error;}
  return {directory,value,dispatchClaim};
}
