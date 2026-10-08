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
  const [service,placement,undo]=await Promise.all(['SelectionReadService.java','WorldPatchPlacementService.java','WorldPatchUndoService.java'].map(name=>read(selection+name)));
  assert.match(service,/t\.assemblyAudit!=null\|\|t\.audit!=null\|\|t\.before!=null\|\|WorldPatchPlacementService\.busy\(server\)/);
  assert.match(service,/t\.audit!=null\|\|t\.assemblyAudit!=null/);
  assert.match(service,/t\.before!=null\|\|t\.assemblyAudit!=null/);
  assert.match(placement,/PREPARATIONS\.containsKey\(server\)\|\|SelectionReadService\.assemblyAuditActive\(server\)/);
  assert.match(undo,/busy\(server\)\|\|SelectionReadService\.assemblyAuditActive\(server\)/);
  for(const file of ['AssemblyPatchBinding.java','AssemblyPatchInput.java','AssemblyPatchCompiler.java','AssemblyPatchPreview.java']){
    const source=await read(selection+file);assert.doesNotMatch(source,/implements WorldPatchCheckedCandidate|WorldPatchPlacementService\.prepare|WorldPatchConsent\.issue|WorldPatchJournal\.prepare|new WorldPatchPreview\.Binding/);
  }
});
