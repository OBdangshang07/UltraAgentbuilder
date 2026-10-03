import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {startNativeRenderer} from './quality-native-renderer.mjs';
import {qualityTerminal} from './quality-run-cleanup.mjs';

// Only image transport is recoverable here. No submit/cancel/Agent function is
// supplied, so a renderer failure cannot cancel or repeat a model invocation.
export function rendererSupervisor({start,now=Date.now,idleMs=15000,maxRecoveries=1,maxStarts=27,onEvent=()=>{}}){
 let current=null,starts=0,idleSince=null,blocked=null,jobId=null,settlement=null;
 const sessions=[],failures=[];
 const snapshot=()=>({mode:'on-demand-native',starts,maxStarts,maxRecoveries,sessions:structuredClone(sessions),failures:structuredClone(failures),blocked,active:!!current,activeRoot:current?.inspect?.().root??null});
 const emit=kind=>onEvent({kind,...snapshot()});
 function failed(message,outcome){
  failures.push({message,outcome:outcome??null,observedAt:new Date(now()).toISOString()});
  if(!outcome?.launcherExited||!outcome?.nativeClientExitVerified)blocked='Prior exact JVM exit is unverified';
  else if(failures.length>maxRecoveries)blocked='Renderer recovery limit exhausted';
  emit('renderer-failure');
 }
 async function retire(unexpected){
  if(!current)return;
  const old=current;current=null;
  let outcome;
  try{outcome=await old.settle();}catch(error){failed(error.message,null);return;}
  sessions.push(outcome);
  if(unexpected||outcome.result!=='passed')failed(unexpected??outcome.errors?.join('; ')??'Renderer cleanup failed',outcome);
  emit('renderer-retired');
 }
 async function launch(){
  if(current)return true;
  if(blocked)return false;
  if(starts>=maxStarts){blocked='Renderer session limit exhausted';emit('renderer-blocked');return false;}
  // A durable session receipt must confirm both launcher and exact JVM exits.
  if(sessions.some(s=>s.launcherExited!==true||s.nativeClientExitVerified!==true)){blocked='Previous session exit unverified';return false;}
  starts++;emit('renderer-starting');
  try{current=await start(starts);idleSince=null;if(jobId)await current.observe(jobId);}
  catch(error){
   if(current)await retire(error.message);
   else{if(error.rendererOutcome)sessions.push(error.rendererOutcome);failed(error.message,error.rendererOutcome);}
   return false;
  }
  emit('renderer-ready');return true;
 }
 async function warmup(){if(settlement)throw Error('Renderer supervisor is closed');if(!(await launch()))throw Error('Renderer preflight failed; no generation submitted');}
 async function observe(id){
  if(jobId&&id!==jobId)throw Error('Supervisor cannot switch generation job');jobId=id;
  if(current)try{await current.observe(id);}catch(error){await retire(error.message);}
 }
 async function update(job){
  if(settlement)throw Error('Renderer supervisor is closed');
  if(job.id!==jobId)throw Error('Observed render job identity changed');
  if(current)try{await current.check();}catch(error){await retire(error.message);}
  if(qualityTerminal(job.state)){await retire();return snapshot();}
  const needed=job.nativeEvidence?.state==='waiting';
  if(needed){idleSince=null;if(!current)await launch();}
  else if(current){idleSince??=now();if(now()-idleSince>=idleMs)await retire();}
  // Failure/exhaustion is reported, not thrown into Bridge.close. The existing
  // evidence timeout ends only a blocked capture, never an in-flight generation.
  return snapshot();
 }
 function settle(){return settlement??=(async()=>{
  await retire();
  const exited=sessions.length===starts&&sessions.every(s=>s.launcherExited===true&&s.nativeClientExitVerified===true);
  const normal=sessions.every(s=>s.result==='passed'&&s.worldLoaded===false&&s.assetOnly===true);
  const result=blocked||!exited?'failed':failures.length?'recovered':normal?'passed':'failed';
  return {...snapshot(),result,launcherExited:exited,nativeClientExitVerified:exited,
   worldLoaded:normal?false:null,assetOnly:normal?true:null,generationSubmittedByClient:normal?false:null,
   errors:blocked?[blocked]:result==='failed'?['Renderer session receipts incomplete']:[],
   additionalModelCalls:0};
 })();}
 async function stop(){const result=await settle();if(result.result==='failed')throw Object.assign(Error(result.errors.join('; ')),{rendererOutcome:result});return result;}
 return {warmup,observe,update,settle,stop,inspect:snapshot};
}

export function createNativeRendererSupervisor(project,ownerRoot,bridge,{onEvent,...options}={}){
 return rendererSupervisor({...options,onEvent,start:async()=>{
  const root=path.join(project,'build','quality-native-'+randomUUID().replaceAll('-',''));
  await fs.mkdir(path.join(root,'data'),{recursive:true});
  await fs.writeFile(path.join(root,'renderer-owner.json'),JSON.stringify({ownerRoot,additionalModelCalls:0}),{flag:'wx'});
  // Exact live loopback connection only, never printed. These children have no
  // model or world routes of their own and all observe the same original job.
  const connection=path.join(root,'data/connection.json');
  await fs.writeFile(connection,JSON.stringify(bridge.connection),{flag:'wx',mode:0o600});
  let renderer;
  try{renderer=await startNativeRenderer(project,root,bridge);}
  catch(error){if(error.rendererOutcome?.nativeClientExitVerified)await fs.unlink(connection);throw error;}
  let cleanup;
  const settle=()=>cleanup??=(async()=>{const outcome=await renderer.settle();if(outcome.nativeClientExitVerified)await fs.unlink(connection);return outcome;})();
  return {...renderer,settle};
 }});
}
