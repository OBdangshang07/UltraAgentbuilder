import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root=new URL('../../mod/src/main/java/dev/voxelstudio/client/',import.meta.url),read=name=>fs.readFile(new URL(name,root),'utf8');
// Wiring only; Java display-state tests and installed player flow remain
// necessary. No model reply, server lease or physical save is mocked here.
test('coupled preview dispatches the displayed whole identity and filters cannot write',async()=>{
 const source=await read('CoupledAssemblyPreviewScreen.java');
 for(const pin of ['new PreviewPageBinding<>(shown)','displayed.dispatch(tool.candidate(),snapshotCurrent(),action)','new CoupledAssemblyPlacementScreen(this,value)','StudioClient.SELECTION.matchesCoupled(value.preview().binding())','void removed(){if(binding!=null)binding.leave();}'])assert.ok(source.includes(pin),pin);
 assert.doesNotMatch(source,/\.confirm\(|setBlockState|\.parts\(\)|new Asset|\.rotate\(|\.move\(/);
});
test('coupled placement preparation and final acceptance are fenced to original client/world/context/candidate',async()=>{
 const source=await read('SelectionController.java');const typed=source.slice(source.indexOf('record CoupledPlacementRun('),source.indexOf('CompletableFuture<CoupledAssemblyPlacementService.Operation> currentCoupledOperation('));
 for(const pin of ['CoupledAssemblyPlacementService.prepare(owner,user,capture,preview,candidate.input())','server==owner','epoch==worldTicket','contextEpoch==contextTicket','COUPLED_PREVIEW.candidate()==candidate','matchesCoupled(preview.binding())','Boolean.TRUE.equals(ack)','CoupledAssemblyPlacementService.confirm(owner,user,confirmation,true)'])assert.ok(typed.includes(pin),pin);
 assert.doesNotMatch(typed,/AssemblyPatchPlacementService|WorldPatchPlacementService|sendCoupledAssembly|\.parts\(\)/);
});
test('closing or resizing unconfirmed pages cancels preparation, never a confirmed task',async()=>{
 for(const name of ['CoupledAssemblyPlacementScreen.java','CoupledAssemblyUndoScreen.java']){
  const source=await read(name);for(const pin of ['submitted=true','run.confirm().apply(confirmation,true)','page.leave();if(!submitted)cancelPreparation()','acknowledged','45 秒'])assert.ok(source.includes(pin),name+' '+pin);
  assert.match(source,/if\(run!=null&&!submitted\)/);assert.doesNotMatch(source,/removed\(\)[^\n]*cancelCoupledOperation/);
 }
});
test('inverse confirmation uses only the separate UNDO service and complete-group safety disclosure',async()=>{
 const source=await read('SelectionController.java'),page=await read('CoupledAssemblyUndoScreen.java');
 const typed=source.slice(source.indexOf('record CoupledUndoRun('),source.indexOf('JsonObject confirmedTask()'));
 assert.match(typed,/CoupledAssemblyUndoService\.prepare\(owner,user,parent\)/);assert.match(typed,/CoupledAssemblyUndoService\.confirm\(owner,user,confirmation,true\)/);
 assert.doesNotMatch(typed,/AssemblyPatchUndoService|WorldPatchUndoService|\.parts\(\)|sendCoupledAssembly/);
 assert.match(page,/confirmation\.summary\(\)\.writes\(\)/);assert.match(page,/confirmation\.summary\(\)\.groups\(\)/);assert.match(page,/改动后又改回同状态的历史识别尚未验证/);
});
test('operation screen queries current dimension-owned originals and never resumes disk history',async()=>{
 const source=await read('CoupledAssemblyOperationScreen.java');
 for(const pin of ['currentCoupledOperation()','currentCoupledUndo()','Objects.equals(dimension,','void removed(){page.leave();}'])assert.ok(source.includes(pin),pin);
 assert.doesNotMatch(source,/prepareCoupledPlacement|Files\.|resume\(|new Asset|sendCoupledAssembly/);
});
test('separate read-only HUDs follow scope and clear older family display only after accepted operations',async()=>{
 const [source,client,hud,state]=await Promise.all(['SelectionController.java','StudioClient.java','StudioHud.java','AssemblyPatchHudState.java'].map(read));
 assert.match(source,/COUPLED_HUD\.showApply\(displayTicket,operation\.id\(\)/);assert.match(source,/COUPLED_HUD\.showUndo\(displayTicket,parent\.id\(\)/);
 assert.match(source,/StudioClient\.ASSEMBLY_HUD\.clear\(\)/);assert.match(source,/StudioClient\.COUPLED_HUD\.clear\(\)/);
 assert.match(client,/COUPLED_HUD\.scope\(c\.getServer\(\)/);assert.match(client,/COUPLED_HUD\.hasProgress\(\)\?new CoupledAssemblyOperationScreen/);assert.match(client,/COUPLED_HUD\.close\(\)/);
 assert.match(hud,/COUPLED_HUD\.view\(\)/);assert.match(state,/void clear\(\)\{if\(closed\)return;epoch\+\+;operationId=null;apply=undo=null;\}/);
 assert.doesNotMatch(state,/MinecraftServer|PlacementService|UndoService|\.cancel\(|\.confirm\(/);
});
