import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const client=name=>fs.readFile(new URL('../../mod/src/main/java/dev/voxelstudio/client/'+name,import.meta.url),'utf8');
const service=name=>fs.readFile(new URL('../../mod/src/main/java/dev/voxelstudio/selection/'+name,import.meta.url),'utf8');

// These are wiring checks, not installed UI/physics/world acceptance. The
// actual shared binding and read-only dimension filter also have Java tests.
test('single-patch pages fence both original preview and checked candidate at click and layout',async()=>{
  const screen=await client('WorldPatchPreviewScreen.java');
  for(const text of ['new PreviewPageBinding<>(shown)','new PreviewPageBinding<>(candidate)',
    'displayed.dispatch(tool.preview(),snapshotCurrent(),action)','displayed.current(tool.preview(),snapshotCurrent())',
    'checked.dispatch(tool.candidate(),candidateCurrent(),action)','StudioClient.SELECTION.matchesPreview(value.binding())',
    'candidate.preview()==shown','new WorldPatchBeforeScreen(this,value)','new WorldPatchAuditScreen(this,value)',
    'new WorldPatchPlacementScreen(this,value)','(!row.previewAction||current)&&(!row.candidateAction||checked)',
    'void tick(){layout();}','void removed(){if(viewBinding!=null)viewBinding.leave();if(candidateBinding!=null)candidateBinding.leave();}'])assert.ok(screen.includes(text),text);
  assert.doesNotMatch(screen,/new WorldPatch(?:Before|Audit|Placement)Screen\(this,tool\.(?:preview|candidate)\(\)\)|setBlockState|\.confirm\(/);
});
test('apply and undo query each original plan dimension after original server-thread and creative-owner checks',async()=>{
  for(const file of ['AssemblyPatchPlacementService.java','AssemblyPatchUndoService.java','WorldPatchPlacementService.java','WorldPatchUndoService.java']){
    const text=await service(file),start=text.indexOf('public static CompletableFuture<Operation> current('),end=text.indexOf('\n',start),query=text.slice(start,end);
    assert.ok(start>=0,file);for(const required of ['server.execute(','thread(server)','server.isDedicated()','isCreative()','server.isHost(','TASKS.get(server)','!t.player.equals(player)','WorldOperationViewScope.currentDimension('])assert.ok(query.includes(required),file+' '+required);
    assert.ok(query.includes(file.includes('Undo')?'t.origin.plan().binding().selection().world().dimension()':'t.plan.binding().selection().world().dimension()'),file);
    assert.match(query,/getServerWorld\(\).getRegistryKey\(\).getValue\(\).toString\(\)/);
    assert.doesNotMatch(query,/prepare\(|confirm\(|cancel\(|Files\.|setBlockState|TASKS\.remove|\.detach\(|WorldChangeTracker/);
  }
  const scope=await service('WorldOperationViewScope.java');assert.match(scope,/original.equals\(current\)/);assert.doesNotMatch(scope,/MinecraftServer|Files\.|BlockPos|\.confirm\(|\.cancel\(/);
});
test('fixed legacy preview has its own bounded HUD and reopen route without movable-building hints',async()=>{
  const [hud,clientSource,controller]=await Promise.all(['StudioHud.java','StudioClient.java','WorldPatchPreviewController.java'].map(client));
  const overlay=hud.slice(hud.indexOf('var legacy='),hud.indexOf('var progress='));
  for(const required of ['patch.totalWrites()','filter.mode()','不支持移动或旋转','过滤不缩小补丁'])assert.ok(overlay.includes(required),required);
  assert.doesNotMatch(overlay,/\.anchor|\.rotation|followDistance|setBlockState|\.confirm\(/);
  assert.match(clientSource,/PATCH_PREVIEW.preview\(\)!=null\?new WorldPatchPreviewScreen/);
  assert.match(controller,/void clear\(\).*message="改造预览已清空；没有建造权限"/);
});
