import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {exactKeys} from '../contracts/world-selection.mjs';
import {REFERENCE_OWNER} from '../contracts/reference-attachments.mjs';
import {jointInvocationDirectory,writeJointInvocationEnvelope} from './reference-world-patch-invocation-data.mjs';

// PRIVATE diagnostic data only. Never served by an HTTP endpoint, used as a
// candidate, treated as provider closure, or accepted as permission to retry.
export const REFERENCE_ASSEMBLY_TERMINAL_FAILURE_FILE='original-terminal-failure.json';
export const REFERENCE_ASSEMBLY_LOCAL_PHASES=Object.freeze(['source-validation','runtime-validation','generation',
  'final-native-compile','final-native-identity','candidate-publication']);
const phases=new Set(['starting',...REFERENCE_ASSEMBLY_LOCAL_PHASES]);
const states=new Set(['start-rejected','failed-needs-original-inspection','cancelled-needs-original-inspection']);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const string=(value,maximum)=>{
  if(typeof value!=='string')return null;
  // Bound before UTF-8 allocation too. Private messages may include paths or
  // model prose; no caller serialization/toJSON or arbitrary fields are read.
  const bytes=Buffer.from(value.slice(0,maximum));
  return {text:new TextDecoder().decode(bytes.subarray(0,maximum)),truncated:value.length>maximum||bytes.length>maximum};
};
const own=(value,key)=>{
  try {const descriptor=Object.getOwnPropertyDescriptor(value,key);return descriptor&&'value' in descriptor?descriptor.value:undefined;}
  catch {return undefined;}
};

/** Bounded exact own error fields/cause chain, without invoking error getters,
 * toJSON, iterators or model objects. Truncation/unreadable data is explicit. */
export function privateAssemblyError(error){
  const seen=new Set();
  function visit(value,depth){
    if(value===null||typeof value!=='object'&&typeof value!=='function')
      return {kind:'non-error-thrown',value:string(typeof value==='string'?value:typeof value,2048)};
    if(seen.has(value))return {kind:'cause-cycle'};
    if(depth>=6)return {kind:'cause-depth-limit'};
    seen.add(value);
    const result={kind:'own-error-fields',name:string(own(value,'name'),128),message:string(own(value,'message'),8192),
      stack:string(own(value,'stack'),8192),code:string(own(value,'code'),128)};
    const cause=own(value,'cause');if(cause!==undefined)result.cause=visit(cause,depth+1);
    return result;
  }
  return visit(error,0);
}

/** Called ONLY with the current runner's independently issued packet. Paths
 * are internal, not request parameters. Exclusive creation preserves existing
 * or incomplete records; a failed diagnostic never replaces the actual error. */
export async function persistAssemblyTerminalFailure({directory,binding,phase,state,error}){
  exactKeys(binding,['id','requestHash','preparationHash','runtimeHash','maximumCalls','reservedCalls','stageEventsObserved'],'private terminal identity');
  if(!REFERENCE_OWNER.test(binding.id??'')||!['requestHash','preparationHash','runtimeHash'].every(k=>digest(binding[k]))
    ||!Number.isSafeInteger(binding.maximumCalls)||binding.maximumCalls<1||binding.maximumCalls>26
    ||binding.reservedCalls!==null&&(!Number.isSafeInteger(binding.reservedCalls)||binding.reservedCalls<0||binding.reservedCalls>binding.maximumCalls)
    ||!Number.isSafeInteger(binding.stageEventsObserved)||binding.stageEventsObserved<0||!phases.has(phase)||!states.has(state))
    throw Error('Exact original private terminal diagnostic identity required');
  if(!path.isAbsolute(directory)||path.resolve(directory)!==directory||path.basename(directory)!==binding.id
    ||path.basename(path.dirname(directory))!=='reference-world-assembly-jobs')throw Error('Original internal job diagnostic directory required');
  let ancestor=path.parse(directory).root;
  await jointInvocationDirectory(ancestor);
  for(const segment of path.relative(ancestor,directory).split(path.sep)){ancestor=path.join(ancestor,segment);await jointInvocationDirectory(ancestor);}
  const value={format:'ReferenceWorldAssemblyPrivateTerminalFailure',version:1,diagnosticId:randomUUID(),...binding,
    phase,state,occurredAt:Date.now(),error:privateAssemblyError(error),
    diagnosticOnly:true,providerOutcome:'not-established-by-local-error',allowsNewModelCall:false,
    originalOutcomeRewritten:false,canAuthorizePlacement:false,worldWrites:0};
  if(Buffer.byteLength(JSON.stringify(value))>114688)throw Error('Private terminal diagnostic quota');
  await writeJointInvocationEnvelope(path.join(directory,REFERENCE_ASSEMBLY_TERMINAL_FAILURE_FILE),value);
  return Object.freeze({saved:true,diagnosticOnly:true,allowsNewModelCall:false});
}
