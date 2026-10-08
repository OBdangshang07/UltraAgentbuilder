import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {jointResourceFixture,jointResourceBytes} from '../tests/bridge/joint-assembly-resource-fixture.mjs';
import {createReferenceWorldAssemblyJobRegistry} from '../bridge/reference-world-assembly-job-registry.mjs';
import {readReferenceWorldAssemblyJobRecord} from '../bridge/reference-world-assembly-job-data.mjs';
import {createReferenceWorldAssemblyRunner} from '../bridge/reference-world-assembly-runner.mjs';

/** Production whole candidate, native/shared orchestration and read workers;
 * authored pixels, captures, responses and upload evidence are SYNTHETIC.
 * Never real image understanding, a server certificate or world acceptance. */
export async function makeReferenceWorldAssemblyCandidateFixtures(){
  const output=path.resolve(fileURLToPath(new URL('../mod/build/test-fixtures/',import.meta.url)));
  await fs.mkdir(output,{recursive:true});if(await fs.realpath(output)!==output)throw Error('Physical whole fixture output required');
  const fixtures=[];
  for(const tier of ['lite','ultra']){
    const cleanup=[];
    try{
      const h=await jointResourceFixture({after:fn=>cleanup.push(fn)},{tier});
      const registry=await createReferenceWorldAssemblyJobRegistry({dataDir:h.f.dataDir,resources:h.resources});cleanup.push(()=>registry.close());
      h.f.jobDirectory=path.join(registry.root,h.f.ownerId);
      const request={format:'ReferenceWorldAssemblyJobRequest',version:2,purpose:'reference-world-assembly',contextId:h.contextId,
        referenceOwnerId:h.f.ownerId,referenceSetHash:h.f.manifest.setHash,generation:h.f.generation,send:h.send};
      await registry.reserve({request,selectedCapability:h.input.selectedCapability});
      const original=await readReferenceWorldAssemblyJobRecord({dataDir:h.f.dataDir,id:h.f.ownerId});
      const options=await h.executionOptions({referenceInput:original.value.referenceInput});
      const runner=createReferenceWorldAssemblyRunner({registry,adapter:options.adapter,nativeEvidence:options.nativeEvidence});cleanup.push(()=>runner.close());
      await runner.start(h.f.ownerId);const status=await runner.wait(h.f.ownerId);
      if(status.state!=='preview-ready'||status.reservedCalls!==h.calls.length)throw Error('Original synthetic whole task did not close');
      const read={referenceInput:options.referenceInput,preparationHash:h.prepared.preparationHash,candidateHash:status.candidate.candidateHash};
      const metadata=await h.resources.operation('metadata',h.f.ownerId,jointResourceBytes(read)),parts=[];
      for(let index=0;index<metadata.candidate.partCount;index++)parts.push(await h.resources.operation('part',h.f.ownerId,jointResourceBytes({...read,partIndex:index})));
      fixtures.push({tier,contextId:h.contextId,contextRevision:h.saved.record.identity.contextRevision,selection:h.selection,
        payload:JSON.stringify({selection:h.selection,capture:h.capture}),saved:h.saved,generation:h.f.generation,
        manifest:h.f.manifest,capability:h.input.selectedCapability,prepared:h.prepared,request,status,metadata,parts,
        realModelCalls:0,worldWrites:0,serverBaselineVerified:false});
    }finally{
      const failures=[];for(const fn of cleanup.reverse())try{await fn();}catch(error){failures.push(error);}
      if(failures.length)throw new AggregateError(failures,'Original synthetic whole fixture cleanup failed; preserve failure');
    }
  }
  await fs.writeFile(path.join(output,'reference-world-assembly-candidate.json'),JSON.stringify(fixtures));
  // Retain the complete original aggregate above. Java consumes the same
  // exact transport parts sequentially, as the production HTTP client does,
  // instead of retaining seven parsed patch/guard trees simultaneously.
  const headers=[];
  for(const fixture of fixtures){
    const {parts,...header}=fixture;header.partFiles=[];
    for(let index=0;index<parts.length;index++){
      const name=`reference-world-assembly-candidate-${fixture.tier}-${index}.json`;
      const bytes=Buffer.from(JSON.stringify(parts[index]));
      await fs.writeFile(path.join(output,name),bytes);
      header.partFiles.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
    }
    headers.push(header);
  }
  await fs.writeFile(path.join(output,'reference-world-assembly-candidate-headers.json'),JSON.stringify(headers));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await makeReferenceWorldAssemblyCandidateFixtures();console.log(JSON.stringify({syntheticWholeFixtures:2,realModelCalls:0,worldWrites:0,javaTestsExecuted:false}));
}
