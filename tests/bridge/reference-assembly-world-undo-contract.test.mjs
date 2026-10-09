import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const read=relative=>fs.readFile(new URL('../../mod/src/main/java/dev/voxelstudio/selection/'+relative,import.meta.url),'utf8');

// Wiring only; Java covers whole ledgers and a synthetic world. No live
// server final consent, game-save durability or model understanding claim.
test('whole undo uses an independent v2 plan and original same-live sealed witness',async()=>{
  const [journal,apply,undo]=await Promise.all(['AssemblyPatchUndoJournal.java','AssemblyPatchExecution.java','AssemblyPatchUndoExecution.java'].map(read));
  assert.match(journal,/AssemblyPatchUndoPlan/);assert.match(journal,/addProperty\("version",2\)/);assert.match(journal,/AssemblyPatchExecution\.UndoOrigin/);assert.match(journal,/origin\.sealed\(\)\.verify\(\)/);assert.match(journal,/origin\.claim\(\)/);
  assert.doesNotMatch(journal,/WorldPatchUndoJournal|WorldPatchJournal\.(Plan|Live|prepare|create)|WorldPatchExecution/);
  assert.match(apply,/log\.sealed\(confirmed\)/);assert.match(undo,/AssemblyPatchExecution\.Source source/);assert.match(undo,/PRESERVED_TARGET/);assert.match(undo,/PRESERVED_NEIGHBOR/);assert.match(undo,/WorldPointIndex\.copy\(indexed\)/);
});
test('whole live seal checks exact archive events without rebuilding a replacement on each batch',async()=>{
  const source=await read('AssemblyPatchJournal.java');const sealed=source.slice(source.indexOf('static final class Sealed'),source.indexOf('static Live create'));
  assert.match(sealed,/private Sealed\(/);assert.match(sealed,/plan\.verifyArchive\(directory\)/);assert.match(sealed,/events\.get\(name\)/);assert.match(sealed,/core\.size\(\)\+events\.size\(\)/);assert.doesNotMatch(sealed,/inspect\(|compile\(|new Capture|setBlock|canAuthorizePlacement\(\)\{return true/);
});
test('whole undo disk review is read-only and cooperative ticks do not block on disk',async()=>{
  const [journal,engine]=await Promise.all(['AssemblyPatchUndoJournal.java','AssemblyPatchUndoExecution.java'].map(read));
  assert.match(journal,/AssemblyPatchJournal\.inspect\(directory\.getParent\(\)\.resolve\(parentId\.toString\(\)\)\)/);assert.doesNotMatch(journal,/REPLACE_EXISTING|TRUNCATE_EXISTING|Files\.delete|recoverAndApply|resume\(/);
  assert.doesNotMatch(engine.slice(engine.indexOf('Progress step()')),/Files\.|\.join\(|\.get\(\)|Thread\.sleep/);assert.match(engine,/f\.contextRevision\(\)!=revision\+1/);
});
