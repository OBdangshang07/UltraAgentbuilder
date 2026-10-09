import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const read=name=>fs.readFile(new URL('../../mod/src/main/java/dev/voxelstudio/client/'+name,import.meta.url),'utf8');

// Static wiring is not an in-game lifecycle/render acceptance. The actual
// shared binding and HUD state have separate Java behavior tests.
test('whole preview action captures displayed identity and checks again at click and layout',async()=>{
  const screen=await read('AssemblyPatchPreviewScreen.java');
  for(const text of ['if(binding!=null)binding.leave()','new PreviewPageBinding<>(shown)','var displayed=binding',
    'displayed.dispatch(tool.candidate(),snapshotCurrent(),action)','new AssemblyPatchPlacementScreen(this,value)',
    'StudioClient.SELECTION.matchesAssembly(value.preview().binding())','void tick(){layout();}',
    'row.widget.visible&&(!row.previewAction||current)','void removed(){if(binding!=null)binding.leave();}'])assert.ok(screen.includes(text),text);
  assert.doesNotMatch(screen,/new AssemblyPatchPlacementScreen\(this,tool.candidate\(\)\)|cursor\s*[<>]\s*\d+|setBlockState|\.confirm\(/);
});
test('whole HUD shows complete fixed preview before prior progress without borrowing building movement hints',async()=>{
  const hud=await read('StudioHud.java');
  const whole=hud.slice(hud.indexOf('var whole='),hud.indexOf('if(!p.visible&&!p.busy)return;'));
  assert.ok(whole.indexOf('preview!=null')<whole.indexOf('ASSEMBLY_HUD.view()'));
  for(const text of ['preview.totalWrites()','filter.mode()','不支持移动或旋转','过滤不缩小补丁','不证明世界已落盘','count=Math.min(maximum,lines.size())'])assert.ok(hud.includes(text),text);
  assert.doesNotMatch(whole,/\.anchor|\.rotation|followDistance|PlacementService|setBlockState|\.confirm\(/);
});
test('live HUD receives only already accepted operations and follows owner scope through tick and shutdown',async()=>{
  const [selection,client,state]=await Promise.all(['SelectionController.java','StudioClient.java','AssemblyPatchHudState.java'].map(read));
  assert.match(selection,/ASSEMBLY_HUD.showApply\(displayTicket,operation.id\(\)/);
  assert.match(selection,/ASSEMBLY_HUD.showUndo\(displayTicket,parent.id\(\)/);
  assert.match(client,/ASSEMBLY_HUD.scope\(c.getServer\(\),c.player==null\?null:c.player.getUuid\(\),c.world==null\?null:c.world.getRegistryKey\(\).getValue\(\).toString\(\)\)/);
  assert.match(client,/ASSEMBLY_HUD.hasProgress\(\)\?new AssemblyPatchOperationScreen/);assert.match(client,/ASSEMBLY_HUD.close\(\)/);
  for(const text of ['next!=owner','ticket==epoch','!Objects.equals(parentId,operationId)','apply=undo=null','worldDurabilityVerified(){return false;}','canAuthorizePlacement(){return false;}'])assert.ok(state.includes(text),text);
  assert.doesNotMatch(state,/MinecraftServer|PlacementService|UndoService|Files\.|BridgeClient|CompletableFuture|\.confirm\(|\.cancel\(/);
});
