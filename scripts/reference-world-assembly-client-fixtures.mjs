import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {jointResourceFixture} from '../tests/bridge/joint-assembly-resource-fixture.mjs';
import {createReferenceWorldAssemblyJobRegistry} from '../bridge/reference-world-assembly-job-registry.mjs';
import {readReferenceWorldAssemblyJobStatus} from '../bridge/reference-world-assembly-history.mjs';
import {hash} from '../src/generation/compiler.mjs';

/** Production Node receipts for FREE Java transport tests. All pixels,
 * captures and reservations are synthetic; no adapter or model is called. */
export async function makeReferenceWorldAssemblyClientFixtures(){
  const output=path.resolve(fileURLToPath(new URL('../mod/build/test-fixtures/',import.meta.url)));
  await fs.mkdir(output,{recursive:true});if(await fs.realpath(output)!==output)throw Error('Physical fixture output required');
  const fixtures=[];
  for(const tier of ['lite','pro','max','ultra']){
    const cleanup=[];
    try{
      const f=await jointResourceFixture({after:fn=>cleanup.push(fn)},{tier});
      const request={format:'ReferenceWorldAssemblyJobRequest',version:2,purpose:'reference-world-assembly',contextId:f.contextId,
        referenceOwnerId:f.f.ownerId,referenceSetHash:f.f.manifest.setHash,generation:f.f.generation,send:f.send};
      const registry=await createReferenceWorldAssemblyJobRegistry({dataDir:f.f.dataDir,resources:f.resources});
      await registry.reserve({request,selectedCapability:f.input.selectedCapability});
      const retained=await readReferenceWorldAssemblyJobStatus({dataDir:f.f.dataDir,id:f.f.ownerId,expectedRequestHash:hash(request)});
      fixtures.push({tier,contextId:f.contextId,contextRevision:f.saved.record.identity.contextRevision,
        selection:f.selection,payload:JSON.stringify({selection:f.selection,capture:f.capture}),saved:f.saved,
        generation:f.f.generation,manifest:f.f.manifest,capability:f.input.selectedCapability,prepared:f.prepared,request,retained,
        capabilities:{format:'ReferenceWorldAssemblyCapabilities',version:2,purpose:'reference-world-assembly',preparationImplemented:true,preparationEnabled:true,
          runtimeHash:f.prepared.runtimeHash,sendingImplemented:true,sendingEnabled:true,nativeRendererReady:true,nativeTransportImplemented:true,historyImplemented:true,
          automaticRetries:0,maximumCallsByTier:{lite:8,pro:14,max:20,ultra:26},sharedFullPipeline:true,independentJointConfirmationRequired:true,
          legacyConsentTransferable:false,playerUiImplemented:false,placementImplemented:false,serverBaselineVerified:false,canAuthorizePlacement:false},
        realModelCalls:0,worldWrites:0});
    }finally{
      const failures=[];for(const fn of cleanup.reverse())try{await fn();}catch(error){failures.push(error);}
      if(failures.length)throw new AggregateError(failures,'Synthetic full client fixture cleanup failed; preserve failure');
    }
  }
  await fs.writeFile(path.join(output,'reference-world-assembly-client.json'),JSON.stringify(fixtures));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await makeReferenceWorldAssemblyClientFixtures();console.log(JSON.stringify({syntheticFullClientFixtures:4,realModelCalls:0,worldWrites:0,javaTestsExecuted:false}));
}
