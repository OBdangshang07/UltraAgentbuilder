import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root=new URL('../../mod/src/main/java/dev/voxelstudio/',import.meta.url);
const read=name=>fs.readFile(new URL(name,root),'utf8');
// Source wiring only, never evidence that the native world or player UI ran.
test('only the retained latest apply object can obtain the original sealed inverse witness',async()=>{
 const source=await read('selection/CoupledAssemblyPlacementService.java');
 assert.match(source,/private UndoSource\(Task task\)/);
 assert.match(source,/TASKS\.get\(server\)!=task\|\|!task\.player\.equals\(player\)\|\|task\.undoSubmitted/);
 assert.match(source,/task\.engine\.undoOrigin\(\)!=original/);
 assert.match(source,/task\.handle!=operation\|\|task\.engine==null/);
 assert.match(source,/task\.world\.currentUndo\(server,player,original\)/);
});
test('inverse preparation verifies the same sealed origin without claiming it or touching worlds',async()=>{
 const source=await read('selection/CoupledAssemblyUndoService.java');
 const prepare=source.slice(source.indexOf('public static PrepareHandle prepare('),source.indexOf('public static void cancelPreparation('));
 assert.match(prepare,/WorldOperationExclusion\.require\(server,WorldOperationExclusion\.Kind\.READ\)/);
 assert.match(prepare,/CoupledAssemblyPlacementService\.undoSource\(server,player,original\)/);
 assert.match(prepare,/AssemblyPlanPreparation\.start\(VERIFY,System::nanoTime/);
 assert.match(prepare,/origin\.sealed\(\)\.verify\(\)/);
 assert.doesNotMatch(prepare,/\.claim\(|\.forUndo\(|\.open\(|\.setBlockState|UndoJournal\.create/);
});
test('inverse final confirmation is private, purpose-bound and consumed only by native handoff',async()=>{
 const source=await read('selection/CoupledAssemblyUndoService.java');
 assert.match(source,/private Confirmation\(Preparation owner,Summary summary,CoupledAssemblyConsent\.Ticket ticket\)/);
 assert.match(source,/CoupledAssemblyConsent\.issue\(p,p\.player,p\.original\.plan\(\)\.binding\(\),CoupledAssemblyConsent\.Purpose\.UNDO,System\.nanoTime\(\)\)/);
 assert.match(source,/p!=confirmation\.owner\|\|p\.confirmation!=confirmation\|\|!p\.player\.equals\(player\)/);
 assert.match(source,/!protectionAcknowledged/);
 assert.match(source,/p\.source\.open\(server,player,p,confirmation\.ticket\)/);
 assert.doesNotMatch(source,/CoupledAssemblyConsent\.consume|Purpose\.APPLY/);
});
test('original inverse disk result precedes exact plan identity and native source construction',async()=>{
 const source=await read('selection/CoupledAssemblyUndoService.java');
 const wait=source.indexOf('if(!t.worker.isDone())'),result=source.indexOf('t.journal=t.worker.getNow(null)'),identity=source.indexOf('!t.journal.plan().fromOriginalOrigin(t.original)'),native=source.indexOf('new CoupledAssemblyUndoNativeSource(server,t.world,t.journal.plan())');
 assert.ok(wait>=0&&result>wait&&identity>result&&native>identity);
 assert.match(source,/new CoupledAssemblyUndoExecution\(new CoupledAssemblyUndoExecution\.Disk\(t\.journal,DISK\),t\.source,64,2_000_000,System::nanoTime\)/);
 assert.match(source,/CoupledAssemblyUndoJournal\.create\(directory,original\)/);
 assert.match(source,/var directory=original\.archive\(\)\.getParent\(\)/);
});
test('undo busy is a leaf and participates in forward idle and the shared family policy',async()=>{
 const source=await read('selection/CoupledAssemblyUndoService.java'),forward=await read('selection/CoupledAssemblyPlacementService.java');
 const busy=source.slice(source.indexOf('public static boolean busy('),source.indexOf('private static void idle('));
 assert.match(busy,/PREPARATIONS\.containsKey\(server\)\|\|RETIRING\.containsKey\(server\)/);
 assert.match(busy,/!terminal\(t\.handle\.status\.state\)\|\|diskBusy\(\)/);
 assert.doesNotMatch(busy,/WorldOperationExclusion|CoupledAssemblyPlacementService|\.(?:get|join)\(\)/);
 assert.match(forward,/diskBusy\(\)\|\|CoupledAssemblyUndoService\.busy\(server\)/);
});
test('cancelled preparation retains worker lifetime and unknown disk work never replays',async()=>{
 const source=await read('selection/CoupledAssemblyUndoService.java');
 assert.match(source,/CoupledAssemblyConsent\.revoke\(p\.confirmation\.ticket,p\)/);
 assert.match(source,/p\.worker\.cancel\(\);if\(!p\.worker\.closed\(\)\)RETIRING\.put\(server,p\.worker\)/);
 assert.match(source,/DISK\.getActiveCount\(\)!=0\|\|!DISK\.getQueue\(\)\.isEmpty\(\)/);
 assert.match(source,/finish\(t,State\.REVIEW_REQUIRED,0,0,0,/);
 assert.doesNotMatch(source,/t\.worker\.cancel|Files\.delete|Thread\.sleep|retry|resume/);
});
test('inverse tick and shutdown ordering preserve the original forward source until undo is closed',async()=>{
 const source=await read('VoxelStudio.java');
 const apply=source.indexOf('END_SERVER_TICK.register(dev.voxelstudio.selection.CoupledAssemblyPlacementService::tick)'),undo=source.indexOf('END_SERVER_TICK.register(dev.voxelstudio.selection.CoupledAssemblyUndoService::tick)');
 const stopUndo=source.indexOf('SERVER_STOPPING.register(dev.voxelstudio.selection.CoupledAssemblyUndoService::stopping)'),stopApply=source.indexOf('SERVER_STOPPING.register(dev.voxelstudio.selection.CoupledAssemblyPlacementService::stopping)'),stopRead=source.indexOf('SERVER_STOPPING.register(dev.voxelstudio.selection.SelectionReadService::stopping)');
 assert.ok(apply>=0&&undo>apply&&stopUndo>=0&&stopApply>stopUndo&&stopRead>stopApply);
});
test('inverse public views remain current-host dimension scoped and never claim durability',async()=>{
 const source=await read('selection/CoupledAssemblyUndoService.java');
 assert.match(source,/server\.isDedicated\(\)\|\|user==null\|\|!user\.isCreative\(\)\|\|!server\.isHost\(user\.getGameProfile\(\)\)/);
 assert.match(source,/WorldOperationViewScope\.currentDimension\(t\.original\.plan\(\)\.binding\(\)\.selection\(\)\.world\(\)\.dimension\(\)/);
 assert.match(source,/worldDurabilityVerified\(\)\{return false;\}/);
 assert.match(source,/t\.journal==null\?null:t\.journal\.plan\(\)\.id\(\)\.toString\(\)/);
});
