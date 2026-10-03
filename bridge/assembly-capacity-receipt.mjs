import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../src/generation/compiler.mjs';
import {assemblyInvocationFingerprint} from './assembly-invocation.mjs';
import {codexRequestFingerprint,checkCodexBinding} from './codex-persistent-receipt.mjs';
import {codexTerminalFailure} from './codex-terminal-failure.mjs';
import {safeEvidenceFile,validateModelImageFiles} from './native-evidence.mjs';
import {readJobReferenceInput} from './reference-generation-binding.mjs';

const digest=/^[a-f0-9]{64}$/;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const check=(ok,message)=>{if(!ok)throw Error('Capacity receipt verification: '+message);};
const same=(actual,expected,message)=>check(hash(actual)===hash(expected),message);
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const json=async(root,file,limit=65536)=>JSON.parse((await safeEvidenceFile(root,file,limit)).toString('utf8'));
async function envelope(root,file){
  const data=await json(root,file,16*1024*1024);
  check(plain(data)&&plain(data.value)&&digest.test(data.sha256)&&hash(data.value)===data.sha256,'journal envelope identity');
  return data.value;
}
async function physical(directory){
  const resolved=path.resolve(directory),stat=await fs.lstat(resolved);
  check(stat.isDirectory()&&!stat.isSymbolicLink()&&await fs.realpath(resolved)===resolved,'redirected evidence directory');
  return resolved;
}
function classification(error){
  const d=error?.diagnostic;
  if(!plain(d)||d.provider!=='codex'||d.reason!=='failed'||d.failureKind!=='model-capacity')return null;
  const expected=codexTerminalFailure({turn:{status:d.reason,error:{message:error.message}},answer:'',
    outputObserved:d.providerFailure?.outputObserved,completionSource:d.completionSource});
  if(!expected||hash(expected)!==hash(d.providerFailure)||d.automaticRetries!==0||d.json!==null||
    d.receivedTextBytes!==0||d.receivedTextSha256!==hash(''))return null;
  return expected;
}

/** Read-only prerequisite, NOT retry authority. The caller supplies the exact
 * original invocation and immutable outer job identity. Ordinary/unknown errors
 * return null; a capacity-looking receipt with broken evidence fails closed.
 * No writes, receipt recovery, provider dispatch, budget refund or world access.
 * Old jobs can be inspected, but this function cannot change their policies. */
export async function verifyAssemblyCapacityReceipt({directory,index,prompt,options,requestHash,policy,runtimeHash,error,model,effort}){
  const failure=classification(error);if(!failure)return null;
  const maximumCalls=policy?.assembly?.maximumCalls,d=error.diagnostic;
  check(Number.isSafeInteger(maximumCalls)&&maximumCalls>=1&&maximumCalls<=26&&
    Number.isSafeInteger(index)&&index>=1&&index<=maximumCalls&&digest.test(requestHash)&&digest.test(runtimeHash)&&
    typeof prompt==='string'&&prompt.length>0&&typeof model==='string'&&model.length>0&&typeof effort==='string'&&effort.length>0&&
    plain(options)&&plain(options.outputSchema)&&typeof options.stageName==='string'&&options.stageName.length>0&&
    options.stageCount===maximumCalls&&Array.isArray(options.images??[]),'original invocation required');
  const root=await physical(directory),journal=await physical(path.join(root,'assembly-journal'));
  const identity=await envelope(root,'assembly-journal/identity.json');
  same(identity,{version:1,requestHash,policyHash:hash(policy),runtimeHash,maximumCalls},'original job, policy, runtime or call limit changed');
  const names=(await fs.readdir(journal)).filter(n=>/^call-\d+\.json$/.test(n)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
  check(names.length>=index&&names.length<=maximumCalls,'reserved call count');
  const calls=[];
  for(const [i,name] of names.entries()){
    const saved=await envelope(root,'assembly-journal/'+name);
    check(name===`call-${i+1}.json`&&saved.index===i+1&&digest.test(saved.fingerprint)&&
      ['pending','response','error'].includes(saved.state)&&iso(saved.reservedAt),'call order, state or reservation');
    calls.push(saved);
  }
  const dispatched=await envelope(root,'assembly-journal/dispatched.json');
  check(Number.isSafeInteger(dispatched.count)&&dispatched.count>=index&&dispatched.count<=calls.length&&
    calls.length<=dispatched.count+1&&(calls.length===dispatched.count||calls.at(-1).state==='pending'),'dispatched ledger');
  const call=calls[index-1];
  check(call.state==='error'&&plain(call.error)&&call.error.completedFormat===undefined&&
    call.error.parseFacts===undefined&&call.error.responseText===undefined,'original error receipt required');
  same(call.error,{message:error.message,diagnostic:d},'error and saved diagnostic differ');

  // Never trust attachment paths from an error. Read only the original, caller-
  // supplied job-owned invocation after its native/reference allowlist checks.
  let images=options.images??[],referenceBindingHash;
  if(options.referenceInput!==undefined){
    check(images.length===0,'reference/native attachments mixed');
    const reference=await readJobReferenceInput({directory:root,input:options.referenceInput,model,runtimeHash});
    check(reference.binding.policyHash===hash(policy),'reference policy differs from original job');
    images=reference.images;referenceBindingHash=reference.binding.bindingHash;
  }else await validateModelImageFiles(images,root);
  const imageHashes=[];
  for(const file of images){
    check(typeof file==='string'&&path.isAbsolute(file),'absolute job image required');
    imageHashes.push(hash(await safeEvidenceFile(root,path.relative(root,file),32*1024*1024)));
  }
  const invocationFingerprint=assemblyInvocationFingerprint({prompt,index,outputSchema:options.outputSchema,
    stageName:options.stageName,stageCount:options.stageCount,referenceInput:options.referenceInput,
    imageHashes:options.referenceInput!==undefined?[]:imageHashes});
  check(call.fingerprint===invocationFingerprint,'prompt, schema, stage, images or reference input changed');
  const providerRequestHash=codexRequestFingerprint({prompt,model,effort,outputSchema:options.outputSchema,imageHashes,referenceBindingHash});
  const binding=call.providerBinding;
  const turn=checkCodexBinding(binding,providerRequestHash);
  same(binding,{version:1,provider:'codex',storage:'persistent-single-turn',model,effort,
    requestHash:providerRequestHash,...turn},'provider model, effort or binding changed');
  check(d.threadId===turn.threadId&&d.turnId===turn.turnId&&d.requestHash===providerRequestHash,'diagnostic is not for the original turn');

  const evidence=d.responseEvidence;
  check(plain(evidence)&&evidence.persisted===true&&typeof evidence.directory==='string'&&
    /^codex-response-[\w-]{1,96}$/.test(evidence.directory)&&evidence.file==='answer-1.txt','private persisted evidence path');
  const prefix=evidence.directory+'/',answer=await safeEvidenceFile(root,prefix+evidence.file,2*1024*1024);
  check(answer.length===0&&hash(answer)===d.receivedTextSha256,'capacity turn has output');
  same(await json(root,prefix+'receipt.json'),d,'private receipt differs from journal diagnostic');
  const request=await json(root,prefix+'request.json');
  check(plain(request)&&iso(request.createdAt)&&(request.recoveredOriginal===undefined||request.recoveredOriginal===true),'provider request metadata');
  const recovered=request.recoveredOriginal===true;
  same(request,{version:1,provider:'codex',model,effort,requestHash:providerRequestHash,createdAt:request.createdAt,
    ...(recovered?{recoveredOriginal:true}:{})},'provider request identity');
  const thread=await json(root,prefix+'thread.json'),savedTurn=await json(root,prefix+'turn.json');
  if(recovered){
    check(d.completionSource==='stored-original-turn','recovered receipt must come from closed original history');
    same(thread,{threadId:turn.threadId,storage:binding.storage},'recovered original thread');
    same(savedTurn,turn,'recovered original turn');
  }else{
    check(plain(thread)&&iso(thread.createdAt)&&plain(savedTurn)&&iso(savedTurn.startedAt),'original thread/turn metadata');
    same(thread,{...binding,turnId:null,createdAt:thread.createdAt},'original persistent thread');
    same(savedTurn,{...turn,startedAt:savedTurn.startedAt},'acknowledged original turn');
  }
  const proof={version:1,kind:'verified-empty-codex-capacity',index,requestHash,policyHash:hash(policy),runtimeHash,
    maximumCalls,reservedCalls:calls.length,dispatchedCalls:dispatched.count,invocationFingerprint,
    providerRequestHash,threadId:turn.threadId,turnId:turn.turnId,model,effort,closureSource:failure.closureSource,
    diagnosticHash:hash(d),journalReceiptHash:hash(call),answerSha256:hash(answer),imageHashes,
    ...(referenceBindingHash!==undefined?{referenceBindingHash}:{}),
    originalReceiptVerified:true,outputObserved:false,additionalModelCalls:0,canAuthorizeRetry:false,canAuthorizePlacement:false};
  return {...proof,proofHash:hash(proof)};
}
