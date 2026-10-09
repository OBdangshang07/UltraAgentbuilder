import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read=relative=>fs.readFile(new URL('../../'+relative,import.meta.url),'utf8');
const selection='mod/src/main/java/dev/voxelstudio/selection/';

// Wiring checks supplement the full Java whole-set comparator regression.
// They are not a live world, pixel, native placement or physics acceptance.
test('whole BEFORE uses the original server audit and one bounded independent comparison',async()=>{
  const source=await read(selection+'SelectionReadService.java');
  const start=source.slice(source.indexOf('public static AssemblyBeforeHandle startAssemblyBeforeCheck'),source.indexOf('private static AssemblyAudit checkedAssemblyAudit'));
  assert.match(start,/checkedTask\(server,player,original\.id\(\),original\.selection\(\)\.revision\(\)\)/);
  assert.match(start,/checkedAssemblyAudit\(t,original,player,auditId,preview\.binding\(\)\)/);
  assert.match(start,/t\.assemblyBefore!=null\|\|t\.audit!=null\|\|t\.before!=null\|\|WorldPatchPlacementService\.busy\(server\)/);
  assert.match(start,/AssemblyPatchBeforeCheck\.prepare\(compiled,preview,\(\)->b\.cancelled\)/);
  assert.doesNotMatch(start,/fromSealedCapture|new Capture|WorldPatchBeforeCheck\.prepare|\.setBlockState|WorldPatchConsent|WorldPatchPlacementService\.prepare/);
  assert.match(source,/new AssemblyPatchBeforeCheck\(plan,assemblyBeforeSource\(server,t\),4096,2_000_000,System::nanoTime\)/);
  assert.match(source,/if\(TASKS\.get\(server\)==t\)tickAssemblyBefore\(server,t\)/);
  assert.match(source,/b\.scan\.result\(\);result\.complete\(b\.report\)/);
});
test('whole lease permits only a one-use original-object handoff and cancellation revokes read authority',async()=>{
  const source=await read(selection+'SelectionReadService.java');
  const leaseStart=source.indexOf('static final class AssemblyNativeLease');
  const worldStart=source.indexOf('static final class AssemblyNativeWorld',leaseStart);
  const factoryStart=source.indexOf('static AssemblyNativeLease assemblyNativeLease(',worldStart);
  const factoryEnd=source.indexOf('/** No writes.',factoryStart);
  assert.ok(leaseStart>=0&&worldStart>leaseStart&&factoryStart>worldStart&&factoryEnd>factoryStart);
  const lease=source.slice(leaseStart,worldStart);
  const factory=source.slice(factoryStart,factoryEnd);
  assert.match(lease,/private AssemblyNativeLease\(/);
  for(const pin of ['task.capture!=original','task.assemblyAudit!=audit','task.assemblyBefore!=before','audit.compiled!=compiled','before.preview!=preview'])assert.ok(lease.includes(pin));
  assert.match(lease,/detached\|\|checkedTask\(server,player,original\.id\(\),original\.selection\(\)\.revision\(\)\)!=task/);
  assert.match(lease,/before\.report==null\|\|before\.cancelled\|\|before\.handle\.status\.state\(\)!=AssemblyPatchBeforeCheck\.State\.MATCHED/);
  assert.match(lease,/checkedAssemblyAudit\(task,original,player,audit\.handle\.id,compiled\.binding\(\)\)!=audit/);
  assert.match(lease,/before\.scan\.result\(\)/);
  assert.match(lease,/boolean canAuthorizePlacement\(\)\{return false;\}/);
  assert.match(lease,/AssemblyNativeWorld detach\(MinecraftServer server,UUID player\)\{\s*current\(server,player\);if\(!TASKS\.remove\(server,task\)\)throw new IllegalStateException\([^;]+;detached=true;task\.lifetime\.revoke\(\)/);
  assert.match(lease,/new AssemblyNativeWorld\(task\.world,task\.player,task\.selection,task\.watch,task\.chunks,compiled,compiled\.writes\(\)\);task\.watch=null/);
  assert.match(lease,/stopAssemblyBefore\(task,AssemblyPatchBeforeCheck\.State\.CANCELLED/);
  assert.match(lease,/stopAssemblyAudit\(task,PatchAuditState\.CANCELLED/);
  assert.match(lease,/if\(task\.scan!=null\)task\.scan\.cancel\(\);task\.states\.clear\(\);task\.capture=null;task\.baseline=null/);
  assert.match(lease,/task\.handle\.status=new Status\(State\.STALE/);
  assert.doesNotMatch(lease,/\.setBlockState|new NativeWorld\(|WorldPatchJournal|WorldPatchConsent|new WorldPatchPreview\.Binding|public AssemblyNativeWorld detach/);
  assert.match(factory,/checkedTask\(server,player,original\.id\(\),original\.selection\(\)\.revision\(\)\)/);
  assert.match(factory,/b\.audit!=audit\|\|b\.preview!=preview\|\|!b\.handle\.id\.equals\(beforeId\)/);
  assert.match(factory,/b\.report==null\|\|b\.scan==null\|\|b\.handle\.status\.state\(\)!=AssemblyPatchBeforeCheck\.State\.MATCHED/);
  assert.match(factory,/var lease=new AssemblyNativeLease\(t,preview\);lease\.current\(server,player\);return lease/);
  assert.match(source,/t\.assemblyBefore!=null&&t\.assemblyBefore\.audit==audit\)stopAssemblyBefore/);
  assert.match(source,/b\.worker\.cancel\(false\);if\(b\.scan!=null\)b\.scan\.cancel\(\);b\.report=null/);
  assert.match(source,/return t!=null&&\(t\.assemblyAudit!=null\|\|t\.assemblyBefore!=null\)/);
});
test('legacy and whole renderer share only sparse read-only geometry',async()=>{
  const [api,legacy,whole,renderer]=await Promise.all([
    selection+'WorldDifferenceView.java',selection+'WorldPatchPreview.java',selection+'AssemblyPatchPreview.java',
    'mod/src/main/java/dev/voxelstudio/client/WorldPatchPreviewRenderer.java'].map(read));
  for(const source of [legacy,whole])assert.match(source,/implements WorldDifferenceView/);
  assert.doesNotMatch(api,/AssemblyPatchBinding|WorldPatchPreview\.Binding|Consent|setBlock|void write|canAuthorizePlacement\(/);
  assert.match(renderer,/rebuild\(WorldDifferenceView preview,WorldPatchPreview\.Filter filter\)/);
  assert.match(renderer,/preview\.selection\(\)\.world\(\)/);
  assert.doesNotMatch(renderer,/AssemblyPatchConsent|WorldPatchPlacementService|AssemblyPatchBinding/);
});
