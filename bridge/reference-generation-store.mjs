import {Worker} from 'node:worker_threads';
import {REFERENCE_JOB_LIMITS} from '../contracts/reference-generation-job.mjs';

// Pixel verification, immutable copying and recovery validation remain off the
// HTTP event loop. This lane never invokes an adapter or touches a world.
export class ReferenceGenerationStore{
  constructor({dataDir}){this.dataDir=dataDir;this.active=null;this.closed=false;}
  busy(){return this.active!==null;}
  operation(operation,options={}){
    if(this.closed)return Promise.reject(Error('Reference generation store closed'));
    if(this.busy())return Promise.reject(Object.assign(Error('Reference generation storage lane full; no model invoked'),{statusCode:429}));
    if(!['list','submit','recover','history','image'].includes(operation))return Promise.reject(Error('Unknown reference generation storage operation'));
    if(options.input?.byteLength>REFERENCE_JOB_LIMITS.inputBytes)return Promise.reject(Object.assign(Error('Reference SEND byte quota'),{statusCode:413}));
    return new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./reference-generation-worker.mjs',import.meta.url),{
        workerData:{...options,dataDir:this.dataDir,operation,kind:'reference-generation-v1'},resourceLimits:{maxOldGenerationSizeMb:512}});
      let settled=false;const finish=(error,value)=>{
        if(settled)return;settled=true;
        const done=terminationError=>{if(this.active?.worker===worker)this.active=null;(error??terminationError)?reject(error??terminationError):resolve(value);};
        worker.terminate().then(()=>done(),done);
      };
      this.active={worker,finish};
      worker.once('message',m=>finish(m.ok?null:Object.assign(Error(m.error),{code:m.code}),m.value));
      worker.once('error',e=>finish(e));worker.once('exit',code=>{if(!settled)finish(Error('Reference generation worker exited '+code));});
    });
  }
  async close(){this.closed=true;const active=this.active;if(active){active.finish(Error('Reference storage interrupted; original SEND preserved'));await active.worker.terminate();}}
}
