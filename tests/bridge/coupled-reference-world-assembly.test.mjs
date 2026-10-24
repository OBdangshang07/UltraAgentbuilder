import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {coupledTaskFixture} from './coupled-assembly-task-fixture.mjs';
import {runCoupledReferenceWorldAssembly,readCoupledReferenceWorldAssemblyCandidate} from '../../bridge/coupled-reference-world-assembly.mjs';
import {COUPLED_REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY as candidateDirectory,COUPLED_REFERENCE_ASSEMBLY_CANDIDATE_CLAIM as candidateClaim} from '../../bridge/coupled-reference-world-assembly-candidate.mjs';
import {COUPLED_REFERENCE_ASSEMBLY_RUN_CLAIM} from '../../bridge/coupled-reference-world-assembly-run-claim.mjs';
import {readJointAssemblyReferenceInput,validateJointAssemblyReferenceInput} from '../../bridge/reference-world-assembly-input.mjs';
import {validateCoupledAssemblyReferenceInput} from '../../bridge/coupled-reference-world-assembly-input.mjs';
import {validateCoupledReferenceWorldAssemblyJobRequest,coupledReferenceAssemblyOriginalRequest} from '../../contracts/coupled-reference-world-assembly-job.mjs';
import {readFrozenCoupledReferenceWorldAssembly} from '../../bridge/coupled-reference-world-assembly-preparation.mjs';
import {validateReferenceWorldAssemblyJobRequest} from '../../contracts/reference-world-assembly-job.mjs';
import {codexImageInput} from '../../bridge/codex-image-input.mjs';

test('new pixel-only coupled input uses its independent SEND and cannot cross legacy validators',async t=>{
  const h=await coupledTaskFixture(t),original=await readFrozenCoupledReferenceWorldAssembly({directory:h.f.jobDirectory,referenceInput:h.referenceInput});
  validateCoupledAssemblyReferenceInput(h.referenceInput);assert.equal(h.referenceInput.version,1);
  assert.throws(()=>validateJointAssemblyReferenceInput(h.referenceInput));
  await assert.rejects(readJointAssemblyReferenceInput({directory:h.f.jobDirectory,input:h.referenceInput,model:h.f.generation.model}));
  const request=coupledReferenceAssemblyOriginalRequest(original);validateCoupledReferenceWorldAssemblyJobRequest(request);assert.throws(()=>validateReferenceWorldAssemblyJobRequest(request));
  for(const change of [{format:'ReferenceWorldAssemblyJobRequest',version:2},{purpose:'reference-world-assembly'},{send:{...request.send,format:'ReferenceWorldAssemblySend',version:2}}])assert.throws(()=>validateCoupledReferenceWorldAssemblyJobRequest({...request,...change}));
  const images=await codexImageInput({cwd:h.f.jobDirectory,referenceInput:h.referenceInput,model:h.f.generation.model});assert.deepEqual(images.images,original.reference.images);
  assert.equal(h.calls.length,0);await assert.rejects(fs.lstat(path.join(h.f.jobDirectory,'assembly-journal')),{code:'ENOENT'});
});

test('complete coupled Lite generation retains reviewed actual door/native/plan/all parts and derives binding after candidate hash',async t=>{
  const h=await coupledTaskFixture(t),result=await runCoupledReferenceWorldAssembly(h.runOptions),c=result.candidate,root=path.join(h.f.jobDirectory,candidateDirectory);
  assert.equal(h.calls.length,8);assert.equal(c.reservedCalls,8);assert.equal(c.pairCount,1);assert.equal(c.canAuthorizePlacement,false);assert.equal(c.originalRegistryVerified,false);assert.equal(c.worldWrites,0);
  for(const call of h.calls){assert.equal(call.input.worldContext.format,'CoupledAssemblyWorldContext');assert.match(call.request.prompt,/New doors must have both matching lower\/upper/);}
  assert.equal(c.couplingPlanHash,result.plan.planHash);assert.equal(result.binding.candidateHash,c.candidateHash);assert.equal(result.binding.sourceHash,c.sourceHash);assert.equal(result.binding.captureId,h.contextId);
  assert.equal(c.files.some(f=>['binding.json','candidate.json'].includes(f.path)),false);assert.ok(c.proofFiles.some(f=>f.path===COUPLED_REFERENCE_ASSEMBLY_RUN_CLAIM));
  assert.ok((await fs.readFile(path.join(root,'native-manifest.json'))).equals(await fs.readFile(path.join(result.finalDirectory,'manifest.json'))));
  assert.ok((await fs.readFile(path.join(root,'cells.bin'))).equals(await fs.readFile(path.join(result.finalDirectory,'cells.bin'))));
  const options={directory:h.f.jobDirectory,referenceInput:h.referenceInput,preparationHash:h.prepared.preparationHash,candidateHash:c.candidateHash};
  const read=await readCoupledReferenceWorldAssemblyCandidate({...options,partIndex:0});assert.equal(read.selectedPart.index,0);assert.equal(read.selectedPart.part.partHash,read.patchSet.partHashes[0]);assert.equal(read.candidate.candidateHash,c.candidateHash);
  assert.ok(read.selectedPart.part.writes.some(w=>w.after.includes('dark_oak_door[')&&w.after.includes('half=lower')));
  for(const name of ['binding.json','coupling-plan.json','native-manifest.json','cells.bin','part-000.json','preview-000.json']){
    const file=path.join(root,name),bytes=await fs.readFile(file);try{const changed=Buffer.from(bytes);changed[changed.length-1]^=1;await fs.writeFile(file,changed);await assert.rejects(readCoupledReferenceWorldAssemblyCandidate({...options,partIndex:0}));}finally{await fs.writeFile(file,bytes);}
  }
  const proof=c.proofFiles.find(f=>f.path.endsWith('/1/input.json')),file=path.join(h.f.jobDirectory,proof.path),bytes=await fs.readFile(file);
  try{await fs.writeFile(file,Buffer.concat([bytes,Buffer.from(' ')]));await assert.rejects(readCoupledReferenceWorldAssemblyCandidate(options));}finally{await fs.writeFile(file,bytes);}
  assert.equal((await readCoupledReferenceWorldAssemblyCandidate(options)).candidate.candidateHash,c.candidateHash);assert.equal(h.calls.length,8);
  await assert.rejects(fs.lstat(path.join(h.f.jobDirectory,candidateClaim)),{code:'ENOENT'});
  await assert.rejects(runCoupledReferenceWorldAssembly(h.runOptions),/Existing original|restart|EEXIST/);assert.equal(h.calls.length,8);
});

test('coupled disk failure keeps original claim/provisional files without publishing metadata or restarting generation',async t=>{
  const h=await coupledTaskFixture(t),open=fs.open;let injected=0;
  try{await assert.rejects(runCoupledReferenceWorldAssembly({...h.runOptions,onLocalPhase:phase=>{
    if(phase==='candidate-publication')fs.open=async(file,flags,...args)=>{if(flags==='wx'&&file===path.join(h.f.jobDirectory,candidateDirectory,'part-000.json')){injected++;throw Object.assign(Error('synthetic coupled disk full'),{code:'ENOSPC'});}return open(file,flags,...args);};
  }}),/synthetic coupled disk full/);}finally{fs.open=open;}
  assert.equal(injected,1);assert.equal(h.calls.length,8);const claim=await fs.readFile(path.join(h.f.jobDirectory,candidateClaim));assert.equal(JSON.parse(claim).format,'CoupledReferenceWorldAssemblyCandidatePublication');
  await assert.rejects(fs.lstat(path.join(h.f.jobDirectory,candidateDirectory,'candidate.json')),{code:'ENOENT'});assert.ok((await fs.readFile(path.join(h.f.jobDirectory,candidateDirectory,'cells.bin'))).length>0);
  await assert.rejects(runCoupledReferenceWorldAssembly(h.runOptions),/Existing original|restart/);assert.equal(h.calls.length,8);assert.ok(claim.equals(await fs.readFile(path.join(h.f.jobDirectory,candidateClaim))));
});

test('aborting coupled execution at publication keeps eight original calls and cannot restart from its ledger',async t=>{
  const h=await coupledTaskFixture(t),controller=new AbortController();
  await assert.rejects(runCoupledReferenceWorldAssembly({...h.runOptions,signal:controller.signal,onLocalPhase:phase=>{if(phase==='candidate-publication')controller.abort(Error('synthetic coupled publication cancelled'));}}),/synthetic coupled publication cancelled/);
  assert.equal(h.calls.length,8);await assert.rejects(fs.lstat(path.join(h.f.jobDirectory,candidateDirectory)),{code:'ENOENT'});
  const claim=await fs.readFile(path.join(h.f.jobDirectory,COUPLED_REFERENCE_ASSEMBLY_RUN_CLAIM));await assert.rejects(runCoupledReferenceWorldAssembly(h.runOptions),/Existing original|restart/);assert.equal(h.calls.length,8);assert.ok(claim.equals(await fs.readFile(path.join(h.f.jobDirectory,COUPLED_REFERENCE_ASSEMBLY_RUN_CLAIM))));
});

test('cancellation after metadata bytes are written cannot adopt an uncertain publication by readonly reopening',async t=>{
  const h=await coupledTaskFixture(t),open=fs.open,controller=new AbortController();let injected=0;
  try{await assert.rejects(runCoupledReferenceWorldAssembly({...h.runOptions,signal:controller.signal,onLocalPhase:phase=>{
    if(phase==='candidate-publication')fs.open=async(file,flags,...args)=>{
      const handle=await open(file,flags,...args);
      if(flags!=='wx'||file!==path.join(h.f.jobDirectory,candidateDirectory,'candidate.json'))return handle;
      return {writeFile:async bytes=>{await handle.writeFile(bytes);injected++;controller.abort(Error('synthetic coupled metadata closure cancelled'));},sync:()=>handle.sync(),close:()=>handle.close()};
    };
  }}),/synthetic coupled metadata closure cancelled/);}finally{fs.open=open;}
  assert.equal(injected,1);assert.equal(h.calls.length,8);
  const metadata=JSON.parse(await fs.readFile(path.join(h.f.jobDirectory,candidateDirectory,'candidate.json'))),claim=await fs.readFile(path.join(h.f.jobDirectory,candidateClaim));
  await assert.rejects(readCoupledReferenceWorldAssemblyCandidate({directory:h.f.jobDirectory,referenceInput:h.referenceInput,preparationHash:h.prepared.preparationHash,candidateHash:metadata.candidateHash}),/incomplete or uncertain/);
  await assert.rejects(runCoupledReferenceWorldAssembly(h.runOptions),/Existing original|restart/);assert.equal(h.calls.length,8);assert.ok(claim.equals(await fs.readFile(path.join(h.f.jobDirectory,candidateClaim))));
});
