import {exactKeys} from '../contracts/world-selection.mjs';
import {REFERENCE_OWNER} from '../contracts/reference-attachments.mjs';
import {validateReferenceWorldAssemblyJobRequest} from '../contracts/reference-world-assembly-job.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {assemblyRuntimeIdentity} from './assembly-durability.mjs';
import {ReferenceWorldAssemblyResources,JOINT_ASSEMBLY_RESOURCE_LIMITS} from './reference-world-assembly-resources.mjs';
import {createReferenceWorldAssemblyJobRegistry} from './reference-world-assembly-job-registry.mjs';
import {createReferenceWorldAssemblyRunner} from './reference-world-assembly-runner.mjs';
import {requestNativeEvidence} from './native-evidence.mjs';

const prefix='/v1/reference-world-assembly',uuid='[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const contextRoute=new RegExp(`^${prefix}/contexts/(${uuid})/prepare$`);
const jobRoute=new RegExp(`^${prefix}/jobs/(${uuid})(?:/(cancel|candidate)|/parts/([0-9]{1,3})|/native-evidence/([a-f0-9]{64})/(request|manifest|cells|upload))?$`);
const fail=(message,statusCode=409)=>{throw Object.assign(Error(message),{statusCode,publicMessage:message});};
const raw=value=>Buffer.from(JSON.stringify(value));
async function body(req,signal,maximum=32768) {
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''))fail('Expected UTF-8 application/json',400);
  if(Number(req.headers['content-length'])>maximum)fail('Complete joint request byte quota',413);
  let size=0;const chunks=[],abort=()=>req.destroy();signal.throwIfAborted();signal.addEventListener('abort',abort,{once:true});
  try{for await(const chunk of req){signal.throwIfAborted();size+=chunk.length;if(size>maximum)fail('Complete joint request byte quota',413);chunks.push(chunk);}}
  finally{signal.removeEventListener('abort',abort);}
  signal.throwIfAborted();
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));}
  catch{fail('Exact valid UTF-8 complete joint request required',400);}
}

/** AFTER the exact paired-loopback Host/no-Origin/Bearer checks. FULL SEND
 * has its own immutable process opt-in, original v2 consent and tier budget.
 * A lost HTTP response or closed panel NEVER cancels/replays a consumed SEND.
 * This service has no world writer or authority to apply a transport part. */
export async function createReferenceWorldAssemblyHttpService({dataDir,enabled=false,sending=false,adapterFor,state}) {
  if(typeof enabled!=='boolean'||typeof sending!=='boolean'||typeof adapterFor!=='function'||typeof state!=='function')throw Error('Process-owned complete joint service required');
  const resources=new ReferenceWorldAssemblyResources({dataDir});
  const registry=sending?await createReferenceWorldAssemblyJobRegistry({dataDir,resources}):null;
  const runtimeHash=registry?.runtimeHash??(enabled?await assemblyRuntimeIdentity():null);
  const runners=new Map(),active=new Set();let closed=false,mutations=0;
  const running=()=>[...runners.values()].some(runner=>runner.busy());
  const checkpoint=signal=>{
    const current=state();
    if(closed||current.closing||signal?.aborted)fail('Complete joint service closed/cancelled; original evidence retained',503);
    if(current.changingConfig)fail('Complete joint configuration changing; no new model invoked');
    if(current.busy)fail('Finish other model, attachment or context work before complete joint action',429);
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
    checkpoint(signal);if(adapterFor('codex')!==adapter)fail('Selected original adapter changed during preparation');
    const selected=models.find(m=>m.id===generation.model),efforts=selected?.efforts?.map(e=>e.reasoningEffort??e);
    if(selected?.supportsImages!==true||!efforts?.includes(generation.effort))fail('Selected model must explicitly advertise images and exact effort');
    return {adapter,capability:{id:selected.id,supportsImages:true,efforts}};
  }
  async function reservation(id,signal) {
    const saved=await resources.operation('job-record',id,raw({expectedRequestHash:runners.get(id)?.get(id)?.requestHash??null}),{signal});
    if(!saved)fail('Original complete joint job not found',404);return saved;
  }
  async function status(id,signal) {
    const live=runners.get(id)?.get(id);if(live)return live;
    return resources.operation('job-status',id,raw({expectedRequestHash:null}),{signal});
  }
  async function handle(req,res,url) {
    if(url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/'))return false;
    const json=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    let item;
    try {
      const context=contextRoute.exec(url.pathname),job=jobRoute.exec(url.pathname);
      const capabilities=url.pathname===prefix+'/capabilities',collection=url.pathname===prefix+'/jobs';
      if(!context&&!job&&!capabilities&&!collection)fail('Unknown complete joint route',404);
      const download=job&&(job[2]==='candidate'||job[3]!==undefined);
      if(download?[...url.searchParams.keys()].length!==1||url.searchParams.getAll('candidateHash').length!==1
        ||! /^[a-f0-9]{64}$/.test(url.searchParams.get('candidateHash')??''):url.search)fail('Only the exact original candidateHash download query is allowed',400);
      const post=context||job?.[2]==='cancel'||job?.[5]==='upload'||collection&&req.method==='POST';
      if(req.method!==(post?'POST':'GET'))fail('Unsupported complete joint method',405);
      if(!post&&(req.headers['transfer-encoding']||Number(req.headers['content-length'])>0))fail('Read-only complete joint requests accept no body',400);
      if(capabilities) {
        json(200,{format:'ReferenceWorldAssemblyCapabilities',version:2,purpose:'reference-world-assembly',
          preparationImplemented:true,preparationEnabled:(enabled||sending)&&!closed&&!state().closing,runtimeHash,
          sendingImplemented:true,sendingEnabled:sending&&!closed&&!state().closing&&!state().changingConfig,
          nativeRendererReady:state().nativeRendererReady===true,nativeTransportImplemented:true,historyImplemented:true,
          automaticRetries:0,maximumCallsByTier:{lite:8,pro:14,max:20,ultra:26},sharedFullPipeline:true,
          independentJointConfirmationRequired:true,legacyConsentTransferable:false,
          playerUiImplemented:false,placementImplemented:false,serverBaselineVerified:false,canAuthorizePlacement:false});return true;
      }
      checkpoint();
      const mutation=!!context||collection&&post||job?.[2]==='cancel';
      if(mutation&&mutations)fail('Complete joint mutation lane busy; query the original task',429);
      if(context&&running())fail('Finish the original full task before changing preparation',429);
      if(active.size>=4)fail('Complete joint HTTP observation quota',429);
      const controller=new AbortController();let done;
      item={controller,mutation,done:new Promise(resolve=>{done=resolve;}),finish:done};
      active.add(item);if(mutation)mutations++;
      const abort=()=>controller.abort(),disconnected=()=>{if(!res.writableEnded)abort();};
      req.once('aborted',abort);
      // Once a FULL SEND body is accepted its one original controller continues
      // independently of the initiating HTTP connection or the player's panel.
      if(!(collection&&post))res.once('close',disconnected);
      item.detach=()=>{req.off('aborted',abort);res.off('close',disconnected);};const signal=controller.signal;
      if(context) {
        if(!enabled&&!sending)fail('Complete joint preparation is disabled in this process; no model invoked');
        const input=await body(req,signal);exactKeys(input,['referenceOwnerId','referenceSetHash','generation'],'complete joint HTTP preparation');
        if(typeof input.referenceOwnerId!=='string'||!REFERENCE_OWNER.test(input.referenceOwnerId)||input.generation?.key!==input.referenceOwnerId
          ||! /^[a-f0-9]{64}$/.test(input.referenceSetHash??''))fail('Exact original image draft and task UUID required',400);
        const selected=await advertisement(input.generation,signal);
        const value=await resources.operation('prepare',input.referenceOwnerId,raw({contextId:context[1],referenceSetHash:input.referenceSetHash,
          generation:input.generation,selectedCapability:selected.capability}),{signal});
        checkpoint(signal);if(value.runtimeHash!==runtimeHash)fail('Complete joint runtime changed; no SEND or model invoked');json(200,value);
      }else if(collection&&post) {
        if(!registry)fail('Complete joint SEND is disabled in this process; no model invoked');
        const request=validateReferenceWorldAssemblyJobRequest(await body(req,signal)),id=request.referenceOwnerId;
        const old=await registry.get(id);checkpoint(signal);
        if(old) {
          if(old.requestHash!==hash(request))fail('Existing complete joint SEND differs; no new reservation or dispatch');
          json(200,await status(id,signal));
        }else {
          if(running())fail('Original complete joint runner lane busy',429);
          if(state().nativeRendererReady!==true)fail('Original native renderer is not ready; no model invoked');
          const selected=await advertisement(request.generation,signal);checkpoint(signal);
          if(state().nativeRendererReady!==true)fail('Original native renderer readiness changed; no model invoked');
          await registry.reserve({request,selectedCapability:selected.capability});checkpoint(signal);
          const runner=createReferenceWorldAssemblyRunner({registry,adapter:selected.adapter,nativeEvidence:options=>requestNativeEvidence(options)});
          runners.set(id,runner);json(202,await runner.start(id));
        }
      }else if(collection) {
        const jobs=await resources.operation('job-list',null,raw({}),{signal});
        json(200,{format:'ReferenceWorldAssemblyHistory',version:2,jobs:jobs.map(job=>({...job,...(runners.get(job.id)?.get(job.id)??{})})),
          reservationInspectionOnly:true,automaticRetries:0,allowsNewModelCall:false,canAuthorizePlacement:false});
      }else if(job[2]==='cancel') {
        const input=await body(req,signal,1024);exactKeys(input,['confirmed'],'explicit full-task cancellation');if(input.confirmed!==true)fail('Explicit full-task cancellation required',400);
        await reservation(job[1],signal);const runner=runners.get(job[1]);
        if(runner)await runner.cancel(job[1]);else await registry?.cancel(job[1]);
        await resources.cancel(job[1]);json(200,{status:await status(job[1],signal),stoppedOriginalLiveTask:!!runner,
          unknownProviderOutcomeNotRepeated:true,canAuthorizePlacement:false});
      }else if(job[4]) {
        const saved=await reservation(job[1],signal),evidenceId=job[4],member=job[5];
        const live=runners.get(job[1])?.get(job[1]);
        if(member==='upload') {
          if(live?.state!=='running'||live.nativeEvidence?.state!=='waiting'||live.nativeEvidence.id!==evidenceId)fail('Original native request is no longer active');
          const upload=await body(req,signal,JOINT_ASSEMBLY_RESOURCE_LIMITS.nativeUploadBytes),current=runners.get(job[1])?.get(job[1]);
          if(current?.state!=='running'||current.nativeEvidence?.state!=='waiting'||current.nativeEvidence.id!==evidenceId)fail('Original native request changed during upload');
          json(200,await resources.operation('native-upload',job[1],raw({expectedRequestHash:saved.value.requestHash,evidenceId,upload}),{signal}));
        }else {
          const value=await resources.operation('native-read',job[1],raw({expectedRequestHash:saved.value.requestHash,evidenceId,member}),{signal});
          if(member!=='cells')json(200,value);
          else {
            const bytes=Buffer.from(value.data,'base64');if(bytes.length!==value.bytes||hash(bytes)!==value.sha256)fail('Original native transport bytes changed');
            res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);
          }
        }
      }else if(download) {
        const saved=await reservation(job[1],signal);
        const result=await resources.operation(job[3]!==undefined?'part':'metadata',job[1],raw({referenceInput:saved.value.referenceInput,
          preparationHash:saved.value.prepared.preparationHash,candidateHash:url.searchParams.get('candidateHash'),
          ...(job[3]!==undefined?{partIndex:Number(job[3])}:{})}),{signal});json(200,result);
      }else {
        const value=await status(job[1],signal);json(value?200:404,value??{error:'Original complete joint job not found'});
      }
    }catch(error){if(!res.destroyed&&!res.headersSent)json([400,404,405,409,413,429,503].includes(error.statusCode)?error.statusCode:409,
      {error:error.publicMessage??'Complete joint request rejected; original evidence retained; no automatic resubmission'});}
    finally{if(item){item.detach();active.delete(item);if(item.mutation)mutations--;item.finish();}}
    return true;
  }
  return {handle,busy:()=>active.size>0||resources.busy()||registry?.busy()===true||running(),
    async close(){closed=true;for(const item of active)item.controller.abort();
      await Promise.allSettled([...runners.values()].map(runner=>runner.close()));await registry?.close();await resources.close();
      await Promise.allSettled([...active].map(item=>item.done));}};
}
