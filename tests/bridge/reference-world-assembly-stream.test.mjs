import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../../src/generation/compiler.mjs';
import {compileAssemblyWorldPatch} from '../../src/world/assembly-context.mjs';
import {prepareWorldPatchPreview} from '../../src/world/world-patch-preview-data.mjs';
import {readFrozenReferenceWorldAssembly,runReferenceWorldAssembly,readReferenceWorldAssemblyCandidate,
  readReferenceWorldAssemblyCandidatePart} from '../../bridge/reference-world-assembly.mjs';
import {REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY,REFERENCE_ASSEMBLY_CANDIDATE_CLAIM,
  saveReferenceWorldAssemblyCandidate} from '../../bridge/reference-world-assembly-candidate.mjs';
import {jointResourceFixture} from './joint-assembly-resource-fixture.mjs';

const raw=value=>Buffer.from(JSON.stringify(value));
const partName=(kind,i)=>`${kind}-${String(i).padStart(3,'0')}.json`;
async function fixture(t,tier='lite') {
  const h=await jointResourceFixture(t,{tier,images:1}),bound=await h.bind();
  const result=await runReferenceWorldAssembly({...await h.executionOptions(bound),retainCandidateParts:false});
  const original=await readFrozenReferenceWorldAssembly({directory:h.f.jobDirectory,referenceInput:bound.referenceInput});
  const options={directory:h.f.jobDirectory,referenceInput:bound.referenceInput,preparationHash:h.prepared.preparationHash,
    candidateHash:result.candidate.candidateHash};
  return {h,bound,result,original,options,root:path.join(h.f.jobDirectory,REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY)};
}

test('bounded production save and reads preserve exact legacy v2 complete candidate identity',async t=>{
  const f=await fixture(t),calls=f.h.calls.length;
  assert.equal(f.result.retainedAllParts,false);assert.equal(Object.hasOwn(f.result,'patches'),false);
  const metadata=await readReferenceWorldAssemblyCandidate({...f.options,retainParts:false});
  assert.equal(metadata.retainedAllParts,false);
  for(const name of ['buffers','patches','previews','selectedPart'])assert.equal(Object.hasOwn(metadata,name),false);
  const legacy=compileAssemblyWorldPatch(f.original.worldContext,metadata.native);
  const previews=legacy.patches.map(p=>prepareWorldPatchPreview(f.original.saved.snapshot,p));
  const buffers={'records.json':raw(f.result.records),'patch-set.json':raw(legacy.patchSet)};
  legacy.patches.forEach((p,i)=>{buffers[partName('part',i)]=raw(p);buffers[partName('preview',i)]=raw(previews[i]);});
  const files=Object.entries(buffers).map(([name,bytes])=>({path:name,bytes:bytes.length,sha256:hash(bytes)}));
  assert.deepEqual(metadata.candidate.files,files);assert.deepEqual(metadata.patchSet,legacy.patchSet);
  assert.equal(metadata.candidate.files.length,2+2*metadata.patchSet.partCount);
  assert.equal(metadata.candidate.files.some(pin=>pin.path==='candidate.json'),false);
  const {candidateHash,...content}=metadata.candidate;
  assert.equal(hash({...content,files,previewHashes:previews.map(p=>p.previewHash)}),candidateHash);
  const retained=await readReferenceWorldAssemblyCandidate(f.options);
  assert.equal(retained.retainedAllParts,true);assert.deepEqual(retained.patches,legacy.patches);
  const selected=await readReferenceWorldAssemblyCandidate({...f.options,retainParts:false,partIndex:0});
  assert.equal(Object.hasOwn(selected,'patches'),false);assert.deepEqual(selected.selectedPart.patch,legacy.patches[0]);
  const part=await readReferenceWorldAssemblyCandidatePart({...f.options,partIndex:0});
  assert.deepEqual(part.patch,legacy.patches[0]);assert.deepEqual(part.preview,previews[0]);
  assert.equal(part.canAuthorizePlacement,false);assert.equal(part.partIsApplyScope,false);
  assert.equal(f.h.calls.length,calls);assert.equal(metadata.candidate.worldWrites,0);
});

test('bounded metadata and one-part reads reject corruption of a different part', {timeout:180000},async t=>{
  const f=await fixture(t,'ultra'),calls=f.h.calls.length;
  assert.ok(f.result.patchSet.partCount>1);
  const file=path.join(f.root,partName('part',f.result.patchSet.partCount-1)),bytes=await fs.readFile(file);
  const changed=JSON.parse(bytes);changed.writes[0].after='minecraft:diamond_block';
  try{
    await fs.writeFile(file,raw(changed));
    await assert.rejects(readReferenceWorldAssemblyCandidate({...f.options,retainParts:false}),/member differs/);
    await assert.rejects(readReferenceWorldAssemblyCandidatePart({...f.options,partIndex:0}),/member differs/);
  }finally{await fs.writeFile(file,bytes);}
  assert.equal((await readReferenceWorldAssemblyCandidate({...f.options,retainParts:false})).candidate.candidateHash,f.options.candidateHash);
  assert.equal(f.h.calls.length,calls);
});

for(const mode of ['disk-failure','cancelled'])test(mode+' streaming publication retains exact claim/provisional files and cannot resume as a complete candidate',async t=>{
  const f=await fixture(t),calls=f.h.calls.length,retained=path.join(f.h.f.jobDirectory,'retained-complete-candidate');
  await fs.rename(f.root,retained); // Preserve original successful synthetic evidence.
  const claimFile=path.join(f.h.f.jobDirectory,REFERENCE_ASSEMBLY_CANDIDATE_CLAIM),controller=new AbortController();
  const originalOpen=fs.open;let injected=0;
  fs.open=async(file,flags,...args)=>{
    if(flags==='wx' && file===path.join(f.root,mode==='disk-failure'?'preview-000.json':'part-000.json')){
      injected++;
      if(mode==='disk-failure')throw Object.assign(Error('synthetic disk failure'),{code:'ENOSPC'});
      controller.abort(Error('synthetic publication cancellation'));
    }
    return originalOpen(file,flags,...args);
  };
  try{
    await assert.rejects(saveReferenceWorldAssemblyCandidate({directory:f.h.f.jobDirectory,original:f.original,
      result:f.result,retainParts:false,signal:controller.signal}),/synthetic/);
  }finally{fs.open=originalOpen;}
  assert.equal(injected,1);
  const claim=await fs.readFile(claimFile),provisional=await fs.readFile(path.join(f.root,'part-000.json'));
  assert.equal(JSON.parse(claim).candidateHash,f.result.candidate.candidateHash);
  assert.ok(provisional.length>0);
  await assert.rejects(fs.lstat(path.join(f.root,'candidate.json')),e=>e.code==='ENOENT');
  await assert.rejects(saveReferenceWorldAssemblyCandidate({directory:f.h.f.jobDirectory,original:f.original,
    result:f.result,retainParts:false}),e=>e.code==='EEXIST');
  await assert.rejects(readReferenceWorldAssemblyCandidate({...f.options,retainParts:false}));
  assert.deepEqual(await fs.readFile(claimFile),claim);assert.deepEqual(await fs.readFile(path.join(f.root,'part-000.json')),provisional);
  assert.equal(f.h.calls.length,calls);assert.equal(f.result.joint.worldWrites,0);
});
