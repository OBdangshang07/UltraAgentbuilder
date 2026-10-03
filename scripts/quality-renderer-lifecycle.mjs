import {setTimeout as delay} from 'node:timers/promises';

// Exact client PID comes from the nonce-bound JVM identity, not its cmd/Gradle
// launcher. No process is killed. Absence of identity blocks safe restart.
export function rendererLifecycle({child,root,closeLog,readFailure,readReceipt,readProcessIdentity,isProcessAlive,sendStop,saveOutcome,wait=delay,now=Date.now,stopTimeoutMs=90000}){
 let ended=false,exitCode=null,spawnError=null,settlement=null;
 child.once('error',error=>{spawnError=error;if(!child.pid)ended=true;});
 child.once('close',code=>{exitCode=code;ended=true;});
 const inspect=()=>({root,launcherPid:child.pid??null,launcherExited:ended,exitCode,spawnError:spawnError?.message??null});
 const failure=(message,outcome=inspect())=>Object.assign(new Error(message),{rendererOutcome:outcome});
 async function check(){
  if(ended)throw failure('Isolated renderer stopped: '+(spawnError?.message??exitCode)+'; '+root);
  const saved=await readFailure();if(saved!==null)throw failure('Isolated renderer failed: '+saved+'; '+root);
 }
 async function settle(){
  if(settlement)return settlement;
  settlement=(async()=>{
   const errors=[];let logClosed=false,receipt=null,processIdentity=null,nativeClientExitVerified=false;
   if(!ended)try{await sendStop();}catch(error){errors.push('Stop marker: '+error.message);}
   const until=now()+stopTimeoutMs;
   while(!ended&&now()<until)await wait(Math.min(1000,Math.max(1,until-now())));
   if(!ended)errors.push('Renderer did not stop after stop marker; no process was killed');
   else{
    try{await closeLog();logClosed=true;}catch(error){errors.push('Log close: '+error.message);}
    if(spawnError)errors.push(spawnError.message);
    if(exitCode!==0)errors.push('Isolated client exited '+exitCode);
    if(!errors.length)try{
     receipt=await readReceipt();
     if(receipt.result!=='passed'||receipt.worldLoaded!==false||receipt.generationSubmittedByClient!==false||receipt.assetOnly!==true||receipt.visible!==true)throw Error('Invalid asset-only renderer receipt');
    }catch(error){errors.push('Receipt: '+error.message);receipt=null;}
   }
   try{
    processIdentity=await readProcessIdentity();
    nativeClientExitVerified=ended&&!(await isProcessAlive(processIdentity.pid));
    if(!nativeClientExitVerified)errors.push('Exact renderer JVM exit is not verified; no restart is safe');
    if(receipt&&JSON.stringify(receipt.processIdentity)!==JSON.stringify(processIdentity))throw Error('Exit receipt process identity changed');
   }catch(error){nativeClientExitVerified=false;receipt=null;errors.push('Process identity: '+error.message);}
   const outcome={...(receipt??{}),...inspect(),result:errors.length?'failed':'passed',logClosed,
    // These flags are claims only from a validated client receipt.
    worldLoaded:receipt?.worldLoaded??null,assetOnly:receipt?.assetOnly??null,
    generationSubmittedByClient:receipt?.generationSubmittedByClient??null,
    processIdentity,nativeClientExitVerified,errors,observedAt:new Date(now()).toISOString()};
   try{await saveOutcome(outcome);}catch(error){outcome.result='failed';outcome.errors.push('Exit receipt storage: '+error.message);}
   return outcome;
  })();
  return settlement;
 }
 async function stop(){const outcome=await settle();if(outcome.result!=='passed')throw failure(outcome.errors.join('; ')+'; '+root,outcome);return outcome;}
 return {check,inspect,settle,stop};
}
