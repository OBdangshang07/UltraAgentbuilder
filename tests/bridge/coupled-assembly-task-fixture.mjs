import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from '../../src/generation/compiler.mjs';
import {selectionChunks,regionCells} from '../../contracts/world-selection.mjs';
import {WorldContextStore} from '../../bridge/world-context-store.mjs';
import {readJobReferenceInput} from '../../bridge/reference-generation-binding.mjs';
import {prepareCoupledReferenceWorldAssembly} from '../../bridge/coupled-reference-world-assembly-preparation.mjs';
import {prepareCoupledReferenceWorldAssemblyDraft,bindCoupledReferenceWorldAssemblyDraft} from '../../bridge/coupled-reference-world-assembly-input.mjs';
import {codexRequestFingerprint} from '../../bridge/codex-persistent-receipt.mjs';
import {requestNativeEvidence,acceptNativeEvidence,validateModelImageFiles} from '../../bridge/native-evidence.mjs';
import {fixtureUpload} from './native-evidence-fixtures.mjs';
import {referenceBrief} from './reference-generation-fixture.mjs';
import {jointPixelFixture} from './joint-assembly-input-fixture.mjs';
import {v4Request,v4Response} from './quality-v4-fixtures.mjs';
import {stagedRequest,stagedResponse} from './decomposed-assembly-fixtures.mjs';

// Synthetic complete-provider/renderer transport ONLY, never model, visual or
// architectural-quality evidence. All images/captures/responses are authored.
export const coupledSendFor=p=>({format:'CoupledReferenceWorldAssemblySend',version:1,purpose:'coupled-reference-world-assembly',confirmed:true,
  preparationHash:p.preparationHash,maximumCalls:p.maximumCalls});
const sendFor=coupledSendFor;
export async function coupledTaskFixture(t,{tier='lite',staged=false,images=2,protect=false,withDoor=true}={}) {
  const {model:unused,...generationOverrides}=staged?stagedRequest:v4Request;
  generationOverrides.qualityTier=tier;
  const f=await jointPixelFixture(t,{images,generationOverrides});
  const size=staged?[32,224,32]:[16,10,16],origin=[-16,-40,-16],contextId=randomUUID();
  const selection={format:'WorldSelection',version:1,world:{worldId:'world_joint_synthetic',dimension:'minecraft:overworld',minY:-64,maxY:320},revision:7,
    edit:{min:origin,max:origin.map((v,i)=>v+size[i])},context:{min:origin.map(v=>v-1),max:origin.map((v,i)=>v+size[i]+1)},
    protected:protect?[{min:[-14,-40,-14],max:[-13,-39,-13]}]:[]};
  const store=new WorldContextStore({dataDir:f.dataDir});t.after(()=>store.close());
  const capture={fence:{start:9,end:9},chunks:selectionChunks(selection).map(c=>({x:c.x,z:c.z,coverage:'known',
    palette:[{state:'minecraft:air',blockEntity:false}],runs:[[0,regionCells(c.region)]]}))};
  const saved=await store.operation('capture',contextId,Buffer.from(JSON.stringify({selection,capture})));
  const selectedCapability={id:f.generation.model,supportsImages:true,efforts:['high','max']};
  let referenceInput;
  {
    const options={dataDir:f.dataDir,contextId,referenceOwnerId:f.ownerId,referenceSetHash:f.manifest.setHash,generation:f.generation,selectedCapability};
    const draft=await prepareCoupledReferenceWorldAssemblyDraft(options);
    referenceInput=(await bindCoupledReferenceWorldAssemblyDraft({...options,directory:f.jobDirectory,send:sendFor(draft)})).referenceInput;
    await assert.rejects(fs.lstat(path.join(f.dataDir,'reference-drafts',f.ownerId,'preparations')),e=>e.code==='ENOENT');
  }
  const reference=await readJobReferenceInput({directory:f.jobDirectory,input:referenceInput,model:f.generation.model,runtimeHash:f.runtimeHash});
  const prepareOptions={dataDir:f.dataDir,directory:f.jobDirectory,contextId,referenceInput,selectedCapability};
  const prepared=await prepareCoupledReferenceWorldAssembly(prepareOptions),send=sendFor(prepared),calls=[],observations=[];
  const adapter={models:async()=>[structuredClone(selectedCapability)],generate:async request=>{
    const input=JSON.parse(request.prompt.split('Assembly input (data):\n').at(-1)),schema=request.outputSchema;
    const index=calls.length+1;calls.push({input,request,index});
    const ledger=JSON.parse(await fs.readFile(path.join(f.jobDirectory,'assembly-journal',`call-${index}.json`)));
    assert.equal(ledger.value.state,'pending','Original slot is durably reserved BEFORE dispatch');
    assert.equal(input.worldContext.snapshotHash,saved.record.snapshotHash);
    assert.deepEqual(input.worldContext.origin,origin);assert.equal(input.worldContext.canAuthorizePlacement,false);
    assert.match(request.prompt,/WORLD-BOUND ASSEMBLY/);assert.equal(request.model,f.generation.model);assert.equal(request.effort,'max');
    await validateModelImageFiles(request.images,f.jobDirectory);
    const hashes=request.referenceInput?reference.manifest.references.map(r=>r.sha256):await Promise.all(request.images.map(async file=>hash(await fs.readFile(file))));
    const binding={version:1,provider:'codex',storage:'persistent-single-turn',threadId:'synthetic-'+index,turnId:null,
      model:request.model,effort:request.effort,requestHash:codexRequestFingerprint({prompt:request.prompt,model:request.model,
        effort:request.effort,outputSchema:schema,imageHashes:hashes,...(request.referenceInput?{referenceBindingHash:reference.binding.bindingHash}:{})})};
    await request.onProviderBinding(binding);await request.onProviderBinding({...binding,turnId:'turn-'+index});
    if(schema.properties.format.enum[0]==='ArchitectureReferenceBrief') {
      assert.deepEqual(request.referenceInput,referenceInput);assert.equal(request.images.length,0);return {spec:referenceBrief(reference)};
    }
    assert.equal(request.referenceInput,undefined);assert.equal(input.referenceArchitecture.briefHash,hash(input.referenceArchitecture.brief));
    const response=(staged?stagedResponse:v4Response)(input,{outputSchema:schema});
    if(withDoor){
      const door={kind:'entry',id:'coupled_entry',host:'main',allowOverwrite:[],face:'north',u:3,feet:1,width:1,
        door:'dark_oak_door',frame:'frame',threshold:true,thresholdMaterial:'floor',canopy:0,open:true};
      if(schema.properties.format.enum[0]==='SceneAssemblyPlan')response.scene.components.push(door);
      // Ultra's staged branch creates its full program via a BLUEPRINT, not a
      // SceneAssemblyPlan. Inject only the authored synthetic provider answer,
      // before the real schema/compiler/review pipeline sees it.
      if(schema.properties.format.enum[0]==='SceneAssemblyBlueprint')response.sceneEdit.components.put.push(door);
    }
    return {spec:response};
  }};
  const runOptions={directory:f.jobDirectory,referenceInput,preparationHash:prepared.preparationHash,adapter,
    signal:new AbortController().signal,onStage:async records=>observations.push(records),
    nativeEvidence:o=>requestNativeEvidence({...o,jobDirectory:f.jobDirectory,timeoutMs:10000,onWaiting:async s=>{
      if(s.state==='waiting')await acceptNativeEvidence(f.jobDirectory,s.id,fixtureUpload(s.request));}})};
  return {f,referenceInput,reference,store,saved,contextId,selectedCapability,prepareOptions,prepared,send,calls,observations,adapter,runOptions};
}
