import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {exactKeys} from '../contracts/world-selection.mjs';
import {REFERENCE_OWNER} from '../contracts/reference-attachments.mjs';
import {jointInvocationDirectory,writeJointInvocationEnvelope} from './reference-world-patch-invocation-data.mjs';
import {privateAssemblyError,REFERENCE_ASSEMBLY_LOCAL_PHASES} from './reference-world-assembly-terminal-failure.mjs';

// Private diagnostics are data only, never replay, closure or world authority.
export const COUPLED_REFERENCE_ASSEMBLY_TERMINAL_FAILURE_FILE='original-terminal-failure.json';
export async function persistCoupledAssemblyTerminalFailure({directory,binding,phase,state,error}){
  exactKeys(binding,['id','requestHash','preparationHash','runtimeHash','maximumCalls','reservedCalls','stageEventsObserved'],'private coupled terminal identity');
  if(!REFERENCE_OWNER.test(binding.id??'')||!['requestHash','preparationHash','runtimeHash'].every(k=>/^[a-f0-9]{64}$/.test(binding[k]??''))
    ||!Number.isSafeInteger(binding.maximumCalls)||binding.maximumCalls<1||binding.maximumCalls>26
    ||binding.reservedCalls!==null&&(!Number.isSafeInteger(binding.reservedCalls)||binding.reservedCalls<0||binding.reservedCalls>binding.maximumCalls)
    ||!Number.isSafeInteger(binding.stageEventsObserved)||binding.stageEventsObserved<0||!['starting',...REFERENCE_ASSEMBLY_LOCAL_PHASES].includes(phase)
    ||!['start-rejected','failed-needs-original-inspection','cancelled-needs-original-inspection'].includes(state))throw Error('Exact original private coupled diagnostic identity required');
  if(!path.isAbsolute(directory)||path.resolve(directory)!==directory||path.basename(directory)!==binding.id||path.basename(path.dirname(directory))!=='coupled-reference-world-assembly-jobs')throw Error('Original internal coupled job directory required');
  let ancestor=path.parse(directory).root;await jointInvocationDirectory(ancestor);
  for(const segment of path.relative(ancestor,directory).split(path.sep)){ancestor=path.join(ancestor,segment);await jointInvocationDirectory(ancestor);}
  const value={format:'CoupledReferenceWorldAssemblyPrivateTerminalFailure',version:1,diagnosticId:randomUUID(),...binding,phase,state,occurredAt:Date.now(),error:privateAssemblyError(error),
    diagnosticOnly:true,providerOutcome:'not-established-by-local-error',allowsNewModelCall:false,originalOutcomeRewritten:false,canAuthorizePlacement:false,worldWrites:0};
  if(Buffer.byteLength(JSON.stringify(value))>114688)throw Error('Private coupled terminal diagnostic quota');
  await writeJointInvocationEnvelope(path.join(directory,COUPLED_REFERENCE_ASSEMBLY_TERMINAL_FAILURE_FILE),value);return Object.freeze({saved:true,diagnosticOnly:true,allowsNewModelCall:false});
}
