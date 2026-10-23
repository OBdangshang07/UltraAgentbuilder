import fs from 'node:fs/promises';
import {coupledNative,coupledSnapshot,coupledDoorEntries,coupledDoor,coupledBoundaryEntries} from '../tests/fixtures/assembly-coupled-native.mjs';
import {compileCoupledAssemblyPlan,coupledAssemblyExecutionGroups,streamCoupledAssemblyParts} from '../src/world/assembly-coupled-plan.mjs';
import {analyzeAssemblyCoupling,assemblySupportStateCases} from '../src/world/assembly-coupling.mjs';
import {resolveState} from '../src/generation/block-states.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {ASSEMBLY_COUPLING_POLICY_HASH} from '../contracts/assembly-coupling-policy.mjs';

export async function assemblyCoupledFixtures(){
  const valid=[],invalid=[];
  async function accepted(name,entries=coupledDoorEntries(),options={}){
    const source=coupledSnapshot(options),native=coupledNative(entries,options.dimensions),parts=[];
    const plan=compileCoupledAssemblyPlan(source.snapshot,native),patchSet=await streamCoupledAssemblyParts(plan,{onPart:async part=>parts.push(part)});
    valid.push({name,selection:source.selection,capture:source.capture,manifest:native.manifest,cellsBase64:native.binary.toString('base64'),
      analysis:analyzeAssemblyCoupling(source.snapshot,native),plan,parts,patchSet,groups:[...coupledAssemblyExecutionGroups(plan)]});
  }
  function rejected(name,entries=coupledDoorEntries(),options={},mutate=()=>{}){
    const source=coupledSnapshot(options),native=coupledNative(entries,options.dimensions);mutate(native);
    let refused=false;try{compileCoupledAssemblyPlan(source.snapshot,native);}catch{refused=true;}
    if(!refused)throw Error('Synthetic invalid coupled case was unexpectedly accepted: '+name);
    invalid.push({name,selection:source.selection,capture:source.capture,manifest:native.manifest,cellsBase64:native.binary.toString('base64'),nodeRejected:true});
  }
  await accepted('complete-new-door');
  const boundary=coupledBoundaryEntries();await accepted('door-crosses-8192',boundary.entries,{dimensions:boundary.dimensions});
  await accepted('negative-original-origin',coupledDoorEntries(),{origin:[-20,-30,-20]});
  await accepted('captured-keep-support',coupledDoorEntries().slice(1),{changes:[[[1,0,1],'minecraft:stone']]});
  await accepted('captured-support-below-native',[[[1,0,1],coupledDoor()],[[1,1,1],coupledDoor('upper')]],{changes:[[[1,-1,1],'minecraft:stone']]});
  await accepted('explicit-demolition-and-keep',[...coupledDoorEntries(),[[0,1,0],'minecraft:air']],{changes:[[[0,1,0],'minecraft:glass'],[[2,1,2],'minecraft:stone']]});
  for(const [name,state]of [['top-stair',resolveState('oak_stairs',{half:'top',shape:'outer_right'})],['top-slab',resolveState('quartz_slab',{type:'top'})],['double-slab',resolveState('quartz_slab',{type:'double'})]]){
    const entries=coupledDoorEntries();entries[0][1]=state;await accepted(name,entries);
  }
  await accepted('partial-blocks-without-door',[[[0,1,0],resolveState('oak_trapdoor',{open:true,half:'top'})],[[1,1,0],resolveState('quartz_slab',{type:'top'})],[[2,1,0],resolveState('oak_stairs',{shape:'inner_left'})]]);
  const multiple=[...coupledDoorEntries(),[[2,0,1],'minecraft:stone'],[[2,1,1],coupledDoor()],[[2,2,1],coupledDoor('upper')],[[0,1,1],'minecraft:glass']];await accepted('interleaved-pairs',multiple);
  for(const [name,change]of [
    ['missing-upper',e=>e.pop()],['missing-lower',e=>e.splice(1,1)],['mismatched-material',e=>e[2][1]=resolveState('birch_door',{half:'upper'})],
    ['mismatched-facing',e=>e[2][1]=coupledDoor('upper',{facing:'east'})],['mismatched-hinge',e=>e[2][1]=coupledDoor('upper',{hinge:'right'})],
    ['mismatched-open',e=>e[2][1]=coupledDoor('upper',{open:true})],['support-explicit-clear',e=>e[0][1]='minecraft:air'],
    ['support-bottom-slab',e=>e[0][1]=resolveState('quartz_slab')],['support-bottom-stair',e=>e[0][1]=resolveState('oak_stairs')],
    ['support-top-trapdoor',e=>e[0][1]=resolveState('oak_trapdoor',{half:'top'})],['powered-door',e=>e[1][1]=coupledDoor().replace('powered=false','powered=true')],
    ['wet-trapdoor',e=>e.push([[0,1,0],resolveState('oak_trapdoor').replace('waterlogged=false','waterlogged=true')])],
    ['leaves-unresolved',e=>e.push([[0,1,0],'minecraft:oak_leaves[persistent=true]'])],['light-unresolved',e=>e.push([[0,1,0],'minecraft:light[level=15,waterlogged=false]'])],
  ]){const entries=coupledDoorEntries();change(entries);rejected(name,entries);}
  rejected('protected-lower',coupledDoorEntries(),{protect:[{min:[1,1,1],max:[2,2,2]}]});
  rejected('unknown-write',coupledDoorEntries(),{unknown:[[0,0]]});
  rejected('unknown-neighbor',coupledDoorEntries(),{origin:[-2,0,0],unknown:[[0,0]]});
  rejected('missing-C-closure',coupledDoorEntries(),{tight:true});
  rejected('existing-coupled-before',[[[1,1,1],'minecraft:stone']],{changes:[[[1,1,1],coupledDoor()],[[1,2,1],coupledDoor('upper')]]});
  rejected('old-stair-neighbor',coupledDoorEntries(),{changes:[[[2,1,1],resolveState('oak_stairs')]]});
  rejected('fluid-neighbor',coupledDoorEntries(),{changes:[[[2,1,1],'minecraft:water[level=0]']]});
  rejected('block-entity-neighbor',coupledDoorEntries(),{changes:[[[2,1,1],'minecraft:stone',true]]});
  function rehash(native){const {assetHash,...metadata}=native.manifest;native.manifest.assetHash=hash(metadata);}
  rejected('wrong-cell-hash',undefined,{},n=>n.binary[0]^=1);
  rejected('wrong-count',undefined,{},n=>{n.manifest.setCount++;rehash(n);});
  rejected('diagnostic-asset',undefined,{},n=>{n.manifest.diagnosticOnly=true;rehash(n);});
  rejected('nonboolean-diagnostic',undefined,{},n=>{n.manifest.diagnosticOnly=0;rehash(n);});
  rejected('bad-palette-index',undefined,{},n=>{n.binary.writeUInt16LE(255,0);n.manifest.cellsHash=hash(n.binary);rehash(n);});
  rejected('no-op-mask',[]);
  return {format:'SyntheticAssemblyCoupledFixtures',version:1,policyHash:ASSEMBLY_COUPLING_POLICY_HASH,valid,invalid,supportCases:assemblySupportStateCases(),realModelCalls:0,worldWrites:0};
}
export async function makeAssemblyCoupledFixtures(){
  const data=await assemblyCoupledFixtures();await fs.mkdir('mod/build/test-fixtures',{recursive:true});
  await fs.writeFile('mod/build/test-fixtures/assembly-coupled.json',JSON.stringify(data));return data;
}
