import {REFERENCE_OWNER} from '../contracts/reference-attachments.mjs';
import {publicOwnerCreationFailure} from './world-patch-owner-failure.mjs';

export const REFERENCE_ASSEMBLY_ADMISSION_FAILURE_FILE='admission-failure.json';
const phases=new Set(['new-owner','bind','verify','commit']);
const codes=new Set(['ENOENT','EEXIST','EACCES','EPERM','ENOSPC','EIO','EMFILE','ENFILE','WORLD_PATCH_OWNER_CREATION_FAILED']);
const keys=['format','version','id','requestHash','preparationHash','runtimeHash','claimHash','directoryHash',
  'controllerPid','occurredAt','phase','reason','ownerFailure','requestCommitted','providerDispatchStarted',
  'ownershipRecovered','allowsNewModelCall','canAuthorizePlacement'];
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function validateAssemblyAdmissionFailure(value) {
  if(!value||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))
    ||value.format!=='ReferenceWorldAssemblyAdmissionFailure'||value.version!==1||typeof value.id!=='string'||!REFERENCE_OWNER.test(value.id)
    ||['requestHash','preparationHash','runtimeHash','claimHash','directoryHash'].some(key=>!digest(value[key]))
    ||!Number.isSafeInteger(value.controllerPid)||value.controllerPid<=1||value.controllerPid>0xffffffff
    ||!Number.isSafeInteger(value.occurredAt)||value.occurredAt<0||!phases.has(value.phase)
    ||!codes.has(value.reason)&&value.reason!=='verification-rejected'
    ||['requestCommitted','providerDispatchStarted','ownershipRecovered','allowsNewModelCall','canAuthorizePlacement'].some(key=>value[key]!==false))
    throw Error('Exact original admission-only failure required; no recovery');
  const ownerFailure=value.ownerFailure===null?null:publicOwnerCreationFailure({code:'WORLD_PATCH_OWNER_CREATION_FAILED',ownerCreationDiagnostic:value.ownerFailure});
  if(value.ownerFailure!==null&&!ownerFailure)throw Error('Exact sanitized owner failure required');
  return {...value,ownerFailure};
}
export function assemblyAdmissionFailure(error,binding) {
  return validateAssemblyAdmissionFailure({format:'ReferenceWorldAssemblyAdmissionFailure',version:1,...binding,
    reason:codes.has(error?.code)?error.code:'verification-rejected',ownerFailure:publicOwnerCreationFailure(error),
    requestCommitted:false,providerDispatchStarted:false,ownershipRecovered:false,allowsNewModelCall:false,canAuthorizePlacement:false});
}
export function admissionFailureError(value) {
  const diagnostic=validateAssemblyAdmissionFailure(value),owner=diagnostic.ownerFailure;
  const query=owner?.query,detail=query?`; query=${query.reason}; query-phase=${query.phase??'unknown'}`:'';
  const message=`Complete joint admission rejected at ${diagnostic.phase}${owner?' / '+owner.phase:''} (${owner?.reason??diagnostic.reason}${detail}); original evidence retained; no automatic resubmission`;
  // The normal Error message is fixed/redacted too: test/launcher failures
  // must retain the same cause even if a test-owned temp fixture is cleaned.
  return Object.assign(Error(message),
    {code:'REFERENCE_ASSEMBLY_ADMISSION_FAILED',statusCode:409,publicMessage:message,admissionDiagnostic:diagnostic});
}
export function publicAssemblyAdmissionFailure(error) {
  try{return error?.code==='REFERENCE_ASSEMBLY_ADMISSION_FAILED'?validateAssemblyAdmissionFailure(error.admissionDiagnostic):null;}
  catch{return null;}
}
