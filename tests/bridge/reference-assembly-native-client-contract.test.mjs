import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const read=name=>fs.readFile(new URL('../../mod/src/main/java/dev/voxelstudio/client/'+name,import.meta.url),'utf8');

// Static wiring only. Original paired HTTP and pure candidates are separate
// JUnit gates; live render, final world consent/save and Iris are game gates.
test('whole loader is GET-only, background-combined and fenced by both original server captures',async()=>{
  const [bridge,selection,candidate]=await Promise.all(['BridgeClient.java','SelectionController.java','AssemblyPatchCheckedCandidate.java'].map(read));
  const loader=bridge.slice(bridge.indexOf('CompletableFuture<AssemblyPatchCheckedCandidate> loadReferenceAssemblyCandidate'),bridge.indexOf('CompletableFuture<ReferenceWorldAssemblyPlan> prepareReferenceAssembly'));
  assert.match(loader,/readReferenceAssemblyCandidate\(original,finalStatus,live\)/);assert.match(loader,/submit\(contexts,/);assert.doesNotMatch(loader,/loadPatchCandidate|loadReferencePatchCandidate|sendReference|request\("POST"|new Asset/);
  const load=selection.slice(selection.indexOf('void loadAssemblyPreview'),selection.indexOf('record AssemblyPlacementRun'));
  for(const text of ['ContextPublication.checkedValue(this::checkedCapture','retentionBinding(cap,original)','matchesAssembly(candidate.input().binding())','ticket==contextEpoch&&live.getAsBoolean()','c.currentScreen!=parent','ASSEMBLY_PREVIEW.showReadOnly(candidate)'])assert.ok(load.includes(text),text);
  assert.match(candidate,/private AssemblyPatchCheckedCandidate\(/);assert.match(candidate,/whole\)\.worldInput\(cancelled\)/);assert.match(candidate,/AssemblyPatchPreview.from\(input,cancelled\)/);assert.doesNotMatch(candidate,/implements WorldPatchCheckedCandidate|new Asset|canAuthorizePlacement\(\)\{return true/);
});
test('whole controls call only their typed final/undo services and retain explicit once-only page consent',async()=>{
  const [selection,apply,undo,operation]=await Promise.all(['SelectionController.java','AssemblyPatchPlacementScreen.java','AssemblyPatchUndoScreen.java','AssemblyPatchOperationScreen.java'].map(read));
  const typed=selection.slice(selection.indexOf('record AssemblyPlacementRun'),selection.indexOf('JsonObject confirmedTask()'));
  assert.match(typed,/AssemblyPatchPlacementService.prepare\(owner,user,capture,preview,candidate.input\(\)\)/);assert.match(typed,/AssemblyPatchPlacementService.confirm\(owner,user,confirmation,true\)/);assert.match(typed,/AssemblyPatchUndoService.confirm\(owner,user,confirmation,true\)/);
  assert.doesNotMatch(typed,/WorldPatchPlacementService|WorldPatchUndoService|\.parts\(\)|sendReferenceAssembly|PlacementService\.start/);
  for(const source of [apply,undo])for(const text of ['submitted=true','run.confirm().apply(confirmation,true)','page.leave();if(!submitted)cancelPreparation()','45 秒','acknowledged'])assert.ok(source.includes(text),text);
  assert.match(operation,/currentAssemblyOperation\(\)/);assert.match(operation,/currentAssemblyUndo\(\)/);assert.match(operation,/Objects.equals\(dimension,/);assert.doesNotMatch(operation,/prepareAssemblyPlacement|resume\(|Files\.|new Asset/);
});
test('complete overlay is a distinct world lifecycle, immutable position and geometry-only shared renderer',async()=>{
  const [controller,client,projection,legacy,screen,selection,result]=await Promise.all(['AssemblyPatchPreviewController.java','StudioClient.java','ProjectionController.java','WorldPatchPreviewController.java','AssemblyPatchPreviewScreen.java','SelectionScreen.java','ReferenceWorldAssemblyResultScreen.java'].map(read));
  for(const text of ['private AssemblyPatchPreview preview','private AssemblyPatchCheckedCandidate candidate','tool.matchesAssembly(preview.binding())','renderer.rebuild(preview,filter)','StudioClient.PATCH_PREVIEW.clear()','StudioClient.PROJECTION.visible=false','break markers'])assert.ok(controller.includes(text),text);
  assert.doesNotMatch(controller,/PlacementService|setBlockState|PROJECTION\.load|\.rotate\(|\.move\(/);
  for(const text of ['ASSEMBLY_PREVIEW.tick(c)','ASSEMBLY_PREVIEW.render(worldView,worldProjection,worldCamera)','ASSEMBLY_PREVIEW.reload()','ASSEMBLY_PREVIEW.close()','ASSEMBLY_PREVIEW.preview()!=null'])assert.ok(client.includes(text),text);
  assert.match(projection,/ASSEMBLY_PREVIEW.clear\(\)/);assert.match(legacy,/ASSEMBLY_PREVIEW.clear\(\)/);
  assert.match(screen,/new AssemblyPatchPlacementScreen/);assert.doesNotMatch(screen,/new WorldPatchPlacementScreen|new WorldPatchBeforeScreen|new WorldPatchAuditScreen/);
  assert.match(selection,/new AssemblyPatchOperationScreen/);assert.match(result,/loadAssemblyPreview\(this,reference,view.status\(\),page.publication\(\)\)/);assert.match(result,/void removed\(\)\{page.leave\(\)/);
});
