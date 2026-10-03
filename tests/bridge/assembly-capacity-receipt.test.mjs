import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {hash} from '../../src/generation/compiler.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {openAssemblyJournal} from '../../bridge/assembly-durability.mjs';
import {assemblyInvocationFingerprint} from '../../bridge/assembly-invocation.mjs';
import {codexRequestHash,codexRequestFingerprint} from '../../bridge/codex-persistent-receipt.mjs';
import {CodexAdapter} from '../../bridge/codex-adapter.mjs';
import {verifyAssemblyCapacityReceipt} from '../../bridge/assembly-capacity-receipt.mjs';
import {saveReviewImages} from '../../bridge/visual-review.mjs';
import {fixturePng} from './native-evidence-fixtures.mjs';
import {referenceFixture} from './reference-generation-fixture.mjs';
import {readJobReferenceInput} from '../../bridge/reference-generation-binding.mjs';

const capacityMessage='Selected model is at capacity. Please try a different model.';
const model='gpt-6.1-sol',effort='max';
const request={key:'capacity-fixture',agent:'codex',model,effort,prompt:'Synthetic full-scale office task',
  generationMode:'scene',sceneWorkflow:'components',qualityTier:'ultra',assemblyRecovery:'safe',assemblyConfirmed:true};

// The actual adapter and actual write-ahead journal produce the receipts.
// Only transport is mocked; no model, reasoning data or world is accessed.
async function setup(t,{closure='notification',imageCount=0,referenceCount=0,index=1,output='',commentary=false}={}){
  let directory,policy,runtimeHash,requestHash,referenceInput;
  if(referenceCount){
    const f=await referenceFixture(t,{version:2,images:referenceCount,generationOverrides:{qualityTier:'ultra'}});
    await f.confirm();referenceInput=await f.bind();directory=f.jobDirectory;policy=f.preparation.policy;
    runtimeHash=f.runtimeHash;requestHash=f.preparation.requestHash;
  }else{
    directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'voxel-capacity-proof-')));
    t.after(()=>fs.rm(directory,{recursive:true,force:true}));
    policy=generationPreflight(request);runtimeHash=hash('Synthetic immutable runtime');requestHash=hash(request);
  }
  const images=imageCount?await saveReviewImages(Array(imageCount).fill(fixturePng()),directory):[];
  const prompt='Synthetic original stage input',options={outputSchema:{type:'object',properties:{ok:{type:'boolean'}}},
    stageName:referenceCount?'reference-analysis':'plan',stageCount:policy.assembly.maximumCalls,images,
    ...(referenceInput?{referenceInput}:{})};
  const adapter=new CodexAdapter({observationIntervalMs:5}),requests=[];
  adapter.connect=async()=>{};
  adapter.models=async()=>[{id:model,supportsImages:true,efforts:[{reasoningEffort:effort}],defaultEffort:effort}];
  const items=[...(commentary?[{type:'agentMessage',phase:'commentary',text:'PRIVATE COMMENTARY'}]:[]),
    ...(output?[{type:'agentMessage',phase:'final_answer',text:output}]:[])];
  adapter.readStoredTurn=async()=>({thread:{id:'synthetic-thread',ephemeral:false,turns:[{id:'synthetic-turn',status:'failed',
    startedAt:1,completedAt:2,itemsView:'full',error:{message:capacityMessage,codexErrorInfo:'PRIVATE',additionalDetails:'PRIVATE'},
    items:[{type:'userMessage',content:[{type:'text',text:prompt}]},{type:'reasoning',text:'PRIVATE REASONING'},...items]}]}});
  adapter.request=async(method,params)=>{
    requests.push({method,params});
    if(method==='config/read')return {config:{}};
    if(method==='thread/start')return {thread:{id:'synthetic-thread',ephemeral:false}};
    if(method==='thread/unsubscribe')return {};
    assert.equal(method,'turn/start');
    if(closure==='notification')setImmediate(()=>adapter.emit('notification',{method:'turn/completed',params:{threadId:'synthetic-thread',
      turn:{id:'synthetic-turn',status:'failed',error:{message:capacityMessage,codexErrorInfo:'PRIVATE',additionalDetails:'PRIVATE'},items}}}));
    return {turn:{id:'synthetic-turn',status:'inProgress'}};
  };
  const journalArgs={directory,policy,requestHash,runtimeHash},journal=await openAssemblyJournal(journalArgs);
  for(let i=1;i<index;i++)await journal.invoke('Synthetic earlier stage '+i,i,options,async()=>({ok:true}));
  let error;
  await assert.rejects(journal.invoke(prompt,index,options,async(p,i,o)=>{
    const generated=await adapter.generate({prompt:p,model,effort,cwd:directory,outputSchema:o.outputSchema,
      images:o.images,referenceInput:o.referenceInput,onProviderBinding:o.onProviderBinding});
    return generated.spec;
  }),e=>{error=e;return e.message===capacityMessage;});
  const args={directory,index,prompt,options,requestHash,policy,runtimeHash,error,model,effort};
  return {args,requests,journalArgs,error,directory,verify:changes=>verifyAssemblyCapacityReceipt({...args,...changes})};
}

async function inventory(directory){
  const files=[];
  async function visit(root,prefix=''){
    for(const item of (await fs.readdir(root,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      const name=prefix+item.name,file=path.join(root,item.name);
      if(item.isDirectory())await visit(file,name+'/');else files.push([name,hash(await fs.readFile(file))]);
    }
  }
  await visit(directory);return files;
}
async function changedFile(h,relative,change,check,{rehash=false}={}){
  const file=path.join(h.directory,relative),bytes=await fs.readFile(file),value=JSON.parse(bytes);
  change(value);if(rehash)value.sha256=hash(value.value);
  await fs.writeFile(file,JSON.stringify(value));
  try{await check();}finally{await fs.writeFile(file,bytes);}
}

for(const closure of ['notification','stored-original-turn'])test('verifies exact closed '+closure+' receipt without changing evidence or submitting another turn',async t=>{
  const h=await setup(t,{closure,index:13}),before=await inventory(h.directory),proof=await h.verify();
  const {proofHash,...content}=proof;assert.equal(proofHash,hash(content));
  assert.equal(proof.kind,'verified-empty-codex-capacity');assert.equal(proof.index,13);
  assert.equal(proof.maximumCalls,26);assert.equal(proof.reservedCalls,13);assert.equal(proof.dispatchedCalls,13);
  assert.equal(proof.closureSource,closure==='notification'?'original-turn-completed-event':'closed-original-full-history');
  assert.equal(proof.canAuthorizeRetry,false);assert.equal(proof.canAuthorizePlacement,false);assert.equal(proof.additionalModelCalls,0);
  assert.equal(proof.answerSha256,hash(''));assert.deepEqual(proof.imageHashes,[]);
  assert.deepEqual(await inventory(h.directory),before);assert.ok(!JSON.stringify(proof).includes('PRIVATE'));
  assert.equal(h.requests.filter(r=>r.method==='turn/start').length,1);
  assert.equal(h.requests.filter(r=>r.method==='thread/start').length,1);
});

test('already-closed error replay preserves the original proof and never recovers or reserves another invocation',async t=>{
  const h=await setup(t),proof=await h.verify(),before=await inventory(h.directory),journal=await openAssemblyJournal(h.journalArgs);
  let replay;
  await assert.rejects(journal.invoke(h.args.prompt,1,h.args.options,async()=>assert.fail('No replacement turn'),
    async()=>assert.fail('Closed error cannot be read as pending')),e=>{replay=e;return e.diagnostic.failureKind==='model-capacity';});
  assert.deepEqual(await h.verify({error:replay}),proof);assert.equal(journal.reserved,1);
  assert.deepEqual(await inventory(h.directory),before);
});

test('a pending original call is recovered read-only, then verified without another provider dispatch or reservation',async t=>{
  const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'voxel-pending-capacity-proof-')));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const args={directory,policy:generationPreflight(request),requestHash:hash(request),runtimeHash:hash('Synthetic original runtime')};
  const prompt='Synthetic pending original input',options={outputSchema:{type:'object'},stageName:'plan',stageCount:26,images:[]};
  const adapter=new CodexAdapter({observationIntervalMs:5}),requests=[];
  adapter.connect=async()=>{};adapter.models=async()=>[{id:model,efforts:[effort],defaultEffort:effort}];
  adapter.readStoredTurn=async()=>{throw Error('Synthetic unavailable observation');};
  adapter.request=async(method,params)=>{
    requests.push({method,params});
    if(method==='config/read')return {config:{}};
    if(method==='thread/start')return {thread:{id:'pending-thread',ephemeral:false}};
    if(method==='turn/start')return {turn:{id:'pending-turn',status:'inProgress'}};
    assert.ok(['thread/unsubscribe','turn/interrupt'].includes(method));return {};
  };
  let journal=await openAssemblyJournal(args);
  await assert.rejects(journal.invoke(prompt,1,options,async(p,i,o)=>adapter.generate({prompt:p,model,effort,cwd:directory,
    outputSchema:o.outputSchema,onProviderBinding:o.onProviderBinding,onEvent:async event=>{
      if(event.turnId)throw Error('Synthetic observer process loss after acknowledged original turn');
    }})),/observer process loss/);
  const file=path.join(directory,'assembly-journal/call-1.json'),pending=JSON.parse(await fs.readFile(file));
  assert.equal(pending.value.state,'pending');assert.equal(pending.value.providerBinding.turnId,'pending-turn');
  adapter.connect=async()=>assert.fail('No writer after restart');adapter.request=async()=>assert.fail('No dispatch or resume');
  adapter.readStoredTurn=async()=>({thread:{id:'pending-thread',ephemeral:false,turns:[{id:'pending-turn',status:'failed',
    startedAt:1,completedAt:2,itemsView:'full',error:{message:capacityMessage},items:[
      {type:'userMessage',content:[{type:'text',text:prompt}]}]}]}});
  let recovered;journal=await openAssemblyJournal(args);
  await assert.rejects(journal.invoke(prompt,1,options,async()=>assert.fail('No replacement generation'),async(p,i,o,binding)=>
    adapter.recoverOriginal({binding,prompt:p,model,effort,outputSchema:o.outputSchema,cwd:directory})),
    e=>{recovered=e;return e.diagnostic.failureKind==='model-capacity';});
  const closed=JSON.parse(await fs.readFile(file));assert.equal(closed.value.state,'error');
  assert.equal(closed.value.reservedAt,pending.value.reservedAt);assert.equal(journal.reserved,1);
  const before=await inventory(directory),proof=await verifyAssemblyCapacityReceipt({...args,index:1,prompt,options,model,effort,error:recovered});
  assert.equal(proof.closureSource,'closed-original-full-history');assert.equal(proof.providerRequestHash,pending.value.providerBinding.requestHash);
  assert.deepEqual(await inventory(directory),before);assert.equal(requests.filter(r=>r.method==='turn/start').length,1);
});

test('partial or commentary output is never accepted as empty capacity, despite an empty retained answer',async t=>{
  for(const options of [{output:'{"partial":'},{output:' '},{commentary:true}]){
    const h=await setup(t,options),before=await inventory(h.directory);
    assert.equal(h.error.diagnostic.failureKind,null);assert.equal(await h.verify(),null);
    assert.deepEqual(await inventory(h.directory),before);assert.equal(h.requests.filter(r=>r.method==='turn/start').length,1);
  }
});

test('ordinary, malformed, transport, cancellation and unclassified capacity errors are not recovery evidence',async t=>{
  const h=await setup(t),before=await inventory(h.directory);
  const variants=[undefined,Error(capacityMessage),{message:capacityMessage,diagnostic:{provider:'codex',reason:'failed'}},
    ...['incomplete','completed','interrupted','aborted','not-submitted'].map(reason=>({message:capacityMessage,
      diagnostic:{...h.error.diagnostic,reason}})),
    ...['provider','answer-json','evidence-storage'].map(failureKind=>({message:capacityMessage,
      diagnostic:{...h.error.diagnostic,failureKind}})),
    ...[' '+capacityMessage,capacityMessage+' ',capacityMessage.toLowerCase(),'Capacity exceeded'].map(message=>({message,diagnostic:h.error.diagnostic})),
    ...[{outputObserved:true},{version:2},{rule:'guessed-capacity-enum'},{closureSource:'summary'},{canRetry:true}].map(change=>({message:capacityMessage,
      diagnostic:{...h.error.diagnostic,providerFailure:{...h.error.diagnostic.providerFailure,...change}}})),
    ...[{automaticRetries:1},{json:{}},{receivedTextBytes:1},{receivedTextSha256:hash(' ')},{provider:'claude'}].map(change=>({message:capacityMessage,
      diagnostic:{...h.error.diagnostic,...change}}))];
  for(const error of variants)assert.equal(await h.verify({error}),null);
  assert.deepEqual(await inventory(h.directory),before);
});

test('confirmed outer job, policy and runtime identity cannot be rebound by a caller or rehashed journal',async t=>{
  const h=await setup(t);
  for(const changes of [{requestHash:hash('foreign')},{runtimeHash:hash('foreign')},{model:'other'},{effort:'low'},
    {index:0},{index:27},{index:1.5},{requestHash:'not-a-digest'},{runtimeHash:'not-a-digest'},
    {policy:{...h.args.policy,assembly:{...h.args.policy.assembly,maximumCalls:25}}}])
    await assert.rejects(h.verify(changes));
  for(const [key,value] of [['requestHash',hash('other')],['policyHash',hash('other')],['runtimeHash',hash('other')],['maximumCalls',25],['version',2]])
    await changedFile(h,'assembly-journal/identity.json',v=>v.value[key]=value,()=>assert.rejects(h.verify()),{rehash:true});
  assert.equal((await h.verify()).originalReceiptVerified,true);
});

test('stage input, schema, prompt and binding are verified against the exact reserved invocation',async t=>{
  const h=await setup(t);
  for(const changes of [{prompt:'Foreign prompt'},{options:{...h.args.options,outputSchema:{type:'object'}}},
    {options:{...h.args.options,stageName:'review'}},{options:{...h.args.options,stageCount:25}}])await assert.rejects(h.verify(changes));
  for(const [key,value] of [['requestHash',hash('other')],['threadId','other-thread'],['turnId','other-turn'],
    ['turnId',null],['model','other-model'],['effort','low'],['storage','ephemeral'],['version',2]])
    await changedFile(h,'assembly-journal/call-1.json',v=>v.value.providerBinding[key]=value,()=>assert.rejects(h.verify()),{rehash:true});
  await changedFile(h,'assembly-journal/call-1.json',v=>v.value.fingerprint=hash('changed'),()=>assert.rejects(h.verify()),{rehash:true});
  await changedFile(h,'assembly-journal/call-1.json',v=>v.value.providerBinding=null,()=>assert.rejects(h.verify()),{rehash:true});
});

test('unrelated option keys cannot replace the original journal prompt or call index',async t=>{
  const h=await setup(t),before=await inventory(h.directory),options={...h.args.options,prompt:'ignored injection',index:25,imageHashes:[hash('ignored')]};
  const original=await h.verify();assert.deepEqual(await h.verify({options}),original);
  const journal=await openAssemblyJournal(h.journalArgs);
  await assert.rejects(journal.invoke(h.args.prompt,1,options,async()=>assert.fail('No dispatch')),e=>e.diagnostic.failureKind==='model-capacity');
  assert.deepEqual(await inventory(h.directory),before);
});

test('journal hashes, reservation order, real dispatch and terminal error receipt cannot be guessed',async t=>{
  const h=await setup(t,{index:2});
  for(const relative of ['assembly-journal/identity.json','assembly-journal/dispatched.json','assembly-journal/call-1.json','assembly-journal/call-2.json'])
    await changedFile(h,relative,v=>v.sha256=hash('wrong'),()=>assert.rejects(h.verify()));
  for(const [key,value] of [['state','pending'],['state','response'],['index',1],['reservedAt','invalid']])
    await changedFile(h,'assembly-journal/call-2.json',v=>v.value[key]=value,()=>assert.rejects(h.verify()),{rehash:true});
  for(const count of [0,1,3,-1,2.5])await changedFile(h,'assembly-journal/dispatched.json',v=>v.value.count=count,()=>assert.rejects(h.verify()),{rehash:true});
  for(const change of [e=>e.message+=' ',e=>e.diagnostic.receivedTextBytes=1,e=>e.completedFormat=true,
    e=>e.parseFacts={},e=>e.responseText=''])
    await changedFile(h,'assembly-journal/call-2.json',v=>change(v.value.error),()=>assert.rejects(h.verify()),{rehash:true});
  const original=path.join(h.directory,'assembly-journal/call-1.json'),moved=original+'.saved';await fs.rename(original,moved);
  try{await assert.rejects(h.verify());}finally{await fs.rename(moved,original);}
  assert.equal((await h.verify()).reservedCalls,2);
});

test('private answer, receipt, request, thread and turn files must match every bound field',async t=>{
  const h=await setup(t),folder=h.error.diagnostic.responseEvidence.directory;
  for(const [name,change] of [
    ['receipt.json',v=>v.requestHash=hash('foreign')],['receipt.json',v=>v.providerFailure.outputObserved=true],
    ['request.json',v=>v.model='foreign'],['request.json',v=>v.effort='low'],['request.json',v=>v.requestHash=hash('foreign')],
    ['request.json',v=>v.version=2],['request.json',v=>v.recoveredOriginal=true],['request.json',v=>v.createdAt='not-a-time'],
    ['request.json',v=>v.extraAuthority=true],['thread.json',v=>v.threadId='foreign'],['thread.json',v=>v.turnId='synthetic-turn'],
    ['thread.json',v=>v.storage='ephemeral'],['thread.json',v=>v.model='foreign'],['thread.json',v=>v.requestHash=hash('foreign')],
    ['turn.json',v=>v.turnId='foreign'],['turn.json',v=>v.threadId='foreign'],['turn.json',v=>v.startedAt=null]
  ])await changedFile(h,folder+'/'+name,change,()=>assert.rejects(h.verify()));
  const answer=path.join(h.directory,folder,'answer-1.txt');
  for(const text of [' ','{"partial":']){
    await fs.writeFile(answer,text);try{await assert.rejects(h.verify(),/has output/);}finally{await fs.writeFile(answer,'');}
  }
  for(const name of ['answer-1.txt','receipt.json','request.json','thread.json','turn.json']){
    const file=path.join(h.directory,folder,name),saved=file+'.saved';await fs.rename(file,saved);
    try{await assert.rejects(h.verify());}finally{await fs.rename(saved,file);}
  }
});

test('diagnostic evidence paths cannot escape the job even when the journal error is rehashed to agree',async t=>{
  const h=await setup(t);
  for(const changes of [{directory:'../foreign'},{directory:'codex-response-../../foreign'},
    {directory:'codex-response-fixture:stream'},{directory:path.resolve(h.directory)},{directory:'claude-response-fixture'},
    {file:'../answer-1.txt'},{file:'answer-2.txt'},{persisted:false}]){
    const error={message:h.error.message,diagnostic:{...h.error.diagnostic,responseEvidence:{...h.error.diagnostic.responseEvidence,...changes}}};
    await changedFile(h,'assembly-journal/call-1.json',v=>v.value.error=error,()=>assert.rejects(h.verify({error}),/evidence path/),{rehash:true});
  }
});

test('links at the job, journal, response directory or evidence file fail closed',async t=>{
  const h=await setup(t),folder=h.error.diagnostic.responseEvidence.directory;
  for(const name of ['assembly-journal',folder,folder+'/answer-1.txt',folder+'/receipt.json']){
    const file=path.join(h.directory,name),saved=file+'.saved',directory=(await fs.stat(file)).isDirectory();
    await fs.rename(file,saved);await fs.symlink(saved,file,directory?'junction':'file');
    try{await assert.rejects(h.verify(),/link|redirected/);}finally{await fs.unlink(file);await fs.rename(saved,file);}
  }
  const linked=h.directory+'-link';await fs.symlink(h.directory,linked,'junction');
  try{await assert.rejects(h.verify({directory:linked}),/redirected/);}finally{await fs.unlink(linked);}
});

test('private evidence must be bounded ordinary files, not malformed JSON or directories',async t=>{
  const h=await setup(t),folder=h.error.diagnostic.responseEvidence.directory;
  for(const name of ['receipt.json','request.json','thread.json','turn.json']){
    const file=path.join(h.directory,folder,name),bytes=await fs.readFile(file);
    for(const text of ['{','null','[]','x'.repeat(65537)]){
      await fs.writeFile(file,text);try{await assert.rejects(h.verify());}finally{await fs.writeFile(file,bytes);}
    }
  }
  const file=path.join(h.directory,folder,'answer-1.txt'),saved=file+'.saved';await fs.rename(file,saved);await fs.mkdir(file);
  try{await assert.rejects(h.verify(),/quota\/type/);}finally{await fs.rmdir(file);await fs.rename(saved,file);}
});

test('native review pixels bind both fingerprints; changed or foreign attachment files are not accepted',async t=>{
  const h=await setup(t,{imageCount:4}),proof=await h.verify();assert.equal(proof.imageHashes.length,4);
  const expected=await codexRequestHash({prompt:h.args.prompt,model,effort,outputSchema:h.args.options.outputSchema,images:h.args.options.images});
  assert.equal(proof.providerRequestHash,expected);
  const file=h.args.options.images[0],bytes=await fs.readFile(file),different=Buffer.from(bytes);different[0]=0;
  await fs.writeFile(file,different);try{await assert.rejects(h.verify());}finally{await fs.writeFile(file,bytes);}
  await assert.rejects(h.verify({options:{...h.args.options,images:[...h.args.options.images].reverse()}}));
  await assert.rejects(h.verify({options:{...h.args.options,images:[path.join(h.directory,'foreign.png')]}}));
  const args={...h.args,options:{...h.args.options,images:[]}};
  await assert.rejects(verifyAssemblyCapacityReceipt(args),/images or reference input changed/);
  const expectedWithoutImages=await codexRequestHash({prompt:h.args.prompt,model,effort,outputSchema:args.options.outputSchema});
  assert.notEqual(expectedWithoutImages,proof.providerRequestHash);
  // Rehashing just the assembly ledger cannot erase the provider's actual
  // image binding or convert a visual call into a text-only call.
  await changedFile(h,'assembly-journal/call-1.json',v=>v.value.fingerprint=assemblyInvocationFingerprint({
    prompt:args.prompt,index:1,...args.options,imageHashes:[]}),()=>assert.rejects(verifyAssemblyCapacityReceipt(args)),{rehash:true});
});

for(const referenceCount of [1,2,4])test(referenceCount+' original reference images retain actual pixel hashes and shared policy/runtime identity',async t=>{
  const h=await setup(t,{referenceCount}),before=await inventory(h.directory),proof=await h.verify();
  assert.equal(proof.imageHashes.length,referenceCount);assert.equal(proof.referenceBindingHash,h.args.options.referenceInput.bindingHash);
  assert.equal(proof.invocationFingerprint,assemblyInvocationFingerprint({prompt:h.args.prompt,index:1,...h.args.options,imageHashes:[]}));
  const error={message:h.error.message,diagnostic:{...h.error.diagnostic,requestHash:hash('foreign')}};
  await assert.rejects(h.verify({error}));
  const foreignInput={...h.args.options.referenceInput,bindingHash:hash('foreign')};
  await assert.rejects(h.verify({options:{...h.args.options,referenceInput:foreignInput}}));
  await assert.rejects(h.verify({options:{...h.args.options,images:[path.join(h.directory,'foreign.png')]}}),/mixed/);
  const reference=await readJobReferenceInput({directory:h.directory,input:h.args.options.referenceInput,model,runtimeHash:h.args.runtimeHash});
  const file=reference.images[0],pixels=await fs.readFile(file);
  await fs.writeFile(file,'not the original reference');
  try{await assert.rejects(h.verify());}finally{await fs.writeFile(file,pixels);}
  const foreignPolicy={...h.args.policy,warnings:[...h.args.policy.warnings,'Synthetic changed policy']};
  await changedFile(h,'assembly-journal/identity.json',v=>v.value.policyHash=hash(foreignPolicy),
    ()=>assert.rejects(h.verify({policy:foreignPolicy}),/reference policy differs/),{rehash:true});
  assert.deepEqual(await inventory(h.directory),before);assert.equal(h.requests.filter(r=>r.method==='turn/start').length,1);
});

test('canonical provider and assembly fingerprint helpers keep all existing hash versions unchanged',async()=>{
  const args={prompt:'Original synthetic input',model,effort,outputSchema:{type:'object'},imageHashes:[hash('pixels')]};
  assert.equal(codexRequestFingerprint(args),hash({version:1,...args}));
  const referenceBindingHash=hash('reference');assert.equal(codexRequestFingerprint({...args,referenceBindingHash}),hash({version:2,...args,referenceBindingHash}));
  assert.throws(()=>codexRequestFingerprint({...args,referenceBindingHash:'bad'}));
  const invocation={prompt:args.prompt,index:3,outputSchema:args.outputSchema,stageName:'review',stageCount:26,imageHashes:args.imageHashes};
  const old={prompt:invocation.prompt,index:3,schema:invocation.outputSchema,phase:'review',maximum:26,images:invocation.imageHashes};
  assert.equal(assemblyInvocationFingerprint(invocation),hash(old));
  const referenceInput={format:'JobReferenceInput',bindingHash:referenceBindingHash};
  assert.equal(assemblyInvocationFingerprint({...invocation,referenceInput}),hash({...old,referenceInput}));
});
