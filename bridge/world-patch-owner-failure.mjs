import {publicWindowsOwnerQueryFailure} from './windows-owner-query.mjs';

const phases=new Set(['directory','empty-directory','process-query','self-process','owner-create','owner-capture']);
const codes=new Set(['ENOENT','EEXIST','EACCES','EPERM','ENOSPC','EIO','EMFILE','ENFILE',
  'WINDOWS_OWNER_QUERY_FAILED','WINDOWS_OWNER_INVALID_JSON','WINDOWS_OWNER_INVALID_OBSERVATION']);
const keys=['format','version','phase','reason','query','ownershipRecovered','canAuthorizePlacement'];

// Fixed diagnostic vocabulary only. Never retain a raw Error, stderr, path,
// command line or process observation. A failure is NOT an owner reference.
export function ownerCreationFailure(error,phase) {
  if(!phases.has(phase))throw Error('Exact owner creation phase required');
  return {format:'WorldPatchOwnerCreationFailure',version:1,phase,
    reason:codes.has(error?.code)?error.code:'verification-rejected',query:publicWindowsOwnerQueryFailure(error),
    ownershipRecovered:false,canAuthorizePlacement:false};
}
export function publicOwnerCreationFailure(error) {
  try {
    const value=error?.ownerCreationDiagnostic;
    if(error?.code!=='WORLD_PATCH_OWNER_CREATION_FAILED'||!value||Object.keys(value).length!==keys.length
      ||keys.some(key=>!Object.hasOwn(value,key))||value.format!=='WorldPatchOwnerCreationFailure'||value.version!==1
      ||!phases.has(value.phase)||!codes.has(value.reason)&&value.reason!=='verification-rejected'
      ||value.ownershipRecovered!==false||value.canAuthorizePlacement!==false)return null;
    const query=value.query===null?null:publicWindowsOwnerQueryFailure({code:'WINDOWS_OWNER_QUERY_FAILED',observationDiagnostic:value.query});
    if(value.query!==null&&!query)return null;
    return {...value,query};
  }catch{return null;}
}
export function ownerCreationError(error,phase) {
  const existing=publicOwnerCreationFailure(error);if(existing)return error;
  const diagnostic=ownerCreationFailure(error,phase);
  return Object.assign(Error('Original owner creation rejected; no ownership recovery or automatic retry'),
    {code:'WORLD_PATCH_OWNER_CREATION_FAILED',ownerCreationDiagnostic:diagnostic});
}
