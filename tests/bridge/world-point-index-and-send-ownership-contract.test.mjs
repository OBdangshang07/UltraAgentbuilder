import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const read=relative=>fs.readFile(new URL('../../'+relative,import.meta.url),'utf8');

// Source wiring supplements Java collision, defensive-copy and concurrent
// publication regression; not game performance or external SEND acceptance.
test('large coordinate lookups keep Point identity and avoid flat MapN copies',async()=>{
  const selection='mod/src/main/java/dev/voxelstudio/selection/';
  for(const [name,field,input] of [
    ['AssemblyPatchExecution.java','guards','indexed'],['AssemblyPatchPreview.java','positions','rows'],
    ['WorldPatchPreview.java','positions','positions'],['WorldPatchNativeSource.java','writes','map'],
    ['WorldPatchExecution.java','guards','indexed'],['WorldPatchUndoExecution.java','guards','indexed'],
  ])assert.ok((await read(selection+name)).includes(`${field}=WorldPointIndex.copy(${input})`),name);
  assert.match(await read('mod/src/main/java/dev/voxelstudio/client/ReferenceWorldAssemblyCandidateReceipt.java'),/rows=WorldPointIndex\.copy\(r\)/);
  const helper=await read(selection+'WorldPointIndex.java');assert.match(helper,/new HashMap/);assert.match(helper,/Collections\.unmodifiableMap\(copy\)/);assert.match(helper,/Objects\.requireNonNull\(point\)/);assert.match(helper,/Objects\.requireNonNull\(value\)/);
  const region=await read(selection+'SelectionRegion.java');assert.doesNotMatch(region,/hashCode\(/);
});
test('SEND ownership comes only from this durable publication, never an observed reference',async()=>{
  const source=await read('mod/src/main/java/dev/voxelstudio/client/PatchReferenceStore.java');
  const claim=source.slice(source.indexOf('synchronized boolean claim'),source.indexOf('synchronized JsonObject read'));
  assert.match(claim,/return publish\(input\)\.created\(\)/);assert.doesNotMatch(claim,/return true|readAt\(|remember\(/);
  assert.match(source,/new Publication\(previous,false\)/);assert.match(source,/Files\.move\(pending,target\);return new Publication\(readAt\(id\),true\)/);
  assert.match(source,/StandardOpenOption\.CREATE_NEW/);assert.doesNotMatch(source,/REPLACE_EXISTING|TRUNCATE_EXISTING|Files\.delete/);
});
