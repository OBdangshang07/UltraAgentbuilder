import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {hash} from '../../src/generation/compiler.mjs';
import {REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY,readCohortReferenceWorldAssemblyCandidate,
  referenceWorldAssemblyCandidatePart} from '../../bridge/reference-world-assembly-candidate.mjs';

const raw=value=>Buffer.from(JSON.stringify(value));
// Small PHYSICAL member-validation fixture only, not a fabricated native
// generation or production acceptance. The owner can seed no such receipt:
// production cohorts come only from its normally-exited full verifier worker.
async function members(t){
  const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'joint-read-cohort-')));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const branch='assembly-run-synthetic',proofFiles=[];
  for(const name of ['reference-world-assembly-v2','reference-input','assembly-journal',branch,'reference-world-assembly-final']){
    await fs.mkdir(path.join(directory,name));const bytes=raw({smallPhysicalTest:name});
    await fs.writeFile(path.join(directory,name,'proof.json'),bytes,{flag:'wx'});
    proofFiles.push({path:name+'/proof.json',bytes:bytes.length,sha256:hash(bytes)});
  }
  const patchSet={partCount:2,operationCount:2,partHashes:['1'.repeat(64),'2'.repeat(64)]};
  const buffers={'records.json':raw([]),'patch-set.json':raw(patchSet)};
  for(let i=0;i<2;i++){
    buffers[`part-00${i}.json`]=raw({patchHash:patchSet.partHashes[i],writes:[{after:'minecraft:stone'}]});
    buffers[`preview-00${i}.json`]=raw({previewHash:String(i+3).repeat(64)});
  }
  const content={branch,proofFiles,files:Object.entries(buffers).map(([file,bytes])=>({path:file,bytes:bytes.length,sha256:hash(bytes)})),
    partCount:2,previewHashes:['3'.repeat(64),'4'.repeat(64)],preparationHash:'a'.repeat(64)};
  const candidate={...content,candidateHash:hash(content)},cohort={kind:'original-complete-rebuild',candidate,patchSet};
  const root=path.join(directory,REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY);await fs.mkdir(root);
  for(const [file,bytes]of Object.entries({...buffers,'candidate.json':raw(candidate)}))await fs.writeFile(path.join(root,file),bytes,{flag:'wx'});
  const read=(options={})=>readCohortReferenceWorldAssemblyCandidate({directory,cohort,expectedCandidateHash:candidate.candidateHash,...options});
  return {directory,root,cohort,buffers,read};
}

test('warm member verification checks complete set while retaining only one original selected part',async t=>{
  const f=await members(t),metadata=await f.read(),part=await f.read({partIndex:0});
  assert.equal(metadata.retainedAllParts,false);assert.equal(Object.hasOwn(metadata,'selectedPart'),false);
  for(const name of ['buffers','patches','previews','native'])assert.equal(Object.hasOwn(part,name),false);
  assert.deepEqual(part.selectedPart.patch,JSON.parse(f.buffers['part-000.json']));
  const response=referenceWorldAssemblyCandidatePart(part,0);
  assert.equal(response.canAuthorizePlacement,false);assert.equal(response.worldWrites,0);assert.equal(response.partIsApplyScope,false);
});

for(const member of ['part-001.json','preview-001.json','records.json','patch-set.json'])
  test('warm read of first part rejects altered unrequested '+member,async t=>{
    const f=await members(t),file=path.join(f.root,member),bytes=await fs.readFile(file);
    const changed=Buffer.from(bytes);changed[changed.length-1]^=1;assert.equal(changed.length,bytes.length);
    await fs.writeFile(file,changed);await assert.rejects(f.read({partIndex:0}),/member differs/);
    await fs.writeFile(file,bytes);assert.equal((await f.read({partIndex:0})).selectedPart.index,0);
  });

test('disk self-rehashed candidate cannot change a previously fully verified original',async t=>{
  const f=await members(t),file=path.join(f.root,'candidate.json'),candidate=JSON.parse(await fs.readFile(file));
  const bytes=raw({patchHash:'9'.repeat(64)});await fs.writeFile(path.join(f.root,'part-001.json'),bytes);
  candidate.files=candidate.files.map(pin=>pin.path==='part-001.json'?{...pin,bytes:bytes.length,sha256:hash(bytes)}:pin);
  const {candidateHash,...changed}=candidate;await fs.writeFile(file,raw({...changed,candidateHash:hash(changed)}));
  await assert.rejects(f.read({partIndex:0}));
  await assert.rejects(f.read({expectedCandidateHash:hash(changed)}),/previously fully verified/);
});

test('same-size original proof edit, changed directory inventory and incomplete candidate reject',async t=>{
  const f=await members(t),proof=path.join(f.directory,'reference-world-assembly-final','proof.json'),before=await fs.readFile(proof);
  const edit=Buffer.from(before);edit[2]^=1;await fs.writeFile(proof,edit);await assert.rejects(f.read(),/proof changed/);
  await fs.writeFile(proof,before);
  const extra=path.join(f.directory,'assembly-journal','extra.json');await fs.writeFile(extra,'{}');await assert.rejects(f.read(),/proof changed/);
  await fs.unlink(extra);const unknown=path.join(f.root,'unknown.json');await fs.writeFile(unknown,'{}');
  await assert.rejects(f.read(),/unknown members/);await fs.unlink(unknown);
  await fs.rename(path.join(f.root,'part-001.json'),path.join(f.directory,'retained-unrequested-original'));
  await assert.rejects(f.read({partIndex:0}),e=>e.code==='ENOENT');
});

test('metadata canonical bytes, exact part index and aborted verification are mandatory',async t=>{
  const f=await members(t);for(const partIndex of [-1,2,'0',1.5])await assert.rejects(f.read({partIndex}),/previously fully verified/);
  await fs.writeFile(path.join(f.root,'candidate.json'),JSON.stringify(f.cohort.candidate,null,2));
  await assert.rejects(f.read(),/metadata changed/);
  const controller=new AbortController();controller.abort(Error('synthetic read stop'));
  await assert.rejects(f.read({signal:controller.signal}),/synthetic read stop/);
});

test('original proof changing after first pass is rejected before any warm result returns',async t=>{
  const f=await members(t),proof=path.join(f.directory,'reference-world-assembly-final','proof.json');
  const before=await fs.readFile(proof),after=Buffer.from(before);after[2]^=1;
  const open=fs.open;let injected=0;
  fs.open=async(file,...args)=>{
    if(file===path.join(f.root,'part-000.json')&&!injected){injected++;await fs.writeFile(proof,after);}
    return open(file,...args);
  };
  try{await assert.rejects(f.read({partIndex:0}),/proof changed during cohort read/);}
  finally{fs.open=open;await fs.writeFile(proof,before);}
  assert.equal(injected,1);assert.equal((await f.read({partIndex:0})).selectedPart.index,0);
});

test('hard-linked candidate member and redirected proof directory cannot use a warm cohort',async t=>{
  const f=await members(t),file=path.join(f.root,'part-001.json'),linked=path.join(f.directory,'second-link');
  await fs.link(file,linked);await assert.rejects(f.read({partIndex:0}),/type\/link\/size/);await fs.unlink(linked);
  const original=path.join(f.directory,'reference-world-assembly-final'),retained=path.join(f.directory,'retained-final');
  await fs.rename(original,retained);
  try{await fs.symlink(retained,original,process.platform==='win32'?'junction':'dir');}
  catch(e){if(['EPERM','EACCES'].includes(e.code)){t.skip('Directory-link privilege unavailable');return;}throw e;}
  await assert.rejects(f.read(),/redirected/);
});
