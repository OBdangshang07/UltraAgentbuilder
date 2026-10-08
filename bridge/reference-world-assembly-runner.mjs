import {exactKeys} from '../contracts/world-selection.mjs';
import {REFERENCE_OWNER} from '../contracts/reference-attachments.mjs';
import {REFERENCE_WORLD_ASSEMBLY_JOB_LIMITS} from '../contracts/reference-world-assembly-job.mjs';
import {referenceWorldAssemblyOriginalController} from './reference-world-assembly-job-registry.mjs';
import {reserveReferenceWorldAssemblyExecution,finishReferenceWorldAssemblyExecution} from './reference-world-assembly-execution.mjs';
import {runReferenceWorldAssembly} from './reference-world-assembly.mjs';

const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const failure=(message,statusCode=409)=>Object.assign(Error(message+'; no original task adoption or resend'),{statusCode});
/** Original-owner full shared pipeline controller, NO HTTP or world API.
 * Start returns without waiting for the model. Closing a UI is unrelated to
 * this controller; only explicit cancel/close retires its original execution. */
export function createReferenceWorldAssemblyRunner(options) {
  exactKeys(options,['registry','adapter','nativeEvidence'],'original full joint runner');
  const {registry,adapter,nativeEvidence}=options;referenceWorldAssemblyOriginalController(registry);
  if(typeof adapter?.models!=='function'||typeof adapter?.generate!=='function'||typeof nativeEvidence!=='function')
    throw failure('Explicit selected adapter and original native renderer required',400);
  const tasks=new Map();let closed=false,active=null;
  const checkpoint=()=>{if(closed)throw failure('Original full joint runner closed',503);};
  const idCheck=id=>{if(typeof id!=='string'||!REFERENCE_OWNER.test(id))throw failure('Exact original full-task UUID required',400);};
  function view(task) {
    return freeze({format:'ReferenceWorldAssemblyRunnerStatus',version:2,purpose:'reference-world-assembly',id:task.id,
      state:task.state,stageEventsObserved:task.stageEvents,reservedCalls:task.reservedCalls,
      maximumCalls:task.packet?.prepared.maximumCalls??null,tier:task.packet?.prepared.tier??null,
      preparationHash:task.packet?.prepared.preparationHash??null,requestHash:task.packet?.requestHash??null,
      candidate:task.candidate??null,originalLiveExecutionOnly:true,automaticRetries:0,
      providerReceiptsIndependentlyAudited:false,serverBaselineVerified:false,allowsNewModelCall:false,
      canAuthorizePlacement:false,worldWrites:0});
  }
  async function start(id) {
    checkpoint();idCheck(id);const existing=tasks.get(id);
    if(existing){await existing.ready;return view(existing);}
    referenceWorldAssemblyOriginalController(registry,id);
    if(active)throw failure('Original complete joint runner lane busy',429);
    if(tasks.size>=REFERENCE_WORLD_ASSEMBLY_JOB_LIMITS.records)throw failure('Original runner history quota; nothing evicted',429);
    const task={id,state:'starting',stageEvents:0,reservedCalls:null,controller:new AbortController(),ready:null,done:null};
    tasks.set(id,task);active=task; // Register BEFORE any asynchronous handoff.
    task.ready=(async()=>{
      const {execution,packet}=await reserveReferenceWorldAssemblyExecution(registry,id);task.execution=execution;task.packet=packet;
      checkpoint();task.controller.signal.throwIfAborted();task.state='running';
      task.done=(async()=>{
        try {
          const result=await runReferenceWorldAssembly({directory:packet.directory,referenceInput:packet.referenceInput,
            preparationHash:packet.prepared.preparationHash,adapter,nativeEvidence,signal:task.controller.signal,execution,
            onStage:async()=>{task.stageEvents++;}});
          task.reservedCalls=result.candidate.reservedCalls;
          task.candidate={candidateHash:result.candidate.candidateHash,patchSetHash:result.candidate.patchSetHash,
            partCount:result.candidate.partCount,operationCount:result.candidate.operationCount,
            canAuthorizePlacement:false,partIsApplyScope:false};
          task.state='preview-ready';
        }catch(error){task.error=error;task.state=task.controller.signal.aborted?'cancelled-needs-original-inspection':'failed-needs-original-inspection';}
        finally{finishReferenceWorldAssemblyExecution(execution);if(active===task)active=null;}
        return view(task);
      })();
    })().catch(error=>{task.error=error;task.state='start-rejected';if(task.execution)finishReferenceWorldAssemblyExecution(task.execution);
      if(active===task)active=null;throw error;});
    await task.ready;return view(task);
  }
  async function wait(id){idCheck(id);const task=tasks.get(id);if(!task)return null;await task.ready;return task.done?await task.done:view(task);}
  function get(id){idCheck(id);const task=tasks.get(id);return task?view(task):null;}
  async function cancel(id) {
    checkpoint();idCheck(id);const task=tasks.get(id);
    if(task)task.controller.abort(Error('Explicit original full-task cancellation; unknown outcome is not repeated'));
    await registry.cancel(id);if(task)await Promise.allSettled([task.ready,task.done].filter(Boolean));
    return task?view(task):null;
  }
  return Object.freeze({start,wait,get,cancel,busy:()=>active!==null,
    async close(){closed=true;for(const task of tasks.values())task.controller.abort(Error('Original full-task runner closed'));
      await Promise.allSettled([...tasks.values()].map(async task=>{await task.ready;if(task.done)await task.done;}));}});
}
