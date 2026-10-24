import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {coupledResourceFixture} from '../tests/bridge/coupled-assembly-resource-fixture.mjs';
import {createCoupledReferenceWorldAssemblyJobRegistry} from '../bridge/coupled-reference-world-assembly-job-registry.mjs';
import {readCoupledReferenceWorldAssemblyJobRecord} from '../bridge/coupled-reference-world-assembly-job-data.mjs';
import {createCoupledReferenceWorldAssemblyRunner} from '../bridge/coupled-reference-world-assembly-runner.mjs';
import {COUPLED_REFERENCE_ASSEMBLY_TERMINAL_FAILURE_FILE} from '../bridge/coupled-reference-world-assembly-terminal-failure.mjs';
import {hash} from '../src/generation/compiler.mjs';

/** REAL independent registration, native/shared orchestration and exact-file
 * workers. All providers/pictures/native uploads authored SYNTHETIC fixtures.
 * This does not invoke accounts, Java/game/native leases or world writes. */
export async function makeCoupledReferenceWorldAssemblyClientFixtures(){
  const output=path.resolve(fileURLToPath(new URL('../mod/build/test-fixtures/',import.meta.url)));
  await fs.mkdir(output,{recursive:true});if(await fs.realpath(output)!==output)throw Error('Physical coupled client fixture output required');
  const fixtures=[],headers=[];
  for(const tier of ['lite','pro','max','ultra']){
    const cleanup=[];let completed=false;
    try{
      const h=await coupledResourceFixture({after:fn=>cleanup.push(fn)},{tier,images:tier==='ultra'?4:1});
      const registry=await createCoupledReferenceWorldAssemblyJobRegistry({dataDir:h.f.dataDir,resources:h.resources});cleanup.push(()=>registry.close());
      h.f.jobDirectory=path.join(registry.root,h.f.ownerId);
      const request={format:'CoupledReferenceWorldAssemblyJobRequest',version:1,purpose:'coupled-reference-world-assembly',contextId:h.contextId,
        referenceOwnerId:h.f.ownerId,referenceSetHash:h.f.manifest.setHash,generation:h.f.generation,send:h.send};
      await registry.reserve({request,selectedCapability:h.input.selectedCapability});
      const retained=await h.operation('job-status',{expectedRequestHash:hash(request)});
      const fixture={tier,contextId:h.contextId,contextRevision:h.saved.record.identity.contextRevision,selection:h.selection,
        payload:JSON.stringify({selection:h.selection,capture:h.capture}),saved:h.saved,generation:h.f.generation,manifest:h.f.manifest,
        capability:h.input.selectedCapability,prepared:h.prepared,request,retained,
        capabilities:{format:'CoupledReferenceWorldAssemblyCapabilities',version:1,purpose:'coupled-reference-world-assembly',preparationImplemented:true,preparationEnabled:true,
          runtimeHash:h.prepared.runtimeHash,sendingImplemented:true,sendingEnabled:true,nativeRendererReady:true,nativeTransportImplemented:true,historyImplemented:true,
          automaticRetries:0,maximumCallsByTier:{lite:8,pro:14,max:20,ultra:26},sharedFullPipeline:true,independentJointConfirmationRequired:true,
          legacyConsentTransferable:false,playerUiImplemented:false,placementImplemented:false,serverBaselineVerified:false,canAuthorizePlacement:false},
        realModelCalls:0,worldWrites:0,serverBaselineVerified:false};
      fixtures.push(fixture);
      if(tier==='lite'||tier==='ultra'){
        const original=await readCoupledReferenceWorldAssemblyJobRecord({dataDir:h.f.dataDir,id:h.f.ownerId});
        const options=await h.executionOptions({referenceInput:original.value.referenceInput});
        const runner=createCoupledReferenceWorldAssemblyRunner({registry,adapter:options.adapter,nativeEvidence:options.nativeEvidence});cleanup.push(()=>runner.close());
        await runner.start(h.f.ownerId);const status=await runner.wait(h.f.ownerId);
        if(status.state!=='preview-ready'){
          const detail=await fs.readFile(path.join(h.f.jobDirectory,COUPLED_REFERENCE_ASSEMBLY_TERMINAL_FAILURE_FILE),'utf8').catch(()=>null);
          throw Error('Original synthetic coupled client fixture did not close: '+JSON.stringify({status,detail}));
        }
        const query={referenceInput:original.value.referenceInput,preparationHash:h.prepared.preparationHash,candidateHash:status.candidate.candidateHash};
        const metadata=await h.operation('metadata',query),cells=await h.operation('native-cells',query),partFiles=[];
        for(let index=0;index<metadata.candidate.partCount;index++){
          const part=await h.operation('part',{...query,partIndex:index}),name=`coupled-reference-world-assembly-candidate-${tier}-${index}.json`,bytes=Buffer.from(JSON.stringify(part));
          await fs.writeFile(path.join(output,name),bytes);partFiles.push({path:name,bytes:bytes.length,sha256:hash(bytes)});
        }
        headers.push({...fixture,status,metadata,cells,partFiles});
      }
      completed=true;
    }finally{
      // The fixture's first hook owns ONLY its newly-created synthetic temp
      // root. Preserve that root on a failure; still close all live workers.
      const hooks=completed?cleanup:cleanup.slice(1),failures=[];
      for(const fn of hooks.reverse())try{await fn();}catch(error){failures.push(error);}
      if(failures.length)throw new AggregateError(failures,'Original synthetic coupled fixture cleanup failed');
    }
  }
  await fs.writeFile(path.join(output,'coupled-reference-world-assembly-client.json'),JSON.stringify(fixtures));
  await fs.writeFile(path.join(output,'coupled-reference-world-assembly-candidate-headers.json'),JSON.stringify(headers));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await makeCoupledReferenceWorldAssemblyClientFixtures();console.log(JSON.stringify({syntheticCoupledClientFixtures:4,syntheticCompleteTasks:2,realModelCalls:0,worldWrites:0,javaTestsExecuted:false}));
}
