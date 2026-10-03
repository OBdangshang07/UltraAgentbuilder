import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {hash} from '../src/generation/compiler.mjs';
import {CompletedResponseFormatError} from './model-json.mjs';
import {runSceneAssembly} from './scene-assembly.mjs';
import {assemblyInvocationFingerprint} from './assembly-invocation.mjs';
import {createAssemblyProviderRecovery} from './assembly-provider-recovery.mjs';

// A write-ahead invocation ledger, not a retry queue. A pending invocation is
// ambiguous and must NEVER be sent again. Replay only a saved, hashed receipt.
export async function durableJson(file,value){
  const temp=file+'.'+randomUUID()+'.tmp',handle=await fs.open(temp,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(value));await handle.sync();}finally{await handle.close();}
  await replaceSyncedJournalFile(temp,file);
}
// Windows readers/AV can briefly deny replacing a complete, synced receipt.
// Retry ONLY this local rename, never serialization, reservation or a provider
// invocation. Keep the original pending receipt and temp on permanent failure.
export async function replaceSyncedJournalFile(temp,file,{rename=fs.rename,wait=delay}={}){
  if(path.dirname(temp)!==path.dirname(file)||!temp.startsWith(file+'.')||!temp.endsWith('.tmp'))throw new Error('Invalid same-directory journal replacement');
  for(let attempt=0;;attempt++){
    try{await rename(temp,file);return;}
    catch(error){
      if(!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt>=7)throw error;
      const source=await fs.lstat(temp);
      if(!source.isFile()||source.isSymbolicLink())throw new Error('Journal replacement source changed; preserved');
      try{const target=await fs.lstat(file);if(!target.isFile()||target.isSymbolicLink())throw new Error('Journal replacement target changed; preserved');}
      catch(check){if(check.code!=='ENOENT')throw check;}
      await wait(Math.min(25*2**attempt,250));
    }
  }
}
export async function readRecoveryJson(file){
  const stat=await fs.lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)throw new Error('Unsafe recovery evidence');
  return JSON.parse(await fs.readFile(file,'utf8'));
}
// The root override is for isolated identity fixtures. Production always uses
// this module's bundled runtime, never a caller-supplied HTTP path.
export async function assemblyRuntimeIdentity(root=new URL('../',import.meta.url)){
  const files=[];
  async function visit(relative){
    for(const item of (await fs.readdir(new URL(relative+'/',root),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      const name=relative+'/'+item.name;
      if(item.isSymbolicLink())throw new Error('Runtime identity excludes links');
      if(item.isDirectory())await visit(name);
      else if(item.isFile())files.push([name,hash(await fs.readFile(new URL(name,root)))]);
    }
  }
  for(const dir of ['bridge','contracts','src/core','src/design','src/generation','src/world','prompts'])await visit(dir);
  return hash({version:2,node:process.versions.node,files});
}
const identity=value=>({value,sha256:hash(value)});
async function readChecked(file){const envelope=await readRecoveryJson(file);if(hash(envelope.value)!==envelope.sha256)throw new Error('Recovery evidence hash mismatch');return envelope.value;}

export async function openAssemblyJournal({directory,requestHash,policy,runtimeHash}){
  const root=path.join(directory,'assembly-journal');await fs.mkdir(root,{recursive:true});
  if((await fs.lstat(root)).isSymbolicLink())throw new Error('Recovery directory link forbidden');
  const meta={version:1,requestHash,policyHash:hash(policy),runtimeHash,maximumCalls:policy.assembly.maximumCalls};
  const metaFile=path.join(root,'identity.json');
  try{if(hash(await readChecked(metaFile))!==hash(meta))throw new Error('Recovery request, budget or runtime changed; no model called');}
  catch(e){
    if(e.code!=='ENOENT')throw e;
    if((await fs.readdir(root)).some(n=>n==='dispatched.json'||/^call-\d+\.json$/.test(n)))throw new Error('Recovery identity missing; original ledger cannot be rebound');
    await durableJson(metaFile,identity(meta));
  }
  const names=(await fs.readdir(root)).filter(n=>/^call-\d+\.json$/.test(n)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
  const records=[];
  for(const [i,name] of names.entries()){
    const record=await readChecked(path.join(root,name));
    if(name!==`call-${i+1}.json`||record.index!==i+1||i>=meta.maximumCalls||!['pending','response','error'].includes(record.state))throw new Error('Invalid recovery call ledger');
    records.push(record);
  }
  let dispatched=0;
  try{dispatched=(await readChecked(path.join(root,'dispatched.json'))).count;}
  catch(e){if(e.code!=='ENOENT')throw e;}
  if(!Number.isSafeInteger(dispatched)||dispatched<0||dispatched>records.length||records.length>dispatched+1||records.length>dispatched&&records.at(-1).state!=='pending')throw new Error('Recovery dispatched ledger missing/truncated');
  let busy=false;
  return {get reserved(){return records.length;},peek:index=>structuredClone(records[index-1]??null),
    snapshot:()=>structuredClone(records),async invoke(prompt,index,options,invoke,recoverInvocation,validateProviderRetry){
    if(busy)throw new Error('Concurrent assembly invocation forbidden');busy=true;
    try{
      const images=[];for(const file of options.images??[])images.push(hash(await fs.readFile(file)));
      const fingerprint=assemblyInvocationFingerprint({prompt,index,outputSchema:options.outputSchema,
        stageName:options.stageName,stageCount:options.stageCount,imageHashes:images,referenceInput:options.referenceInput});
      const saved=records[index-1];
      let recovering=false;
      if(options.providerRetry!==undefined||saved?.providerRetry!==undefined){
        if(typeof validateProviderRetry!=='function'||saved&&hash(saved.providerRetry??null)!==hash(options.providerRetry??null))
          throw Error('Recovery invocation lacks verified original capacity authority');
        await validateProviderRetry({prompt,index,options,saved:saved?structuredClone(saved):null});
      }
      if(saved){
        if(saved.fingerprint!==fingerprint)throw new Error('Recovery replay diverged from saved input; no model called');
        if(saved.state==='pending'){
          if(saved.providerBinding?.provider!=='codex'||saved.providerBinding.storage!=='persistent-single-turn'||!saved.providerBinding.turnId||!recoverInvocation)throw new Error('Recovery stopped: provider receipt unknown; reserved call is not repeated');
          recovering=true;
        }
        if(saved.state==='response')return structuredClone(saved.response);
        if(saved.state==='error'){
          const e=saved.error,err=e.completedFormat?new CompletedResponseFormatError({facts:e.parseFacts},'Saved response'):new Error(e.message);
          err.message=e.message;err.diagnostic=e.diagnostic;
          if(e.completedFormat)Object.defineProperty(err,'responseText',{value:e.responseText});
          throw err;
        }
      }
      if(!recovering&&(index!==records.length+1||index>meta.maximumCalls))throw new Error('Recovery call budget/order violated');
      const file=path.join(root,`call-${index}.json`);let record=saved??{index,fingerprint,state:'pending',reservedAt:new Date().toISOString(),
        ...(options.providerRetry!==undefined?{providerRetry:structuredClone(options.providerRetry)}:{})};
      if(!recovering){
        await durableJson(file,identity(record));records.push(record);
        await durableJson(path.join(root,'dispatched.json'),identity({count:index}));
      }
      const onProviderBinding=async binding=>{
        if(binding?.version!==1||binding.provider!=='codex'||binding.storage!=='persistent-single-turn'||!/^[-\w]{1,128}$/.test(binding.threadId??'')||
          binding.turnId!==null&&!/^[-\w]{1,128}$/.test(binding.turnId??'')||typeof binding.model!=='string'||typeof binding.effort!=='string'||!/^([a-f0-9]{64})$/.test(binding.requestHash??''))throw Error('Invalid provider receipt binding');
        const old=record.providerBinding;
        if(old&&(old.threadId!==binding.threadId||old.requestHash!==binding.requestHash||old.model!==binding.model||old.effort!==binding.effort||old.turnId&&old.turnId!==binding.turnId))throw Error('Original provider receipt cannot be rebound');
        const clean={version:1,provider:'codex',storage:'persistent-single-turn',threadId:binding.threadId,turnId:binding.turnId,requestHash:binding.requestHash,model:binding.model,effort:binding.effort};
        record={...record,providerBinding:clean};await durableJson(file,identity(record));records[index-1]=record;
      };
      let response;
      try{response=recovering?await recoverInvocation(prompt,index,options,structuredClone(saved.providerBinding)):await invoke(prompt,index,{...options,onProviderBinding});}
      catch(error){
        // A bound unknown outcome stays pending, allowing ONLY a read of the
        // same persisted receipt after restart. Never invoke the provider again.
        if(record.providerBinding&&!['completed','failed','interrupted','aborted','not-submitted'].includes(error.diagnostic?.reason))throw error;
        const completedFormat=error instanceof CompletedResponseFormatError;
        const receipt={...record,state:'error',error:{message:error.message,diagnostic:error.diagnostic??null,...(completedFormat?{completedFormat:true,parseFacts:error.parseFacts,responseText:error.responseText}: {})}};
        await durableJson(file,identity(receipt));records[index-1]=receipt;throw error;
      }
      // Keep 'pending' on any receipt persistence failure: absence of a receipt
      // is never evidence that the provider did not run or charge.
      const receipt={...record,state:'response',response};await durableJson(file,identity(receipt));records[index-1]=receipt;
      return structuredClone(response);
    }finally{busy=false;}
  }};
}

export async function runDurableAssembly(options){
  const {directory,requestHash,runtimeHash,policy,invoke,onStage,onRecovery=async()=>{},signal}=options;
  const journal=await openAssemblyJournal({directory,requestHash,runtimeHash,policy});
  for(let attempt=0;;attempt++){
    signal.throwIfAborted();
    // Rebuild deterministic local checks in a fresh evidence branch; neither
    // original responses nor half-written checkpoints are overwritten.
    const branch=await fs.mkdtemp(path.join(directory,'assembly-run-'));
    const providerRecovery=createAssemblyProviderRecovery({...options,journal});
    await onRecovery({version:1,state:journal.reserved?'replaying':'running',branch:path.basename(branch),reservedCalls:journal.reserved});
    try{
      const result=await runSceneAssembly({...options,directory:branch,responseDirectory:directory,providerRecovery,
        invoke:(p,i,o)=>journal.invoke(p,i,o,invoke,options.recoverInvocation,providerRecovery?.beforeInvocation),
        onStage:r=>onStage(r,{reservedCalls:Math.max(journal.reserved,r.length),replaying:r.length<journal.reserved})});
      await onRecovery({version:1,state:'complete',branch:path.basename(branch),reservedCalls:journal.reserved});return result;
    }catch(e){
      // Only known transient LOCAL I/O is retried. The journal prevents any
      // previously dispatched invocation from being resent on this path.
      if(signal.aborted||attempt>=2||!['EBUSY','EPERM','EAGAIN','EMFILE'].includes(e.code))throw e;
      await onRecovery({version:1,state:'local-retry',reservedCalls:journal.reserved,localAttempt:attempt+1});
      await delay(100*(attempt+1),undefined,{signal});
    }
  }
}
