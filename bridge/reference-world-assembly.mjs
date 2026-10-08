import fs from 'node:fs/promises';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {exactKeys} from '../contracts/world-selection.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {readNativeBundle} from '../src/generation/bundle.mjs';
import {prepareAssemblyWorldContext,compileAssemblyWorldPatch} from '../src/world/assembly-context.mjs';
import {readJobReferenceInput} from './reference-generation-binding.mjs';
import {readReferenceWorldPatchPreparationSource,rebuildReferenceWorldPatchContextSource,
  REFERENCE_PATCH_CONTEXT_FILE_LIMITS} from './reference-world-patch-source.mjs';
import {assemblyRuntimeIdentity,runDurableAssembly} from './assembly-durability.mjs';
import {safeEvidenceFile} from './native-evidence.mjs';
import {codexRequestFingerprint} from './codex-persistent-receipt.mjs';

// A NEW independent full-task contract. Never reinterpret the existing v1
// single-call world-patch capsule, its SEND, budget or journal. This internal
// orchestration is not yet a public HTTP endpoint or a world-write service.
const archiveName = 'reference-world-assembly-v2', active = new Set();
const raw = value => Buffer.from(JSON.stringify(value));
const frozen = value => {
  if (value && typeof value === 'object') {for (const child of Object.values(value)) frozen(child); Object.freeze(value);}
  return value;
};
const identity = /^[a-f0-9]{64}$/;
const archiveFiles = {...REFERENCE_PATCH_CONTEXT_FILE_LIMITS,'preparation.json':65536,'send.json':4096};
async function read(root, name, maximum) {
  const bytes = await safeEvidenceFile(root,name,maximum), stat = await fs.lstat(path.join(root,name));
  if (!bytes.length || stat.nlink !== 1 || stat.size !== bytes.length) throw Error('Original full-task file type/size/link changed');
  return bytes;
}
async function immutable(file, bytes) {
  const handle = await fs.open(file,'wx',0o600);
  try {await handle.writeFile(bytes); await handle.sync();} finally {await handle.close();}
}
function capability(value, generation) {
  exactKeys(value,['id','supportsImages','efforts'],'full-task selected image advertisement');
  if (value.id !== generation.model || value.supportsImages !== true || !Array.isArray(value.efforts)
    || !value.efforts.length || value.efforts.length > 16 || value.efforts.some(e => typeof e !== 'string'
      || !['none','minimal','low','medium','high','xhigh','max','ultra'].includes(e))
    || new Set(value.efforts).size !== value.efforts.length || !value.efforts.includes(generation.effort))
    throw Error('Exact selected model must explicitly advertise images and selected effort');
  return structuredClone(value);
}
function preparation(reference, saved, selectedCapability) {
  const p = reference.preparation, generation = p.generation, tier = p.policy.assembly;
  if (p.version !== 2 || generation.agent !== 'codex' || generation.assemblyConfirmed !== true
    || tier.recovery?.mode !== 'safe' || tier.designReview?.mode !== 'native' || ![2,3,4].includes(tier.quality?.version))
    throw Error('Full joint task requires explicit new shared-budget reference preparation, safe recovery and native quality review');
  const context = prepareAssemblyWorldContext(saved.snapshot);
  if (p.policy.minimumHeight > context.maximumBounds.height) throw Error('Requested actual height cannot fit original W; no shrinking');
  if (p.policy.maximumBounds && Object.keys(context.maximumBounds).some(k => p.policy.maximumBounds[k] > context.maximumBounds[k]))
    throw Error('Confirmed requested bounds cannot fit original W; new selection/request required');
  const content = {format:'ReferenceWorldAssemblyPreparation',version:2,purpose:'reference-world-assembly',
    jobId:reference.binding.jobId, contextId:saved.record.id, recordHash:saved.record.recordHash,
    payloadSha256:saved.record.payloadSha256, recordExpiresAt:saved.record.expiresAt,
    referenceBindingHash:reference.binding.bindingHash,referenceSetHash:reference.manifest.setHash,
    referencePreparationHash:p.preparationHash, generationHash:p.generationHash, policyHash:hash(p.policy),
    runtimeHash:p.runtimeHash, selected:{agent:generation.agent,model:generation.model,effort:generation.effort,
      capability:capability(selectedCapability,generation)},
    tier:tier.id, maximumCalls:tier.maximumCalls, providerRetries:tier.providerRetries,
    snapshotHash:context.snapshotHash,selectionHash:context.selectionHash,worldContextHash:context.worldContextHash,
    origin:context.origin,maximumBounds:context.maximumBounds, imageCount:reference.manifest.references.length,
    imageAnnotations:reference.manifest.references.map(({id,width,height,annotation,sha256}) => ({id,width,height,annotation,sha256})),
    stages:'same-reference-analysis-concepts-prototypes-components-native-review-pipeline',
    budget:'one-original-shared-ledger-including-analysis-corrections-recovery-and-review',
    privacy:'confirmed-reference-pixels-and-original-block-context-no-HUD-accounts-or-container-content',
    sourceAuthority:context.sourceAuthority, v1ConsentTransferable:false, state:'prepared-not-sent',
    modelSent:false,callsReserved:0,serverBaselineVerified:false,canAuthorizePlacement:false};
  return frozen({...content,preparationHash:hash(content)});
}
function verifySend(send, prepared) {
  exactKeys(send,['format','version','purpose','confirmed','preparationHash','maximumCalls'],'independent complete world/reference SEND');
  if (send.format !== 'ReferenceWorldAssemblySend' || send.version !== 2 || send.purpose !== 'reference-world-assembly'
    || send.confirmed !== true || send.preparationHash !== prepared.preparationHash || send.maximumCalls !== prepared.maximumCalls)
    throw Error('New exact full-task SEND required; v1/ordinary reference consent cannot grant world/reference task authority');
}

/** Free private preparation, no call reservation, adapter or world writer.
 * The job-owned images already have their separate original image confirmation.
 * A new joint confirmation below additionally binds the environment and budget. */
export async function prepareReferenceWorldAssembly({dataDir,directory,contextId,referenceInput,selectedCapability}) {
  const runtimeHash = await assemblyRuntimeIdentity();
  const reference = await readJobReferenceInput({directory,input:referenceInput,model:selectedCapability?.id,runtimeHash});
  const source = await readReferenceWorldPatchPreparationSource({dataDir,contextId,intent:{
    referenceOwnerId:reference.input.ownerId,referenceSetHash:reference.manifest.setHash}});
  if (hash(source.reference.manifest) !== hash(reference.manifest)) throw Error('Original world/reference preparation picture annotations differ');
  for (const [i, image] of source.reference.images.entries())
    if (hash(image) !== hash(await fs.readFile(reference.images[i]))) throw Error('Original world/reference preparation pixels differ');
  return preparation(reference,source.saved,selectedCapability);
}

/** Freeze original context bytes after an INDEPENDENT new full-budget SEND.
 * Partial archives remain incomplete, never adopted or repaired. No models. */
export async function freezeReferenceWorldAssembly({dataDir,directory,contextId,referenceInput,selectedCapability,send}) {
  const prepared = await prepareReferenceWorldAssembly({dataDir,directory,contextId,referenceInput,selectedCapability});
  verifySend(send,prepared);
  const root = path.join(path.resolve(directory),archiveName);
  try {
    await fs.mkdir(root,{mode:0o700});
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const old = await readFrozenReferenceWorldAssembly({directory,referenceInput});
    if (hash(old.prepared) !== hash(prepared) || hash(old.send) !== hash(send)) throw Error('Existing full-task context/SEND differs; preserved');
    return old.prepared;
  }
  const source = await readReferenceWorldPatchPreparationSource({dataDir,contextId,intent:{
    referenceOwnerId:referenceInput.ownerId,referenceSetHash:prepared.referenceSetHash}});
  const reference = await readJobReferenceInput({directory,input:referenceInput,model:prepared.selected.model,runtimeHash:prepared.runtimeHash});
  if (hash(preparation(reference,source.saved,selectedCapability)) !== hash(prepared)) throw Error('Joint source changed while freezing; partial archive retained');
  const values = {...source.contextFiles,'preparation.json':raw(prepared),'send.json':raw(send)};
  const files = [];
  for (const [name, maximum] of Object.entries(archiveFiles)) {
    const bytes = values[name];
    if (bytes.length > maximum) throw Error('Original joint archive byte quota; partial archive retained');
    await immutable(path.join(root,name),bytes); files.push({path:name,bytes:bytes.length,sha256:hash(bytes)});
  }
  const content = {format:'ReferenceWorldAssemblyArchive',version:2,preparationHash:prepared.preparationHash,
    frozenAt:Date.now(),files,modelSent:false,canAuthorizePlacement:false};
  if (content.frozenAt >= prepared.recordExpiresAt) throw Error('Original context expired during freeze; partial archive retained');
  await immutable(path.join(root,'manifest.json'),raw({...content,manifestHash:hash(content)}));
  return (await readFrozenReferenceWorldAssembly({directory,referenceInput})).prepared;
}

/** Exact archival read, not a new SEND/expiry refresh or a live server check. */
export async function readFrozenReferenceWorldAssembly({directory,referenceInput}) {
  const root = path.join(path.resolve(directory),archiveName), manifest = JSON.parse(await read(root,'manifest.json',65536));
  exactKeys(manifest,['format','version','preparationHash','frozenAt','files','modelSent','canAuthorizePlacement','manifestHash'],'full world/reference archive');
  const {manifestHash,...content} = manifest;
  if (manifest.format !== 'ReferenceWorldAssemblyArchive' || manifest.version !== 2 || hash(content) !== manifestHash
    || !Number.isSafeInteger(manifest.frozenAt) || manifest.frozenAt < 0 || manifest.frozenAt > Date.now()
    || manifest.modelSent !== false || manifest.canAuthorizePlacement !== false || !identity.test(manifest.preparationHash ?? ''))
    throw Error('Original full-task archive manifest changed');
  const names = Object.keys(archiveFiles), entries = await fs.readdir(root);
  if (entries.length !== names.length+1 || entries.some(n => n !== 'manifest.json' && !names.includes(n))
    || !Array.isArray(manifest.files) || manifest.files.length !== names.length) throw Error('Incomplete/unknown full-task archive; no adoption');
  const sources = {};
  for (const [i,name] of names.entries()) {
    const entry = manifest.files[i];exactKeys(entry,['path','bytes','sha256'],'full-task archive source');
    const bytes = await read(root,name,archiveFiles[name]);
    if (entry.path !== name || entry.bytes !== bytes.length || entry.sha256 !== hash(bytes)) throw Error('Original full-task context file changed');
    sources[name] = bytes;
  }
  const prepared = JSON.parse(sources['preparation.json']), send = JSON.parse(sources['send.json']);
  const reference = await readJobReferenceInput({directory,input:referenceInput,model:prepared.selected?.model,runtimeHash:prepared.runtimeHash});
  const saved = rebuildReferenceWorldPatchContextSource(Object.fromEntries(Object.keys(REFERENCE_PATCH_CONTEXT_FILE_LIMITS).map(n => [n,sources[n]])),prepared.contextId,manifest.frozenAt);
  const expected = preparation(reference,saved,prepared.selected?.capability);
  if (hash(expected) !== hash(prepared) || manifest.preparationHash !== expected.preparationHash) throw Error('Original full-task policy/reference/scope/consent pins changed');
  verifySend(send,expected);
  return {prepared:expected,send,reference,saved,worldContext:prepareAssemblyWorldContext(saved.snapshot),manifest};
}

async function selectedAdapter(adapter, prepared) {
  if (typeof adapter?.models !== 'function' || typeof adapter?.generate !== 'function') throw Error('Explicit selected image adapter required');
  const model = (await adapter.models()).find(m => m.id === prepared.selected.model);
  const current = {id:model?.id,supportsImages:model?.supportsImages,efforts:model?.efforts?.map(e => e.reasoningEffort ?? e)};
  if (hash(capability(current,{model:prepared.selected.model,effort:prepared.selected.effort})) !== hash(prepared.selected.capability))
    throw Error('Live original image/effort advertisement changed; no replacement model or new SEND');
}

async function compileFinal(directory, scene, policy, signal) {
  // The first normal final compilation of the ORIGINAL accepted SceneSpec,
  // using the existing production compiler/exporter. Diagnostic assets are NOT
  // copied/promoted or modified. A retained final bundle is read, not replaced.
  const root = path.join(directory,'reference-world-assembly-final');
  const readFinal = async () => {
    const stat=await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(root) !== root) throw Error('Original final native directory redirected; preserved');
    for (const name of ['manifest.json','cells.bin','spec.json','scene.json','design-sources.json','source-owners.bin']) {
      const file=path.join(root,name), found=await fs.lstat(file);
      if (!found.isFile() || found.isSymbolicLink() || found.nlink !== 1 || await fs.realpath(file) !== file)
        throw Error('Original final native file redirected; preserved');
    }
    return {directory:root,compiled:await readNativeBundle(root)};
  };
  try {await fs.lstat(root);return await readFinal();}
  catch (error) {if (error.code !== 'ENOENT') throw error;}
  await fs.mkdir(root,{mode:0o700});
  await new Promise((resolve,reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./compile-worker.mjs',import.meta.url),{
      workerData:{directory:root,spec:scene,policy,generated:true},resourceLimits:{maxOldGenerationSizeMb:512}});
    let message, settled = false;
    const finish = error => {if (settled) return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);
      worker.terminate().then(() => error ? reject(error) : resolve(),reject);};
    const abort = () => finish(Error('Original full-task final compilation cancelled; evidence retained'));
    const timer = setTimeout(() => finish(Error('Final native compile quota; no substitute asset')),120000);
    signal.addEventListener('abort',abort,{once:true});worker.once('message',m => {message=m;});worker.once('error',finish);
    worker.once('exit',code => finish(code !== 0 || message?.ok !== true ? Error(message?.error ?? 'Final compiler missing original receipt') : null));
    if (signal.aborted) abort();
  });
  return readFinal();
}

/** Actual shared durable four-tier orchestration; no world writes. The adapter
 * sees references ONLY in the existing prelude and exact native pictures in
 * review. Every stage receives the SAME original environment and scope.
 * This function is internal until normal HTTP/UI and game gates are complete. */
export async function runReferenceWorldAssembly({directory,referenceInput,preparationHash,adapter,nativeEvidence,signal,onStage,onRecovery}) {
  directory = await fs.realpath(path.resolve(directory));
  if (active.has(directory)) throw Error('Original full joint task already running; no concurrent dispatch');
  active.add(directory);
  try {
    if (!(signal instanceof AbortSignal) || typeof onStage !== 'function' || typeof nativeEvidence !== 'function') throw Error('Original task signal/stage observer/native renderer required');
    const original = await readFrozenReferenceWorldAssembly({directory,referenceInput}), p = original.prepared;
    if (p.preparationHash !== preparationHash) throw Error('Exact confirmed full-task preparation required');
    if (await assemblyRuntimeIdentity() !== p.runtimeHash) throw Error('Original full-task runtime changed');
    const recheck = async freshCall => {
      signal.throwIfAborted();const current = await readFrozenReferenceWorldAssembly({directory,referenceInput});
      if (hash(current.prepared) !== hash(p)) throw Error('Original full-task source changed before dispatch');
      if (await assemblyRuntimeIdentity() !== p.runtimeHash) throw Error('Original full-task runtime changed before dispatch');
      if (freshCall) {if (p.recordExpiresAt <= Date.now()) throw Error('Original world capture expired; no new call or refresh');await selectedAdapter(adapter,p);}
      signal.throwIfAborted();return current;
    };
    const invoke = async (prompt,index,options,binding) => {
      const checked = await recheck(!binding);
      const images = options.referenceInput ? checked.reference.manifest.references.map(r => r.sha256)
        : await Promise.all((options.images ?? []).map(async file => hash(await fs.readFile(file))));
      const expected = codexRequestFingerprint({prompt,model:p.selected.model,effort:p.selected.effort,
        outputSchema:options.outputSchema,imageHashes:images,
        ...(options.referenceInput ? {referenceBindingHash:hash(options.referenceInput)} : {})});
      const request = {prompt,model:p.selected.model,effort:p.selected.effort,cwd:directory,signal,
        images:options.images ?? [],outputSchema:options.outputSchema,
        ...(options.referenceInput ? {referenceInput:options.referenceInput} : {})};
      if (binding) {
        if (binding.model !== p.selected.model || binding.effort !== p.selected.effort || binding.requestHash !== expected)
          throw Error('Original receipt binding differs from exact full-task input; no substitute observation');
        if (typeof adapter.recoverOriginal !== 'function') throw Error('Original receipt observer unavailable; unknown call not repeated');
        return (await adapter.recoverOriginal({...request,binding})).spec;
      }
      const output = await adapter.generate({...request,onProviderBinding:async value => {
        if (value.model !== p.selected.model || value.effort !== p.selected.effort || value.requestHash !== expected)
          throw Error('Actual full-task provider input differs from original model/schema/pixels');
        if (value.turnId === null) await recheck(true);
        await options.onProviderBinding(value);
      }});
      return output.spec;
    };
    const rules = await fs.readFile(new URL('../prompts/scene-v1.md',import.meta.url),'utf8');
    const result = await runDurableAssembly({directory,requestHash:p.preparationHash,runtimeHash:p.runtimeHash,
      policy:original.reference.preparation.policy,prompt:original.reference.preparation.generation.prompt,rules,
      referenceInput,worldContext:original.worldContext,signal,onStage,onRecovery,nativeEvidence,
      invoke:(prompt,index,options) => invoke(prompt,index,options),
      recoverInvocation:(prompt,index,options,binding) => invoke(prompt,index,options,binding)});
    await recheck(false);
    if (result.summary.sourceHash !== hash(result.scene) || result.summary.finalTextReviewCurrent !== true
      || result.summary.visualReviewCurrent !== true || result.summary.designQuality?.nativeMaterialReview !== true)
      throw Error('Current complete native review required; intermediate/old-image task cannot publish a joint patch');
    const final = await compileFinal(directory,result.scene,original.reference.preparation.policy,signal);
    if (final.compiled.manifest.scene?.sourceHash !== result.summary.sourceHash) throw Error('Final original SceneSpec/native source differs');
    const baseline = path.resolve(result.summary.lastAcceptedDirectory);
    if (!baseline.startsWith(directory+path.sep)) throw Error('Final reviewed diagnostic source outside original job');
    const diagnostic = JSON.parse(await safeEvidenceFile(baseline,'manifest.json',1048576));
    const diagnosticCells = await safeEvidenceFile(baseline,'cells.bin',16*1024**2);
    if (diagnostic.scene?.sourceHash !== result.summary.sourceHash || hash(diagnosticCells) !== diagnostic.cellsHash
      || diagnostic.cellsHash !== final.compiled.manifest.cellsHash || !diagnosticCells.equals(final.compiled.binary))
      throw Error('Final native cells differ from original reviewed geometry; no substitute/rebase');
    const lowered = compileAssemblyWorldPatch(original.worldContext,final.compiled,{signal});
    return {...result,...lowered,finalDirectory:final.directory,
      joint:{version:2,preparationHash:p.preparationHash,maximumCalls:p.maximumCalls,reservedCalls:result.records.length,
        sharedPipeline:true,originalScopeAndNativeCellsVerified:true,realImageUnderstandingVerified:false,
        worldWrites:0,canAuthorizePlacement:false}};
  } finally {active.delete(directory);}
}
