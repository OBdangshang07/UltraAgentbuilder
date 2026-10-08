import {exactKeys} from '../contracts/world-selection.mjs';
import {REFERENCE_OWNER} from '../contracts/reference-attachments.mjs';
import {assemblyRuntimeIdentity} from './assembly-durability.mjs';
import {ReferenceWorldAssemblyResources} from './reference-world-assembly-resources.mjs';

const prefix='/v1/reference-world-assembly';
const contextRoute=new RegExp(`^${prefix}/contexts/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})/prepare$`);
const fail=(message,statusCode=409)=>{throw Object.assign(Error(message),{statusCode,publicMessage:message});};
async function body(req,signal) {
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''))fail('Expected UTF-8 application/json',400);
  if(Number(req.headers['content-length'])>32768)fail('Complete joint preparation byte quota',413);
  let size=0;const chunks=[];
  for await(const chunk of req){signal.throwIfAborted();size+=chunk.length;if(size>32768)fail('Complete joint preparation byte quota',413);chunks.push(chunk);}
  signal.throwIfAborted();
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));}
  catch{fail('Exact valid UTF-8 complete joint preparation required',400);}
}

/** Exact paired-loopback middleware. Only FREE preparation is connected at
 * this milestone. The full-budget runner is NOT replaced with a single call.
 * Job ownership/SEND/native transport/history/full-set transactions remain
 * explicit subsequent gates, and cannot be enabled by HTTP/config. */
export async function createReferenceWorldAssemblyHttpService({dataDir,enabled=false,adapterFor,state}) {
  if(typeof enabled!=='boolean'||typeof adapterFor!=='function'||typeof state!=='function')throw Error('Process-owned complete joint service required');
  const resources=enabled?new ReferenceWorldAssemblyResources({dataDir}):null;
  const runtimeHash=enabled?await assemblyRuntimeIdentity():null;
  const active=new Set();let closed=false;
  const checkpoint=signal=>{
    const current=state();
    if(closed||current.closing||signal?.aborted)fail('Complete joint preparation closed/cancelled; original evidence retained',503);
    if(current.changingConfig)fail('Complete joint configuration changing; no model invoked');
    if(current.busy)fail('Finish other model, attachment or context work before complete joint preparation',429);
  };
  async function advertisement(generation,signal) {
    if(generation?.agent!=='codex'||typeof generation.model!=='string'||typeof generation.effort!=='string')fail('Explicit Codex image model and effort required',400);
    const adapter=adapterFor('codex');if(typeof adapter?.models!=='function')fail('Image capability discovery unavailable');
    let timer,abort;
    const models=await Promise.race([adapter.models(),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Object.assign(Error('Capability discovery quota'),{statusCode:503})),15000);
      abort=()=>reject(Object.assign(Error('Capability discovery cancelled'),{statusCode:503}));signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted)abort();
    })]).finally(()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);});
    checkpoint(signal);
    const selected=models.find(m=>m.id===generation.model),efforts=selected?.efforts?.map(e=>e.reasoningEffort??e);
    if(selected?.supportsImages!==true||!efforts?.includes(generation.effort))fail('Selected model must explicitly advertise images and exact effort');
    return {id:selected.id,supportsImages:true,efforts};
  }
  async function handle(req,res,url) {
    if(url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/'))return false;
    const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    let item;
    try {
      const route=contextRoute.exec(url.pathname),capabilities=url.pathname===prefix+'/capabilities';
      if(!route&&!capabilities)fail('Unknown complete joint route; SEND is not implemented here',404);
      if(url.search)fail('Complete joint preparation accepts no query',400);
      if(req.method!==(capabilities?'GET':'POST'))fail('Unsupported complete joint method',405);
      if(capabilities) {
        if(req.headers['transfer-encoding']||Number(req.headers['content-length'])>0)fail('Read-only capabilities accept no body',400);
        json(200,{format:'ReferenceWorldAssemblyCapabilities',version:2,purpose:'reference-world-assembly',
          preparationImplemented:true,preparationEnabled:enabled&&!closed&&!state().closing,runtimeHash,
          sendingImplemented:false,sendingEnabled:false,automaticRetries:0,
          maximumCallsByTier:{lite:8,pro:14,max:20,ultra:26},sharedFullPipeline:true,
          independentJointConfirmationRequired:true,legacyConsentTransferable:false,
          playerUiImplemented:false,placementImplemented:false,serverBaselineVerified:false,canAuthorizePlacement:false});return true;
      }
      if(!resources)fail('Complete joint preparation is disabled in this process; no model invoked');
      checkpoint();if(active.size)fail('Complete joint preparation lane busy; no duplicate operation',429);
      const controller=new AbortController();let done;item={controller,done:new Promise(resolve=>{done=resolve;}),finish:()=>done()};active.add(item);
      const abort=()=>controller.abort(),disconnected=()=>{if(!res.writableEnded)abort();};
      req.once('aborted',abort);res.once('close',disconnected);item.detach=()=>{req.off('aborted',abort);res.off('close',disconnected);};
      const signal=controller.signal,input=await body(req,signal);
      exactKeys(input,['referenceOwnerId','referenceSetHash','generation'],'complete joint HTTP preparation');
      if(typeof input.referenceOwnerId!=='string'||!REFERENCE_OWNER.test(input.referenceOwnerId)
        ||input.generation?.key!==input.referenceOwnerId||! /^[a-f0-9]{64}$/.test(input.referenceSetHash??''))fail('Exact original image draft and task UUID required',400);
      checkpoint(signal);const selectedCapability=await advertisement(input.generation,signal);checkpoint(signal);
      const value=await resources.operation('prepare',input.referenceOwnerId,Buffer.from(JSON.stringify({contextId:route[1],
        referenceSetHash:input.referenceSetHash,generation:input.generation,selectedCapability})),{signal});
      checkpoint(signal);if(value.runtimeHash!==runtimeHash)fail('Complete joint runtime changed; no SEND or model invoked');
      json(200,value);
    }catch(error){if(!res.destroyed&&!res.headersSent)json([400,404,405,409,413,429,503].includes(error.statusCode)?error.statusCode:409,
      {error:error.publicMessage??'Complete joint preparation rejected; original evidence retained; no model invoked'});}
    finally{if(item){item.detach();active.delete(item);item.finish();}}
    return true;
  }
  return {handle,busy:()=>active.size>0||resources?.busy()===true,
    async close(){closed=true;for(const item of active)item.controller.abort();await resources?.close();await Promise.allSettled([...active].map(i=>i.done));}};
}
