import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const root=new URL('../../mod/src/main/java/dev/voxelstudio/selection/',import.meta.url);
const read=name=>fs.readFile(new URL(name,root),'utf8');
// Wiring only: JUnit identity/concurrency and installed native/world gates
// are separate. No model, world, native factory or permission is mocked here.
test('archive verification cannot replace the original owned compiled object',async()=>{
 const source=await read('CoupledAssemblyJournal.java');
 assert.match(source,/static Plan prepareOwned\([\s\S]*?Objects\.requireNonNull\(owned\)/);
 assert.match(source,/var again=AssemblyCoupledCompiler\.read\(baseline,input,cancelled\);var compiled=owned==null\?again:owned/);
 assert.match(source,/!owned\.fromOriginalInput\(input\)/);
 for(const pin of ['snapshotHash','selectionHash','contextRevision'])assert.ok(source.includes('owned.baseline().'+pin),pin);
 assert.match(source,/!again\.writes\(\)\.equals\(owned\.writes\(\)\)/);
 assert.match(source,/!again\.groups\(\)\.equals\(owned\.groups\(\)\)/);
 assert.match(source,/new Plan\(id,player,input,compiled,members,hash\)/);
 assert.match(source,/prepare\(capture,input,null,player,id,\(\)->false\)/);
});
test('new native lease requires the exact original audit, input, preview and BEFORE',async()=>{
 const source=await read('SelectionReadService.java');
 const start=source.indexOf('static final class CoupledNativeLease'),end=source.indexOf('/** Same-live-task whole lease.',start),lease=source.slice(start,end);
 assert.ok(start>=0&&end>start);
 for(const pin of ['task.capture!=original','task.coupledAudit!=audit','task.coupledBefore!=before','audit.input!=input','audit.compiled!=compiled','before.preview!=preview','!compiled.fromOriginalInput(input)','!preview.fromOriginalInput(input)'])assert.ok(lease.includes(pin),pin);
 assert.match(lease,/CoupledAssemblyJournal\.prepareOwned\(original,input,compiled,player,cancelled\)/);
 assert.match(lease,/before\.scan\.result\(\)/);
 assert.doesNotMatch(lease,/new Capture|new AssemblyNativeWorld|AssemblyPatchConsent\.consume|fromSealedCapture/);
});
test('only independent original final APPLY consumption precedes native detachment',async()=>{
 const source=await read('SelectionReadService.java');
 const start=source.indexOf('CoupledNativeWorld detach('),end=source.indexOf('static CoupledNativeLease coupledNativeLease(',start),entry=source.slice(start,end);
 const current=entry.indexOf('current(server,player)'),consume=entry.indexOf('CoupledAssemblyConsent.consume('),remove=entry.indexOf('TASKS.remove(server,task)'),construct=entry.indexOf('new CoupledNativeWorld(');
 assert.ok(current>=0&&consume>current&&remove>consume&&construct>remove);
 assert.match(entry,/confirmationOwner,player,input\.binding\(\),CoupledAssemblyConsent\.Purpose\.APPLY/);
 assert.match(entry,/task\.lifetime\.revoke\(\)/);
 assert.match(entry,/private CoupledNativeWorld\(/);
 assert.match(entry,/task\.capture=null;task\.baseline=null/);
 assert.doesNotMatch(entry,/setBlockState|getChunkFuture|new Capture/);
});
test('coupled final consent stays private, purpose-bound and atomically one-use',async()=>{
 const source=await read('CoupledAssemblyConsent.java');
 assert.match(source,/enum Purpose \{ APPLY,UNDO \}/);
 assert.match(source,/private Ticket\(/);
 assert.match(source,/ticket\.owner==owner/);
 assert.match(source,/ticket\.purpose==purpose/);
 assert.match(source,/synchronized\(ticket\)/);
 assert.match(source,/ticket\.used=true/);
 assert.doesNotMatch(source,/AssemblyPatchBinding|WorldPatchPreview|com\.google\.gson|MinecraftServer|\.setBlockState/);
});
test('actual native source uses the private world origin and exact lazy group gate',async()=>{
 const source=await read('CoupledAssemblyNativeSource.java');
 assert.match(source,/CoupledAssemblyNativeSource\(MinecraftServer server,SelectionReadService\.CoupledNativeWorld origin\)/);
 assert.match(source,/!origin\.compiled\.fromOriginalInput\(origin\.input\)/);
 assert.match(source,/revision=origin\.input\.binding\(\)\.contextRevision\(\)/);
 assert.match(source,/new CoupledNativeWriteGate\(origin\.compiled\.groups\(\)\.size\(\)/);
 assert.match(source,/actual==revision\+gate\.writtenInActiveGroup\(\)/);
 assert.match(source,/getChunkManager\(\)\.getWorldChunk\(x,z\)/);
 assert.doesNotMatch(source,/getChunkFuture|fromSealedCapture|JsonObject|Files\.|new Capture|AssemblyNativeWorld/);
});
test('physical preflight and exact ordered row authorization precede every native set',async()=>{
 const source=await read('CoupledAssemblyNativeSource.java');
 assert.match(source,/oracle\.check\(rows,false\)/);assert.match(source,/oracle\.check\(rows,true\)/);
 assert.match(source,/revision\+=gate\.complete\(rows\)/);
 const setter=source.slice(source.indexOf('public boolean set('),source.indexOf('@Override public void close'));
 const authorized=setter.indexOf('gate.permits(write)'),actual=setter.indexOf('origin.world.setBlockState(');assert.ok(authorized>=0&&actual>authorized);
 assert.match(setter,/origin\.selection\.protectedAt\(write\.position\(\)\)/);
 assert.match(setter,/Block\.NOTIFY_LISTENERS\|Block\.FORCE_STATE\|Block\.SKIP_DROPS/);
 assert.match(setter,/if\(changed\)gate\.applied\(write\);else gate\.revoke\(\)/);
 assert.doesNotMatch(setter,/NOTIFY_NEIGHBORS|new Capture|loadChunk/);
});
