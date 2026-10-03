import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {hash} from '../src/generation/compiler.mjs';
import {REFERENCE_OWNER,REFERENCE_LIMITS} from '../contracts/reference-attachments.mjs';
import {REFERENCE_PREPARATION_LIMITS as preparationLimits} from '../contracts/reference-preparation.mjs';
import {REFERENCE_ARCHIVE_LIMITS as limits,referenceArchiveConfirmation} from '../contracts/reference-archive.mjs';
import {safeEvidenceFile} from './native-evidence.mjs';
import {readReferenceSet} from './reference-attachments.mjs';
import {readReferencePreparation} from './reference-preparation-data.mjs';
import {readReferencePreparationConfirmation} from './reference-generation-binding.mjs';
import {referenceGenerationOperation} from './reference-generation-worker.mjs';

const digest=/^[a-f0-9]{64}$/;
async function physical(directory,create=false){
  if(create)await fs.mkdir(directory).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const stat=await fs.lstat(directory);
  assert.ok(stat.isDirectory()&&!stat.isSymbolicLink(),'Archive directory link/type rejected');
  assert.equal(await fs.realpath(directory),directory,'Archive directory redirected');return directory;
}
async function exists(file){try{await fs.lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function directories(parent,pattern,maximum){
  if(!await exists(parent))return [];
  await physical(parent);const entries=await fs.readdir(parent,{withFileTypes:true});
  assert.ok(entries.length<=maximum,'Archive directory quota exceeded');
  assert.ok(entries.every(e=>e.isDirectory()&&!e.isSymbolicLink()&&pattern.test(e.name)),'Unknown or linked archive entry');
  return entries.map(e=>e.name).sort();
}
async function bytes(root,relative,maximum){
  const content=await safeEvidenceFile(root,relative,maximum),stat=await fs.lstat(path.join(root,relative));
  assert.equal(stat.nlink,1,'Archive hard-linked evidence rejected');return content;
}
async function json(root,relative,maximum=limits.receiptBytes){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(root,relative,maximum)));}
async function immutable(file,value){
  const content=Buffer.from(JSON.stringify(value));assert.ok(content.length<=limits.receiptBytes);
  let handle;
  try{handle=await fs.open(file,'wx',0o600);}
  catch(e){if(e.code!=='EEXIST')throw e;assert.ok((await bytes(path.dirname(file),path.basename(file),limits.receiptBytes)).equals(content),'Original archive identity cannot be replaced');return;}
  try{await handle.writeFile(content);await handle.sync();}finally{await handle.close();}
}
async function checkedJournal(root,relative){
  const raw=await bytes(root,relative,16*1024*1024),envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  assert.deepEqual(Object.keys(envelope).sort(),['sha256','value']);assert.equal(hash(envelope.value),envelope.sha256,'Original archive protection receipt changed');
  return {value:envelope.value,file:{path:relative,bytes:raw.length,sha256:hash(raw)}};
}
// Inspect only: never open a journal through its replay/mutation API. Even a
// terminal job is unsafe to archive while an invocation has an unknown outcome.
async function submissionProtection(dataDir,ownerId){
  const submissions=await referenceGenerationOperation({dataDir,operation:'list'}),submission=submissions.find(s=>s.ownerId===ownerId);
  if(!submission){
    // Missing SEND index is not proof of no publication. Protect orphaned
    // capsules/jobs rather than moving a draft needed by an unknown original.
    for(const jobId of await directories(path.join(dataDir,'jobs'),REFERENCE_OWNER,1000)){
      const root=await physical(path.join(dataDir,'jobs',jobId));
      assert.ok(!await exists(path.join(root,'reference-input',ownerId)),'Original reference capsule has no SEND index; protected');
      if(await exists(path.join(root,'job.json'))){const job=await json(root,'job.json',16*1024*1024);
        assert.ok(job.key!==ownerId&&job.referenceGeneration?.input?.ownerId!==ownerId,'Original job has no SEND index; protected');}
    }
    return {state:'unsubmitted'};
  }
  await physical(path.join(dataDir,'jobs'));
  const root=await physical(path.join(dataDir,'jobs',submission.jobId));
  const jobBytes=await bytes(root,'job.json',16*1024*1024),job=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(jobBytes));
  assert.ok(['preview-ready','failed','cancelled'].includes(job.state),'Active, interrupted or unknown reference SEND is protected');
  const descriptor=await referenceGenerationOperation({dataDir,operation:'recover',jobId:submission.jobId,runtimeHash:submission.submission.sendConfirmation.runtimeHash});
  assert.equal(job.id,submission.jobId);assert.equal(job.key,ownerId);assert.equal(job.requestHash,descriptor.requestHash);
  assert.equal(job.recoveryEnabled,true);assert.equal(hash(job.preflight),hash(descriptor.policy));
  assert.deepEqual(job.referenceGeneration,{version:1,preparationHash:submission.submission.preparationHash,input:descriptor.referenceInput},'Original archive job capsule mismatch');
  const count=job.assemblyCallsReserved??0;assert.ok(Number.isSafeInteger(count)&&count>=0&&count<=descriptor.policy.assembly.maximumCalls);
  if(job.recovery)assert.equal(job.recovery.reservedCalls,count,'Original archive reservation count mismatch');
  const journal=path.join(root,'assembly-journal'),files=[];
  if(await exists(journal)){
    await physical(journal);const names=(await fs.readdir(journal)).sort();
    const expected=['identity.json',...(count?['dispatched.json']:[]),...Array.from({length:count},(_,i)=>`call-${i+1}.json`)];
    if(!count&&names.includes('dispatched.json'))expected.push('dispatched.json');
    assert.deepEqual(names,expected.sort(),'Archive journal missing, pending or unrecognized evidence');
    const identity=await checkedJournal(root,'assembly-journal/identity.json');files.push(identity.file);
    assert.deepEqual(identity.value,{version:1,requestHash:descriptor.requestHash,policyHash:hash(descriptor.policy),runtimeHash:descriptor.runtimeHash,maximumCalls:descriptor.policy.assembly.maximumCalls});
    if(names.includes('dispatched.json')){
      const dispatched=await checkedJournal(root,'assembly-journal/dispatched.json');files.push(dispatched.file);
      assert.deepEqual(dispatched.value,{count});
    }
    for(let i=1;i<=count;i++){
      const record=await checkedJournal(root,`assembly-journal/call-${i}.json`);files.push(record.file);
      assert.equal(record.value.index,i);assert.match(record.value.fingerprint,digest);
      assert.ok(['response','error'].includes(record.value.state),'Unknown provider invocation remains protected; never resend');
      if(record.value.state==='response')assert.ok(record.value.response&&typeof record.value.response==='object');
      else{
        const error=record.value.error;assert.ok(error&&typeof error.message==='string');
        if(error.completedFormat===true)assert.ok(typeof error.responseText==='string'&&error.parseFacts&&typeof error.parseFacts==='object');
        else assert.ok(['completed','failed','interrupted','aborted','not-submitted'].includes(error.diagnostic?.reason),'Uncertain provider error remains protected');
      }
    }
  }else{
    assert.equal(count,0,'Original invocation journal missing; outcome protected');
    assert.notEqual(job.state,'preview-ready','Completed reference building requires original receipts');
    assert.ok(!(await fs.readdir(root)).some(n=>n.startsWith('codex-response-')||n.startsWith('assembly-run-')),'Unjournaled invocation evidence protected');
  }
  const selected=submission.submission.preparationHash,send=submission.submission.sendConfirmation;
  for(const relative of ['reference-recovery-request.json',`reference-input/${ownerId}/binding.json`,`reference-input/${ownerId}/send.json`,
    `reference-input/${ownerId}/preparations/${selected}/preparation.json`,`reference-input/${ownerId}/preparations/${selected}/confirmation.json`,
    `reference-input/${ownerId}/reference-sets/${send.setHash}/manifest.json`]){
    const raw=await bytes(root,relative,limits.receiptBytes);files.push({path:relative,bytes:raw.length,sha256:hash(raw)});
  }
  const selectedPreparation=await readReferencePreparation(path.join(root,'reference-input',ownerId),ownerId,selected);
  for(const r of selectedPreparation.references.manifest.references){
    const relative=`reference-input/${ownerId}/reference-sets/${send.setHash}/${r.file}`,raw=await bytes(root,relative,REFERENCE_LIMITS.bytesPerImage);
    files.push({path:relative,bytes:raw.length,sha256:hash(raw)});
  }
  return {state:'known-terminal',jobId:submission.jobId,jobState:job.state,requestHash:descriptor.requestHash,
    jobSha256:hash(jobBytes),bindingHash:descriptor.referenceInput.bindingHash,originalRecordsHash:hash(files.sort((a,b)=>a.path.localeCompare(b.path))),knownCalls:count};
}
async function draftInventory(root,ownerId){
  await physical(root);assert.equal(path.basename(root),ownerId);
  const entries=(await fs.readdir(root)).sort();assert.ok(entries.every(n=>['preparations','reference-sets'].includes(n)),'Unknown draft archive file');
  const sets=await directories(path.join(root,'reference-sets'),digest,preparationLimits.setsPerDraft);
  const preparations=await directories(path.join(root,'preparations'),digest,preparationLimits.preparationsPerDraft);
  const files=[];
  const add=async(relative,maximum)=>{const raw=await bytes(root,relative,maximum);files.push({path:relative,bytes:raw.length,sha256:hash(raw)});};
  for(const setHash of sets){
    const {manifest}=await readReferenceSet(root,setHash),prefix=`reference-sets/${setHash}`;
    assert.deepEqual((await fs.readdir(path.join(root,prefix))).sort(),['manifest.json',...manifest.references.map(r=>r.file)].sort(),'Unknown archived set file');
    await add(prefix+'/manifest.json',65536);
    for(const r of manifest.references)await add(prefix+'/'+r.file,REFERENCE_LIMITS.bytesPerImage);
  }
  for(const preparationHash of preparations){
    const {preparation}=await readReferencePreparation(root,ownerId,preparationHash),prefix=`preparations/${preparationHash}`;
    const names=(await fs.readdir(path.join(root,prefix))).sort();
    assert.ok(names.includes('preparation.json')&&names.every(n=>['preparation.json','confirmation.json'].includes(n)),'Unknown archived preparation file');
    await add(prefix+'/preparation.json',131072);
    if(names.includes('confirmation.json')){await readReferencePreparationConfirmation(root,preparation);await add(prefix+'/confirmation.json',16384);}
  }
  files.sort((a,b)=>a.path.localeCompare(b.path));const totalBytes=files.reduce((sum,f)=>sum+f.bytes,0);
  assert.ok(files.length<=limits.filesPerDraft&&totalBytes<=limits.bytesPerDraft,'Draft archive byte/file quota exceeded');
  return {topDirectories:entries,setHashes:sets,preparationHashes:preparations,files,totalBytes};
}
function checkedIntent(value,actionId){
  const {intentHash,...content}=value;assert.equal(hash(content),intentHash);
  assert.deepEqual(Object.keys(content).sort(),['format','version','actionId','ownerId','confirmation','confirmationHash','snapshot'].sort());
  assert.equal(content.format,'ReferenceDraftArchiveIntent');assert.equal(content.version,1);assert.equal(content.actionId,actionId);
  referenceArchiveConfirmation(content.confirmation,content.ownerId);assert.equal(content.confirmation.actionId,actionId);assert.equal(content.confirmationHash,hash(content.confirmation));
  const {snapshotHash,...snapshot}=content.snapshot;assert.equal(hash(snapshot),snapshotHash);assert.equal(content.confirmation.snapshotHash,snapshotHash);
  assert.deepEqual(Object.keys(snapshot).sort(),['format','version','ownerId','topDirectories','setHashes','preparationHashes','files','totalBytes','submissionProtection','additionalModelCalls','worldWrites','canAuthorizePlacement'].sort());
  assert.equal(snapshot.format,'ReferenceDraftArchiveSnapshot');assert.equal(snapshot.version,1);assert.equal(snapshot.ownerId,content.ownerId);
  assert.equal(snapshot.additionalModelCalls,0);assert.equal(snapshot.worldWrites,0);assert.equal(snapshot.canAuthorizePlacement,false);
  return value;
}
async function actions(dataDir){
  const parent=path.join(dataDir,'reference-archives'),names=await directories(parent,REFERENCE_OWNER,limits.actions),result=[];
  for(const actionId of names){
    const root=await physical(path.join(parent,actionId)),entries=await fs.readdir(root);
    if(!entries.length)continue; // a pre-intent crash moved no owner data
    const intent=checkedIntent(await json(root,'intent.json'),actionId);
    assert.ok(entries.every(n=>['intent.json','receipt.json','maintenance',intent.ownerId].includes(n)),'Unknown original archive action file');
    result.push({root,intent});
  }
  return result;
}
export async function assertReferenceDraftWritable(dataDir,ownerId){
  assert.match(ownerId,REFERENCE_OWNER);
  for(const a of (await actions(dataDir)).filter(a=>a.intent.ownerId===ownerId)){
    const maintenance=await (await import('./reference-archive-maintenance.mjs')).readArchiveMaintenance(dataDir,a);
    assert.equal(maintenance?.state,'restored','Owner has an original archive action; use the same original archive action or a new draft UUID');
  }
}
async function snapshot(dataDir,ownerId){
  await assertReferenceDraftWritable(dataDir,ownerId);await physical(path.join(dataDir,'reference-drafts'));
  const inventory=await draftInventory(path.join(dataDir,'reference-drafts',ownerId),ownerId),protection=await submissionProtection(dataDir,ownerId);
  const content={format:'ReferenceDraftArchiveSnapshot',version:1,ownerId,...inventory,submissionProtection:protection,
    additionalModelCalls:0,worldWrites:0,canAuthorizePlacement:false};return {...content,snapshotHash:hash(content)};
}
function receipt(intent){
  const content={format:'ReferenceDraftArchiveReceipt',version:1,actionId:intent.actionId,ownerId:intent.ownerId,intentHash:intent.intentHash,
    snapshotHash:intent.snapshot.snapshotHash,state:'archived',fileCount:intent.snapshot.files.length,totalBytes:intent.snapshot.totalBytes,
    activeQuotaReleased:true,permanentlyDeleted:false,additionalModelCalls:0,worldWrites:0,canAuthorizePlacement:false};
  return {...content,receiptHash:hash(content)};
}
async function actionState(dataDir,root,intent){
  if(await exists(path.join(root,'maintenance'))){
    const current=await (await import('./reference-archive-maintenance.mjs')).archiveMaintenanceCurrentStatus(dataDir,{root,intent});if(current)return current;
  }
  await physical(path.join(dataDir,'reference-drafts'));
  const source=path.join(dataDir,'reference-drafts',intent.ownerId),target=path.join(root,intent.ownerId);
  const hasSource=await exists(source),hasTarget=await exists(target);
  assert.ok(hasSource!==hasTarget,'Archive location ambiguous; original action preserved');
  const inventory=await draftInventory(hasSource?source:target,intent.ownerId),expected=intent.snapshot;
  for(const key of ['topDirectories','setHashes','preparationHashes','files','totalBytes'])assert.deepEqual(inventory[key],expected[key],'Archive snapshot changed; original action preserved');
  if(await exists(path.join(root,'receipt.json'))){
    assert.equal(hasSource,false,'Archive receipt/source conflict');const saved=await json(root,'receipt.json');assert.deepEqual(saved,receipt(intent));return saved;
  }
  return {format:'ReferenceDraftArchiveStatus',version:1,actionId:intent.actionId,ownerId:intent.ownerId,snapshotHash:expected.snapshotHash,
    state:hasSource?'pending':'moved-awaiting-receipt',resumeSameAction:true,activeQuotaReleased:!hasSource,
    permanentlyDeleted:false,additionalModelCalls:0,worldWrites:0,canAuthorizePlacement:false};
}
// `rename` is an injected LOCAL filesystem primitive for fault tests, never an
// HTTP option. A throw is ambiguous: query the SAME durable action, not a new move.
export async function referenceArchiveOperation({dataDir,operation,ownerId,input,actionId}, {rename=fs.rename}={}){
  dataDir=path.resolve(dataDir);await physical(dataDir);
  if(operation==='archive-list'){
    const existing=await actions(dataDir),owners=await directories(path.join(dataDir,'reference-drafts'),REFERENCE_OWNER,preparationLimits.drafts),drafts=[];
    for(const id of owners){
      let pending=null;
      for(const a of existing.filter(a=>a.intent.ownerId===id)){
        const maintenance=await (await import('./reference-archive-maintenance.mjs')).readArchiveMaintenance(dataDir,a);
        if(maintenance?.state!=='restored'){pending=a;break;}
      }
      if(pending){drafts.push({ownerId:id,archiveAllowed:false,originalActionId:pending.intent.actionId});continue;}
      try{const s=await snapshot(dataDir,id);drafts.push({ownerId:id,archiveAllowed:true,snapshotHash:s.snapshotHash,totalBytes:s.totalBytes,fileCount:s.files.length,submissionProtection:s.submissionProtection.state});}
      catch{drafts.push({ownerId:id,archiveAllowed:false,reason:'Original integrity or SEND protection check did not pass'});}
    }
    const archiveActions=[];
    for(const a of existing){let state='unavailable',maintenanceActionId=null;try{const current=await actionState(dataDir,a.root,a.intent);state=current.state;maintenanceActionId=current.maintenance?.actionId??null;}catch{}
      archiveActions.push({ownerId:a.intent.ownerId,actionId:a.intent.actionId,snapshotHash:a.intent.snapshot.snapshotHash,state,maintenanceActionId});}
    return {format:'ReferenceDraftArchiveList',version:1,drafts,actions:archiveActions,additionalModelCalls:0,worldWrites:0,canAuthorizePlacement:false};
  }
  assert.match(ownerId,REFERENCE_OWNER);
  if(operation==='archive-snapshot')return snapshot(dataDir,ownerId);
  if(operation==='archive-get'||operation==='archive-record'){
    assert.match(actionId,REFERENCE_OWNER);const existing=(await actions(dataDir)).find(a=>a.intent.actionId===actionId);
    assert.ok(existing&&existing.intent.ownerId===ownerId,'Exact original owner/archive action not found');
    const status=await actionState(dataDir,existing.root,existing.intent);
    if(operation==='archive-get')return status;
    const maintenance=await (await import('./reference-archive-maintenance.mjs')).readArchiveMaintenanceRecord(dataDir,existing);
    if(maintenance)assert.deepEqual(status.maintenance,maintenance.status,'Original maintenance changed during record read');
    const content={format:'ReferenceDraftArchiveRecord',version:1,ownerId,actionId,
      originalIntent:existing.intent,status,maintenance,
      additionalModelCalls:0,worldWrites:0,canAuthorizePlacement:false};
    const record={...content,recordHash:hash(content)};
    assert.ok(Buffer.byteLength(JSON.stringify(record))<=limits.receiptBytes,'Original archive record byte quota');
    return record;
  }
  assert.equal(operation,'archive-confirm');assert.ok(input?.byteLength>0&&input.byteLength<=limits.inputBytes,'Archive confirmation byte quota');
  const confirmation=referenceArchiveConfirmation(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(input)),ownerId);
  const previous=await actions(dataDir);let existing=previous.find(a=>a.intent.actionId===confirmation.actionId);
  if(existing)assert.deepEqual(existing.intent.confirmation,confirmation,'Original archive action cannot be rebound');
  else{
    await assertReferenceDraftWritable(dataDir,ownerId);
    const saved=await snapshot(dataDir,ownerId);assert.equal(saved.snapshotHash,confirmation.snapshotHash,'Archive confirmation is stale; inspect again');
    const parent=await physical(path.join(dataDir,'reference-archives'),true);
    assert.ok((await directories(parent,REFERENCE_OWNER,limits.actions)).length<limits.actions,'Archive action quota reached');
    const root=await physical(path.join(parent,confirmation.actionId),true);assert.deepEqual(await fs.readdir(root),[],'Unrecognized prior archive action');
    const content={format:'ReferenceDraftArchiveIntent',version:1,actionId:confirmation.actionId,ownerId,confirmation,confirmationHash:hash(confirmation),snapshot:saved};
    const intent={...content,intentHash:hash(content)};await immutable(path.join(root,'intent.json'),intent);existing={root,intent};
  }
  const state=await actionState(dataDir,existing.root,existing.intent);
  if(state.format==='ReferenceDraftArchiveCurrentStatus')return state.originalArchiveReceipt; // never replay an archive after restore/purge
  if(state.state==='archived')return state;
  assert.deepEqual(await submissionProtection(dataDir,ownerId),existing.intent.snapshot.submissionProtection,'Original SEND protection changed; archive paused');
  if(state.state==='pending'){
    await physical(path.join(dataDir,'reference-drafts'));await physical(existing.root);
    // Re-read exact source bytes just before the single bounded atomic move.
    assert.equal((await actionState(dataDir,existing.root,existing.intent)).state,'pending');
    await rename(path.join(dataDir,'reference-drafts',ownerId),path.join(existing.root,ownerId));
  }
  assert.equal((await actionState(dataDir,existing.root,existing.intent)).state,'moved-awaiting-receipt');
  const saved=receipt(existing.intent);await immutable(path.join(existing.root,'receipt.json'),saved);
  return actionState(dataDir,existing.root,existing.intent);
}
export const archiveStorage={physical,exists,directories,bytes,json,immutable,submissionProtection,draftInventory,actions,receipt,actionState};
