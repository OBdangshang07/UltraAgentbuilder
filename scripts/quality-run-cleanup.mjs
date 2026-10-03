// Cleanup steps are independent: a renderer error must not hide Bridge shutdown,
// the final durable job state, accounting, or persistence failures.
export const qualityTerminal = state => ['preview-ready','failed','cancelled','interrupted'].includes(state);

export function observeQualityJob(ledger,record,job){
 if(job.id!==record.jobId)throw Error('Observed job identity changed');
 const reserved=job.assemblyCallsReserved??0;
 if(!Number.isSafeInteger(reserved)||reserved<record.assemblyCallsReserved||reserved>ledger.maximumCalls)throw Error('Invalid or regressed invocation accounting');
 Object.assign(record,{state:job.state,error:job.error??null,assemblyCallsReserved:reserved,
  assemblyStages:job.assemblyStages??[],assemblySummary:job.assemblySummary??null,generations:job.generations??[],
  generationDiagnostic:job.generationDiagnostic??null,assetHash:job.assetHash??null,
  visualEvidenceBinding:job.visualEvidenceBinding??null,
  nativeEvidence:job.nativeEvidence?{id:job.nativeEvidence.id,state:job.nativeEvidence.state}:null});
 ledger.reservedCalls=reserved;
 if(qualityTerminal(job.state))record.finishedAt=ledger.finishedAt=job.updatedAt??new Date().toISOString();
}

export async function finalizeQualityRun({ledger,record,renderer,rendererAttempted,bridge,readJob,persist,release}){
 const errors=[];
 const attempt=async(step,fn)=>{try{return await fn();}catch(error){errors.push({step,error:String(error)});return undefined;}};
 let rendererStopped=!rendererAttempted,bridgeClosed=!bridge;
 if(renderer){
  const outcome=await attempt('renderer',()=>renderer.settle());
  if(outcome){ledger.renderer=outcome;rendererStopped=outcome.nativeClientExitVerified===true&&outcome.launcherExited===true;
   if(outcome.result!=='passed')errors.push({step:'renderer-outcome',error:(outcome.errors??['Renderer failed']).join('; ')});
  }
 }else if(ledger.renderer){rendererStopped=ledger.renderer.nativeClientExitVerified===true&&ledger.renderer.launcherExited===true;}
 if(bridge)await attempt('bridge',async()=>{await bridge.close();bridgeClosed=true;});
 // Bridge.close waits for job persistence. Never replace a durable interrupted
 // state with the last generating poll, and never invent a terminal state.
 let observed=!record.jobId;
 if(record.jobId)await attempt('final-job',async()=>{observeQualityJob(ledger,record,await readJob());observed=true;});
 ledger.cleanup={rendererStopped,bridgeClosed,jobObserved:observed,observedAt:new Date().toISOString()};
 ledger.cleanupCompleted=rendererStopped&&bridgeClosed&&observed;
 ledger.cleanupErrors=errors;
 let saved=false;
 await attempt('persist',async()=>{await persist();saved=true;});
 if(release&&saved&&ledger.cleanupCompleted){
  await attempt('lease',async()=>{try{await release();}catch(error){ledger.leaseRetainedReason=error.message;throw error;}});
 }
 // One independent final write after an error. The caller's writer must allow
 // recovery after a rejected write; a recovered write does not erase its error.
 if(errors.length)await attempt('persist-final',persist);
 return {errors,cleanupCompleted:ledger.cleanupCompleted};
}
