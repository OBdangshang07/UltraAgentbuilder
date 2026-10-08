import fs from 'node:fs/promises';
import path from 'node:path';
import {exactKeys} from '../contracts/world-selection.mjs';
import {REFERENCE_OWNER} from '../contracts/reference-attachments.mjs';
import {validateReferenceWorldAssemblyJobRequest,REFERENCE_WORLD_ASSEMBLY_JOB_LIMITS} from '../contracts/reference-world-assembly-job.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {validateWorldPatchOwnerReference} from './world-patch-owner-observation.mjs';
import {jointInvocationDirectory} from './reference-world-patch-invocation-data.mjs';
import {readFrozenReferenceWorldAssembly,verifyReferenceWorldAssemblySend} from './reference-world-assembly.mjs';
import {validateJointAssemblyReferenceInput} from './reference-world-assembly-input.mjs';

export const REFERENCE_ASSEMBLY_DISPATCH_FILE='original-dispatch.json';
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
// Read at most the approved size plus ONE sentinel byte, even if a file grows
// concurrently. File/link/inode checks are repeated; no unbounded readFile.
export async function jointAssemblyJobBytes(file,maximum) {
  const before=await fs.lstat(file);
  const same=stat=>stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.dev===before.dev&&stat.ino===before.ino
    &&stat.size===before.size&&stat.mtimeMs===before.mtimeMs&&stat.ctimeMs===before.ctimeMs;
  if(!Number.isSafeInteger(maximum)||maximum<1||!same(before)||before.size<1||before.size>maximum
    ||await fs.realpath(file)!==file)throw Error('Original full-task member type/link/byte quota rejected');
  const handle=await fs.open(file,'r');
  try {
    if(!same(await handle.stat()))throw Error('Original full-task member changed before open');
    const buffer=Buffer.alloc(before.size+1);let count=0;
    while(count<buffer.length){const read=await handle.read(buffer,count,buffer.length-count,count);if(!read.bytesRead)break;count+=read.bytesRead;}
    if(count!==before.size||!same(await handle.stat())||!same(await fs.lstat(file))||await fs.realpath(file)!==file)
      throw Error('Original full-task member changed during read');
    return buffer.subarray(0,count);
  }finally{await handle.close();}
}
export async function readJointAssemblyJobEnvelope(file,maximum) {
  const envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await jointAssemblyJobBytes(file,maximum)));
  exactKeys(envelope,['value','sha256'],'original full-task envelope');
  if(!digest(envelope.sha256)||hash(envelope.value)!==envelope.sha256)throw Error('Original full-task envelope integrity changed');
  return envelope.value;
}
export async function jointAssemblyJobRoot(dataDir,{create=false}={}) {
  dataDir=path.resolve(dataDir);let ancestor=path.parse(dataDir).root;await jointInvocationDirectory(ancestor);
  for(const part of path.relative(ancestor,dataDir).split(path.sep).filter(Boolean)){ancestor=path.join(ancestor,part);await jointInvocationDirectory(ancestor);}
  const root=path.join(dataDir,'reference-world-assembly-jobs');await jointInvocationDirectory(root,create);return root;
}
export function validateReferenceWorldAssemblyDispatchClaim(claim,value) {
  exactKeys(claim,['format','version','purpose','id','ticketId','requestHash','preparationHash','runtimeHash',
    'ownerReferenceHash','createdAt','maximumCalls','originalOwnerOnly','callsReservedAtClaim','canAuthorizePlacement'],'original full-task runner claim');
  if(claim.format!=='ReferenceWorldAssemblyOriginalDispatchClaim'||claim.version!==2||claim.purpose!=='reference-world-assembly'
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
export async function readReferenceWorldAssemblyJobRecord({dataDir,id,expectedRequestHash=null}) {
  if(typeof id!=='string'||!REFERENCE_OWNER.test(id)||expectedRequestHash!==null&&!digest(expectedRequestHash))throw Error('Original full joint job identity required');
  let root;
  try{root=await jointAssemblyJobRoot(dataDir);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  const directory=path.join(root,id);
  try{await jointInvocationDirectory(directory);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  const value=await readJointAssemblyJobEnvelope(path.join(directory,'request.json'),REFERENCE_WORLD_ASSEMBLY_JOB_LIMITS.recordBytes);
  exactKeys(value,['format','version','purpose','id','request','requestHash','prepared','referenceInput','ownerReference','ownerReferenceHash',
    'runtimeHash','createdAt','maximumCalls','state','modelSentAtReservation','callsReservedAtReservation','canAuthorizePlacement'],'original complete joint job');
  const request=validateReferenceWorldAssemblyJobRequest(value.request),input=validateJointAssemblyReferenceInput(value.referenceInput);
  const owner=validateWorldPatchOwnerReference(value.ownerReference,value.ownerReferenceHash);
  if(value.format!=='ReferenceWorldAssemblyJobReservation'||value.version!==2||value.purpose!=='reference-world-assembly'
    ||value.id!==id||request.referenceOwnerId!==id||hash(request)!==value.requestHash||!digest(value.requestHash)
    ||expectedRequestHash!==null&&expectedRequestHash!==value.requestHash||owner.directory!==directory
    ||hash(await jointAssemblyJobBytes(path.join(directory,'_owner.json'),4096))!==owner.ownerFileSha256
    ||input.ownerId!==id||input.preparationHash!==value.prepared?.preparationHash
    ||value.runtimeHash!==value.prepared?.runtimeHash||value.maximumCalls!==value.prepared?.maximumCalls
    ||!Number.isSafeInteger(value.createdAt)||value.createdAt<Date.parse(owner.observation.observedUtc)
    ||value.createdAt<0||value.createdAt>=value.prepared?.recordExpiresAt||value.state!=='send-consumed-not-dispatched'
    ||value.modelSentAtReservation!==false||value.callsReservedAtReservation!==0||value.canAuthorizePlacement!==false)
    throw Error('Original full-task request, process owner, policy or reservation changed');
  const original=await readFrozenReferenceWorldAssembly({directory,referenceInput:input});
  verifyReferenceWorldAssemblySend(request.send,original.prepared);
  if(hash(original.prepared)!==hash(value.prepared)||hash(original.send)!==hash(request.send)
    ||request.contextId!==original.prepared.contextId||request.referenceSetHash!==original.prepared.referenceSetHash
    ||hash(request.generation)!==hash(original.reference.preparation.generation)
    ||value.createdAt<original.manifest.frozenAt)throw Error('Full joint job differs from ORIGINAL independent frozen source');
  let dispatchClaim=null;
  try{dispatchClaim=validateReferenceWorldAssemblyDispatchClaim(await readJointAssemblyJobEnvelope(path.join(directory,REFERENCE_ASSEMBLY_DISPATCH_FILE),
    REFERENCE_WORLD_ASSEMBLY_JOB_LIMITS.dispatchBytes),value);}catch(error){if(error.code!=='ENOENT')throw error;}
  return {directory,value,dispatchClaim};
}
