import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const selection='mod/src/main/java/dev/voxelstudio/selection/';
const read=relative=>fs.readFile(new URL('../../'+relative,import.meta.url),'utf8');

// Source wiring checks supplement actual Java reconstruction tests. They do
// not certify a live server, pixels, fresh BEFORE, physics or world writes.
test('whole audit retains one server-owned original Capture and exact dispatched lifetime',async()=>{
  const source=await read(selection+'SelectionReadService.java');
  const whole=source.slice(source.indexOf('public static AssemblyAuditHandle startAssemblyAudit'),source.indexOf('public static void cancelAssemblyAudit'));
  assert.match(whole,/checkedTask\(server,player,original\.id\(\),original\.selection\(\)\.revision\(\)\)/);
  assert.match(whole,/t\.capture!=original\|\|t\.baseline==null/);
  assert.match(whole,/t\.lifetime\.checkedAssembly\(original,player,input\.binding\(\)\)/);
  assert.match(whole,/AssemblyPatchCompiler\.compile\(baseline,input,\(\)->audit\.cancelled\)/);
  assert.doesNotMatch(whole,/fromSealedCapture|new Capture|WorldPatchConsent|WorldPatchJournal|nativeLease|\.setBlockState|WorldPatchPlacementService\.prepare|\/v1\/jobs/);
  assert.match(source,/stopAssemblyAudit\(t,state==State\.CANCELLED\?PatchAuditState\.CANCELLED:PatchAuditState\.STALE,reason\)/);
  assert.match(source,/if\(TASKS\.get\(server\)==t\)tickAssemblyAudit\(server,t\)/);
  assert.match(source,/compiled\.baseline\(\)!=t\.baseline\|\|audit\.cancelled/);
});
test('legacy and whole preparations are excluded in both directions rather than per-part apply',async()=>{
  const [service,placement,undo,gate,wholePlacement]=await Promise.all(['SelectionReadService.java','WorldPatchPlacementService.java','WorldPatchUndoService.java','WorldOperationExclusion.java','AssemblyPatchPlacementService.java'].map(name=>read(selection+name)));
  assert.match(service,/t\.assemblyAudit!=null\|\|t\.audit!=null\|\|t\.before!=null\|\|WorldPatchPlacementService\.busy\(server\)/);
  assert.match(service,/t\.audit!=null\|\|t\.assemblyAudit!=null/);
  assert.match(service,/t\.before!=null\|\|t\.assemblyAudit!=null/);
  assert.match(placement,/PREPARATIONS\.containsKey\(server\)\|\|SelectionReadService\.assemblyAuditActive\(server\)/);
  // The unified family gate excludes new-building and whole apply/undo lanes.
  // Independent undo also rejects every active read/audit/BEFORE, not just the
  // older assemblyAuditActive subset. Check prepare and final confirm separately.
  const prepareStart=undo.indexOf('public static PrepareHandle prepare(');
  const confirmStart=undo.indexOf('public static CompletableFuture<Operation> confirm(');
  const confirmEnd=undo.indexOf('public static void cancel(',confirmStart);
  assert.ok(prepareStart>=0&&confirmStart>prepareStart&&confirmEnd>confirmStart);
  const prepare=undo.slice(prepareStart,undo.indexOf('private static List<',prepareStart));
  const confirm=undo.slice(confirmStart,confirmEnd);
  for(const entry of [prepare,confirm])assert.match(entry,/WorldOperationExclusion\.require\(server,WorldOperationExclusion\.Kind\.SINGLE_PATCH\)/);
  assert.match(prepare,/busy\(server\)\|\|SelectionReadService\.busy\(server\)/);
  assert.match(confirm,/if\(SelectionReadService\.busy\(server\)\)/);
  assert.ok(confirm.indexOf('SelectionReadService.busy(server)')<confirm.indexOf('WorldPatchConsent.consume('));
  for(const lane of ['PlacementService.busy(server)','WorldPatchPlacementService.busy(server)','AssemblyPatchPlacementService.busy(server)','SelectionReadService.busy(server)'])assert.ok(gate.includes(lane),lane);
  assert.match(gate,/case SINGLE_PATCH->lanes\.newBuilding\|\|lanes\.wholeAssembly/);
  assert.match(gate,/case WHOLE_ASSEMBLY->lanes\.newBuilding\|\|lanes\.singlePatch/);
  const readBusy=service.slice(service.indexOf('public static boolean busy('),service.indexOf('private static void tickAssemblyAudit'));
  assert.match(readBusy,/t\.capture==null\|\|t\.audit!=null\|\|t\.before!=null\|\|t\.assemblyAudit!=null\|\|t\.assemblyBefore!=null/);
  assert.doesNotMatch(readBusy,/WorldOperationExclusion\.require/);
  for(const source of [placement,wholePlacement]){
    const start=source.indexOf('public static boolean busy(');assert.ok(start>=0);
    const busy=source.slice(start,source.indexOf('\n',start));
    assert.match(busy,/PREPARATIONS\.containsKey\(server\)/);
    assert.match(busy,/UndoService\.busy\(server\)/);
    assert.doesNotMatch(busy,/WorldOperationExclusion\.require/);
  }
  for(const file of ['AssemblyPatchBinding.java','AssemblyPatchInput.java','AssemblyPatchCompiler.java','AssemblyPatchPreview.java']){
    const source=await read(selection+file);assert.doesNotMatch(source,/implements WorldPatchCheckedCandidate|WorldPatchPlacementService\.prepare|WorldPatchConsent\.issue|WorldPatchJournal\.prepare|new WorldPatchPreview\.Binding/);
  }
});
