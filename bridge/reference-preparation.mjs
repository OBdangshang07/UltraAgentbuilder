import {Worker} from 'node:worker_threads';
import {REFERENCE_OWNER} from '../contracts/reference-attachments.mjs';
import {REFERENCE_PREPARATION_LIMITS as limits} from '../contracts/reference-preparation.mjs';
import {REFERENCE_ARCHIVE_OPERATIONS,REFERENCE_ARCHIVE_MAINTENANCE_OPERATIONS} from '../contracts/reference-archive.mjs';

// Single bounded off-thread pixel/storage lane. No provider, accounts,
// generated code, world access or send/repair operation exists here.
export class ReferencePreparationStore {
  constructor({dataDir}){this.dataDir=dataDir;this.active=null;this.closed=false;}
  busy(){return this.active!==null;}
  operation(operation,ownerId,options={}){
    if(this.closed)return Promise.reject(Error('Reference preparation store closed'));
    if(this.busy())return Promise.reject(Object.assign(Error('Reference preparation lane full; no model invoked'),{statusCode:429}));
    if((operation!=='archive-list'&&!REFERENCE_OWNER.test(ownerId))||!['prepare','get','record','image','confirm','pixel-prepare','pixel-get','pixel-image',...REFERENCE_ARCHIVE_OPERATIONS,...REFERENCE_ARCHIVE_MAINTENANCE_OPERATIONS].includes(operation))return Promise.reject(Error('Invalid reference preparation operation'));
    if(options.input?.byteLength>limits.inputBytes)return Promise.reject(Object.assign(Error('Reference preparation byte quota'),{statusCode:413}));
    return new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./reference-preparation-worker.mjs',import.meta.url),{workerData:{...options,dataDir:this.dataDir,operation,ownerId,kind:'reference-preparation-v1'},
        resourceLimits:{maxOldGenerationSizeMb:512}});
      let settled=false;const finish=(error,value)=>{
        if(settled)return;settled=true;
        const done=terminationError=>{if(this.active?.worker===worker)this.active=null;(error??terminationError)?reject(error??terminationError):resolve(value);};
        worker.terminate().then(()=>done(),done);
      };
      this.active={worker,finish};worker.once('message',m=>finish(m.ok?null:Object.assign(Error(m.error),{code:m.code}),m.value));
      worker.once('error',e=>finish(e));worker.once('exit',code=>{if(!settled)finish(Error('Reference worker exited '+code));});
    });
  }
  async close(){this.closed=true;const active=this.active;if(active){active.finish(Error('Reference preparation interrupted; no model invoked'));await active.worker.terminate();}}
}
