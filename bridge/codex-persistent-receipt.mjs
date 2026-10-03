import fs from 'node:fs/promises';
import {hash} from '../src/generation/compiler.mjs';
import {codexTerminalOutput} from './codex-terminal-failure.mjs';

export async function codexRequestHash({prompt,model,effort,outputSchema,images=[],referenceBindingHash}){
 const imageHashes=[];for(const file of images)imageHashes.push(hash(await fs.readFile(file)));
 return codexRequestFingerprint({prompt,model,effort,outputSchema,imageHashes,referenceBindingHash});
}

// The verifier uses one checked snapshot of image bytes for BOTH the assembly
// fingerprint and the provider request. Keep the versioned hash unchanged.
export function codexRequestFingerprint({prompt,model,effort,outputSchema,imageHashes=[],referenceBindingHash}){
 if(referenceBindingHash!==undefined){
  if(!/^[a-f0-9]{64}$/.test(referenceBindingHash))throw Error('Invalid Codex reference binding hash');
  return hash({version:2,prompt,model,effort,outputSchema,imageHashes,referenceBindingHash});
 }
 return hash({version:1,prompt,model,effort,outputSchema,imageHashes});
}
export function checkCodexBinding(binding,requestHash){
 if(binding?.version!==1||binding.provider!=='codex'||binding.storage!=='persistent-single-turn'||
  binding.requestHash!==requestHash||!/^[-\w]{1,128}$/.test(binding.threadId??'')||
  !/^[-\w]{1,128}$/.test(binding.turnId??''))throw Error('Original Codex receipt binding missing or mismatched; no generation submitted');
 return {threadId:binding.threadId,turnId:binding.turnId};
}

// CLI 0.159.0 can read persisted full history from a separate read-only
// connection. Its loaded-thread store does not implement list_turns. Never
// resume the thread or infer a terminal result from a runtime summary.
export function inspectPersistedCodexTurn(result,{threadId,turnId,prompt}){
 const thread=result?.thread;
 if(thread?.id!==threadId||thread.ephemeral!==false||!Array.isArray(thread.turns))throw Error('Persistent receipt thread identity mismatch');
 if(thread.turns.length>1)throw Error('Dedicated receipt thread has unexpected additional turns');
 const turn=thread.turns.find(t=>t.id===turnId);
 if(thread.turns.length&&!turn)throw Error('Persistent receipt turn identity mismatch');
 const progress={source:'original-persisted-turn',threadId,turnId,observedAt:new Date().toISOString(),terminal:false,
  completionRecoveryAvailable:true,receiptState:'awaiting-original-stored-receipt',turnStatus:turn?.status??null};
 if(!turn)return {progress};
 if(!['inProgress','completed','failed','interrupted'].includes(turn.status))throw Error('Unknown original turn status');
 if(turn.status==='inProgress')return {progress};
 // A live rollout with task_started but no closing event is reconstructed as
 // "interrupted" by CLI 0.159.0. It is NOT an authoritative failed receipt.
 // Require a closing timestamp, not just the reconstructed status enum.
 if(!Number.isSafeInteger(turn.completedAt)||!Number.isSafeInteger(turn.startedAt)||turn.startedAt<=0||turn.completedAt<turn.startedAt){
  return {progress:{...progress,turnStatus:'unconfirmed',recordedStatus:turn.status,receiptState:'awaiting-closed-original-receipt'}};
 }
 if(turn.itemsView!=='full'||!Array.isArray(turn.items))throw Error('Original terminal history is not fully loaded');
 const users=turn.items.filter(i=>i.type==='userMessage');
 if(users.length!==1||users[0].content?.filter(i=>i.type==='text').map(i=>i.text).join('')!==prompt)throw Error('Original receipt input mismatch');
 const finals=turn.items.filter(i=>i.type==='agentMessage'&&i.phase==='final_answer');
 if(turn.status==='completed'&&(finals.length!==1||typeof finals[0].text!=='string'||Buffer.byteLength(finals[0].text)>2*1024*1024))throw Error('Original completed answer unavailable or ambiguous');
 const failedOutput=codexTerminalOutput(turn);
 if(turn.status!=='completed'&&Buffer.byteLength(failedOutput.text)>2*1024*1024)throw Error('Original failed answer exceeds evidence quota');
 // Do not forward/store reasoning, tools, user contents, or session metadata.
 return {progress:{...progress,terminal:true,receiptState:'original-terminal-receipt'},
  turn:{id:turn.id,status:turn.status,items:turn.status==='completed'?[{type:'agentMessage',phase:'final_answer',text:finals[0].text}]:failedOutput.text?[{type:'agentMessage',phase:'final_answer',text:failedOutput.text}]:[],
   ...(turn.status!=='completed'?{outputObserved:failedOutput.observed}:{}),
   error:turn.error?{message:String(turn.error.message??'Original turn failed').slice(0,1000)}:null}};
}

export function observePersistedCodexTurn({read,identity,onProgress,onTerminal,onUnavailable,intervalMs=60000}){
 if(!Number.isSafeInteger(intervalMs)||intervalMs<1)throw Error('Invalid receipt observation interval');
 let closed=false,busy=false,timer;
 const stop=()=>{closed=true;clearTimeout(timer);};
 const poll=async()=>{
  if(closed||busy)return;clearTimeout(timer);busy=true;
  try{
   const checked=inspectPersistedCodexTurn(await read(),identity);
   if(!closed){if(checked.turn)await onTerminal(checked.turn,checked.progress);else await onProgress(checked.progress);}
  }catch{
   if(!closed)try{await onUnavailable({source:'original-persisted-turn',threadId:identity.threadId,turnId:identity.turnId,
    observedAt:new Date().toISOString(),terminal:false,completionRecoveryAvailable:true,observation:'unavailable'});}catch{ /* progress callbacks cannot crash callers */ }
  }finally{busy=false;if(!closed)timer=setTimeout(poll,intervalMs);}
 };
 timer=setTimeout(poll,intervalMs);return {stop,poll};
}
