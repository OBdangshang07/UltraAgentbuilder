import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const root=new URL('../../mod/src/main/java/dev/voxelstudio/',import.meta.url);
const read=name=>fs.readFile(new URL(name,root),'utf8');
// Wiring checks only. Existing pure-core JUnit fault cases, real server/native
// entry points and physical saves require their own independent acceptance.
test('coupled service prepares the same audited original input through fresh BEFORE',async()=>{
 const source=await read('selection/CoupledAssemblyPlacementService.java');
 for(const expression of [/startCoupledAssemblyAudit\(server,player,original,input\)/,/startCoupledAssemblyBeforeCheck\(server,p\.player,p\.original,p\.preview,p\.audit\.id\(\)\)/,/coupledNativeLease\(server,p\.player,p\.original,p\.preview,p\.audit\.id\(\),p\.before\.id\(\),p\)/])assert.match(source,expression);
 assert.match(source,/AssemblyPlanPreparation\.start\(PLAN,System::nanoTime,cancelled->prepared\(lease,player,cancelled\)\)/);
 assert.match(source,/plan\.compiled\(\)!=lease\.compiled\(\)/);
 assert.match(source,/!plan\.compiled\(\)\.fromOriginalInput\(lease\.input\(\)\)/);
 assert.doesNotMatch(source,/AssemblyPatchPlacementService|WorldPatchPlacementService|fromSealedCapture|new Capture\(|\.setBlockState/);
});
test('private confirmation retains owner identity and cannot be forged from public summaries',async()=>{
 const source=await read('selection/CoupledAssemblyPlacementService.java');
 assert.match(source,/private Confirmation\(Preparation owner,Summary summary,CoupledAssemblyConsent\.Ticket ticket\)/);
 assert.match(source,/CoupledAssemblyConsent\.issue\(p,p\.player,value\.plan\.binding\(\),CoupledAssemblyConsent\.Purpose\.APPLY,System\.nanoTime\(\)\)/);
 assert.match(source,/p!=confirmation\.owner\|\|p\.confirmation!=confirmation\|\|!p\.player\.equals\(player\)/);
 assert.match(source,/!unverifiedSafetyAcknowledged/);
 assert.match(source,/canAuthorizePlacement\(\)\{return false;\}/);
 assert.match(source,/physicsVerified\(\)\{return false;\}/);
});
test('native detach consumes the original ticket once and precedes any grouped journal task',async()=>{
 const source=await read('selection/CoupledAssemblyPlacementService.java');
 const confirm=source.slice(source.indexOf('public static CompletableFuture<Operation> confirm('),source.indexOf('private static CoupledAssemblyJournal.Live createJournal('));
 const cancelled=confirm.indexOf('result.isCancelled()'),detach=confirm.indexOf('p.lease.detach(server,player,confirmation.ticket)'),native=confirm.indexOf('new CoupledAssemblyNativeSource(server,t.world)'),disk=confirm.indexOf('CompletableFuture.supplyAsync(');
 assert.ok(cancelled>=0&&detach>cancelled&&native>detach&&disk>native);
 assert.doesNotMatch(confirm,/CoupledAssemblyConsent\.consume|new CoupledAssemblyExecution|\.(?:join|get)\(\)/);
 assert.match(confirm,/PREPARATIONS\.remove\(server,p\)/);
});
test('tick awaits the original initial journal and uses bounded grouped execution without retries',async()=>{
 const source=await read('selection/CoupledAssemblyPlacementService.java');
 assert.match(source,/if\(!t\.worker\.isDone\(\)\)/);
 assert.match(source,/t\.workerStarted>CoupledAssemblyExecution\.WAIT_TIMEOUT_NANOS/);
 assert.match(source,/finish\(t,State\.REVIEW_REQUIRED,0,/);
 assert.match(source,/new CoupledAssemblyExecution\(new CoupledAssemblyExecution\.Disk\(t\.journal,DISK\),t\.source,64,2_000_000,System::nanoTime\)/);
 assert.match(source,/if\(t\.cancelled\)t\.engine\.cancel\(\)/);
 assert.doesNotMatch(source,/retry|resume|t\.worker\.cancel\(|Thread\.sleep|Files\.delete|\.get\(\d/);
});
test('cancellation revokes preparation but retains retiring CPU lifetime until actual closure',async()=>{
 const source=await read('selection/CoupledAssemblyPlacementService.java');
 assert.match(source,/CoupledAssemblyConsent\.revoke\(p\.confirmation\.ticket,p\)/);
 assert.match(source,/p\.worker\.cancel\(\);if\(!p\.worker\.closed\(\)\)RETIRING_PLANS\.put\(server,p\.worker\)/);
 assert.match(source,/RETIRING_PLANS\.entrySet\(\)\.removeIf\(e->e\.getValue\(\)\.closed\(\)\)/);
 assert.match(source,/cancelCoupledAssemblyAudit\(server,p\.audit\.id\(\)\)/);
 assert.match(source,/cancelCoupledAssemblyBeforeCheck\(server,p\.before\.id\(\)\)/);
});
test('leaf busy includes actual coupled task and original outstanding disk work in every family policy',async()=>{
 const source=await read('selection/CoupledAssemblyPlacementService.java'),policy=await read('selection/WorldOperationExclusion.java');
 const busy=source.slice(source.indexOf('public static boolean busy('),source.indexOf('private static void idle('));
 assert.match(busy,/RETIRING_PLANS\.containsKey\(server\)\|\|PREPARATIONS\.containsKey\(server\)/);
 assert.match(busy,/!terminal\(t\.handle\.status\.state\)\|\|diskBusy\(\)/);
 assert.doesNotMatch(busy,/WorldOperationExclusion|SelectionReadService|\.(?:join|get)\(\)/);
 assert.match(source,/DISK\.getActiveCount\(\)!=0\|\|!DISK\.getQueue\(\)\.isEmpty\(\)/);
 assert.match(policy,/SelectionReadService\.coupledAuditActive\(server\)\|\|CoupledAssemblyPlacementService\.busy\(server\)/);
});
test('actual lifecycle processes read checks before coupled placement and closes it before capture cleanup',async()=>{
 const source=await read('VoxelStudio.java');
 const readTick=source.indexOf('END_SERVER_TICK.register(dev.voxelstudio.selection.SelectionReadService::tick)'),coupledTick=source.indexOf('END_SERVER_TICK.register(dev.voxelstudio.selection.CoupledAssemblyPlacementService::tick)');
 const coupledStop=source.indexOf('SERVER_STOPPING.register(dev.voxelstudio.selection.CoupledAssemblyPlacementService::stopping)'),readStop=source.indexOf('SERVER_STOPPING.register(dev.voxelstudio.selection.SelectionReadService::stopping)');
 assert.ok(readTick>=0&&coupledTick>readTick&&coupledStop>=0&&readStop>coupledStop);
 const service=await read('selection/CoupledAssemblyPlacementService.java');
 assert.match(service,/服务器正在关闭；未确认成组准备作废/);
 assert.match(service,/State\.REVIEW_REQUIRED[\s\S]*关闭时成组事务未完全封闭/);
});
test('live status reads are current-host and dimension scoped and do not imply physical durability',async()=>{
 const source=await read('selection/CoupledAssemblyPlacementService.java');
 assert.match(source,/server\.isDedicated\(\)\|\|user==null\|\|!user\.isCreative\(\)\|\|!server\.isHost\(user\.getGameProfile\(\)\)/);
 assert.match(source,/WorldOperationViewScope\.currentDimension\(t\.plan\.binding\(\)\.selection\(\)\.world\(\)\.dimension\(\),user\.getServerWorld\(\)\.getRegistryKey\(\)\.getValue\(\)\.toString\(\)\)/);
 assert.match(source,/worldDurabilityVerified\(\)\{return false;\}/);
 assert.match(source,/voxel-studio-coupled-assembly-journals/);
 assert.match(source,/getUsableSpace\(\)<2L\*1024\*1024\*1024/);
});
