import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const root=new URL('../../mod/src/main/java/dev/voxelstudio/selection/',import.meta.url);
const read=name=>fs.readFile(new URL(name,root),'utf8');
// Source wiring only. Complete Java/native reconstruction regressions and
// an exact installed-JAR live server gate are separate, mandatory evidence.
test('coupled server audit binds the same retained Capture and complete original input',async()=>{
  const source=await read('SelectionReadService.java');
  const entry=source.slice(source.indexOf('public static CoupledAuditHandle startCoupledAssemblyAudit'),source.indexOf('public static void cancelCoupledAssemblyAudit'));
  assert.match(entry,/WorldOperationExclusion\.require\(server,WorldOperationExclusion\.Kind\.COUPLED_ASSEMBLY\)/);
  assert.match(entry,/checkedTask\(server,player,original\.id\(\),original\.selection\(\)\.revision\(\)\)/);
  assert.match(entry,/t\.capture!=original\|\|t\.baseline==null/);
  assert.match(entry,/t\.lifetime\.checkedCoupled\(original,player,input\.binding\(\)\)/);
  assert.match(entry,/AssemblyCoupledCompiler\.read\(baseline,input,\(\)->audit\.cancelled\)/);
  assert.doesNotMatch(entry,/fromSealedCapture|new Capture|AssemblyPatchCompiler\.compile|\.setBlockState|Consent|Journal|nativeLease/);
  assert.match(source,/compiled\.baseline\(\)!=t\.baseline\|\|!compiled\.fromOriginalInput\(audit\.input\)\|\|audit\.cancelled/);
});
test('fresh coupled BEFORE retains whole-input identity and actual nonloading chunk identities',async()=>{
  const source=await read('SelectionReadService.java');
  const before=source.slice(source.indexOf('public static CoupledBeforeHandle startCoupledAssemblyBeforeCheck'),source.indexOf('/** Same-live-task whole lease.'));
  assert.match(before,/!preview\.fromOriginalInput\(audit\.input\)/);
  assert.match(before,/CoupledAssemblyBeforeCheck\.prepare\(compiled,input,preview,\(\)->b\.cancelled\)/);
  assert.match(before,/getChunkManager\(\)\.getWorldChunk\(x,z\)/);
  assert.match(before,/t\.chunks\.observe\(x,z,value\)/);
  assert.match(before,/new CoupledAssemblyBeforeCheck\(plan,coupledBeforeSource\(server,t\),4096,2_000_000,System::nanoTime\)/);
  assert.match(before,/b\.scan\.result\(\);result\.complete\(b\.report\)/);
  assert.doesNotMatch(before,/getChunk\(|getChunkFuture|\.setBlockState|new Capture|WorldPatchBeforeCheck\.prepare|AssemblyPatchBeforeCheck\.prepare/);
});
test('coupled audit and BEFORE participate in the real server tick and every task discard',async()=>{
  const source=await read('SelectionReadService.java');
  assert.match(source,/if\(TASKS\.get\(server\)==t\)tickCoupledAudit\(server,t\);if\(TASKS\.get\(server\)==t\)tickCoupledBefore\(server,t\)/);
  const discard=source.slice(source.indexOf('private static void discard('));
  assert.match(discard,/t\.lifetime\.revoke\(\)/);
  assert.match(discard,/stopCoupledAudit\(t,state==State\.CANCELLED\?PatchAuditState\.CANCELLED:PatchAuditState\.STALE,reason\)/);
  assert.match(discard,/stopCoupledBefore\(t,state==State\.CANCELLED\?CoupledAssemblyBeforeCheck\.State\.CANCELLED:CoupledAssemblyBeforeCheck\.State\.CONFLICT,reason\)/);
  assert.match(source,/if\(b\.worker!=null\)b\.worker\.cancel\(false\);if\(b\.scan!=null\)b\.scan\.cancel\(\);b\.report=null/);
  assert.match(source,/t\.assemblyBefore!=null\|\|t\.coupledAudit!=null\|\|t\.coupledBefore!=null/);
});
test('all existing operation families exclude the independent coupled server lane',async()=>{
  const source=await read('WorldOperationExclusion.java');
  assert.match(source,/record Lanes\(boolean newBuilding,boolean singlePatch,boolean wholeAssembly,boolean read,boolean coupledAssembly\)/);
  for(const kind of ['NEW_BUILDING','SINGLE_PATCH','WHOLE_ASSEMBLY','READ'])assert.match(source,new RegExp('case '+kind+'->[^;]*lanes\\.coupledAssembly'));
  assert.match(source,/case COUPLED_ASSEMBLY->lanes\.newBuilding\|\|lanes\.singlePatch\|\|lanes\.wholeAssembly/);
  assert.match(source,/SelectionReadService\.coupledAuditActive\(server\)/);
  assert.doesNotMatch(source,/\.setBlockState|Consent|Journal|AssemblyPatchInput/);
});
