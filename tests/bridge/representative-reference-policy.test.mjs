import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {stagedRequest} from './decomposed-assembly-fixtures.mjs';
import {referenceAssemblyPreflight} from '../../bridge/reference-assembly-policy.mjs';
import {validateReferencePreparation} from '../../contracts/reference-preparation.mjs';
import {representativeEvidenceEnabled} from '../../contracts/assembly-evidence-policy.mjs';
import {referencePreparationOperation} from '../../bridge/reference-preparation-worker.mjs';
import {encodeReferencePixels} from '../../bridge/reference-pixels.mjs';

const generation=key=>({...stagedRequest,key,model:'offline-camera-reference',effort:'max',assemblyEvidence:'representative-v1'});
const png=encodeReferencePixels(1,1,Buffer.from([12,34,56,255])).toString('base64');
const preparedRequest=ownerId=>({format:'ReferenceGenerationPreparationRequest',version:2,generation:generation(ownerId),
 upload:{format:'UserReferenceUpload',version:1,mode:'multi-view',references:['front','side'].map(view=>({png,annotation:{purpose:'exterior',view,caption:'Synthetic reference fixture only'}}))}});
test('reference v2 retains representative evidence in the SAME task budget; legacy v1 cannot gain it',()=>{
 const key=randomUUID(),input=preparedRequest(key),current=validateReferencePreparation(key,input);
 assert.equal(current.assembly.cameraEvidence.mode,'representative-v1');
 const old=generation(key);delete old.assemblyEvidence;
 const legacy=referenceAssemblyPreflight(old),{cameraEvidence,...rest}=current.assembly;
 assert.deepEqual(rest,legacy.assembly);assert.equal(current.maximumCalls,26);assert.equal(current.assembly.maxPackages,5);
 assert.throws(()=>validateReferencePreparation(key,{...input,version:1}),/preparation v2/);
 assert.equal(representativeEvidenceEnabled(current.assembly),true);
});
test('exact representative policy refuses legacy staged versions, moving cameras and hidden authority',()=>{
 const tier=referenceAssemblyPreflight(generation(randomUUID())).assembly;
 for(const version of [1,2,3,4]){
  const old=structuredClone(tier);old.prototypes.version=version;
  assert.throws(()=>representativeEvidenceEnabled(old));
 }
 for(const delta of [{version:2},{comparisonCameras:'moving'},{canAuthorizePlacement:true},{worldAuthority:true}])
  assert.throws(()=>representativeEvidenceEnabled({...tier,cameraEvidence:{...tier.cameraEvidence,...delta}}));
});
test('real free preparation and confirmation preserve the new policy, both picture identities and zero calls',async()=>{
 const ownerId=randomUUID(),input=preparedRequest(ownerId),dataDir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'representative-reference-')));
 const options={dataDir,ownerId,runtimeHash:'c'.repeat(64),capability:{id:input.generation.model,supportsImages:true}};
 const prepared=await referencePreparationOperation({...options,operation:'prepare',input:Buffer.from(JSON.stringify(input))});
 assert.deepEqual(prepared.generation,input.generation);assert.equal(prepared.references.length,2);
 assert.equal(prepared.policy.assembly.cameraEvidence.mode,'representative-v1');
 assert.equal(prepared.callsReserved,0);assert.equal(prepared.generationSubmitted,false);assert.equal(prepared.canAuthorizePlacement,false);
 const confirmation={format:'ReferenceSendConfirmation',version:1,ownerId,requestHash:prepared.requestHash,setHash:prepared.referenceSetHash,provider:'codex',model:input.generation.model,accepted:true};
 const confirmed=await referencePreparationOperation({...options,operation:'confirm',preparationHash:prepared.preparationHash,input:Buffer.from(JSON.stringify(confirmation))});
 assert.equal(confirmed.accepted,true);assert.equal(confirmed.callsReserved,0);assert.equal(confirmed.generationSubmitted,false);
 assert.deepEqual(await fs.readdir(dataDir),['reference-drafts']);
});
