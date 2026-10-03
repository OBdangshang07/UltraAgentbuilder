import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {hash} from '../src/generation/compiler.mjs';
import {REFERENCE_OWNER} from '../contracts/reference-attachments.mjs';
import {REFERENCE_PREPARATION_LIMITS} from '../contracts/reference-preparation.mjs';
import {REFERENCE_ARCHIVE_LIMITS as limits,referenceArchiveMaintenanceConfirmation as confirmation} from '../contracts/reference-archive.mjs';
import {archiveStorage as S} from './reference-archive.mjs';

const filePattern=/^(?:reference-sets\/[a-f0-9]{64}\/(?:manifest\.json|image-[0-3]\.png)|preparations\/[a-f0-9]{64}\/(?:preparation|confirmation)\.json)$/;
const directoryPattern=/^(?:reference-sets|preparations)(?:\/[a-f0-9]{64})?$/;
function checkedSnapshot(saved){
  const {snapshotHash,...content}=saved;assert.equal(hash(content),snapshotHash);
  assert.deepEqual(Object.keys(content).sort(),['format','version','purpose','ownerId','archiveActionId','archiveReceiptHash','inventory','submissionProtection',
    'permanentDeletion','retainsJobOriginals','retainsAuditRecords','restoresGenerationAuthority','additionalModelCalls','worldWrites','canAuthorizePlacement'].sort());
  assert.equal(content.format,'ReferenceArchiveMaintenanceSnapshot');assert.equal(content.version,1);assert.ok(['restore','purge'].includes(content.purpose));
  assert.match(content.ownerId,REFERENCE_OWNER);assert.match(content.archiveActionId,REFERENCE_OWNER);
  assert.match(content.archiveReceiptHash,/^[a-f0-9]{64}$/);
  assert.equal(content.permanentDeletion,content.purpose==='purge');assert.equal(content.retainsJobOriginals,true);assert.equal(content.retainsAuditRecords,true);
  assert.equal(content.restoresGenerationAuthority,false);assert.equal(content.additionalModelCalls,0);assert.equal(content.worldWrites,0);assert.equal(content.canAuthorizePlacement,false);
  const inventory=content.inventory;assert.deepEqual(Object.keys(inventory).sort(),['topDirectories','setHashes','preparationHashes','files','totalBytes'].sort());
  assert.ok(Array.isArray(inventory.files)&&inventory.files.length<=limits.filesPerDraft);const names=new Set();let total=0;
  for(const file of inventory.files){assert.deepEqual(Object.keys(file).sort(),['bytes','path','sha256']);assert.match(file.path,filePattern);
    assert.ok(!names.has(file.path));names.add(file.path);assert.ok(Number.isSafeInteger(file.bytes)&&file.bytes>0&&file.bytes<=limits.bytesPerDraft);assert.match(file.sha256,/^[a-f0-9]{64}$/);total+=file.bytes;}
  assert.equal(total,inventory.totalBytes);assert.ok(total<=limits.bytesPerDraft);
  assert.deepEqual(inventory.topDirectories,[...new Set(inventory.topDirectories)].sort());
  assert.ok(inventory.topDirectories.every(n=>['preparations','reference-sets'].includes(n)));
  for(const field of ['setHashes','preparationHashes']){assert.ok(Array.isArray(inventory[field]));assert.deepEqual(inventory[field],[...new Set(inventory[field])].sort());for(const id of inventory[field])assert.match(id,/^[a-f0-9]{64}$/);}
  return saved;
}
function checkedIntent(saved,archive,actionId){
  const {intentHash,...content}=saved;assert.equal(hash(content),intentHash);
  assert.deepEqual(Object.keys(content).sort(),['format','version','actionId','archiveActionId','ownerId','purpose','confirmation','confirmationHash','snapshot'].sort());
  assert.equal(content.format,'ReferenceArchiveMaintenanceIntent');assert.equal(content.version,1);assert.equal(content.actionId,actionId);
  assert.equal(content.archiveActionId,archive.intent.actionId);assert.equal(content.ownerId,archive.intent.ownerId);
  confirmation(content.confirmation,content.ownerId,content.archiveActionId,content.purpose);assert.equal(content.confirmation.actionId,actionId);
  assert.equal(content.confirmationHash,hash(content.confirmation));checkedSnapshot(content.snapshot);
  assert.equal(content.snapshot.purpose,content.purpose);assert.equal(content.snapshot.ownerId,content.ownerId);assert.equal(content.snapshot.archiveActionId,content.archiveActionId);
  assert.equal(content.confirmation.snapshotHash,content.snapshot.snapshotHash);
  const expected=archive.intent.snapshot;
  for(const key of ['topDirectories','setHashes','preparationHashes','files','totalBytes'])assert.deepEqual(content.snapshot.inventory[key],expected[key],'Original maintenance inventory replaced');
  assert.equal(content.snapshot.archiveReceiptHash,S.receipt(archive.intent).receiptHash);return saved;
}
async function originalReceipt(archive){const saved=await S.json(archive.root,'receipt.json');assert.deepEqual(saved,S.receipt(archive.intent));return saved;}
function resultReceipt(intent){
  const content={format:'ReferenceArchiveMaintenanceReceipt',version:1,actionId:intent.actionId,archiveActionId:intent.archiveActionId,ownerId:intent.ownerId,
    intentHash:intent.intentHash,snapshotHash:intent.snapshot.snapshotHash,archiveReceiptHash:intent.snapshot.archiveReceiptHash,
    state:intent.purpose==='purge'?'purged':'restored',fileCount:intent.snapshot.inventory.files.length,totalBytes:intent.snapshot.inventory.totalBytes,
    permanentDeletion:intent.purpose==='purge',retainsJobOriginals:true,retainsAuditRecords:true,restoresGenerationAuthority:false,
    additionalModelCalls:0,worldWrites:0,canAuthorizePlacement:false};return {...content,receiptHash:hash(content)};
}
function directoriesFor(inventory){
  return [...new Set([...inventory.topDirectories,...inventory.setHashes.map(h=>'reference-sets/'+h),...inventory.preparationHashes.map(h=>'preparations/'+h)])]
    .sort((a,b)=>b.split('/').length-a.split('/').length||a.localeCompare(b));
}
// A purge can leave an incomplete image set. Validate surviving ORIGINAL
// bytes against the confirmed pre-deletion inventory, not a newly forged set.
async function remaining(archive,intent){
  const root=path.join(archive.root,intent.ownerId),inventory=intent.snapshot.inventory;
  if(!await S.exists(root))return {files:[],directories:[]};await S.physical(root);
  const knownFiles=new Map(inventory.files.map(f=>[f.path,f])),knownDirs=new Set(directoriesFor(inventory)),files=[],directories=[];
  async function walk(relative=''){
    const folder=relative?path.join(root,relative):root;await S.physical(folder);
    for(const entry of await fs.readdir(folder,{withFileTypes:true})){
      const name=relative?relative+'/'+entry.name:entry.name;
      assert.ok(!entry.isSymbolicLink(),'Maintenance link rejected');
      if(entry.isDirectory()){
        assert.ok(knownDirs.has(name)&&directoryPattern.test(name),'Unknown maintenance directory preserved');directories.push(name);await walk(name);
      }else{
        assert.ok(entry.isFile()&&knownFiles.has(name),'Unknown maintenance file preserved');const expected=knownFiles.get(name),raw=await S.bytes(root,name,expected.bytes);
        assert.equal(raw.length,expected.bytes);assert.equal(hash(raw),expected.sha256,'Original maintenance file changed; preserved');files.push(name);
      }
    }
  }
  await walk();return {files:files.sort(),directories};
}
function fileReceipt(intent,index,disposition){
  const content={format:'ReferenceArchiveFileRemovalReceipt',version:1,actionId:intent.actionId,archiveActionId:intent.archiveActionId,ownerId:intent.ownerId,
    index,...intent.snapshot.inventory.files[index],disposition};return {...content,receiptHash:hash(content)};
}
async function validateProgress(root,intent,remainingFiles){
  const entries=await fs.readdir(root);const allowed=new Set(['intent.json','receipt.json',...intent.snapshot.inventory.files.map((_,i)=>`file-${i}.json`)]);
  assert.ok(entries.every(n=>allowed.has(n)),'Unknown maintenance progress preserved');
  if(intent.purpose==='restore')assert.ok(entries.every(n=>['intent.json','receipt.json'].includes(n)),'Restore cannot inherit purge progress');
  for(let i=0;i<intent.snapshot.inventory.files.length;i++)if(entries.includes(`file-${i}.json`)){
    const saved=await S.json(root,`file-${i}.json`);assert.ok(['deleted','absent-after-intent'].includes(saved.disposition));
    assert.deepEqual(saved,fileReceipt(intent,i,saved.disposition));assert.ok(!remainingFiles.includes(saved.path),'Removed file reappeared; preserved');
  }
}
async function status(dataDir,archive,action){
  const {root,intent}=action,target=path.join(archive.root,intent.ownerId),source=path.join(dataDir,'reference-drafts',intent.ownerId);
  if(await S.exists(path.join(root,'receipt.json'))){
    const saved=await S.json(root,'receipt.json');assert.deepEqual(saved,resultReceipt(intent));assert.ok(!await S.exists(target),'Completed maintenance archive reappeared; preserved');
    await validateProgress(root,intent,[]);
    if(intent.purpose==='purge')for(let i=0;i<intent.snapshot.inventory.files.length;i++)assert.ok(await S.exists(path.join(root,`file-${i}.json`)),'Original purge file receipt missing');
    return saved; // restored active data may have since been explicitly edited/rearchived
  }
  let state,removedFiles=0;
  if(intent.purpose==='restore'){
    await S.physical(path.join(dataDir,'reference-drafts'));const hasTarget=await S.exists(target),hasSource=await S.exists(source);
    assert.ok(hasTarget!==hasSource,'Restore location ambiguous; no overwrite');
    assert.deepEqual(await S.draftInventory(hasTarget?target:source,intent.ownerId),intent.snapshot.inventory,'Original restore bytes changed');
    await validateProgress(root,intent,[]);state=hasTarget?'restore-pending':'restore-moved-awaiting-receipt';
  }else{
    assert.ok(!await S.exists(source),'Active owner prevents archive purge');const r=await remaining(archive,intent);await validateProgress(root,intent,r.files);
    removedFiles=intent.snapshot.inventory.files.length-r.files.length;state=await S.exists(target)?'purge-pending':'purged-awaiting-receipt';
  }
  return {format:'ReferenceArchiveMaintenanceStatus',version:1,actionId:intent.actionId,archiveActionId:intent.archiveActionId,ownerId:intent.ownerId,
    snapshotHash:intent.snapshot.snapshotHash,purpose:intent.purpose,state,removedFiles,resumeSameAction:true,
    permanentDeletion:intent.purpose==='purge',retainsJobOriginals:true,retainsAuditRecords:true,restoresGenerationAuthority:false,
    additionalModelCalls:0,worldWrites:0,canAuthorizePlacement:false};
}
async function readAction(archive){
  const parent=path.join(archive.root,'maintenance'),names=await S.directories(parent,REFERENCE_OWNER,limits.maintenancePerArchive);
  if(!names.length)return null;const root=await S.physical(path.join(parent,names[0]));
  if(!(await fs.readdir(root)).length)return null;
  await originalReceipt(archive);const intent=checkedIntent(await S.json(root,'intent.json'),archive,names[0]);return {root,intent};
}
export async function readArchiveMaintenance(dataDir,archive){const action=await readAction(archive);return action?status(dataDir,archive,action):null;}
// Historical consent is evidence, not new consent. A record GET must never
// finish a moved restore, continue a purge, or create/replace an action.
export async function readArchiveMaintenanceRecord(dataDir,archive){
  const action=await readAction(archive);
  return action?{intent:action.intent,status:await status(dataDir,archive,action)}:null;
}
export async function archiveMaintenanceCurrentStatus(dataDir,archive){
  const maintenance=await readArchiveMaintenance(dataDir,archive);if(!maintenance)return null;const originalArchiveReceipt=await originalReceipt(archive);
  return {format:'ReferenceDraftArchiveCurrentStatus',version:1,actionId:archive.intent.actionId,ownerId:archive.intent.ownerId,
    snapshotHash:archive.intent.snapshot.snapshotHash,state:maintenance.state,originalArchiveReceipt,maintenance,
    additionalModelCalls:0,worldWrites:0,canAuthorizePlacement:false};
}
async function restoreCapacity(dataDir,ownerId){
  const parent=await S.physical(path.join(dataDir,'reference-drafts'));
  assert.ok(!await S.exists(path.join(parent,ownerId)),'Restore cannot overwrite an active owner');
  const owners=await S.directories(parent,REFERENCE_OWNER,REFERENCE_PREPARATION_LIMITS.drafts);
  assert.ok(owners.length<REFERENCE_PREPARATION_LIMITS.drafts,'Active draft quota reached; archived records preserved');
}
async function snapshot(dataDir,archive,purpose){
  assert.equal(await readAction(archive),null,'Use the same original maintenance action');
  const archived=await S.actionState(dataDir,archive.root,archive.intent);assert.equal(archived.format,'ReferenceDraftArchiveReceipt');assert.equal(archived.state,'archived');
  if(purpose==='restore')await restoreCapacity(dataDir,archive.intent.ownerId);
  const inventory=await S.draftInventory(path.join(archive.root,archive.intent.ownerId),archive.intent.ownerId);
  const content={format:'ReferenceArchiveMaintenanceSnapshot',version:1,purpose,ownerId:archive.intent.ownerId,archiveActionId:archive.intent.actionId,
    archiveReceiptHash:archived.receiptHash,inventory,submissionProtection:await S.submissionProtection(dataDir,archive.intent.ownerId),
    permanentDeletion:purpose==='purge',retainsJobOriginals:true,retainsAuditRecords:true,restoresGenerationAuthority:false,
    additionalModelCalls:0,worldWrites:0,canAuthorizePlacement:false};return checkedSnapshot({...content,snapshotHash:hash(content)});
}
// Only exact known files then verified empty directories are removed. No
// recursive deletion, generated task cleanup, original-image or model operation.
export async function referenceArchiveMaintenanceOperation({dataDir,operation,ownerId,archiveActionId,actionId,input,purpose},{rename=fs.rename,unlink=fs.unlink,rmdir=fs.rmdir}={}){
  dataDir=path.resolve(dataDir);await S.physical(dataDir);assert.match(ownerId,REFERENCE_OWNER);assert.match(archiveActionId,REFERENCE_OWNER);
  if(operation!=='archive-maintenance-get')purpose=operation.startsWith('archive-purge-')?'purge':'restore';
  assert.ok(['restore','purge'].includes(purpose));const archive=(await S.actions(dataDir)).find(a=>a.intent.actionId===archiveActionId&&a.intent.ownerId===ownerId);
  assert.ok(archive,'Exact original archive owner/action not found');
  if(operation.endsWith('-snapshot'))return snapshot(dataDir,archive,purpose);
  let action=await readAction(archive);
  if(operation==='archive-maintenance-get'){
    assert.match(actionId,REFERENCE_OWNER);assert.ok(action&&action.intent.actionId===actionId&&action.intent.purpose===purpose,'Original maintenance action/purpose missing');
    return status(dataDir,archive,action);
  }
  assert.ok(['archive-restore-confirm','archive-purge-confirm'].includes(operation));assert.ok(input?.byteLength>0&&input.byteLength<=limits.inputBytes,'Maintenance confirmation byte quota');
  const consent=confirmation(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(input)),ownerId,archiveActionId,purpose);
  if(action)assert.deepEqual(action.intent.confirmation,consent,'Original maintenance action cannot be rebound');
  else{
    const exact=await snapshot(dataDir,archive,purpose);assert.equal(consent.snapshotHash,exact.snapshotHash,'Maintenance confirmation is stale');
    const parent=await S.physical(path.join(archive.root,'maintenance'),true),names=await S.directories(parent,REFERENCE_OWNER,limits.maintenancePerArchive);
    assert.ok(names.length===0||names.length===1&&names[0]===consent.actionId,'Use the same original maintenance action');
    const root=await S.physical(path.join(parent,consent.actionId),true);assert.deepEqual(await fs.readdir(root),[],'Unknown original maintenance intent preserved');
    const content={format:'ReferenceArchiveMaintenanceIntent',version:1,actionId:consent.actionId,archiveActionId,ownerId,purpose,
      confirmation:consent,confirmationHash:hash(consent),snapshot:exact},intent={...content,intentHash:hash(content)};
    await S.immutable(path.join(root,'intent.json'),intent);action={root,intent};
  }
  let current=await status(dataDir,archive,action);if(['restored','purged'].includes(current.state))return current;
  assert.deepEqual(await S.submissionProtection(dataDir,ownerId),action.intent.snapshot.submissionProtection,'Original SEND protection changed; maintenance paused');
  const target=path.join(archive.root,ownerId),source=path.join(dataDir,'reference-drafts',ownerId);
  if(purpose==='restore'){
    if(current.state==='restore-pending'){
      await restoreCapacity(dataDir,ownerId);await S.physical(archive.root);await S.physical(path.dirname(source));
      assert.equal((await status(dataDir,archive,action)).state,'restore-pending');await rename(target,source);
    }
    assert.equal((await status(dataDir,archive,action)).state,'restore-moved-awaiting-receipt');
  }else{
    const inventory=action.intent.snapshot.inventory;
    for(let i=0;i<inventory.files.length;i++){
      const file=inventory.files[i],record=`file-${i}.json`;
      if(await S.exists(path.join(action.root,record)))continue; // validated above; cannot re-delete a later replacement
      const left=await remaining(archive,action.intent);let disposition='absent-after-intent';
      if(left.files.includes(file.path)){
        await S.physical(target);const raw=await S.bytes(target,file.path,file.bytes);assert.equal(hash(raw),file.sha256);
        await unlink(path.join(target,file.path));assert.ok(!await S.exists(path.join(target,file.path)),'Purge removal unresolved');disposition='deleted';
      }
      await S.immutable(path.join(action.root,record),fileReceipt(action.intent,i,disposition));
    }
    assert.deepEqual((await remaining(archive,action.intent)).files,[]);
    for(const relative of [...directoriesFor(inventory),'']){
      const folder=relative?path.join(target,relative):target;if(!await S.exists(folder))continue;
      assert.ok(relative===''||directoryPattern.test(relative));await S.physical(folder);assert.deepEqual(await fs.readdir(folder),[],'Unknown files prevent empty-directory removal');
      await rmdir(folder);assert.ok(!await S.exists(folder),'Purge directory removal unresolved');
    }
    assert.equal((await status(dataDir,archive,action)).state,'purged-awaiting-receipt');
  }
  assert.deepEqual(await S.submissionProtection(dataDir,ownerId),action.intent.snapshot.submissionProtection,'Original SEND protection changed; receipt retained pending');
  await S.immutable(path.join(action.root,'receipt.json'),resultReceipt(action.intent));return status(dataDir,archive,action);
}
