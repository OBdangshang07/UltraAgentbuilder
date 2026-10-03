import {Worker} from 'node:worker_threads';
export function renderAssemblyPreview(directory,expected,out,signal){
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./assembly-preview-worker.mjs',import.meta.url),{workerData:{directory,expected,out},resourceLimits:{maxOldGenerationSizeMb:256}});
    let settled=false;const done=(error,evidence)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve(evidence);};
    const abort=()=>done(new Error('Assembly preview cancelled'));
    const timer=setTimeout(()=>done(new Error('Assembly preview time quota exceeded')),60000);
    worker.once('message',m=>done(m.ok?null:new Error(m.error),m.evidence));worker.once('error',e=>done(e));worker.once('exit',c=>{if(!settled)done(new Error('Assembly preview exited '+c));});
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });
}
