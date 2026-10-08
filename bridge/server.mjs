import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { CodexAdapter, findCodex } from './codex-adapter.mjs';
import { RELEASE_VERSION } from './release.mjs';
import { ClaudeAdapter, findClaude } from './claude-adapter.mjs';
import { DeepseekAdapter, findDeepseek } from './deepseek-adapter.mjs';
import {AgentDiscovery} from './agent-discovery.mjs';
import { sampleSpec } from '../src/generation/sample.mjs';
import { hash, patchSpec } from '../src/generation/compiler.mjs';
import {exportNativeBundle} from '../src/generation/bundle.mjs';
import {generationPreflight} from './generation-policy.mjs';
import {ENVELOPE_INSTRUCTIONS,INTERIOR_INSTRUCTIONS,validateEnvelope,mergeInterior} from './layered-generation.mjs';
import {reviewPngs,saveReviewImages,VISUAL_REVIEW_INSTRUCTIONS} from './visual-review.mjs';
import {sceneSchema} from '../contracts/scene-spec.schema.mjs';
import {scenePatchSchema,validateSceneSelection} from '../src/design/revision.mjs';
import {readFailedScene,failedRepairPolicy,validateFailedRepairResult,FAILED_SCENE_REPAIR_RULES} from './failed-scene-repair.mjs';
import {runSceneCheckpoints} from './scene-checkpoints.mjs';
import {runSceneAssembly} from './scene-assembly.mjs';
import {qualityTiers} from './quality-tiers.mjs';
import {runDurableAssembly,assemblyRuntimeIdentity,durableJson,readRecoveryJson} from './assembly-durability.mjs';
import {NATIVE_RENDERER,requestNativeEvidence,readNativeRequest,acceptNativeEvidence,safeEvidenceFile} from './native-evidence.mjs';
import {WorldContextStore, CONTEXT_STORE_LIMITS} from './world-context-store.mjs';
import {WorldContextConsents} from './world-context-consent.mjs';
import {createContextAnalysisRunner} from './world-context-analysis-runner.mjs';
import {createWorldPatchDesignRunner} from './world-patch-design-runner.mjs';
import {createReferenceWorldPatchHttpService} from './reference-world-patch-http.mjs';
import {worldPatchSendingCapabilities} from './world-patch-capabilities.mjs';
import {exactKeys} from '../contracts/world-selection.mjs';
import {ReferencePreparationStore} from './reference-preparation.mjs';
import {referencePreparationCapabilities,referenceImageRestoreCapabilities,REFERENCE_PREPARATION_LIMITS,validateReferencePreparation} from '../contracts/reference-preparation.mjs';
import {ReferenceGenerationStore} from './reference-generation-store.mjs';
import {validateReferenceGenerationJobRequest,referenceGenerationJobCapabilities,REFERENCE_JOB_LIMITS} from '../contracts/reference-generation-job.mjs';
import {referenceArchiveCapabilities,REFERENCE_ARCHIVE_LIMITS} from '../contracts/reference-archive.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const terminal = s => ['preview-ready', 'failed', 'cancelled', 'interrupted'].includes(s);
async function atomic(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 }); await fs.rename(temp, file);
}
async function readJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
async function body(req,maximum=6000000) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('Expected application/json');
  let size = 0; const chunks = [];
  for await (const part of req) { size += part.length; if (size > maximum) throw new Error('Request quota exceeded'); chunks.push(part); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function contextBytes(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('Expected application/json');
  if (Number(req.headers['content-length']) > CONTEXT_STORE_LIMITS.inputBytes) throw Object.assign(new Error('Context request byte quota exceeded'), {statusCode: 413});
  let size = 0; const chunks = [];
  for await (const part of req) { size += part.length; if (size > CONTEXT_STORE_LIMITS.inputBytes) throw Object.assign(new Error('Context request byte quota exceeded'), {statusCode: 413}); chunks.push(part); }
  return Buffer.concat(chunks, size);
}
async function patchIntentBytes(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('Expected application/json');
  const maximum = 32768, quota = () => Object.assign(new Error('Patch intent byte quota exceeded'), {statusCode: 413});
  if (Number(req.headers['content-length']) > maximum) throw quota();
  let size = 0; const chunks = [];
  for await (const part of req) { size += part.length; if (size > maximum) throw quota(); chunks.push(part); }
  if (!size) throw new Error('Patch intent is required');
  // Preserve exact UTF-8 bytes for the worker's fatal decoder. Re-encoding
  // Buffer.toString would silently replace malformed user text.
  return Buffer.concat(chunks, size);
}
async function referenceInputBytes(req,maximum=REFERENCE_PREPARATION_LIMITS.inputBytes){
  if(!req.headers['content-type']?.startsWith('application/json'))throw Error('Expected application/json');
  const quota=()=>Object.assign(Error('Reference preparation input byte quota'),{statusCode:413});
  if(Number(req.headers['content-length'])>maximum)throw quota();let size=0;const chunks=[];
  for await(const part of req){size+=part.length;if(size>maximum)throw quota();chunks.push(part);}return Buffer.concat(chunks,size);
}
export async function startBridge({ dataDir, codexPath, claudePath, deepseekPath, port = 0, adapter, claudeAdapter, deepseekAdapter, experimentalContextAnalysis = false, experimentalWorldPatchDesign = false, worldPatchSending = false, referenceGenerationSending = false, referenceWorldPatchSending = false } = {}) {
  if (!dataDir) throw new Error('dataDir is required');
  if (typeof experimentalContextAnalysis !== 'boolean') throw new Error('Explicit process-owned context analysis switch required');
  if (typeof experimentalWorldPatchDesign !== 'boolean') throw new Error('Explicit process-owned patch design switch required');
  if (typeof worldPatchSending !== 'boolean') throw new Error('Explicit process-owned production patch SEND switch required');
  if (typeof referenceGenerationSending !== 'boolean') throw new Error('Explicit process-owned reference SEND switch required');
  if (typeof referenceWorldPatchSending !== 'boolean') throw new Error('Explicit process-owned joint reference/patch SEND switch required');
  dataDir = path.resolve(dataDir);
  await fs.mkdir(path.join(dataDir, 'jobs'), { recursive: true });
  const connectionFile = path.join(dataDir, 'connection.json');
  const lockFile = path.join(dataDir, 'bridge.lock');
  try { const old = await readJson(lockFile); try { process.kill(old.pid, 0); throw new Error('Bridge already running in this data directory'); } catch (e) { if (e.code !== 'ESRCH') throw e; } await fs.unlink(lockFile); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const lock = await fs.open(lockFile, 'wx', 0o600); await lock.writeFile(JSON.stringify({ pid: process.pid })); await lock.close();
  let agent = adapter ?? new CodexAdapter({ codexPath }), configuredPath = codexPath ?? '', changingConfig = false;
  let claudeAgent=claudeAdapter??new ClaudeAdapter({claudePath}),configuredClaudePath=claudePath??'';
  let deepseekAgent=deepseekAdapter??new DeepseekAdapter({deepseekPath}),configuredDeepseekPath=deepseekPath??'';
  const agentFor=id=>id==='deepseek'?deepseekAgent:id==='claude'?claudeAgent:agent;
  const autoDiscovery=new AgentDiscovery(agentFor);
  const {generationInstructions}=await import('./generation-prompt.mjs');
  const promptRules = await generationInstructions();
  const sceneRules=await fs.readFile(new URL('../prompts/scene-v1.md',import.meta.url),'utf8');
  const token = randomBytes(32).toString('hex'), jobs = new Map(), active = new Map(), running = new Set();
  const contexts = new WorldContextStore({dataDir}), contextConsents = new WorldContextConsents();
  const referencePreparations=new ReferencePreparationStore({dataDir});let referenceUploads=0;
  const referenceGeneration=new ReferenceGenerationStore({dataDir});
  let referenceSubmissions;
  try{referenceSubmissions=new Map((await referenceGeneration.operation('list')).map(s=>[s.ownerId,s]));}
  catch(error){await referenceGeneration.close();await referencePreparations.close();await contexts.close();contextConsents.close();await fs.unlink(lockFile);throw error;}
  // Development-only process opt-in. HTTP/config/CLI cannot turn this on, and
  // current player preparation UI still promises no send. Tests replace all
  // providers; a separate versioned player protocol is required before rollout.
  let contextAnalysis = null;
  if (experimentalContextAnalysis) {
    try { contextAnalysis = await createContextAnalysisRunner({dataDir, contexts, consents: contextConsents, adapterFor: agentFor}); }
    catch (error) { contextConsents.close(); await contexts.close(); await fs.unlink(lockFile); throw error; }
  }
  let patchDesign = null;
  // Normal CLI/builtin startup enables only v2. The legacy v1 experimental
  // lane remains separately process-owned; HTTP/config cannot enable either.
  if (experimentalWorldPatchDesign || worldPatchSending) {
    try { patchDesign = await createWorldPatchDesignRunner({dataDir, contexts, adapterFor: agentFor}); }
    catch (error) { await contextAnalysis?.close(); contextConsents.close(); await contexts.close(); await fs.unlink(lockFile); throw error; }
  }
  let contextUploads = 0;
  const recoverable=[];let shuttingDown=false,runtimeIdentity;
  let nativeRendererSeen=0;
  const runtimeHash=()=>runtimeIdentity??=assemblyRuntimeIdentity();
  let jointPatch;
  try {
    jointPatch = await createReferenceWorldPatchHttpService({dataDir, contexts, adapterFor:agentFor, enabled:referenceWorldPatchSending,
      state:() => ({closing:shuttingDown, changingConfig, busy:referenceUploads || contextUploads
        || referencePreparations.busy() || referenceGeneration.busy() || patchDesign?.busy() || contextAnalysis?.busy()
        || [...jobs.values()].some(j => !terminal(j.state))})});
  } catch (error) {
    await patchDesign?.close(); await contextAnalysis?.close(); await referenceGeneration.close(); await referencePreparations.close();
    contextConsents.close(); await contexts.close(); await fs.unlink(lockFile); throw error;
  }
  const publicJob = job => Object.fromEntries(Object.entries(job).filter(([k]) => !['requestHash', 'prompt', 'spec','repairOriginalPrompt'].includes(k)));
  const jobDir = id => path.join(dataDir, 'jobs', id);
  const repairSource=async input=>{
    const result=await readFailedScene(jobs.get(input.repairJobId),jobDir(input.repairJobId));
    if(result.context.sourceHash!==input.repairSourceHash)throw new Error('Stale failed source hash; inspect the source again before confirming');
    return result;
  };
  const preflight=async input=>{const policy=generationPreflight(input);return input.repairJobId?failedRepairPolicy(policy,(await repairSource(input)).context):policy;};
  async function save(job) { await atomic(path.join(jobDir(job.id), 'job.json'), job); }
  async function event(job, state, extra = {}) {
    const updatedAt=new Date().toISOString();
    const next={...job,state,updatedAt,...extra,events:[...job.events,{seq:job.events.length+1,state,time:updatedAt,error:extra.error}]};
    if(next.recoveryEnabled&&next.recovery)next.recovery={...next.recovery,
      reservedCalls:Math.max(next.recovery.reservedCalls??0,next.assemblyCallsReserved??0),
      ...(terminal(state)?{state:state==='preview-ready'?'complete':state}:{})};
    // A visible terminal state must already be durable before a caller can revalidate it.
    await save(next);Object.assign(job,next);
  }
  for (const e of await fs.readdir(path.join(dataDir, 'jobs'), { withFileTypes: true })) {
    if (!e.isDirectory() || !/^[0-9a-f-]{36}$/.test(e.name)) continue;
    try { const j = await readJson(path.join(jobDir(e.name), 'job.json'));
    if(j.id!==e.name)continue;
    if(j.recoveryEnabled===true&&!j.cancelRequested&&(!terminal(j.state)||j.state==='interrupted')){
      try{
        let request;
        if(j.referenceGeneration){
          if(!referenceGenerationSending){await event(j,'interrupted',{error:'Reference SEND is disabled in this process; original capsule preserved'});jobs.set(j.id,j);continue;}
          const saved=await referenceGeneration.operation('recover',{jobId:j.id,runtimeHash:await runtimeHash()});
          if(saved.requestHash!==j.requestHash||hash(saved.policy)!==hash(j.preflight)||
            hash({version:1,preparationHash:saved.submission.preparationHash,input:saved.referenceInput})!==hash(j.referenceGeneration))
            throw Error('Original reference request/budget changed');
          request=saved.request;
        }else{
          request=await readRecoveryJson(path.join(jobDir(j.id),'recovery-request.json'));
          if(request.assemblyRecovery!=='safe'||request.assemblyConfirmed!==true||hash(request)!==j.requestHash||hash(generationPreflight(request))!==hash(j.preflight))throw new Error('Saved recovery request/budget changed');
        }
        if(request.assemblyRecovery!=='safe'||request.assemblyConfirmed!==true)throw Error('Original recovery was not confirmed');
        await event(j,'recovering',{error:null});recoverable.push({job:j,request});
      }catch(error){await event(j,'failed',{error:'Automatic recovery blocked: '+error.message});}
    }else if (!terminal(j.state)) {
      const stages=j.checkpointStages?.map(s=>['reserved','checking'].includes(s.state)?{...s,state:'interrupted',invocationOutcome:s.responseReceived?'response-received':'unknown',error:'Bridge restarted; reserved call is not repeated'}:s);
      const assemblyStages=j.assemblyStages?.map(s=>['reserved','checking'].includes(s.state)?{...s,state:'interrupted',invocationOutcome:s.responseReceived?'response-received':'unknown',error:'Bridge restarted; reserved call is not repeated'}:s);
      await event(j, 'interrupted', { error: 'Bridge restarted. No automatic resubmission; latest completed revisions remain available.',...(stages?{checkpointStages:stages}:{}),...(assemblyStages?{assemblyStages}:{}) });
    } jobs.set(j.id, j); } catch {}
  }
  function compile(spec, directory, signal, baseDirectory,importDirectory,generated=false,policy,validateOnly=false,sceneRevision) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(here, 'compile-worker.mjs'), { workerData: { spec, directory,baseDirectory,importDirectory,generated,policy,validateOnly,sceneRevision }, resourceLimits: { maxOldGenerationSizeMb: 512 } });
      let settled = false;
      const done = (err, result) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); worker.terminate(); err ? reject(err) : resolve(result); };
      const abort = () => done(new Error('Compilation cancelled'));
      const timer = setTimeout(() => done(new Error('Compilation time quota exceeded')), 120000);
      worker.once('message', m => done(m.ok ? null : Object.assign(new Error(m.error),{diagnosticPreview:m.diagnosticPreview,diagnosticUnavailable:m.diagnosticUnavailable,constructionFeedback:m.constructionFeedback}), m.manifest));
      worker.once('error', e => done(e)); worker.once('exit', c => { if (!settled) done(new Error(`Compiler exited ${c}`)); });
      signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    });
  }
  async function run(job, request) {
    const selectedAgent=agentFor(job.agent);
    const controller = new AbortController(); active.set(job.id, controller);
    try {
      let reviewImages=[];
      const invoke=async(prompt,stage,stageOptions={})=>{
        controller.signal.throwIfAborted();
        await event(job,'generating',{stage,stageCount:stageOptions.stageCount??(job.preflight.mode==='layered'?2:1),threadId:null,turnId:null,providerProgress:null,...(stageOptions.stageName?{stageName:stageOptions.stageName}:{}),
          ...(job.recovery?.nextIndex===stage&&['provider-capacity-wait','provider-capacity-replay'].includes(job.recovery.state)?
            {recovery:{...job.recovery,state:stageOptions.recoverProviderBinding?'provider-capacity-observing-original':'provider-capacity-dispatched',waitMs:0}}:{})});
        controller.signal.throwIfAborted();
        let output;
        const operation=stageOptions.recoverProviderBinding?selectedAgent.recoverOriginal?.bind(selectedAgent):selectedAgent.generate.bind(selectedAgent);
        if(!operation)throw Error('Original provider receipt recovery unavailable; no generation submitted');
        try{output=await operation({prompt,binding:stageOptions.recoverProviderBinding,onProviderBinding:stageOptions.onProviderBinding,referenceInput:stageOptions.referenceInput,images:stageOptions.images??reviewImages,outputSchema:stageOptions.outputSchema??(job.preflight.mode==='scene'?(request.baseJobId?scenePatchSchema:sceneSchema):undefined),model:request.model,effort:request.effort,maxOutputTokens:job.preflight.maxOutputTokens??undefined,cwd:jobDir(job.id),signal:controller.signal,onEvent:async e=>{
          if(e.threadId)job.threadId=e.threadId;if(e.turnId)job.turnId=e.turnId;
          if(e.providerProgress)job.providerProgress=e.providerProgress;
          // Persist identity/progress independently of a final model answer.
          // A responsive Bridge is not proof that its provider turn is active.
          await save(job);
        }});}
        catch(error){
          job.generations??=[];job.generations.push({stage,outcome:'failed',usage:error.diagnostic?.usage??null,diagnostic:error.diagnostic??null});
          delete job.usage;job.usageNote='各次调用（含失败）的已知用量保存在 generations；回执缺失不代表免费。';
          await save(job);throw error;
        }
        job.threadId=output.threadId;job.turnId=output.turnId;
        job.generations??=[];job.generations.push({stage,usage:output.usage??null,diagnostic:output.diagnostic??null});
        if(output.usage)job.lastGenerationUsage=output.usage;
        if(job.generations.length===1&&output.usage)job.usage=output.usage;
        else if(job.generations.length>1){delete job.usage;job.usageNote='多次调用的用量分别保存在 generations；不把最后一次用量当作总用量。';}
        if(output.totalCostUsd!==undefined){job.generations.at(-1).totalCostUsd=output.totalCostUsd;job.totalCostUsd=job.generations.every(g=>Number.isFinite(g.totalCostUsd)&&g.totalCostUsd>=0)?job.generations.reduce((n,g)=>n+g.totalCostUsd,0):null;}
        if(output.model)job.resolvedModel=output.model;
        await save(job);controller.signal.throwIfAborted();
        return output.spec;
      };
      if(request.importDirectory){await event(job,'compiling');const manifest=await compile(null,jobDir(job.id),controller.signal,undefined,request.importDirectory);controller.signal.throwIfAborted();await event(job,'preview-ready',{assetHash:manifest.assetHash,manifest,revision:job.id,imported:true});return;}
      let spec = request.sample ? sampleSpec() : request.spec??request.scenePatch;
      if(job.preflight.assembly){
        if(job.referenceGeneration&&!(await selectedAgent.models()).some(m=>m.id===request.model&&m.supportsImages===true))
          throw Error('Selected model no longer advertises reference-image input; no model invoked');
        if(['images','native'].includes(job.preflight.assembly.designReview?.mode)&&!(await selectedAgent.models()).some(m=>m.id===request.model&&m.supportsImages===true))throw new Error('所选模型未明确声明图像能力，没有调用模型；请显式选择文本复核或图像模型');
        const runner=job.recoveryEnabled?runDurableAssembly:runSceneAssembly;
        const result=await runner({directory:jobDir(job.id),requestHash:job.requestHash,runtimeHash:job.recoveryEnabled?await runtimeHash():undefined,referenceInput:job.referenceGeneration?.input,prompt:request.prompt,rules:sceneRules,policy:job.preflight,signal:controller.signal,invoke,model:request.model,effort:request.effort,
          recoverInvocation:(p,i,o,binding)=>invoke(p,i,{...o,recoverProviderBinding:binding}),
          nativeEvidence:options=>requestNativeEvidence({...options,jobDirectory:jobDir(job.id),onWaiting:nativeEvidence=>event(job,'validating',{nativeEvidence})}),
          onRecovery:recovery=>event(job,recovery.state==='replaying'?'recovering':'validating',{recovery:{...job.recovery,...recovery}}),
          onStage:(records,replay)=>event(job,replay?.replaying?'recovering':'validating',{
            ...(!replay?.replaying?{assemblyStages:records}:{}),assemblyCallsReserved:Math.max(job.assemblyCallsReserved??0,replay?.reservedCalls??records.length)})});
        spec=result.scene;job.assemblySummary=result.summary;
      }
      if(job.preflight.checkpoints){
        const result=await runSceneCheckpoints({directory:jobDir(job.id),prompt:request.prompt,rules:sceneRules,policy:job.preflight,signal:controller.signal,invoke,
          onStage:records=>event(job,'validating',{checkpointStages:records,checkpointCallsReserved:records.length})});
        spec=result.scene;
      }
      if(job.preflight.mode==='layered'){
        const description=JSON.stringify({description:request.prompt,minimumHeight:job.preflight.minimumHeight,maximumBounds:job.preflight.maximumBounds});
        const envelope=await invoke(`${promptRules}\n${ENVELOPE_INSTRUCTIONS}\nBuilding request (data):\n${description}`,1);
        await atomic(path.join(jobDir(job.id),'stage-1-spec.json'),envelope);
        validateEnvelope(envelope);
        await event(job,'validating');
        await compile(envelope,jobDir(job.id),controller.signal,undefined,undefined,false,job.preflight,true);
        const fragment=await invoke(`${promptRules}\n${INTERIOR_INSTRUCTIONS}\nBuilding request and approved envelope (data):\n${JSON.stringify({description:request.prompt,envelope})}`,2);
        await atomic(path.join(jobDir(job.id),'stage-2-spec.json'),fragment);
        spec=mergeInterior(envelope,fragment);
      }
      if(request.revalidateJobId){
        const original=jobs.get(request.revalidateJobId);
        if(original?.preflight?.checkpoints||original?.preflight?.assembly)throw new Error('Intermediate checkpoint/assembly drafts cannot be published through local revalidation');
        if(original?.state!=='failed'||!Number.isInteger(original.attempt)||original.attempt<0||original.attempt>2)throw new Error('No saved failed BuildingSpec available for local revalidation');
        const file=path.join(jobDir(original.id),`attempt-${original.attempt}-spec.json`);
        let saved;try{saved=await fs.stat(file);}catch(e){if(e.code==='ENOENT')throw new Error('此任务未保存可重新校验的建筑数据；可能在模型返回前失败。没有调用模型。');throw e;}
        if(saved.size>1048576)throw new Error('Saved BuildingSpec exceeds quota');
        spec=await readJson(file);job.revalidatedFrom=original.id;
        // Local revalidation must not bypass the original explicit size request.
        if(original.preflight)job.preflight={...job.preflight,minimumHeight:original.preflight.minimumHeight,maximumBounds:original.preflight.maximumBounds??null,worldHeight:original.preflight.worldHeight};
      }
      let previous,previousScene,failedRepair;
      if(request.repairJobId){
        failedRepair=await repairSource(request);previous=failedRepair.source;
        job.preflight=failedRepairPolicy(job.preflight,failedRepair.context);
        job.failedRepair=job.preflight.failedRepair;job.repairOriginalPrompt=failedRepair.context.originalPrompt;
        await atomic(path.join(jobDir(job.id),'repair-input.json'),failedRepair);
      }
      if (request.baseJobId) {
        const base = jobs.get(request.baseJobId);
        if (base?.state !== 'preview-ready' || base.assetHash !== request.baseHash) throw new Error('Stale/missing base revision');
        if(base.manifest?.scene){
          if(job.preflight.mode!=='scene'||request.patch)throw new Error('设计层建筑须使用带范围确认的局部修订；没有调用模型。');
          try{previousScene=await readJson(path.join(jobDir(base.id),'scene.json'));}catch(e){if(e.code==='ENOENT')throw new Error('此资产没有可验证的设计源，只可预览/放置/导出；没有调用模型。');throw e;}
          if(hash(previousScene)!==base.manifest.scene.sourceHash)throw new Error('Scene source integrity check failed');
          const sourceFile=path.join(jobDir(base.id),'design-sources.json');if((await fs.stat(sourceFile)).size>8*1024*1024)throw new Error('Scene source map quota exceeded');
          const sourceMap=await readJson(sourceFile);if(hash(sourceMap)!==base.manifest.scene.sourcesHash)throw new Error('Scene source map integrity check failed');
          validateSceneSelection(previousScene,request.sceneScope,sourceMap);
        }else if(job.preflight.mode==='scene')throw new Error('此旧资产没有 SceneSpec；请用原有完整修订入口。没有调用模型。');
        try{previous = previousScene??await readJson(path.join(jobDir(base.id), 'spec.json'));}catch(e){if(e.code==='ENOENT')throw new Error('This imported asset has no BuildingSpec; preview/place/export only, no AI revision');throw e;}
        if (request.patch) spec = patchSpec(previous, request.patch,{navigationPolicy:job.preflight.navigationPolicy});
      }
      if(request.reviewImages){if(!(await selectedAgent.models()).some(m=>m.id===request.model&&m.supportsImages===true))throw new Error('所选模型未明确声明图像能力，没有调用模型');reviewImages=await saveReviewImages(request.reviewImages,jobDir(job.id));job.visualReview={views:4,assetOnly:true,baseHash:request.baseHash};}
      const maxRepairs = request.revalidateJobId||job.preflight.mode==='layered'?0:request.maxRepairs??0;
      for (let attempt = 0; attempt <= maxRepairs; attempt++) {
        controller.signal.throwIfAborted();
        if (!spec) {
          if(request.revalidateJobId)throw new Error('Saved BuildingSpec is empty; no model was invoked');
          await event(job, 'generating', { attempt });
          const description = JSON.stringify({ description: request.prompt,originalDescription:failedRepair?.context.originalPrompt??null,requiredIntent:failedRepair?.context.requiredIntent??null,minimumHeight:job.preflight.minimumHeight,maximumBounds:job.preflight.maximumBounds, previousSpec: previous ?? null,baseHash:request.baseHash??null,approvedRevisionScope:request.sceneScope??null, compilerError: failedRepair?.context.error??job.repairError ?? null,...(failedRepair?{constructionFeedback:failedRepair.context.constructionFeedback}:{}) });
          const rules=job.preflight.mode==='scene'?sceneRules:promptRules;
          const revisionRule=previousScene?'Return a ScenePatch, NOT a new scene. baseHash must exactly match the supplied immutable asset hash. Only replace/remove approved component IDs or explicitly authorized shared modules. The approved scope is caller-owned: do not enlarge it. Changes outside regions, protected components or unapproved dependency closure will be rejected. If scope.instances selects an array member, use replaceInstances (component, zero-based index, replacement, module). Its replacement retains the original ID but repeat=count1/step[0,0,0], with at set to the actual desired position of the selected instance, NOT the first member. module=null preserves the template; a complete replacement of the original template forks a private copy for ONLY this member. Other members and shared consumers remain unchanged. Use empty replaceInstances otherwise. Overlapping emitted instance regions cannot be individually changed; require explicit component-wide scope instead. No automatic repair.':'';
          spec=await invoke(`${rules}\n${revisionRule}\n${failedRepair?FAILED_SCENE_REPAIR_RULES:''}\n${reviewImages.length?VISUAL_REVIEW_INSTRUCTIONS:''}\nBuilding request (data):\n${description}`,1);
        }
        // Preserve rejected model outputs locally as evidence; never include private jobs in releases.
        await atomic(path.join(jobDir(job.id), `attempt-${attempt}-spec.json`), spec);
        await event(job, 'compiling', { attempt,sourceHash:hash(spec) });
        try {
          if(failedRepair)validateFailedRepairResult(spec,failedRepair.context);
          const manifest = await compile(spec, jobDir(job.id), controller.signal,request.baseJobId?jobDir(request.baseJobId):undefined,undefined,!request.sample&&!request.spec&&!request.patch&&!request.scenePatch,job.preflight,false,previousScene?{baseScene:previousScene,scope:request.sceneScope}:undefined);
          controller.signal.throwIfAborted();
          const visual=job.assemblySummary?.finalVisualReview;
          if(['native-asset','native-revision'].includes(visual?.kind)&&job.assemblySummary.visualReviewCurrent){
            if(visual.sourceHash!==manifest.scene?.sourceHash||visual.cellsHash!==manifest.cellsHash)throw new Error('Final native evidence does not match published geometry');
            job.visualEvidenceBinding={sourceHash:visual.sourceHash,cellsHash:visual.cellsHash,renderedDiagnosticAssetHash:visual.assetHash,finalAssetHash:manifest.assetHash,evidenceHash:visual.evidenceHash,canAuthorizePlacement:false};
          }
          await event(job, 'preview-ready', { assetHash: manifest.assetHash, manifest, revision: job.id, repairError: null });
          return;
        } catch (e) {
          if (controller.signal.aborted || request.sample || request.spec || request.patch || attempt === maxRepairs) throw e;
          job.repairError = e.message; previous = spec; spec = null;
          await event(job, 'validating', { repairError: e.message });
        }
      }
    } catch (e) { await event(job, controller.signal.aborted ? (shuttingDown&&job.recoveryEnabled&&!job.cancelRequested?'interrupted':'cancelled') : 'failed', { error: e.message,...(e.diagnostic?{generationDiagnostic:e.diagnostic}:{}),...(!controller.signal.aborted&&e.diagnosticPreview?{diagnosticPreview:e.diagnosticPreview}:{}),...(e.diagnosticUnavailable?{diagnosticUnavailable:e.diagnosticUnavailable}:{}),...(!controller.signal.aborted&&e.constructionFeedback?{constructionFeedback:e.constructionFeedback}:{}) }); }
    finally { active.delete(job.id); }
  }
  async function createReferenceJob(saved){
    if([...jobs.values()].some(j=>j.key===saved.key||j.id===saved.jobId))throw Error('Reference job/key already published');
    try{await fs.lstat(path.join(jobDir(saved.jobId),'job.json'));throw Error('Original reference job record was not safely loaded; cannot replace it');}
    catch(error){if(error.code!=='ENOENT')throw error;}
    const job={id:saved.jobId,key:saved.key,requestHash:saved.requestHash,agent:'codex',prompt:saved.request.prompt,
      model:saved.request.model,effort:saved.request.effort,preflight:saved.policy,createdAt:new Date().toISOString(),
      state:'queued',events:[],recoveryEnabled:true,referenceGeneration:{version:1,preparationHash:saved.submission.preparationHash,input:saved.referenceInput}};
    // Freeze/capsule is already committed. Only durable publication makes the
    // task visible, and run() is called strictly after this commit.
    await event(job,'queued');jobs.set(job.id,job);return job;
  }
  if(referenceGenerationSending){
    for(const saved of referenceSubmissions.values()){
      if(jobs.has(saved.jobId)||[...jobs.values()].some(j=>j.key===saved.ownerId)||jobs.size>=1000||[...jobs.values()].filter(j=>!terminal(j.state)).length>=2)continue;
      try{
        const capability=(await agent.models()).find(m=>m.id===saved.submission.sendConfirmation.model);
        const descriptor=await referenceGeneration.operation('submit',{input:Buffer.from(JSON.stringify(saved.submission)),runtimeHash:await runtimeHash(),capability});
        const job=await createReferenceJob(descriptor);recoverable.push({job,request:descriptor.request});
      }catch(error){saved.recoveryError=error.message;}
    }
  }
  let closeService;
  const server = http.createServer(async (req, res) => {
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    try {
      const expectedHost = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== expectedHost || req.headers.origin) return json(403, { error: 'Host/origin denied' });
      const supplied = Buffer.from(req.headers.authorization?.replace(/^Bearer /, '') ?? '');
      if (supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) return json(401, { error: 'Pairing token required' });
      const url = new URL(req.url, `http://${expectedHost}`), route = url.pathname;
      if (await jointPatch.handle(req, res, url)) return;
      if (jointPatch.busy() && (route.startsWith('/v1/reference-drafts') || req.method === 'POST' && (
        route === '/v1/reference-generation-jobs' || route === '/v1/jobs' || route.startsWith('/v1/config/')
        || route.startsWith('/v1/world-contexts/') || route.startsWith('/v1/context-analysis/')
        || /^\/v[12]\/world-patch\//.test(route))))
        return json(409, {error:'Finish original joint reference/patch work before changing its model, attachments or context'});
      if(route==='/v1/reference-preparations/capabilities'&&req.method==='GET')return json(200,referencePreparationCapabilities());
      if(route==='/v1/reference-image-restore/capabilities'&&req.method==='GET')return json(200,referenceImageRestoreCapabilities());
      if(route==='/v1/reference-generation-jobs/capabilities'&&req.method==='GET')return json(200,referenceGenerationJobCapabilities(referenceGenerationSending));
      if(route==='/v1/reference-archives/capabilities'&&req.method==='GET')return json(200,referenceArchiveCapabilities());
      const archiveRecordRoute=route.match(/^\/v1\/reference-drafts\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/archive\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/record$/);
      if(archiveRecordRoute){
        if(req.method!=='GET')return json(405,{error:'Original archive records are read-only; historical consent grants no new action'});
        if(shuttingDown||changingConfig)return json(409,{error:'Reference archive service/configuration changing; no model invoked'});
        if(referenceUploads||referencePreparations.busy()||referenceGeneration.busy())return json(429,{error:'Reference preparation/archive lane full; no model invoked'});
        return json(200,await referencePreparations.operation('archive-record',archiveRecordRoute[1],{actionId:archiveRecordRoute[2]}));
      }
      const maintenanceRoute=route.match(/^\/v1\/reference-drafts\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/archive\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/(restore|purge)(?:\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}))?$/);
      if(maintenanceRoute){
        if(shuttingDown||changingConfig)return json(409,{error:'Reference archive service/configuration changing; no model invoked'});
        if(referenceUploads||referencePreparations.busy()||referenceGeneration.busy())return json(429,{error:'Reference preparation/archive lane full; no model invoked'});
        const [,ownerId,archiveActionId,purpose,actionId]=maintenanceRoute;
        if(req.method==='GET')return json(200,await referencePreparations.operation(actionId?'archive-maintenance-get':`archive-${purpose}-snapshot`,ownerId,{archiveActionId,purpose,actionId}));
        if(req.method!=='POST'||actionId)return json(405,{error:'Maintenance requires independent exact confirmation; no broad deletion endpoint'});
        referenceUploads++;
        try{
          const input=await referenceInputBytes(req,REFERENCE_ARCHIVE_LIMITS.inputBytes);
          if(changingConfig||shuttingDown)throw Error('Reference maintenance configuration changed; original action retained');
          return json(200,await referencePreparations.operation(`archive-${purpose}-confirm`,ownerId,{archiveActionId,purpose,input}));
        }finally{referenceUploads--;}
      }
      const archiveRoute=route.match(/^\/v1\/reference-drafts\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/archive(?:\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}))?$/);
      if(archiveRoute||route==='/v1/reference-drafts'){
        if(shuttingDown||changingConfig)return json(409,{error:'Reference archive service/configuration changing; no model invoked'});
        if(referenceUploads||referencePreparations.busy()||referenceGeneration.busy())return json(429,{error:'Reference preparation/archive lane full; no model invoked'});
        if(route==='/v1/reference-drafts')return req.method==='GET'?json(200,await referencePreparations.operation('archive-list',null)):json(405,{error:'Draft listing is read-only'});
        const [,ownerId,actionId]=archiveRoute;
        if(req.method==='GET')return json(200,await referencePreparations.operation(actionId?'archive-get':'archive-snapshot',ownerId,{actionId}));
        if(req.method!=='POST'||actionId)return json(405,{error:'Archive requires exact independent confirmation; no deletion endpoint'});
        referenceUploads++;
        try{
          const input=await referenceInputBytes(req,REFERENCE_ARCHIVE_LIMITS.inputBytes);
          if(changingConfig||shuttingDown)throw Error('Reference archive configuration changed; original records preserved');
          return json(200,await referencePreparations.operation('archive-confirm',ownerId,{input}));
        }finally{referenceUploads--;}
      }
      const referenceHistoryRoute=route.match(/^\/v1\/reference-generation-jobs\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/(history|images\/([a-f0-9]{64}))$/);
      if(referenceHistoryRoute){
        if(req.method!=='GET')return json(405,{error:'Original reference history is read-only'});
        if(!jobs.get(referenceHistoryRoute[1])?.referenceGeneration)return json(404,{error:'Original reference image task not found'});
        const result=await referenceGeneration.operation(referenceHistoryRoute[3]?'image':'history',{jobId:referenceHistoryRoute[1],...(referenceHistoryRoute[3]?{imageId:referenceHistoryRoute[3]}:{})});
        if(!referenceHistoryRoute[3])return json(200,result);
        const png=Buffer.from(result.png);res.writeHead(200,{'Content-Type':'image/png','Content-Length':png.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','ETag':result.sha256});return res.end(png);
      }
      if(route==='/v1/reference-generation-jobs'&&req.method==='POST'){
        if(!referenceGenerationSending)return json(409,{error:'Reference generation SEND is not enabled; no model invoked'});
        if(changingConfig||referenceUploads||referencePreparations.busy()||referenceGeneration.busy()||patchDesign?.busy()||jointPatch.busy())
          return json(429,{error:'Reference SEND/configuration lane full; no new model invoked'});
        referenceUploads++;
        try{
          const input=await referenceInputBytes(req,REFERENCE_JOB_LIMITS.inputBytes);
          const submission=validateReferenceGenerationJobRequest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(input))),requestHash=hash(submission);
          const existing=[...jobs.values()].find(j=>j.key===submission.ownerId),pending=referenceSubmissions.get(submission.ownerId);
          if(existing)return json(existing.referenceGeneration&&existing.requestHash===requestHash?200:409,
            existing.referenceGeneration&&existing.requestHash===requestHash?publicJob(existing):{error:'Idempotency key reused with changed input'});
          if(pending&&pending.requestHash!==requestHash)return json(409,{error:'Idempotency key reused with changed reference SEND'});
          if(jobs.size>=1000||[...jobs.values()].filter(j=>!terminal(j.state)).length>=2)return json(429,{error:'Job quota reached'});
          const capability=(await agent.models()).find(m=>m.id===submission.sendConfirmation.model);
          let saved;
          try{saved=await referenceGeneration.operation('submit',{input,runtimeHash:await runtimeHash(),capability});}
          catch(error){
            // Recover local committed intents BEFORE emitting an HTTP result.
            // Never await cleanup after res.end(): shutdown could otherwise
            // close the lane and trigger a second HTTP response.
            if(!shuttingDown)for(const s of await referenceGeneration.operation('list'))referenceSubmissions.set(s.ownerId,s);
            throw error;
          }
          referenceSubmissions.set(saved.key,{jobId:saved.jobId,ownerId:saved.key,requestHash:saved.requestHash,submission:saved.submission});
          if(saved.policy.assembly?.designReview?.mode==='native'&&Date.now()-nativeRendererSeen>30000)
            throw Error('Native renderer is not ready; original SEND retained, no model invoked');
          const current=(await agent.models()).find(m=>m.id===saved.request.model);
          if(current?.supportsImages!==true)throw Error('Selected model no longer advertises reference-image input; no model invoked');
          if(changingConfig||patchDesign?.busy()||jointPatch.busy()||jobs.size>=1000||[...jobs.values()].filter(j=>!terminal(j.state)).length>=2)
            return json(429,{error:'Job/configuration quota changed during reference binding; original SEND retained'});
          const job=await createReferenceJob(saved),promise=run(job,saved.request).catch(()=>{});
          running.add(promise);promise.finally(()=>running.delete(promise));return json(202,publicJob(job));
        }finally{referenceUploads--;}
      }
      const referenceRoute=route.match(/^\/v1\/reference-drafts\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:\/prepare|\/preparations\/([a-f0-9]{64})(?:\/(confirm|record|images\/([a-f0-9]{64})))?)$/);
      if(referenceRoute){
        if(shuttingDown||changingConfig)return json(409,{error:'Reference preparation service/configuration changing; no model invoked'});
        if(referenceUploads>=REFERENCE_PREPARATION_LIMITS.lanes||referencePreparations.busy()||referenceGeneration.busy())return json(429,{error:'Reference preparation lane full; no model invoked'});
        const [,ownerId,preparationHash,action,imageId]=referenceRoute;
        if(!preparationHash&&req.method==='POST'){
          if(referenceUploads>=REFERENCE_PREPARATION_LIMITS.lanes||referencePreparations.busy())return json(429,{error:'Reference preparation lane full; no model invoked'});
          referenceUploads++;
          try{
            const bytes=await referenceInputBytes(req),input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));validateReferencePreparation(ownerId,input);
            const capability=(await agent.models()).find(m=>m.id===input.generation.model);
            if(capability?.supportsImages!==true)throw Error('Selected model has not advertised image input; no model invoked');
            if(changingConfig||shuttingDown)throw Error('Reference preparation configuration changed; no model invoked');
            return json(200,await referencePreparations.operation('prepare',ownerId,{input:bytes,runtimeHash:await runtimeHash(),capability}));
          }finally{referenceUploads--;}
        }
        if(preparationHash&&req.method==='GET'&&!action)return json(200,await referencePreparations.operation('get',ownerId,{preparationHash}));
        if(preparationHash&&req.method==='GET'&&action==='record'){
          const value=await referencePreparations.operation('record',ownerId,{preparationHash}),bytes=Buffer.from(value.record);
          res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Length':bytes.length,'ETag':value.sha256,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(bytes);
        }
        if(preparationHash&&req.method==='GET'&&imageId){
          const value=await referencePreparations.operation('image',ownerId,{preparationHash,imageId}),bytes=Buffer.from(value.png);
          res.writeHead(200,{'Content-Type':'image/png','Content-Length':bytes.length,'ETag':value.sha256,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(bytes);
        }
        if(preparationHash&&req.method==='POST'&&action==='confirm'){
          referenceUploads++;
          try{
            const input=await referenceInputBytes(req,4096),prepared=await referencePreparations.operation('get',ownerId,{preparationHash});
            const capability=(await agent.models()).find(m=>m.id===prepared.model);
            if(changingConfig||shuttingDown)throw Error('Reference preparation configuration changed; no model invoked');
            return json(200,await referencePreparations.operation('confirm',ownerId,{preparationHash,input,runtimeHash:await runtimeHash(),capability}));
          }finally{referenceUploads--;}
        }
        return json(405,{error:'Reference preparation is not a generation or world-write endpoint'});
      }
      if (route === '/v1/world-patch/capabilities' && req.method === 'GET') return json(200, {
        format: 'WorldPatchCapabilities', version: 1, purpose: 'world-patch-design',
        preparationImplemented: true, reviewPreparationImplemented: true, freezePreparationImplemented: true,
        frozenTaskAuditImplemented: true, preparationEnabled: !shuttingDown,
        sendingImplemented: false, placementImplemented: false, maximumCalls: 1, automaticRetries: 0,
        experimentalSendingImplemented: true, experimentalSendingEnabled: experimentalWorldPatchDesign && !!patchDesign && !shuttingDown && !changingConfig,
        jobStatusVersion: 2, previewDownloadVersion: 1, runtimeHash: experimentalWorldPatchDesign ? patchDesign?.runtimeHash ?? null : null,
        exactDataRequiresIndependentConfirmation: true, summaryConsentTransferable: false,
        sourceAuthority: 'client-submitted-block-facts-not-a-server-signature',
        serverBaselineVerified: false, canAuthorizePlacement: false,
      });
      if (route === '/v2/world-patch/capabilities' && req.method === 'GET') return json(200, worldPatchSendingCapabilities({
        preparationEnabled: !shuttingDown,
        sendingEnabled: worldPatchSending && !!patchDesign && !shuttingDown && !changingConfig,
        runtimeHash: worldPatchSending ? patchDesign?.runtimeHash ?? null : null,
      }));
      const frozenPatchRoute = route.match(/^\/v1\/world-patch\/tasks\/([a-f0-9]{64})$/);
      if (frozenPatchRoute) {
        if (shuttingDown) return json(503, {error: 'Bridge shutting down'});
        if (req.method !== 'GET') return json(405, {error: 'Frozen task audit is read-only; no model invoked'});
        return json(200, await contexts.operation('patch-frozen-task', frozenPatchRoute[1]));
      }
      const patchJobRoute = route.match(/^\/(v1|v2)\/world-patch\/jobs\/([a-f0-9]{64})(?:\/(send|observe-original|recheck-response|preview|candidate))?$/);
      if (patchJobRoute) {
        const [, api, id, action] = patchJobRoute;
        if (!patchDesign || !(api === 'v2' ? worldPatchSending : experimentalWorldPatchDesign)) return json(409, {error: 'Requested patch SEND protocol is disabled; no model invoked'});
        if (shuttingDown || changingConfig) return json(409, {error: 'Patch service/configuration changing'});
        if (req.method === 'GET' && ['preview', 'candidate'].includes(action)) {
          if ([...url.searchParams.keys()].length !== 1 || url.searchParams.getAll('candidateHash').length !== 1) return json(400, {error: 'One exact retained candidateHash required'});
          const bytes = await (action === 'candidate' ? patchDesign.downloadCandidate : patchDesign.downloadPreview)(id, url.searchParams.get('candidateHash'));
          res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});return res.end(bytes);
        }
        if (req.method === 'GET' && !action) { const value = await patchDesign.get(id); return json(value ? 200 : 404, value ?? {error: 'Original patch job not found'}); }
        if (req.method === 'POST' && ['send', 'observe-original', 'recheck-response'].includes(action)) {
          if (contextAnalysis?.busy() || [...jobs.values()].some(j => !terminal(j.state))) return json(409, {error: 'Finish active model work before patch dispatch or original observation'});
          const input = await body(req, 4096);
          if (jointPatch.busy() || changingConfig || shuttingDown) return json(409, {error:'Joint/configuration lane changed; no patch dispatch'});
          if (action === 'send') {
            if (input.capsuleId !== id) throw new Error('Patch SEND route/identity differs');
            return json(202, await patchDesign.submit(input));
          }
          exactKeys(input, ['confirmed'], 'original patch observation');
          if (input.confirmed !== true) throw new Error('Explicit original patch turn observation required');
          if (action === 'recheck-response') return json(200, await patchDesign.recheckResponse(id));
          return json(202, await patchDesign.observeOriginal(id));
        }
        return json(405, {error: 'Unsupported patch job action'});
      }
      if (route === '/v1/context-analysis/capabilities' && req.method === 'GET') return json(200, {
        format: 'WorldContextAnalysisCapabilities', version: 1, requestVersion: 2,
        enabled: !!contextAnalysis && !shuttingDown && !changingConfig,
        maximumCalls: 1, automaticRetries: 0, canAuthorizePlacement: false,
      });
      const analysisRoute = route.match(/^\/v1\/context-analysis\/([a-f0-9]{64})(?:\/(observe-original))?$/);
      if (analysisRoute) {
        if (!contextAnalysis) return json(409, {error: 'Read-only analysis sending is not enabled; no model invoked'});
        if (shuttingDown || changingConfig) return json(409, {error: 'Context analysis service/configuration changing'});
        const [, id, action] = analysisRoute;
        if (req.method === 'GET' && !action) { const value = await contextAnalysis.get(id); return json(value ? 200 : 404, value ?? {error: 'Context analysis task not found'}); }
        if (req.method === 'POST' && action === 'observe-original') {
          if (patchDesign?.busy()) return json(409, {error: 'Finish patch model work before analysis observation'});
          const input = await body(req, 1024); exactKeys(input, ['confirmed'], 'original context observation');
          if (jointPatch.busy() || changingConfig || shuttingDown) return json(409, {error:'Joint/configuration lane changed; no analysis observation'});
          if (input.confirmed !== true) throw new Error('Explicit original-turn observation required; no generation submitted');
          return json(200, await contextAnalysis.observeOriginal(id));
        }
        return json(405, {error: 'Unsupported context analysis action'});
      }
      const contextRoute = route.match(/^\/v1\/world-contexts\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/(capture|record|disclosure|confirm-disclosure|task-disclosure|patch-task-disclosure|patch-review-task|patch-freeze-task|cancel|discard|send-analysis)$/);
      if (contextRoute) {
        const [, id, action] = contextRoute;
        if (shuttingDown) return json(503, {error: 'Bridge shutting down'});
        if (req.method === 'POST' && action === 'send-analysis') {
          if (!contextAnalysis) return json(409, {error: 'Read-only analysis sending is not enabled; no model invoked'});
          if (changingConfig) return json(409, {error: 'Context model configuration changing; no model invoked'});
          if (patchDesign?.busy()) return json(409, {error: 'Finish patch model work before analysis send'});
          const input = await body(req, 32768);
          if (jointPatch.busy() || changingConfig || shuttingDown) return json(409, {error:'Joint/configuration lane changed; no analysis dispatch'});
          if (input.contextId !== id) throw new Error('Context analysis route/request identity differs');
          return json(202, await contextAnalysis.submit(input));
        }
        if (req.method === 'POST' && ['cancel','discard'].includes(action)) {
          contextUploads++;
          try {contextConsents.revoke(id); const value = await contexts.cancel(id);
            if (action === 'discard') return json(200, await contexts.operation('discard', id));
            return json(200, value);
          } finally {contextUploads--;}
        }
        if (req.method === 'POST' && action === 'capture') {
          if (contextUploads >= 3) return json(429, {error: 'Context upload lanes full; no model invoked'});
          contextUploads++;try { return json(200, await contexts.operation('capture', id, await contextBytes(req))); } finally { contextUploads--; }
        }
        if (req.method === 'GET' && action === 'record') return json(200, await contexts.operation('get', id));
        if (req.method === 'POST' && ['patch-task-disclosure', 'patch-review-task', 'patch-freeze-task'].includes(action)) {
          contextUploads++;
          try {return json(200, await contexts.operation(action, id, await patchIntentBytes(req)));}
          finally {contextUploads--;}
        }
        if (req.method === 'POST' && action === 'task-disclosure') {
          const input = await body(req, 32768);
          return json(200, await contexts.operation(action, id, new TextEncoder().encode(JSON.stringify(input))));
        }
        if (req.method === 'POST' && ['disclosure', 'confirm-disclosure'].includes(action)) {
          const input = await body(req, 4096);
          const task = action === 'disclosure' ? input : input.task;
          const disclosure = await contexts.operation('disclosure', id, new TextEncoder().encode(JSON.stringify(task)));
          return json(200, action === 'disclosure' ? disclosure : contextConsents.confirm(disclosure, input));
        }
        return json(405, {error: 'Invalid context action'});
      }
      if(req.method==='POST'&&route==='/v1/renderers/heartbeat'){
        const input=await body(req);if(input.renderer!==NATIVE_RENDERER||input.assetOnly!==true)throw new Error('Unsupported asset renderer');
        nativeRendererSeen=Date.now();return json(200,{ready:true,renderer:NATIVE_RENDERER,worldCaptured:false});
      }
      const nativeRoute=route.match(/^\/v1\/jobs\/([0-9a-f-]{36})\/native-evidence\/([a-f0-9]{64})\/(request|manifest|cells|upload)$/);
      if(nativeRoute){
        const [,id,evidenceId,action]=nativeRoute,job=jobs.get(id);
        if(!job||job.preflight?.assembly?.designReview?.mode!=='native')return json(404,{error:'No authorized native evidence job'});
        const request=await readNativeRequest(jobDir(id),evidenceId);
        if(req.method==='GET'&&action==='request')return json(200,request);
        if(req.method==='GET'&&['manifest','cells'].includes(action)){
          const bytes=await safeEvidenceFile(jobDir(id),`native-evidence/${evidenceId}/${action==='manifest'?'manifest.json':'cells.bin'}`,action==='manifest'?1048576:16777216);
          if(action==='manifest')return json(200,JSON.parse(bytes));
          if(hash(bytes)!==request.cellsHash)throw new Error('Native evidence cells changed');
          res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':bytes.length});return res.end(bytes);
        }
        if(req.method==='POST'&&action==='upload'){
          if(terminal(job.state)||job.nativeEvidence?.id!==evidenceId||job.cancelRequested)return json(409,{error:'Native evidence request is no longer active'});
          const evidence=await acceptNativeEvidence(jobDir(id),evidenceId,await body(req,12000000));
          return json(200,{accepted:true,requestHash:evidenceId,evidenceHash:evidence.evidenceHash});
        }
        return json(405,{error:'Invalid native evidence action'});
      }
      if(req.method==='GET'&&route==='/v1/quality-tiers')return json(200,{version:1,tiers:qualityTiers(),visualReview:false,qualityVersions:['v1','v2','v3','v4'],designReviewModes:['text','images','native'],imageReviewRequires:'explicitly image-capable Codex model and confirmed image mode; native additionally requires quality v2/v3/v4 and a ready client renderer; v3/v4 require native rendered concepts',qualityGuaranteed:false});
      if (req.method === 'GET' && route === '/v1/health') return json(200, { protocol: 1, version: RELEASE_VERSION, minecraft: '1.20.1', capabilities: ['job-key-lookup', 'codex-path-config', 'claude-path-config', 'deepseek-path-config','agent-specific-discovery','progressive-agent-discovery','claude-experimental', 'native-bundle', 'revision-diff','generation-preflight','layered-generation','height-384','deepseek-output-budget','navigation-review','verified-generation-examples','building-spec-v2','special-blocks','visual-refinement','scene-spec-v1','scoped-scene-revisions','design-provenance','failed-scene-repair','scene-checkpoints','scene-components','quality-tiers-v1','assembly-design-review-v1','assembly-occupancy-images','assembly-safe-recovery-v1','storey-facade-layout-v1','floor-linked-interiors-v1','assembly-quality-v2','assembly-quality-v3','assembly-quality-v4','native-revision-comparison-v1','structured-quality-review-v1','native-concept-comparison-v1','native-asset-evidence-v1','scoped-coordinated-refinement-v1'] });
      if (req.method === 'GET' && route === '/v1/diagnostics') {
        const required = ['bridge/server.mjs','bridge/scene-checkpoint-worker.mjs','contracts/building-spec.schema.mjs','contracts/scene-draft-edit.schema.mjs','prompts/building-v1.md','.agents/skills/voxel-studio/SKILL.md'];
        const components = [];
        for (const file of required) { let present = true; try { await fs.access(path.join(here, '..', file)); } catch { present = false; } components.push({ file, present }); }
        return json(200, { protocol: 1, version: RELEASE_VERSION, minecraft: '1.20.1', node: process.version, codexPath: configuredPath,resolvedCodexPath:agent.cli??null,codexVersion:agent.version??null,claudePath:configuredClaudePath,deepseekPath:configuredDeepseekPath, components, capabilities: ['job-key-lookup','codex-path-config','claude-experimental','deepseek-data-only','progressive-agent-discovery','generation-preflight','layered-generation','height-384','deepseek-output-budget','navigation-review','verified-generation-examples','building-spec-v2','special-blocks','visual-refinement','scene-spec-v1','scoped-scene-revisions','design-provenance','failed-scene-repair','scene-checkpoints','scene-components','quality-tiers-v1','assembly-design-review-v1','assembly-occupancy-images','assembly-safe-recovery-v1','storey-facade-layout-v1','floor-linked-interiors-v1','assembly-quality-v2','assembly-quality-v3','assembly-quality-v4','native-revision-comparison-v1','structured-quality-review-v1','native-concept-comparison-v1','native-asset-evidence-v1','scoped-coordinated-refinement-v1'], generationSubmitted: false });
      }
      if (req.method === 'POST' && ['/v1/config/codex-path','/v1/config/claude-path','/v1/config/deepseek-path'].includes(route)) {
        if (changingConfig || referenceUploads || referencePreparations.busy() || referenceGeneration.busy() || contextAnalysis?.busy() || patchDesign?.busy() || jointPatch.busy() || [...jobs.values()].some(j => !terminal(j.state))) return json(409, { error: 'Finish/cancel active jobs before changing Agent path' });
        const input = await body(req);
        const isClaude=route.endsWith('claude-path'),isDeepseek=route.endsWith('deepseek-path'),field=isDeepseek?'deepseekPath':isClaude?'claudePath':'codexPath',value=input[field];
        if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid Agent path');
        // Check again after the asynchronous body read, before taking the configuration lock.
        if (changingConfig || referenceUploads || referencePreparations.busy() || referenceGeneration.busy() || contextAnalysis?.busy() || patchDesign?.busy() || jointPatch.busy() || [...jobs.values()].some(j => !terminal(j.state))) return json(409, { error: 'Active task or configuration change' });
        changingConfig = true;
        try {
          if (value) await (isDeepseek?findDeepseek(value):isClaude?findClaude(value):findCodex(value));
          const file = path.join(dataDir, 'config.json'); let config = {};
          try { config = await readJson(file); await fs.copyFile(file, `${file}.${randomUUID()}.backup`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
          config[field] = value; await atomic(file, config);
          if(isDeepseek){deepseekAgent.close();configuredDeepseekPath=value;deepseekAgent=new DeepseekAdapter({deepseekPath:value||undefined});}
          else if(isClaude){claudeAgent.close();configuredClaudePath=value;claudeAgent=new ClaudeAdapter({claudePath:value||undefined});}
          else{agent.close(); configuredPath = value; agent = new CodexAdapter({ codexPath: configuredPath || undefined });}
          autoDiscovery.invalidate(isDeepseek?'deepseek':isClaude?'claude':'codex');
          return json(200, { saved: true, requiresModelRefresh: true });
        } finally { changingConfig = false; }
      }
      if (changingConfig && (route.startsWith('/v1/agents') || req.method === 'POST' && route === '/v1/jobs')) return json(409, { error: 'Agent configuration is changing; retry discovery' });
      if (req.method === 'POST' && route === '/v1/shutdown') { json(202, { closing: true }); setTimeout(() => closeService?.(), 25); return; }
      if (req.method === 'GET' && route === '/v1/agents') return json(200, { agents: await Promise.all([agent.status(),claudeAgent.status(),deepseekAgent.status()]) });
      if(req.method==='GET'&&route==='/v1/agents/discovery')return json(200,autoDiscovery.snapshot(url.searchParams.get('refresh')==='1'));
      const discovery=route.match(/^\/v1\/agents\/(codex|claude|deepseek)$/);
      if(req.method==='GET'&&discovery)return json(200,{agents:[await agentFor(discovery[1]).status()]});
      if (req.method === 'GET' && route === '/v1/agents/deepseek/models') return json(200, {models:await deepseekAgent.models(),advisory:true});
      if (req.method === 'GET' && route === '/v1/agents/claude/models') return json(200, { models: [],manualModel:true,note:'Enter an explicit Claude model ID/alias; availability is not inferred from a static list.' });
      if (req.method === 'GET' && route === '/v1/agents/codex/models') return json(200, { models: await agent.models(),cliVersion:agent.version??null });
      if (req.method === 'GET' && route === '/v1/jobs') return json(200, { jobs: [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicJob) });
      if(req.method==='POST'&&route==='/v1/preflight')return json(200,await preflight(await body(req)));
      if (req.method === 'GET' && route === '/v1/jobs/by-key') {
        const key = url.searchParams.get('key');
        if (!key || !/^[\w-]{1,128}$/.test(key)) throw new Error('Invalid task key');
        const job = [...jobs.values()].find(j => j.key === key);
        const pending=referenceSubmissions.get(key);
        return json(200, { job: job ? publicJob(job) : null,...(!job&&pending?{pendingReferenceSubmission:true,error:pending.recoveryError??null}:{}) });
      }
      if (req.method === 'POST' && route === '/v1/jobs') {
        const input = await body(req);
        if(referenceUploads||referenceGeneration.busy()||jointPatch.busy())return json(429,{error:'Reference SEND storage is active; no new model invoked'});
        if (['worldContext', 'contextId', 'contextConsent', 'worldPatch'].some(k => Object.hasOwn(input, k))) throw new Error('World-context editing is not connected to generation; no model invoked');
        if (changingConfig) return json(409, { error: 'Agent configuration is changing; retry discovery' });
        if (input.maxRepairs !== undefined && (!Number.isInteger(input.maxRepairs) || input.maxRepairs < 0 || input.maxRepairs > 2)) throw new Error('maxRepairs must be 0..2');
        if (typeof input.key !== 'string' || !/^[\w-]{1,128}$/.test(input.key)) throw new Error('A stable idempotency key is required');
        if(referenceSubmissions.has(input.key))return json(409,{error:'Task key belongs to an original reference SEND; use its versioned endpoint'});
        const requestHash = hash(input), existing = [...jobs.values()].find(j => j.key === input.key);
        if (existing) { if (existing.requestHash !== requestHash) return json(409, { error: 'Idempotency key reused with changed input' }); return json(200, publicJob(existing)); }
        if ([...jobs.values()].filter(j => !terminal(j.state)).length >= 2 || jobs.size >= 1000) return json(429, { error: 'Job quota reached' });
        if(input.importDirectory!==undefined&&(typeof input.importDirectory!=='string'||input.importDirectory.length>2048||!path.isAbsolute(input.importDirectory)))throw new Error('Import requires an absolute native-bundle directory');
        if(input.revalidateJobId!==undefined&&(!/^[0-9a-f-]{36}$/.test(input.revalidateJobId)||input.sample||input.spec||input.patch||input.scenePatch||input.importDirectory||input.baseJobId))throw new Error('Local revalidation requires only a failed job ID');
        if (!input.sample && !input.spec && !input.patch && !input.scenePatch && !input.importDirectory && !input.revalidateJobId && (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 16000 || typeof input.model !== 'string')) throw new Error('Description and selected model are required');
        if (input.agent && !['codex','claude','deepseek'].includes(input.agent)) throw new Error('Unsupported Agent');
        const policy=await preflight(input);
        if(policy.assembly?.designReview?.mode==='native'&&Date.now()-nativeRendererSeen>30000)throw new Error('原生资产渲染客户端尚未就绪；未提交模型调用，请在游戏中启用质量 v2 后重试');
        if(input.repairJobId&&input.repairConfirmed!==true)throw new Error('Confirm the single paid failed-draft repair before submitting');
        if(policy.checkpoints&&input.checkpointConfirmed!==true)throw new Error('Confirm the full checkpoint model-call budget before submitting');
        if(policy.assembly&&input.assemblyConfirmed!==true)throw new Error('Confirm the full component-workflow model-call budget before submitting');
        if(input.reviewImages)reviewPngs(input.reviewImages);
        // Preflight may await a failed source read. Recheck idempotency and quotas
        // after that boundary so concurrent identical requests cannot double-call.
        const concurrent=[...jobs.values()].find(j=>j.key===input.key);
        if(concurrent)return json(concurrent.requestHash===requestHash?200:409,concurrent.requestHash===requestHash?publicJob(concurrent):{error:'Idempotency key reused with changed input'});
        if(changingConfig||referenceUploads||referenceGeneration.busy()||referenceSubmissions.has(input.key)||patchDesign?.busy()||jointPatch.busy()||[...jobs.values()].filter(j=>!terminal(j.state)).length>=2||jobs.size>=1000)return json(429,{error:'Job/configuration quota changed during preflight'});
        const id = randomUUID(), job = { id, key: input.key, requestHash, agent:input.agent??'codex',prompt: input.prompt, model: input.model, effort: input.effort,preflight:policy, baseJobId: input.baseJobId,createdAt: new Date().toISOString(), state: 'queued', events: [] };
        jobs.set(id, job);
        try { await fs.mkdir(jobDir(id));
          if(policy.assembly?.recovery){await durableJson(path.join(jobDir(id),'recovery-request.json'),input);job.recoveryEnabled=true;}
          await event(job, 'queued'); }
        catch (e) { jobs.delete(id); throw e; }
        const promise = run(job, input).catch(() => {}); running.add(promise); promise.finally(() => running.delete(promise));
        return json(202, publicJob(job));
      }
      const match = route.match(/^\/v1\/jobs\/([0-9a-f-]{36})(?:\/(events|cancel|manifest|cells|spec|scene|design-sources|diff|bundle|export|diagnostic-manifest|diagnostic-cells|repair-context))?$/);
      if (match) {
        const job = jobs.get(match[1]); if (!job) return json(404, { error: 'Job not found' });
        const action = match[2];
        if (req.method === 'GET' && !action) return json(200, publicJob(job));
        if(req.method==='GET'&&action==='repair-context')return json(200,(await readFailedScene(job,jobDir(job.id))).context);
        if (req.method === 'GET' && action === 'events') return json(200, { events: job.events.filter(e => e.seq > Number(url.searchParams.get('after') ?? 0)) });
        if (req.method === 'POST' && action === 'cancel') {
          if(!terminal(job.state)){job.cancelRequested=true;await save(job);active.get(job.id)?.abort();}
          return json(200, publicJob(job));
        }
        if(req.method==='GET'&&['diagnostic-manifest','diagnostic-cells'].includes(action)){
          if(job.state!=='failed'||job.diagnosticPreview?.diagnosticOnly!==true)return json(409,{error:'No read-only diagnostic view for this failed job'});
          if(action==='diagnostic-manifest')return json(200,job.diagnosticPreview);
          const bytes=await fs.readFile(path.join(jobDir(job.id),'diagnostic','cells.bin'));
          if(hash(bytes)!==job.diagnosticPreview.cellsHash)throw new Error('Diagnostic cell hash mismatch');
          res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':bytes.length,'ETag':job.diagnosticPreview.cellsHash});return res.end(bytes);
        }
        if (job.state !== 'preview-ready') return json(409, { error: 'No immutable completed revision' });
        if (req.method === 'GET' && action === 'manifest') return json(200, job.manifest);
        if (req.method === 'GET' && action === 'spec') return json(200, await readJson(path.join(jobDir(job.id), 'spec.json')));
        if(req.method==='GET'&&['scene','design-sources'].includes(action)){if(!job.manifest?.scene)return json(404,{error:'This legacy asset has no SceneSpec source'});return json(200,await readJson(path.join(jobDir(job.id),action+'.json')));}
        if (req.method === 'GET' && action === 'diff') return json(200, job.baseJobId?await readJson(path.join(jobDir(job.id),'diff.json')):job.failedRepair?{failedRepair:job.failedRepair,fullDraftReviewRequired:true,note:'失败稿全文修订；没有可用原资产作逐格差异基线，不保证仅局部变化。'}:{sameBounds:true,changed:0,note:'Original revision; no base to compare'});
        if (req.method === 'GET' && action === 'cells') {
          const bytes = await fs.readFile(path.join(jobDir(job.id), 'cells.bin'));
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length, 'ETag': job.manifest.cellsHash }); return res.end(bytes);
        }
        if (req.method === 'POST' && action === 'export') return json(200, { file: path.join(jobDir(job.id), `${job.manifest.id}.schem`), report: await readJson(path.join(jobDir(job.id), 'export-report.json')) });
        if (req.method === 'POST' && action === 'bundle') return json(200,{directory:await exportNativeBundle(jobDir(job.id)),containsCredentials:false,containsPrivatePrompt:false});
      }
      json(404, { error: 'Unknown route' });
    } catch (e) { json(e.statusCode ?? 400, { error: e.message }); }
  });
  server.requestTimeout = 120000;
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); }
  catch (e) { await jointPatch.close(); await patchDesign?.close(); await contextAnalysis?.close(); await referencePreparations.close(); await referenceGeneration.close(); contextConsents.close(); await contexts.close(); await fs.unlink(lockFile); throw e; }
  const connection = { protocol: 1, port: server.address().port, token, pid: process.pid };
  await atomic(connectionFile, connection);
  let closing;
  closeService = () => closing ??= (async () => {
    shuttingDown=true;
    await jointPatch.close();
    await patchDesign?.close();
    await contextAnalysis?.close();
    await referencePreparations.close();
    await referenceGeneration.close();
    contextConsents.close(); await contexts.close();
    for (const c of active.values()) c.abort(); autoDiscovery.close();agent.close();claudeAgent.close();deepseekAgent.close();
    await new Promise(resolve => server.close(resolve));
    await Promise.allSettled([...running]);
    await fs.unlink(connectionFile).catch(() => {}); await fs.unlink(lockFile).catch(() => {});
  })();
  for(const {job,request} of recoverable){
    const promise=run(job,request).catch(()=>{});running.add(promise);promise.finally(()=>running.delete(promise));
  }
  return { connection, server, close: closeService };
}
// Node resolves import.meta.url through Windows junctions, while argv retains
// the launch alias. Compare actual files or a legitimate relocated install can
// silently exit without ever starting its service.
if (process.argv[1] && await fs.realpath(path.resolve(process.argv[1])).catch(()=>null) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--data-dir');
  const dataDir = at >= 0 ? process.argv[at + 1] : path.join(here, '../.studio-data');
  let config = {}; try { config = await readJson(path.join(dataDir, 'config.json')); } catch {}
  // Normal companion startup exposes the versioned reference lane. This is
  // availability only: preparation and the separate, exact SEND confirmation
  // are still mandatory. Config/HTTP cannot enable the imported default lane.
  const instance = await startBridge({ dataDir, codexPath: config.codexPath,claudePath:config.claudePath,deepseekPath:config.deepseekPath, worldPatchSending: true, referenceGenerationSending: true });
  console.log(`Voxel Studio Bridge ready (protocol 1, loopback port ${instance.connection.port})`);
  let closing = false;
  const close = () => { if (closing) return; closing = true; instance.close().finally(() => process.exit()); };
  process.on('SIGINT', close); process.on('SIGTERM', close);
  const parentAt = process.argv.indexOf('--parent-pid');
  if (parentAt >= 0) {
    const parentPid = Number(process.argv[parentAt + 1]);
    const watchdog = setInterval(() => { try { process.kill(parentPid, 0); } catch { close(); } }, 5000); watchdog.unref();
  }
}
