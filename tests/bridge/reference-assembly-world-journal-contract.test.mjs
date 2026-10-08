import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const read=relative=>fs.readFile(new URL('../../'+relative,import.meta.url),'utf8');
const selection='mod/src/main/java/dev/voxelstudio/selection/';

// These source contracts supplement actual Java disk/whole execution tests.
// They do not certify a live gateway, final confirmation or game physics.
test('whole journal retains complete original bytes and has an independent v2 identity',async()=>{
  const [journal,input,client]=await Promise.all([selection+'AssemblyPatchJournal.java',selection+'AssemblyPatchInput.java',
    'mod/src/main/java/dev/voxelstudio/client/ReferenceWorldAssemblyCandidateReceipt.java'].map(read));
  assert.match(journal,/AssemblyPatchTransactionPlan/);assert.match(journal,/addProperty\("version",2\)/);
  assert.match(journal,/for\(var part:compiled\.original\(\)\.parts\(\)\)/);
  for(const member of ['originalProposal()','originalPatch()','originalPreview()'])assert.ok(journal.includes(member));
  assert.match(journal,/Original complete preview bytes required; no synthesized archive substitute/);
  assert.match(journal,/AssemblyPatchCompiler\.compile\(baseline,new AssemblyPatchInput\(binding,parts\),\(\)->false\)/);
  assert.doesNotMatch(journal,/WorldPatchJournal\.(Plan|Live|prepare|create)|WorldPatchExecution|\.setBlockState|WorldPatchPlacementService/);
  assert.match(input,/previewBytes=originalPreview\.clone\(\)/);
  assert.match(client,/new AssemblyPatchInput\.Part\(part\.index,part\.proposal,part\.patch,part\.preview,part\.previewBytes\)/);
});
test('whole engine has one ordered plan and disk acknowledgement never becomes legacy apply',async()=>{
  const source=await read(selection+'AssemblyPatchExecution.java');
  assert.match(source,/AssemblyPatchJournal\.Plan plan\(\)/);assert.match(source,/writes=plan\.compiled\(\)\.writes\(\)/);
  assert.match(source,/intent\.belongs\(log\.plan\(\)\)/);assert.match(source,/actual\.contextRevision!=revision\+1/);
  assert.match(source,/private UndoOrigin\(/);
  assert.doesNotMatch(source,/WorldPatchExecution|WorldPatchJournal\.|WorldPatchPlacementService|for\(var part:|\.join\(|Thread\.sleep/);
  const tick=source.slice(source.indexOf('Progress step()'));
  assert.doesNotMatch(tick,/Files\.|WorldPatchJournalFiles|\.get\(\)|\.join\(|prepare\(/);
});
test('journal unknown publications and review never grant replay or durability',async()=>{
  const source=await read(selection+'AssemblyPatchJournal.java');
  assert.match(source,/broken=true;throw io\(error\)/);assert.match(source,/worldDurabilityVerified\(\)\{return false;\}/);
  assert.match(source,/if\(names\.contains\("ambiguous\.json"\)\)throw new IOException/);
  assert.match(source,/WorldPatchJournalFiles\.publish\(directory\.resolve\(name\),raw,eventMaximum\(name\)\)/);
  assert.doesNotMatch(source,/REPLACE_EXISTING|TRUNCATE_EXISTING|Files\.delete|resume\(|recoverAndApply/);
});
