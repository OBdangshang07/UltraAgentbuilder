import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../src/generation/compiler.mjs';
import {assemblyRuntimeIdentity,runDurableAssembly} from './assembly-durability.mjs';
import {codexRequestFingerprint} from './codex-persistent-receipt.mjs';
import {validateCoupledAssemblyReferenceInput} from './coupled-reference-world-assembly-input.mjs';
import {readFrozenCoupledReferenceWorldAssembly} from './coupled-reference-world-assembly-preparation.mjs';
import {claimCoupledReferenceAssemblyRun,readCoupledReferenceAssemblyRunClaim} from './coupled-reference-world-assembly-run-claim.mjs';
import {selectedReferenceAssemblyAdapter,compileReferenceAssemblyFinal} from './reference-world-assembly.mjs';
import {COUPLED_REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY,COUPLED_REFERENCE_ASSEMBLY_CANDIDATE_CLAIM,
  saveCoupledReferenceAssemblyCandidate,readCoupledReferenceAssemblyCandidateData} from './coupled-reference-world-assembly-candidate.mjs';
import {beginCoupledReferenceWorldAssemblyExecution,checkCoupledReferenceWorldAssemblyExecution,finishCoupledReferenceWorldAssemblyExecution} from './coupled-reference-world-assembly-execution.mjs';

const active=new Set();
/** Actual shared component-generation/native-review pipeline under an explicit
 * new coupled SEND. A registered path requires its independent live execution;
 * the unregistered engineering path cannot borrow copied owner records. This
 * is not an HTTP/client/native server lease or player placement permission. */
export async function runCoupledReferenceWorldAssembly({directory,referenceInput,preparationHash,adapter,nativeEvidence,signal,onStage,onRecovery,onLocalPhase=()=>{},execution=null}){
  validateCoupledAssemblyReferenceInput(referenceInput);directory=await fs.realpath(path.resolve(directory));
  if(active.has(directory))throw Error('Original coupled full task already running');
  active.add(directory);
  try{
    if(!(signal instanceof AbortSignal)||typeof onStage!=='function'||typeof nativeEvidence!=='function'||typeof onLocalPhase!=='function')throw Error('Original coupled task signal/stage/native renderer required');
    signal.throwIfAborted();onLocalPhase('source-validation');
    const original=await readFrozenCoupledReferenceWorldAssembly({directory,referenceInput}),p=original.prepared;
    if(preparationHash!==p.preparationHash)throw Error('Exact independent coupled preparation required');
    const registered=path.basename(path.dirname(directory))==='coupled-reference-world-assembly-jobs';
    if(registered!==(execution!==null))throw Error('Registered coupled task requires its exact live original execution; no disk adoption');
    if(registered)await beginCoupledReferenceWorldAssemblyExecution({execution,directory,prepared:p,signal});
    // Any previous execution, legacy lane or partial publication stays intact.
    // This entry cannot replay a pending/failed task or rebase it on a new world.
    for(const name of ['reference-world-assembly-v2','reference-world-assembly-candidate-v2','assembly-journal',COUPLED_REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY,COUPLED_REFERENCE_ASSEMBLY_CANDIDATE_CLAIM]){
      try{await fs.lstat(path.join(directory,name));throw Error('Existing original/legacy execution retained; no coupled task restart or adoption');}
      catch(e){if(e.code!=='ENOENT')throw e;}
    }
    if(!registered)for(const name of ['_owner.json','request.json','original-dispatch.json','original-execution-start.json']){
      try{await fs.lstat(path.join(directory,name));throw Error('Registered ownership records cannot become an unregistered internal task');}
      catch(e){if(e.code!=='ENOENT')throw e;}
    }
    onLocalPhase('runtime-validation');
    if(await assemblyRuntimeIdentity()!==p.runtimeHash)throw Error('Original coupled runtime changed before start');
    await selectedReferenceAssemblyAdapter(adapter,p);signal.throwIfAborted();
    await claimCoupledReferenceAssemblyRun({directory,original});
    async function recheck(freshCall,index){
      signal.throwIfAborted();const current=await readFrozenCoupledReferenceWorldAssembly({directory,referenceInput});
      if(hash(current.prepared)!==hash(p)||await assemblyRuntimeIdentity()!==p.runtimeHash)throw Error('Original coupled scope/policy/runtime changed; no replacement');
      await readCoupledReferenceAssemblyRunClaim({directory,original:current});
      if(registered)await checkCoupledReferenceWorldAssemblyExecution({execution,directory,prepared:p,freshCall,index});
      if(freshCall)await selectedReferenceAssemblyAdapter(adapter,p);
      signal.throwIfAborted();return current;
    }
    async function invoke(prompt,index,options,binding){
      const current=await recheck(!binding,index);
      if(options.referenceInput&&hash(options.referenceInput)!==hash(current.reference.input))throw Error('Original coupled image input changed');
      const imageHashes=options.referenceInput?current.reference.manifest.references.map(r=>r.sha256):await Promise.all((options.images??[]).map(async f=>hash(await fs.readFile(f))));
      const expected=codexRequestFingerprint({prompt,model:p.selected.model,effort:p.selected.effort,outputSchema:options.outputSchema,imageHashes,
        ...(options.referenceInput?{referenceBindingHash:current.reference.binding.bindingHash}:{})});
      const request={prompt,model:p.selected.model,effort:p.selected.effort,cwd:directory,signal,images:options.images??[],outputSchema:options.outputSchema,
        ...(options.referenceInput?{referenceInput:options.referenceInput}:{})};
      if(binding){
        if(binding.model!==p.selected.model||binding.effort!==p.selected.effort||binding.requestHash!==expected||typeof adapter.recoverOriginal!=='function')throw Error('Exact original coupled provider receipt required; no resend');
        return (await adapter.recoverOriginal({...request,binding})).spec;
      }
      return (await adapter.generate({...request,onProviderBinding:async value=>{
        if(value.model!==p.selected.model||value.effort!==p.selected.effort||value.requestHash!==expected)throw Error('Actual coupled model/schema/pixels differ');
        if(value.turnId===null)await recheck(true,index);await options.onProviderBinding(value);
      }})).spec;
    }
    const rules=await fs.readFile(new URL('../prompts/scene-v1.md',import.meta.url),'utf8');onLocalPhase('generation');
    const result=await runDurableAssembly({directory,requestHash:p.preparationHash,runtimeHash:p.runtimeHash,model:p.selected.model,effort:p.selected.effort,
      policy:original.reference.preparation.policy,prompt:original.reference.preparation.generation.prompt,rules,referenceInput,
      worldContext:original.worldContext,signal,onStage,onRecovery,nativeEvidence,
      invoke:(prompt,index,options)=>invoke(prompt,index,options),recoverInvocation:(prompt,index,options,binding)=>invoke(prompt,index,options,binding)});
    await recheck(false);
    if(result.summary.sourceHash!==hash(result.scene)||result.summary.finalTextReviewCurrent!==true||result.summary.visualReviewCurrent!==true||result.summary.designQuality?.nativeMaterialReview!==true)throw Error('Current complete native review required for coupled result');
    onLocalPhase('final-native-compile');
    await compileReferenceAssemblyFinal(directory,result.scene,original.reference.preparation.policy,signal);
    onLocalPhase('candidate-publication');
    const saved=await saveCoupledReferenceAssemblyCandidate({directory,original,result,signal});
    return {...result,...saved,joint:{version:1,purpose:'coupled-reference-world-assembly',sharedPipeline:true,
      maximumCalls:p.maximumCalls,reservedCalls:result.records.length,originalRegistryVerified:false,canAuthorizePlacement:false,worldWrites:0}};
  }finally{if(execution!==null)finishCoupledReferenceWorldAssemblyExecution(execution);active.delete(directory);}
}

/** All original ledger/pixels/render/native/member checks run again. No model,
 * compile, recovery, registry ownership or world permission is acquired. */
export async function readCoupledReferenceWorldAssemblyCandidate({directory,referenceInput,preparationHash,candidateHash,signal,partIndex=null}){
  validateCoupledAssemblyReferenceInput(referenceInput);directory=path.resolve(directory);
  const original=await readFrozenCoupledReferenceWorldAssembly({directory,referenceInput});
  if(original.prepared.preparationHash!==preparationHash)throw Error('Exact original coupled preparation required for readonly result');
  return readCoupledReferenceAssemblyCandidateData({directory,original,expectedCandidateHash:candidateHash,signal,partIndex});
}
