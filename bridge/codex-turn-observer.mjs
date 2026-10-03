// Codex 0.159.0 ephemeral threads support summary reads, not includeTurns or
// turn pagination. These observations cannot recover a terminal answer. Keep
// the original notifications; never infer completion from idle/systemError.
export function inspectOriginalStatus(result,{threadId,turnId}){
 const thread=result?.thread;
 if(!thread||thread.id!==threadId)throw Error('Codex observation thread identity mismatch');
 const status=thread.status?.type;
 if(!['notLoaded','idle','systemError','active'].includes(status))throw Error('Codex observation runtime status unknown');
 return {source:'original-thread-status',threadId,turnId,runtimeStatus:status,
  observedAt:new Date().toISOString(),terminal:false,completionRecoveryAvailable:false,
  receiptState:status==='active'?'awaiting-original-notification':'unresolved-terminal-receipt'};
}

export function observeOriginalTurn({request,threadId,turnId,onObservation,onUnavailable,intervalMs=60000}){
 if(!Number.isSafeInteger(intervalMs)||intervalMs<1)throw Error('Invalid Codex observation interval');
 let closed=false,timer,busy=false;
 const stop=()=>{closed=true;clearTimeout(timer);};
 const poll=async()=>{
  if(closed||busy)return;clearTimeout(timer);busy=true;
  try{
   const result=await request('thread/read',{threadId,includeTurns:false},10000);
   if(!closed)await onObservation(inspectOriginalStatus(result,{threadId,turnId}));
  }catch{
   // Unsupported, unavailable or ambiguous reads never manufacture a terminal
   // state. Keep the original event subscription and do not send another turn.
   if(!closed)try{await onUnavailable({source:'original-thread-status',threadId,turnId,
    observedAt:new Date().toISOString(),observation:'unavailable',terminal:false,completionRecoveryAvailable:false});}catch{ /* diagnostics cannot crash the caller */ }
  }finally{busy=false;if(!closed)timer=setTimeout(poll,intervalMs);}
 };
 timer=setTimeout(poll,intervalMs);
 return {stop,poll};
}
