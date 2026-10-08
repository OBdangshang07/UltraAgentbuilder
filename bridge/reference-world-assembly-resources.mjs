import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {exactKeys} from '../contracts/world-selection.mjs';
import {REFERENCE_OWNER} from '../contracts/reference-attachments.mjs';

export const JOINT_ASSEMBLY_RESOURCE_LIMITS=Object.freeze({queue:2,inputBytes:65536,
  outputBytes:40*1024**2,operationMs:120000,oldGenerationMb:512,stackMb:4});
const operations=['prepare','bind','metadata','part'];
const failure=(message,statusCode=409)=>Object.assign(Error(message),{statusCode});
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};

/** Internal owner API, not a SEND or HTTP body schema. It derives every job
 * path from the private data root and original pixel UUID. The future job
 * owner must create/claim a NEW job directory before bind; this lane cannot
 * create one, adopt partial records, invoke a model or refresh world facts. */
export class ReferenceWorldAssemblyResources {
  constructor(options) {
    exactKeys(options,['dataDir'],'joint resource owner');
    if(typeof options.dataDir!=='string'||!options.dataDir)throw Error('Private joint data root required');
    this.dataDir=path.resolve(options.dataDir);this.root=path.join(this.dataDir,'reference-world-assembly-jobs');
    this.queue=[];this.active=null;this.closed=false;this.cleanups=new Set();
  }
  busy(){return !!this.active||this.queue.length>0||this.cleanups.size>0;}
  operation(operation,id,payload,{signal}={}) {
    if(!operations.includes(operation)||typeof id!=='string'||!REFERENCE_OWNER.test(id))
      return Promise.reject(failure('Exact independent joint operation and original UUID required',400));
    if(this.closed)return Promise.reject(failure('Joint resources closed; original evidence retained',503));
    if(signal!==undefined&&!(signal instanceof AbortSignal))return Promise.reject(failure('Joint cancellation signal required',400));
    if(signal?.aborted)return Promise.reject(failure('Joint resource operation cancelled; original evidence retained'));
    if(!(payload instanceof Uint8Array)||payload.byteLength<1||payload.byteLength>JOINT_ASSEMBLY_RESOURCE_LIMITS.inputBytes)
      return Promise.reject(failure('Joint resource input byte quota',413));
    if(this.active&&this.queue.length>=JOINT_ASSEMBLY_RESOURCE_LIMITS.queue)
      return Promise.reject(failure('Joint resource queue full; no retry or model invoked',429));
    // Freeze exact queued bytes before the caller can mutate its Buffer.
    const bytes=Buffer.from(payload);
    return new Promise((resolve,reject)=>{
      const item={operation,id,payload:bytes,signal,resolve,reject,settled:false};
      item.abort=()=>this.finish(item,failure('Joint resource operation cancelled; original evidence retained'));
      signal?.addEventListener('abort',item.abort,{once:true});this.queue.push(item);this.pump();
    });
  }
  pump() {
    if(this.closed||this.active||!this.queue.length)return;
    const item=this.active=this.queue.shift();
    try {
      item.worker=new Worker(new URL('./reference-world-assembly-resource-worker.mjs',import.meta.url),{
        workerData:{dataDir:this.dataDir,operation:item.operation,id:item.id,payload:item.payload},
        resourceLimits:{maxOldGenerationSizeMb:JOINT_ASSEMBLY_RESOURCE_LIMITS.oldGenerationMb,
          stackSizeMb:JOINT_ASSEMBLY_RESOURCE_LIMITS.stackMb}});
    }catch{this.finish(item,failure('Joint resource worker unavailable; original evidence retained',503));return;}
    item.timer=setTimeout(()=>this.finish(item,failure('Joint resource time quota; original evidence retained',503)),JOINT_ASSEMBLY_RESOURCE_LIMITS.operationMs);
    item.worker.once('message',message=>{if(item.message){this.finish(item,failure('Joint worker returned multiple receipts'));return;}item.message=message;});
    item.worker.once('error',()=>this.finish(item,failure('Joint resource worker failed; original evidence retained',503)));
    item.worker.once('exit',code=>{
      const message=item.message;
      if(code!==0||!message||message.operation!==item.operation||message.id!==item.id)
        return this.finish(item,failure('Joint worker exited without an exact complete receipt',503));
      this.finish(item,message.ok===true?null:failure('Original joint resource verification rejected; no automatic retry',
        [400,409,413].includes(message.statusCode)?message.statusCode:409),message.result);
    });
  }
  finish(item,error,result) {
    if(item.settled)return;item.settled=true;clearTimeout(item.timer);item.signal?.removeEventListener('abort',item.abort);
    this.queue=this.queue.filter(other=>other!==item);
    // Do not declare the lane idle or start a second writer until the original
    // worker has actually stopped, including cancellation and quota failures.
    const cleanup=(item.worker?item.worker.terminate():Promise.resolve()).then(()=>{
      if(this.active===item)this.active=null;
      error?item.reject(error):item.resolve(freeze(result));
    },()=>{
      // An unverified retirement is not permission to start another writer.
      this.closed=true;if(this.active===item)this.active=null;
      item.reject(failure('Joint worker retirement unverified; original evidence retained',503));
      for(const queued of [...this.queue])this.finish(queued,failure('Joint resources closed after unverified retirement',503));
    });
    this.cleanups.add(cleanup);cleanup.finally(()=>{this.cleanups.delete(cleanup);this.pump();});
  }
  async cancel(id) {
    if(typeof id!=='string'||!REFERENCE_OWNER.test(id))throw failure('Exact original joint UUID required',400);
    const selected=[...this.queue,...(this.active?[this.active]:[])].filter(item=>item.id===id);
    for(const item of selected)this.finish(item,failure('Joint resource operation explicitly cancelled; original evidence retained'));
    await Promise.allSettled([...this.cleanups]);
    return freeze({id,cancelledOperations:selected.length,originalPartialFilesMayExist:true,
      additionalModelCalls:0,worldWrites:0,canAuthorizePlacement:false});
  }
  async close() {
    this.closed=true;
    for(const item of [...this.queue,...(this.active?[this.active]:[])])
      this.finish(item,failure('Joint resources closed; original evidence retained',503));
    await Promise.allSettled([...this.cleanups]);
  }
}
