import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root=new URL('../../mod/src/main/java/dev/voxelstudio/client/',import.meta.url);
const read=name=>fs.readFile(new URL(name,root),'utf8');
// Source wiring only. Native game, true model/pixels, Iris and saves are
// independent gates; no source match is reported as installed acceptance.
test('coupled task generation uses its own full receipt validation and explicit original pictures',async()=>{
 const studio=await read('StudioScreen.java'),task=await read('CoupledReferenceWorldAssemblyTaskScreen.java');
 const generation=studio.slice(studio.indexOf('static JsonObject coupledAssemblyGenerationRequest('),studio.indexOf('static String referenceAssemblyTierSummary('));
 assert.match(generation,/CoupledReferenceWorldAssemblyReceipt\.generation\(request\)/);assert.doesNotMatch(generation,/\bReferenceWorldAssemblyReceipt\.generation\(request\)/);
 assert.match(task,/ReferencePixelPreparationReceipt\.verify\(snapshot,pixels\.manifest\(\)\)/);
 assert.match(task,/StudioScreen\.coupledAssemblyGenerationRequest\(snapshot\.ownerId\(\),text\)/);
 assert.match(task,/SELECTION\.prepareCoupledAssembly\(this,generation,manifest,/);
 assert.doesNotMatch(task,/sendCoupledAssembly|\.confirm\(|setBlockState/);
});
test('the only coupled SEND action has its own plan, observer, retention and once-only click',async()=>{
 const source=await read('CoupledReferenceWorldAssemblySendScreen.java');
 for(const pin of ['CoupledReferenceWorldAssemblyPlan plan','StudioClient.COUPLED_ASSEMBLY.watch(reference,null)','BRIDGE.coupledAssemblyCapabilities()','BRIDGE.sendCoupledAssembly(capture,plan,valid,','SELECTION.retainCoupledAssemblySend(original,r,valid)','attempted=true','originalSendFailure(reference,error)','void removed(){page.leave();}'])assert.ok(source.includes(pin),pin);
 assert.doesNotMatch(source,/sendReferenceAssembly\(|retainReferenceAssemblySend\(|\.confirm\(|setBlockState/);
 assert.match(source,/catch\(RuntimeException rejected\)/);assert.match(source,/catch\(RuntimeException error\)/);
});
test('coupled history and result observe only their original jobs, never send or take over',async()=>{
 const history=await read('CoupledReferenceWorldAssemblyHistoryScreen.java'),result=await read('CoupledReferenceWorldAssemblyResultScreen.java');
 assert.match(history,/COUPLED_ASSEMBLY\.reloadHistory\(\)/);assert.match(result,/CoupledReferenceWorldAssemblyReceipt\.verifyReference/);
 assert.match(result,/COUPLED_ASSEMBLY\.refresh\(reference\)/);assert.match(result,/loadCoupledPreview\(this,reference,view\.status\(\),page\.publication\(\)\)/);
 for(const source of [history,result])assert.doesNotMatch(source,/sendCoupledAssembly\(|\.confirm\(|resume\(|setBlockState/);
});
test('whole coupled loading retains the same Capture, scope and original complete checked candidate',async()=>{
 const source=await read('SelectionController.java');const load=source.slice(source.indexOf('void loadCoupledPreview('),source.indexOf('void loadAssemblyPreview('));
 for(const pin of ['ContextPublication.checkedValue(this::checkedCapture','CoupledReferenceWorldAssemblyReceipt.retentionBinding(capture,original)','loadCoupledAssemblyCandidate(original,status,','ticket==contextEpoch&&live.getAsBoolean()','client.currentScreen!=parent','matchesCoupled(candidate.input().binding())','COUPLED_PREVIEW.showReadOnly(candidate)'])assert.ok(load.includes(pin),pin);
 assert.doesNotMatch(load,/\.parts\(\)|sendCoupledAssembly|new Asset|setBlockState/);
 const match=await read('CoupledAssemblyContextMatch.java');assert.match(match,/CoupledReferenceWorldAssemblyReceipt\.verifyReference\(original\.deepCopy\(\)\)/);
});
test('coupled world overlay is ticked, rendered with state preservation, reloaded and closed',async()=>{
 const client=await read('StudioClient.java'),preview=await read('CoupledAssemblyPreviewController.java');
 for(const pin of ['COUPLED_PREVIEW.tick(c)','COUPLED_PREVIEW.reload()','COUPLED_PREVIEW.close()','try(var coupledState=new ProjectionRenderState()){COUPLED_PREVIEW.render(worldView,worldProjection,worldCamera);}'])assert.ok(client.includes(pin),pin);
 assert.match(preview,/renderer\.rebuild\(preview,filter\)/);assert.match(preview,/tool\.matchesCoupled\(preview\.binding\(\)\)/);
 assert.doesNotMatch(preview,/PlacementService|setBlockState|\.move\(|\.rotate\(|PROJECTION\.load/);
});
test('old/new patch overlays exclude each other and block movable-building hotkeys without moving a patch',async()=>{
 const client=await read('StudioClient.java'),projection=await read('ProjectionController.java'),old=await read('AssemblyPatchPreviewController.java'),single=await read('WorldPatchPreviewController.java'),coupled=await read('CoupledAssemblyPreviewController.java');
 assert.match(client,/COUPLED_PREVIEW\.preview\(\)!=null\?new CoupledAssemblyPreviewScreen/);
 assert.match(client,/\|\| COUPLED_PREVIEW\.preview\(\)!=null \|\| !PROJECTION\.visible/);
 for(const source of [projection,old,single])assert.match(source,/COUPLED_PREVIEW\.clear\(\)/);
 assert.match(coupled,/ASSEMBLY_PREVIEW\.clear\(\)/);assert.match(coupled,/PATCH_PREVIEW\.clear\(\)/);
});
