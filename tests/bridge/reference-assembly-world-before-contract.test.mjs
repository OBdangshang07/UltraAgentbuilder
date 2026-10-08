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
test('whole lease and cancellation retain exact objects without exposing a writer',async()=>{
  const source=await read(selection+'SelectionReadService.java');
  const lease=source.slice(source.indexOf('static final class AssemblyNativeLease'),source.indexOf('/** No writes.'));
  assert.match(lease,/private AssemblyNativeLease\(/);
  for(const pin of ['task.capture!=original','task.assemblyAudit!=audit','task.assemblyBefore!=before','audit.compiled!=compiled','before.preview!=preview'])assert.ok(lease.includes(pin));
  assert.match(lease,/before\.scan\.result\(\)/);
  assert.doesNotMatch(lease,/\.setBlockState|detach\(|WorldPatchJournal|WorldPatchConsent|new WorldPatchPreview\.Binding/);
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
