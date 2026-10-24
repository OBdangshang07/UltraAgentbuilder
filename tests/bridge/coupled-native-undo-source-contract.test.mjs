import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root=new URL('../../mod/src/main/java/dev/voxelstudio/selection/',import.meta.url);
const read=name=>fs.readFile(new URL(name,root),'utf8');
// Source wiring only; no actual native world, consent or save is fabricated.
test('inverse native origin requires original compiled identity and independent UNDO consumption',async()=>{
 const source=await read('SelectionReadService.java'),start=source.indexOf('CoupledUndoNativeWorld forUndo('),end=source.indexOf('static CoupledNativeLease coupledNativeLease(',start),entry=source.slice(start,end);
 assert.ok(start>=0&&end>start);
 for(const pin of ['undoDetached','undo.plan().compiled()!=compiled','!compiled.fromOriginalInput(input)','world.getServer()!=server','current.getServerWorld()!=world','busy(server)'])assert.ok(entry.includes(pin),pin);
 const consent=entry.indexOf('CoupledAssemblyConsent.consume('),origin=entry.indexOf('new CoupledUndoNativeWorld(');assert.ok(consent>=0&&origin>consent);
 assert.match(entry,/confirmationOwner,player,input\.binding\(\),CoupledAssemblyConsent\.Purpose\.UNDO/);
 assert.match(entry,/private CoupledUndoNativeWorld\(/);
 assert.doesNotMatch(entry,/new Capture\(|fromSealedCapture|getChunkFuture|\.setBlockState/);
});
test('original inverse plan must claim the private source once without rebasing a late epoch',async()=>{
 const selection=await read('SelectionReadService.java'),source=await read('CoupledAssemblyUndoNativeSource.java');
 assert.match(selection,/sourceClaimed\|\|!plan\.fromOriginalOrigin\(original\)\|\|plan\.original\(\)!=original\.plan\(\)/);
 assert.match(selection,/initialRevision=watch\.revision\(\)/);
 assert.match(source,/origin\.claim\(Objects\.requireNonNull\(plan\)\)/);
 assert.match(source,/revision=origin\.initialRevision/);
 assert.doesNotMatch(source,/revision=origin\.watch\.revision\(\)/);
});
test('inverse source does not reuse forward authority and expands only the next complete group',async()=>{
 const source=await read('CoupledAssemblyUndoNativeSource.java');
 assert.match(source,/implements CoupledAssemblyUndoExecution\.Source,AutoCloseable/);
 assert.match(source,/SelectionReadService\.CoupledUndoNativeWorld origin,CoupledAssemblyUndoJournal\.Plan plan/);
 assert.match(source,/new CoupledNativeWriteGate\(plan\.groups\(\)\.size\(\),index->plan\.groups\(\)\.get\(index\)\.writes\(\)\)/);
 assert.match(source,/CoupledAssemblyNativeCheck\.Mode\.UNDO/);
 assert.doesNotMatch(source,/new CoupledAssemblyNativeSource|AssemblyNativeWorld|JsonObject|Files\.|getChunkFuture/);
});
test('preservation is an ordered no-write operation and cannot close an armed half group',async()=>{
 const source=await read('CoupledAssemblyUndoNativeSource.java'),gate=await read('CoupledNativeWriteGate.java');
 const preserve=source.slice(source.indexOf('public boolean preserveGroup('),source.indexOf('public boolean verifyGroup('));
 assert.match(preserve,/!gate\.expects\(rows\)/);assert.match(preserve,/gate\.preserve\(rows\)/);assert.doesNotMatch(preserve,/setBlockState|gate\.applied|gate\.arm/);
 assert.match(gate,/void preserve\(List<WorldPatchCompiler\.Write> rows\)[\s\S]*?if\(!expects\(rows\)\)\{revoke\(\)/);
});
test('the inverse core acknowledges native preservation before evaluating the whole group',async()=>{
 const source=await read('CoupledAssemblyUndoExecution.java');
 assert.match(source,/interface Source extends CoupledAssemblyExecution\.Source/);
 const preserve=source.indexOf('if(!source.preserveGroup(rows)||!frame())'),evaluate=source.indexOf('for(var row:rows){var entry=new CoupledAssemblyUndoJournal.Entry');assert.ok(preserve>=0&&evaluate>preserve);
 assert.match(source,/reason="原完整逆向组保留游标不一致；不继续恢复其他组";receipt\(CoupledAssemblyJournal\.ReceiptState\.CONFLICT\);break/);
});
test('immutable original AFTER lookup is prepared in the original inverse plan, never on tick',async()=>{
 const journal=await read('CoupledAssemblyUndoJournal.java'),core=await read('CoupledAssemblyUndoExecution.java');
 assert.match(journal,/originalAfter=Map\.copyOf\(after\)/);
 assert.match(journal,/boolean fromOriginalOrigin\(CoupledAssemblyExecution\.UndoOrigin value\)\{return origin==value;\}/);
 assert.match(core,/log\.plan\(\)\.originalAfter\(\)\.getOrDefault\(point,before\.state\(\)\)/);
 const constructor=core.slice(core.indexOf('CoupledAssemblyUndoExecution(Log log,'),core.indexOf('Progress progress()'));assert.doesNotMatch(constructor,/for\(|expected\.put/);
});
test('inverse writes require exact gate, original region and native state before mutation',async()=>{
 const source=await read('CoupledAssemblyUndoNativeSource.java'),start=source.indexOf('public boolean set('),end=source.indexOf('@Override public void close'),setter=source.slice(start,end);
 assert.ok(setter.indexOf('gate.permits(write)')<setter.indexOf('origin.world.setBlockState('));
 assert.match(setter,/origin\.selection\.protectedAt\(write\.position\(\)\)/);
 assert.match(setter,/new SelectionScan\.BlockFact\(write\.before\(\),false\)/);
 assert.match(setter,/Block\.NOTIFY_LISTENERS\|Block\.FORCE_STATE\|Block\.SKIP_DROPS/);
 assert.match(source,/oracle\.check\(rows,false\)/);assert.match(source,/oracle\.check\(rows,true\)/);
});
