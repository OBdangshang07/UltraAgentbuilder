import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const read=name=>fs.readFile(new URL('../../mod/src/main/java/dev/voxelstudio/'+name,import.meta.url),'utf8');

test('whole apply has its own confirmation, one complete audit/BEFORE and v2 journal/engine rather than per-part calls',async()=>{
  const apply=await read('selection/AssemblyPatchPlacementService.java');
  for(const text of ['AssemblyPatchInput input','startAssemblyAudit(server,player,original,input)',
    'startAssemblyBeforeCheck(server,p.player,p.original,p.preview,p.audit.id())','AssemblyPatchConsent.consume(',
    'p.lease.current(server,player)','p.lease.detach(server,player)','new AssemblyPatchNativeSource(',
    'AssemblyPatchJournal.create(root,plan)','new AssemblyPatchExecution(', 'unverifiedSafetyAcknowledged',
    'WorldOperationExclusion.Kind.WHOLE_ASSEMBLY','45 秒','voxel-studio-assembly-patch-journals'])assert.ok(apply.includes(text),text);
  assert.doesNotMatch(apply,/WorldPatchPlacementService|WorldPatchExecution|WorldPatchJournal\.|\.parts\(\)|resume\(|Files\.delete/);
  assert.match(apply,/private Confirmation\(/);assert.match(apply,/原磁盘操作可能仍在执行，不重发/);
});

test('whole undo uses only its original live sealed witness, distinct v2 journal/engine and final protection confirmation',async()=>{
  const undo=await read('selection/AssemblyPatchUndoService.java');
  for(const text of ['AssemblyPatchPlacementService.UndoSource','origin.sealed().verify()',
    'AssemblyPatchConsent.consume(','protectionAcknowledged','AssemblyPatchUndoJournal.create(root,origin)',
    'new AssemblyPatchUndoExecution(','t.confirmationRevision=t.source.frame().contextRevision()',
    'SelectionReadService.busy(server)','WorldOperationExclusion.Kind.WHOLE_ASSEMBLY'])assert.ok(undo.includes(text),text);
  assert.doesNotMatch(undo,/WorldPatchJournal\.inspect|WorldPatchUndoJournal\.(create|Live)|WorldPatchUndoExecution|WorldPatchPlacementService|resume\(/);
});

test('exclusion reads only leaf busy states, and old entry points also reject the new whole lane',async()=>{
  const [gate,building,legacy,undo,selection]=await Promise.all(['selection/WorldOperationExclusion.java','PlacementService.java',
    'selection/WorldPatchPlacementService.java','selection/WorldPatchUndoService.java','selection/SelectionReadService.java'].map(read));
  for(const source of ['PlacementService.busy(server)','WorldPatchPlacementService.busy(server)',
    'AssemblyPatchPlacementService.busy(server)','SelectionReadService.busy(server)'])assert.ok(gate.includes(source));
  for(const [text,kind] of [[building,'NEW_BUILDING'],[legacy,'SINGLE_PATCH'],[undo,'SINGLE_PATCH'],[selection,'READ']])assert.ok(text.includes('WorldOperationExclusion.Kind.'+kind));
  assert.ok(undo.includes('if(SelectionReadService.busy(server))'));
  for(const source of [legacy,selection])assert.match(source,/public static boolean busy\(MinecraftServer server\)/);
  const before=selection.slice(selection.indexOf('public static BeforeHandle startBeforeCheck('),selection.indexOf('public static void cancelBeforeCheck('));
  assert.ok(before.includes('WorldOperationExclusion.require(server,WorldOperationExclusion.Kind.SINGLE_PATCH)'),
    'the directly callable legacy BEFORE entry must reject another family, not only its placement caller');
  for(const source of [legacy,building]){
    const busy=source.slice(source.indexOf('public static boolean busy'),source.indexOf('\n',source.indexOf('public static boolean busy')));
    assert.doesNotMatch(busy,/WorldOperationExclusion\.require/);
  }
});

test('actual server lifecycle services whole tasks while normal full SEND remains disabled',async()=>{
  const [init,server]=await Promise.all([read('VoxelStudio.java'),fs.readFile(new URL('../../bridge/server.mjs',import.meta.url),'utf8')]);
  for(const service of ['AssemblyPatchPlacementService','AssemblyPatchUndoService']){
    assert.ok(init.includes('END_SERVER_TICK.register(dev.voxelstudio.selection.'+service+'::tick)'));
    assert.ok(init.includes('SERVER_STOPPING.register(dev.voxelstudio.selection.'+service+'::stopping)'));
  }
  assert.match(server,/referenceWorldAssemblySending = false/);
});
