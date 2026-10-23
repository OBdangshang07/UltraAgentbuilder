import fs from 'node:fs/promises';
import {assemblyCoupledFixtures} from './assembly-coupled-fixtures.mjs';
import {createContextSnapshot} from '../src/world/context-snapshot.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {compileCoupledAssemblyPlan,streamCoupledAssemblyParts} from '../src/world/assembly-coupled-plan.mjs';
import {prepareCoupledAssemblyPreview} from '../src/world/assembly-coupled-preview.mjs';
import {prepareCoupledAssemblyBinding} from '../src/world/assembly-coupled-binding.mjs';

/** Raw synthetic cells and an opaque synthetic source digest, not a compiled
 * SceneSpec, paid model answer, real-world capture or placement consent. */
export async function coupledTransportFixtures(){
  const base=await assemblyCoupledFixtures(),cases=[];
  for(const [i,f]of base.valid.entries()){
    const snapshot=createContextSnapshot(f.selection,f.capture),manifest=structuredClone(f.manifest),sourceHash=hash('synthetic-source-'+f.name);
    manifest.scene={sourceHash};const {assetHash,...metadata}=manifest;manifest.assetHash=hash(metadata);
    const binary=Buffer.from(f.cellsBase64,'base64'),plan=compileCoupledAssemblyPlan(snapshot,{manifest,binary}),parts=[],previews=[];
    const patchSet=await streamCoupledAssemblyParts(plan,{onPart:async part=>{parts.push(part);previews.push(prepareCoupledAssemblyPreview(plan,part));}});
    const source={captureId:'eeeeeeee-0000-4000-8000-000000000001',selection:f.selection,jobId:'dddddddd-0000-4000-8000-'+(i+1).toString(16).padStart(12,'0'),sourceHash};
    for(const key of ['worldContextHash','preparationHash','requestHash','runtimeHash','referenceSetHash','contextRecordHash','referenceBindingHash','currentNativeEvidenceHash','candidateHash'])source[key]=hash('synthetic-'+f.name+'-'+key);
    const binding=prepareCoupledAssemblyBinding(plan,patchSet,previews,source);
    cases.push({name:f.name,selection:f.selection,capture:f.capture,manifest,cellsBase64:binary.toString('base64'),plan,parts,previews,patchSet,binding});
  }
  return {format:'SyntheticCoupledTransportFixtures',version:1,cases,realModelCalls:0,worldWrites:0};
}
export async function makeCoupledTransportFixtures(){const data=await coupledTransportFixtures();await fs.mkdir('mod/build/test-fixtures',{recursive:true});await fs.writeFile('mod/build/test-fixtures/assembly-coupled-transport.json',JSON.stringify(data));return data;}
