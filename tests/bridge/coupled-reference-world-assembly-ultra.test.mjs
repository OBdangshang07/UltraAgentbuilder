import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../../src/generation/compiler.mjs';
import {coupledTaskFixture} from './coupled-assembly-task-fixture.mjs';
import {runCoupledReferenceWorldAssembly,readCoupledReferenceWorldAssemblyCandidate} from '../../bridge/coupled-reference-world-assembly.mjs';
import {COUPLED_REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY} from '../../bridge/coupled-reference-world-assembly-candidate.mjs';
import {WORLD_ASSEMBLY_LIMITS} from '../../contracts/world-assembly-limits.mjs';

// Large REAL compiler/native/candidate path with authored SYNTHETIC answers and
// pixels only. This proves neither model/design quality nor installed gameplay.
test('new coupled Ultra completes actual 224-block height, staged packages, paired door and all original transport parts',{timeout:600000},async t=>{
  let h,completed=false;const cleanups=[];
  t.after(async()=>{
    // Keep a failed large synthetic asset for diagnosis; close its read worker.
    // Successful owned temporary fixtures can be removed in normal reverse order.
    if(!completed&&h){await h.store.close();return;}
    for(const cleanup of cleanups.reverse())await cleanup();
  });
  h=await coupledTaskFixture({after:fn=>cleanups.push(fn)},{tier:'ultra',staged:true,images:4,withDoor:true});
  t.diagnostic('Synthetic Ultra owned fixture: '+h.f.jobDirectory);
  const result=await runCoupledReferenceWorldAssembly({...h.runOptions,signal:AbortSignal.any([h.runOptions.signal,t.signal])}),c=result.candidate;
  const root=path.join(h.f.jobDirectory,COUPLED_REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY),native=result.native;
  assert.equal(c.tier,'ultra');assert.equal(c.maximumCalls,26);assert.equal(c.reservedCalls,h.calls.length);assert.equal(result.records.length,h.calls.length);
  assert.ok(h.calls.length>8&&h.calls.length<=26);assert.equal(c.pairCount,1);assert.ok(c.partCount>1);
  assert.equal(c.operationCount,native.manifest.setCount,'Original air baseline makes every original SET exactly one world difference');
  assert.deepEqual(native.manifest.dimensions,{width:32,height:224,length:32});
  let minY=Infinity,maxY=-Infinity,sets=0;const {width,height,length}=native.manifest.dimensions;
  for(let i=0;i<width*height*length;i++)if(native.binary.readUInt16LE(i*2)>=2){const y=Math.floor(i/(width*length));minY=Math.min(minY,y);maxY=Math.max(maxY,y);sets++;}
  assert.equal(sets,native.manifest.setCount);assert.equal(minY,0);assert.equal(maxY,223);assert.equal(maxY-minY+1,224,'Declared empty height is not enough');
  const formats=new Set(h.calls.map(call=>call.request.outputSchema.properties.format.enum[0]));
  for(const format of ['ArchitectureReferenceBrief','SceneConceptSet','SceneAssemblyBlueprint','ScenePrototypeRoleEdit','SceneAssemblyReview'])assert.ok(formats.has(format),format+' must actually execute');
  assert.ok(result.summary.completedPackages.length>=4);assert.equal(result.summary.finalTextReviewCurrent,true);assert.equal(result.summary.visualReviewCurrent,true);
  assert.equal(c.sourceHash,result.summary.sourceHash);assert.equal(c.couplingPlanHash,result.plan.planHash);assert.equal(result.binding.candidateHash,c.candidateHash);
  assert.equal(result.binding.partHashes.length,c.partCount);assert.equal(result.binding.previewHashes.length,c.partCount);
  assert.equal(c.files.length,5+2*c.partCount);assert.equal(c.files.some(f=>f.path==='binding.json'),false);
  for(const name of ['manifest.json','cells.bin'])assert.ok((await fs.readFile(path.join(root,name==='manifest.json'?'native-manifest.json':name))).equals(await fs.readFile(path.join(result.finalDirectory,name))));
  let offset=0;const doors=[];
  for(let i=0;i<c.partCount;i++){
    const name='part-'+String(i).padStart(3,'0')+'.json',part=JSON.parse(await fs.readFile(path.join(root,name)));
    assert.equal(part.index,i);assert.equal(part.offset,offset);assert.equal(part.partHash,result.patchSet.partHashes[i]);assert.equal(part.partIsApplyScope,false);
    assert.ok(part.writes.length>0&&part.writes.length<=WORLD_ASSEMBLY_LIMITS.operationsPerPart);offset+=part.writes.length;
    doors.push(...part.writes.filter(w=>w.after.startsWith('minecraft:dark_oak_door[')));
  }
  assert.equal(offset,c.operationCount);assert.equal(doors.length,2);
  const lower=doors.find(w=>w.after.includes('half=lower')),upper=doors.find(w=>w.after.includes('half=upper'));
  assert.ok(lower&&upper);assert.deepEqual(upper.position,[lower.position[0],lower.position[1]+1,lower.position[2]]);
  assert.deepEqual(result.plan.pairs[0].positions,[lower.position,upper.position]);
  const options={directory:h.f.jobDirectory,referenceInput:h.referenceInput,preparationHash:h.prepared.preparationHash,candidateHash:c.candidateHash};
  const last=await readCoupledReferenceWorldAssemblyCandidate({...options,partIndex:c.partCount-1});assert.equal(last.selectedPart.index,c.partCount-1);assert.equal(last.candidate.candidateHash,c.candidateHash);
  const file=path.join(root,'part-'+String(c.partCount-1).padStart(3,'0')+'.json'),bytes=await fs.readFile(file),changed=JSON.parse(bytes);
  changed.writes.at(-1).after='minecraft:diamond_block';const {partHash,...content}=changed;changed.partHash=hash(content);
  try{await fs.writeFile(file,JSON.stringify(changed));await assert.rejects(readCoupledReferenceWorldAssemblyCandidate({...options,partIndex:0}),/complete coupled member differs/);}
  finally{await fs.writeFile(file,bytes);}
  assert.equal((await readCoupledReferenceWorldAssemblyCandidate({...options,partIndex:0})).candidate.candidateHash,c.candidateHash);
  assert.equal(h.calls.length,c.reservedCalls,'Readonly verification/corruption never invokes another model');
  assert.equal(c.canAuthorizePlacement,false);assert.equal(c.serverBaselineVerified,false);assert.equal(c.physicsVerified,false);assert.equal(c.originalRegistryVerified,false);assert.equal(c.worldWrites,0);
  t.diagnostic('Synthetic Ultra evidence: '+JSON.stringify({reservedCalls:c.reservedCalls,maximumCalls:c.maximumCalls,partCount:c.partCount,operations:c.operationCount,pairs:c.pairCount,occupiedHeight:maxY-minY+1,actualModelCalls:0,gameLaunches:0,worldWrites:0}));
  completed=true;
});
