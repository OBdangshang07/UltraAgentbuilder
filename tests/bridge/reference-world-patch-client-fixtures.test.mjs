import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {contextHash} from '../../src/world/context-snapshot.mjs';
import {referenceWorldPatchClientFixture} from '../fixtures/reference-world-patch-client-fixture.mjs';
import {REFERENCE_WORLD_PATCH_RULES,REFERENCE_WORLD_PATCH_PROTOCOL_HASH} from '../../src/world/reference-world-patch-design-task.mjs';
import {WORLD_PATCH_DESIGN_PROTOCOL_HASH} from '../../src/world/world-patch-design-input.mjs';

test('Java joint fixture is produced by actual paired HTTP and exact two-image adapter/worker path with independent original pins',async t=>{
  const f=await referenceWorldPatchClientFixture(t),preview=JSON.parse(f.preview),candidate=JSON.parse(f.candidate);
  assert.equal(f.fixtureAdapterCalls,1);assert.equal(f.realModelCalls,0);assert.equal(f.worldWrites,0);
  assert.equal(f.task.frozen.imageCount,2);assert.equal(f.task.status.maximumCalls,1);assert.equal(f.task.status.callsReserved,1);
  assert.equal(f.task.imageFreeze.format,'ReferenceWorldPatchImageFreezeStatus');assert.equal(f.task.imageFreeze.version,1);
  assert.equal(f.task.imageFreeze.capsuleId,f.reference.capsuleId);assert.equal(f.task.imageFreeze.state,'images-frozen-not-sent');
  assert.equal(f.task.imageFreeze.modelSent,false);assert.equal(f.task.imageFreeze.canAuthorizePlacement,false);
  assert.match(f.task.imageFreeze.transportHash,/^[a-f0-9]{64}$/);
  assert.deepEqual(f.task.imageFreeze.imageHashes,f.task.referenceManifest.references.map(image=>image.sha256));
  assert.equal(f.reference.submissionHash,contextHash(f.task.send));assert.equal(f.reference.responseHash,contextHash(f.proposal));
  for(const value of [preview,candidate]){
    const {downloadHash,...content}=value;assert.equal(downloadHash,contextHash(content));
    for(const key of ['capsuleId','manifestHash','submissionHash','runtimeHash','responseHash','candidateHash','referenceSetHash','imageCapabilityHash','snapshotHash','selectionHash','patchHash','previewHash'])assert.equal(value[key],f.reference[key]);
    assert.deepEqual(value.selection,f.reference.selection);assert.equal(value.contextRevision,4);
    assert.equal(value.canAuthorizePlacement,false);assert.equal(value.serverBaselineVerified,false);assert.equal(value.worldWrites,0);
    assert.equal(value.preview.movable,false);assert.equal(value.preview.canAuthorizePlacement,false);
  }
  assert.equal(preview.format,'FrozenReferenceWorldPatchPreviewDownload');assert.equal(candidate.format,'FrozenReferenceWorldPatchCandidateDownload');
  assert.equal(Object.hasOwn(preview,'proposal'),false);assert.deepEqual(candidate.proposal,f.proposal);
  assert.equal(f.task.prepared.task.request.baseTaskHash,f.task.baseDisclosure.taskHash);
  assert.equal(f.task.referenceManifest.setHash,f.task.intent.referenceSetHash);
  assert.equal(contextHash(f.task.capability),f.task.prepared.task.request.imageCapabilityHash);
  // Check that the data-only Java reconstruction's declared field sets can
  // recover the exact archived base transcript. This is Node fixture/source
  // evidence, NOT execution or acceptance of the uncompiled Java verifier.
  const java=await fs.readFile(new URL('../../mod/src/main/java/dev/voxelstudio/client/ReferenceWorldPatchTaskReceipt.java',import.meta.url),'utf8');
  const fields=name=>[...java.match(new RegExp(name+'=List\\.of\\(([^;]+)\\);'))[1].matchAll(/"([^"]+)"/g)].map(m=>m[1]);
  const pick=(value,names)=>Object.fromEntries(names.map(key=>[key,value[key]]));
  const rehash=(value,key)=>{delete value[key];value[key]=contextHash(value);return value;};
  const prepared=f.task.prepared,task=prepared.task,request=task.request,d=task.disclosure;
  const marker='\n\n'+REFERENCE_WORLD_PATCH_RULES+'\n\n',boundary=d.modelPrompt.lastIndexOf(marker);assert.ok(boundary>=0);
  const basePrompt=d.modelPrompt.slice(0,boundary),basePromptHash=createHash('sha256').update(basePrompt).digest('hex');
  const baseIntent={format:'WorldPatchDesignIntent',version:1,purpose:'world-patch-design',
    ...pick(f.task.intent,['agent','model','effort','prompt','maximumCalls'])};
  const baseRequest={...pick(request,fields('REQUEST_BASE')),format:'WorldPatchDesignTask',purpose:'world-patch-design',
    intent:baseIntent,protocolHash:request.patchProtocolHash,promptSha256:basePromptHash};
  const baseDisclosure=rehash({...pick(d,fields('DISCLOSURE_BASE')),format:'WorldPatchDesignDisclosure',purpose:'world-patch-design',
    requestHash:contextHash(baseRequest),protocolHash:request.patchProtocolHash,modelPrompt:basePrompt,modelPromptUtf8Bytes:Buffer.byteLength(basePrompt),
    promptSha256:basePromptHash,transmittedData:d.transmittedData.slice(0,-2),
    excludedData:['NBT','container-items','sign-book-text','entities','save-paths','screenshots','diagonal-neighbor-cells']},'disclosureHash');
  const baseTask=rehash({...task,format:'WorldPatchDesignPreparedTask',request:baseRequest,requestHash:contextHash(baseRequest),disclosure:baseDisclosure},'taskHash');
  assert.equal(baseTask.taskHash,request.baseTaskHash);
  const base={...prepared,format:'SavedWorldPatchTaskDisclosure',purpose:'world-patch-design',task:baseTask,taskHash:baseTask.taskHash};
  delete base.referenceConsentTransferable;rehash(base,'taskDisclosureHash');assert.deepEqual(base,f.task.baseDisclosure);
});

test('packaged joint Java protocol matches production rules and keeps base evidence reuse separate from all legacy consent and SEND',async()=>{
  const read=file=>fs.readFile(new URL('../../'+file,import.meta.url),'utf8');
  assert.deepEqual(JSON.parse(await read('contracts/reference-world-patch-review-protocol.json')),
    {version:1,patchProtocolHash:WORLD_PATCH_DESIGN_PROTOCOL_HASH,rules:REFERENCE_WORLD_PATCH_RULES,protocolHash:REFERENCE_WORLD_PATCH_PROTOCOL_HASH});
  assert.match(await read('mod/build.gradle'),/include .*'reference-world-patch-review-protocol.json'/);
  const source=await read('mod/src/main/java/dev/voxelstudio/client/ReferenceWorldPatchTaskReceipt.java');
  assert.match(source,/WorldPatchTaskReceipt\.verify\(capture,saved,baseIntent,base\)/);
  assert.match(source,/same\(baseTask\.get\("taskHash"\),r\.get\("baseTaskHash"\)\)/);
  assert.match(source,/verifyManifest\(requested,manifest\);verifyCapability\(requested,capability\)/);
  assert.match(source,/CodingErrorAction\.REPORT/);assert.match(source,/strictJson\(json,cancelled\)/);
  assert.match(source,/SavedReferenceWorldPatchDesignConfirmation/);assert.match(source,/FrozenReferenceWorldPatchTaskReceipt/);
  assert.doesNotMatch(source,/WorldPatchTaskReceipt\.(confirmation|verifyFrozen)\(|FrozenWorldPatchExplicitSend|\/send|CompletableFuture|java\.net/);
});

test('Java joint receipt retains explicit image and source pins, separate format, fatal decoder, exact fields and original proposal hash',async()=>{
  const read=file=>fs.readFile(new URL('../../mod/src/main/java/dev/voxelstudio/client/'+file,import.meta.url),'utf8');
  const source=await read('ReferenceWorldPatchCandidateReceipt.java');
  assert.match(source,/referenceSetHash,String imageCapabilityHash/);assert.match(source,/CodingErrorAction\.REPORT/);
  assert.match(source,/WorldPatchCandidateReceipt\.strictJson/);assert.match(source,/value\.keySet\(\)\.equals\(fields\)/);
  assert.match(source,/eq\(value,"purpose","reference-world-patch-design"\)/);
  assert.match(source,/ContextReceipt\.jsonHash\(proposal\)\.equals\(expected\.responseHash\(\)\)/);
  assert.match(source,/hash\(value,"downloadHash"\)/);assert.match(source,/private AuditableDownload/);assert.match(source,/response\.clone\(\)/);
  assert.doesNotMatch(source,/new WorldPatchCandidateReceipt\.Reference|replace\(.*FrozenWorldPatch|canAuthorizePlacement\(\)\{return true/);
  const sealed=await read('WorldPatchCheckedCandidate.java');assert.match(sealed,/sealed interface/);assert.match(sealed,/permits WorldPatchCandidateReceipt\.AuditableDownload,ReferenceWorldPatchCandidateReceipt\.AuditableDownload/);
});

test('joint client download methods are GET-only without SEND, provider observation, legacy fallback or fresh-baseline claims',async()=>{
  const source=await fs.readFile(new URL('../../mod/src/main/java/dev/voxelstudio/client/BridgeClient.java',import.meta.url),'utf8');
  const segment=source.slice(source.indexOf('CompletableFuture<ReferenceWorldPatchCandidateReceipt.Download> loadReferencePatchPreview'),source.indexOf('/** Query one stable identity'));
  assert.match(segment,/\/v1\/reference-world-patch\/jobs\//);assert.match(segment,/ReferenceWorldPatchCandidateReceipt\.parse\(/);
  assert.match(segment,/ReferenceWorldPatchCandidateReceipt\.parseCandidate\(/);
  assert.doesNotMatch(segment,/\/v2\/world-patch|\.POST\(|\/send|observe-original|readPatchJob|loadPatchCandidate\(/);
  const controller=await fs.readFile(new URL('../../mod/src/main/java/dev/voxelstudio/client/SelectionController.java',import.meta.url),'utf8');
  assert.match(controller,/preparePlacement\(WorldPatchCheckedCandidate candidate/);assert.match(controller,/patchAudit\(WorldPatchCheckedCandidate candidate/);
  assert.match(controller,/WorldPatchPlacementService\.prepare\(owner,user,capture,preview,candidate\.originalResponse\(\),candidate\.originalResponseHash\(\)\)/);
  assert.match(controller,/SelectionReadService\.startPatchAudit\(owner,user,capture,preview,candidate\.originalResponse\(\),candidate\.originalResponseHash\(\)\)/);
  const loading=controller.slice(controller.indexOf('void loadReferencePatchPreview'),controller.indexOf('record BeforeRun'));
  assert.match(loading,/ReferenceWorldPatchCandidateReceipt\.Reference pin/);assert.match(loading,/ContextPublication\.checkedValue\(this::checkedCapture/);
  assert.match(loading,/cap\.selection\(\)\.equals\(pin\.binding\(\)\.selection\(\)\)/);assert.match(loading,/cap\.contextRevision\(\)!=pin\.binding\(\)\.contextRevision\(\)/);
  assert.match(loading,/BRIDGE\.loadReferencePatchCandidate\(pin/);assert.match(loading,/currentScreen!=parent\|\|!live\.getAsBoolean\(\)/);
  assert.match(loading,/showAuditableReadOnly\(download\)/);assert.doesNotMatch(loading,/preparePlacement|\/send|startPatchAudit|new SelectionReadService\.Capture/);
});

test('joint job verifier retains distinct SEND/status/image identity without legacy conversion or world/model operations',async()=>{
  const source=await fs.readFile(new URL('../../mod/src/main/java/dev/voxelstudio/client/ReferenceWorldPatchJobReceipt.java',import.meta.url),'utf8');
  assert.match(source,/FrozenReferenceWorldPatchExplicitSend/);assert.match(source,/FrozenReferenceWorldPatchJobReference/);
  assert.match(source,/FrozenReferenceWorldPatchJobStatus/);assert.match(source,/FrozenReferenceWorldPatchResponseCheck/);
  assert.match(source,/ReferenceWorldPatchTaskReceipt\.verifyFrozen/);assert.match(source,/ReferenceWorldPatchTaskReceipt\.protocolHash\(\)/);
  assert.match(source,/CodingErrorAction\.REPORT/);assert.match(source,/isProviderTerminalReceipt/);
  assert.match(source,/"referenceSetHash","runtimeHash","imageCapabilityHash"/);
  assert.doesNotMatch(source,/new WorldPatchCandidateReceipt\.Reference|WorldPatchJobReceipt\.verify\(|java\.net|\.POST\(|adapter\.generate|canAuthorizePlacement.*true/);
  // Static source checks are deliberately not described as Java execution.
});
