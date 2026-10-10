import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WORLD_ASSEMBLY_LIMITS,validateWorldAssemblyLimits} from '../../contracts/world-assembly-limits.mjs';
import {WORLD_ASSEMBLY_PATCH_LIMITS} from '../../src/world/assembly-context.mjs';
import {REFERENCE_ASSEMBLY_CANDIDATE_LIMITS} from '../../bridge/reference-world-assembly-candidate.mjs';
import {JOINT_ASSEMBLY_RESOURCE_LIMITS} from '../../bridge/reference-world-assembly-resources.mjs';
const contract=()=>JSON.parse(readFileSync(new URL('../../contracts/world-assembly-limits.json',import.meta.url),'utf8'));

test('fixed assembly contract raises only measured whole-asset resource budgets',()=>{
  const mib=1024**2;assert.equal(WORLD_ASSEMBLY_LIMITS.patchBytes,192*mib);
  assert.equal(WORLD_ASSEMBLY_LIMITS.candidateBytes,224*mib);assert.equal(WORLD_ASSEMBLY_LIMITS.downloadBytes,256*mib);
  assert.equal(WORLD_ASSEMBLY_LIMITS.proposalBytes,64*mib);assert.equal(WORLD_ASSEMBLY_LIMITS.previewBytes,64*mib);
  assert.equal(WORLD_ASSEMBLY_LIMITS.partBytes,16*mib);assert.equal(WORLD_ASSEMBLY_LIMITS.partEnvelopeBytes,40*mib);
  assert.equal(WORLD_ASSEMBLY_LIMITS.metadataBytes,2*mib);assert.equal(WORLD_ASSEMBLY_LIMITS.recordsBytes,2*mib);
  assert.equal(WORLD_ASSEMBLY_LIMITS.operationsPerPart,8192);assert.ok(Object.isFrozen(WORLD_ASSEMBLY_LIMITS));
});
test('production lowering, candidate storage and resource output consume the same bundled limits',()=>{
  assert.equal(WORLD_ASSEMBLY_PATCH_LIMITS.bytes,WORLD_ASSEMBLY_LIMITS.patchBytes);
  assert.equal(WORLD_ASSEMBLY_PATCH_LIMITS.operationsPerPart,WORLD_ASSEMBLY_LIMITS.operationsPerPart);
  assert.equal(WORLD_ASSEMBLY_PATCH_LIMITS.parts,128);
  for(const key of ['candidateBytes','metadataBytes','recordsBytes','partBytes'])assert.equal(REFERENCE_ASSEMBLY_CANDIDATE_LIMITS[key],WORLD_ASSEMBLY_LIMITS[key]);
  assert.equal(JOINT_ASSEMBLY_RESOURCE_LIMITS.outputBytes,WORLD_ASSEMBLY_LIMITS.partEnvelopeBytes);
  assert.equal(JOINT_ASSEMBLY_RESOURCE_LIMITS.oldGenerationMb,512);assert.equal(JOINT_ASSEMBLY_RESOURCE_LIMITS.operationMs,120000);
});
test('extra authority/token fields and missing quota fields cannot change fixed policy',()=>{
  for(const key of ['canAuthorizePlacement','maxTokens','unlimited','model'])assert.throws(()=>validateWorldAssemblyLimits({...contract(),[key]:true}));
  for(const key of Object.keys(contract())){const value=contract();delete value[key];assert.throws(()=>validateWorldAssemblyLimits(value));}
  assert.throws(()=>validateWorldAssemblyLimits({...contract(),version:2}));
});
test('noninteger, unbounded, negative and incoherent budgets are rejected',()=>{
  for(const key of Object.keys(contract()).filter(k=>k!=='version'))for(const value of [0,-1,0.5,Infinity,NaN,'1',Number.MAX_SAFE_INTEGER+1])
    assert.throws(()=>validateWorldAssemblyLimits({...contract(),[key]:value}));
  for(const [key,value] of [['operationsPerPart',8193],['patchBytes',257*1024**2],['candidateBytes',321*1024**2],
    ['downloadBytes',385*1024**2],['proposalBytes',65*1024**2],['previewBytes',65*1024**2],['partBytes',17*1024**2],
    ['partEnvelopeBytes',41*1024**2],['metadataBytes',3*1024**2],['recordsBytes',3*1024**2],
    ['candidateBytes',191*1024**2],['downloadBytes',223*1024**2],['partEnvelopeBytes',15*1024**2]])
    assert.throws(()=>validateWorldAssemblyLimits({...contract(),[key]:value}));
});
