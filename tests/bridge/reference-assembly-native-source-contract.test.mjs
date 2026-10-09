import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const read=name=>fs.readFile(new URL('../../mod/src/main/java/dev/voxelstudio/selection/'+name,import.meta.url),'utf8');

test('whole native lease transfers only original task/watch and revokes read authority without becoming a legacy source',async()=>{
  const text=await read('SelectionReadService.java');
  const whole=text.slice(text.indexOf('static final class AssemblyNativeLease'),text.indexOf('static AssemblyNativeLease assemblyNativeLease'));
  assert.match(whole,/private AssemblyNativeLease\(/);assert.match(whole,/detached\|\|checkedTask/);
  assert.match(whole,/TASKS\.remove\(server,task\)/);assert.match(whole,/task\.lifetime\.revoke\(\)/);
  assert.match(whole,/new AssemblyNativeWorld/);assert.match(whole,/task\.watch=null/);assert.match(whole,/task\.capture=null;task\.baseline=null/);
  assert.match(whole,/undo\.plan\(\)\.compiled\(\)!=compiled/);assert.match(whole,/undoDetached=true/);
  assert.match(whole,/compiled,compiled\.writes\(\)/);assert.match(whole,/undo\.prefix\(\)\.size\(\)-1;i>=0;i--/);assert.match(whole,/WorldPatchUndoJournal\.inverse\(undo\.prefix\(\)\.get\(i\)\)/);
  assert.doesNotMatch(whole,/new NativeWorld\(|WorldPatchJournal\.prepare|setBlockState|return true;/);
});

test('whole native source implements whole frames, exact static native states, loaded-only reads and original guarded writes',async()=>{
  const text=await read('AssemblyPatchNativeSource.java');
  assert.match(text,/implements AssemblyPatchExecution\.Source,AutoCloseable/);assert.match(text,/SelectionReadService\.AssemblyNativeWorld origin/);
  assert.match(text,/!origin\.writes\.equals\(rows\)/);
  for(const required of ['server.isOnThread()','server.isDedicated()','player.isCreative()','server.isHost(','player.getServerWorld()!=origin.world',
    'WorldPatchStatePolicy.requireStatic(row.before())','WorldPatchStatePolicy.requireStatic(row.after())','origin.selection.protectedAt(',
    'getWorldChunk(x,z)','origin.chunks.observe(','world.isOutOfHeightLimit(pos)','getWorldBorder().contains(pos)',
    'write.equals(writes.get(write.position()))','new SelectionScan.BlockFact(write.before(),false)','Block.SKIP_DROPS'])assert.ok(text.includes(required),required);
  assert.doesNotMatch(text,/WorldPatchNativeSource|WorldPatchExecution|SelectionReadService\.NativeWorld|getChunk\(|getOrCreate|\.join\(|\.get\(\)|Files\.|executeCommand|loadChunk/);
});
