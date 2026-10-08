import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {jointPixelFixture} from './joint-assembly-input-fixture.mjs';
import {v4Request,v4Response} from './quality-v4-fixtures.mjs';
import {stagedRequest,stagedResponse} from './decomposed-assembly-fixtures.mjs';
import {selectionChunks,regionCells} from '../../contracts/world-selection.mjs';
import {WorldContextStore} from '../../bridge/world-context-store.mjs';
import {ReferenceWorldAssemblyResources} from '../../bridge/reference-world-assembly-resources.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {readJobReferenceInput} from '../../bridge/reference-generation-binding.mjs';
import {runReferenceWorldAssembly} from '../../bridge/reference-world-assembly.mjs';
import {codexRequestFingerprint} from '../../bridge/codex-persistent-receipt.mjs';
import {requestNativeEvidence,acceptNativeEvidence} from '../../bridge/native-evidence.mjs';
import {fixtureUpload} from './native-evidence-fixtures.mjs';
import {referenceBrief} from './reference-generation-fixture.mjs';

export const jointResourceBytes=value=>Buffer.from(JSON.stringify(value));
export const jointResourceSend=p=>({format:'ReferenceWorldAssemblySend',version:2,purpose:'reference-world-assembly',confirmed:true,
  preparationHash:p.preparationHash,maximumCalls:p.maximumCalls});
export async function jointResourceFixture(t,{tier='lite',images=2}={}) {
  const staged=tier==='ultra',{model,...generationOverrides}=staged?stagedRequest:v4Request;
  const f=await jointPixelFixture(t,{images,generationOverrides:{...generationOverrides,qualityTier:tier}});
  const contextId=randomUUID(),size=staged?[32,224,32]:[16,10,16],origin=[-16,-40,-16];
  const selection={format:'WorldSelection',version:1,world:{worldId:'joint_resource_synthetic',dimension:'minecraft:overworld',minY:-64,maxY:320},
    revision:7,edit:{min:origin,max:origin.map((v,i)=>v+size[i])},context:{min:origin.map(v=>v-1),max:origin.map((v,i)=>v+size[i]+1)},protected:[]};
  const capture={fence:{start:9,end:9},chunks:selectionChunks(selection).map(c=>({x:c.x,z:c.z,coverage:'known',
    palette:[{state:'minecraft:air',blockEntity:false}],runs:[[0,regionCells(c.region)]]}))};
  const contexts=new WorldContextStore({dataDir:f.dataDir}),resources=new ReferenceWorldAssemblyResources({dataDir:f.dataDir});
  t.after(()=>contexts.close());t.after(()=>resources.close());
  const saved=await contexts.operation('capture',contextId,jointResourceBytes({selection,capture}));
  const selectedCapability={id:f.generation.model,supportsImages:true,efforts:['high','max']};
  const input={contextId,referenceSetHash:f.manifest.setHash,generation:f.generation,selectedCapability};
  const operation=(operation,value=input,options)=>resources.operation(operation,f.ownerId,jointResourceBytes(value),options);
  const prepared=await operation('prepare'),send=jointResourceSend(prepared),calls=[];
  async function bind() {
    // Synthetic future job OWNER, not the worker, creates the new directory.
    await fs.mkdir(resources.root);const jobDirectory=path.join(resources.root,f.ownerId);
    await fs.rename(f.jobDirectory,jobDirectory);f.jobDirectory=jobDirectory;
    return operation('bind',{...input,send});
  }
  async function run(bound) {
    const reference=await readJobReferenceInput({directory:f.jobDirectory,input:bound.referenceInput,model:f.generation.model});
    const adapter={models:async()=>[selectedCapability],generate:async request=>{
      const index=calls.length+1;calls.push(request);
      const data=JSON.parse(request.prompt.split('Assembly input (data):\n').at(-1));
      assert.equal(data.worldContext.snapshotHash,saved.record.snapshotHash);assert.deepEqual(data.worldContext.origin,origin);
      const call=JSON.parse(await fs.readFile(path.join(f.jobDirectory,'assembly-journal',`call-${index}.json`)));
      assert.equal(call.value.state,'pending');
      const imageHashes=request.referenceInput?reference.manifest.references.map(r=>r.sha256):await Promise.all(request.images.map(async file=>hash(await fs.readFile(file))));
      const binding={version:1,provider:'codex',storage:'persistent-single-turn',threadId:'synthetic-resources-'+index,turnId:null,
        model:request.model,effort:request.effort,requestHash:codexRequestFingerprint({prompt:request.prompt,model:request.model,effort:request.effort,
          outputSchema:request.outputSchema,imageHashes,...(request.referenceInput?{referenceBindingHash:hash(request.referenceInput)}:{})})};
      await request.onProviderBinding(binding);await request.onProviderBinding({...binding,turnId:'turn-'+index});
      if(request.outputSchema.properties.format.enum[0]==='ArchitectureReferenceBrief')return {spec:referenceBrief(reference)};
      return {spec:(staged?stagedResponse:v4Response)(data,{outputSchema:request.outputSchema})};
    }};
    return runReferenceWorldAssembly({directory:f.jobDirectory,referenceInput:bound.referenceInput,preparationHash:prepared.preparationHash,adapter,
      signal:new AbortController().signal,onStage:async()=>{},nativeEvidence:options=>requestNativeEvidence({...options,jobDirectory:f.jobDirectory,
        timeoutMs:10000,onWaiting:async status=>{if(status.state==='waiting')await acceptNativeEvidence(f.jobDirectory,status.id,fixtureUpload(status.request));}})});
  }
  return {f,resources,contexts,contextId,selection,capture,saved,input,prepared,send,operation,bind,run,calls};
}
