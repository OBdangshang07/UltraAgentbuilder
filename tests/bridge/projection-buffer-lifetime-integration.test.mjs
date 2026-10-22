import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const source=await fs.readFile(new URL('../../mod/src/main/java/dev/voxelstudio/client/ProjectionRenderer.java',import.meta.url),'utf8');
const patch=await fs.readFile(new URL('../../mod/src/main/java/dev/voxelstudio/client/WorldPatchPreviewRenderer.java',import.meta.url),'utf8');
const storage=await fs.readFile(new URL('../../mod/src/main/java/dev/voxelstudio/client/ProjectionBufferStorage.java',import.meta.url),'utf8');
const accessor=await fs.readFile(new URL('../../mod/src/main/java/dev/voxelstudio/mixin/BufferBuilderNativeAccess.java',import.meta.url),'utf8');
const mixins=JSON.parse(await fs.readFile(new URL('../../mod/src/main/resources/voxel-studio.mixins.json',import.meta.url),'utf8'));
test('one owned writer arena is outside all chunk loops',()=>{
  assert.ok(source.indexOf('try(var cpu=ProjectionBufferStorage.allocate())')<source.indexOf('for (int cy'));
  assert.equal((storage.match(/new BufferBuilder\(65536\)/g)||[]).length,1);assert.ok(!source.includes('new BufferBuilder('));
});
test('actual consumer completion precedes arena reuse; publication cancellation is separate',()=>{
  assert.ok(source.indexOf('var lease=cpu.retain()')<source.indexOf('ProjectionMeshUpload.executeRetained'));
  assert.ok(source.includes('consumed.get(30, TimeUnit.SECONDS);uploaded.get()'));
  assert.ok(source.includes('ProjectionMeshUpload.abandon(uploaded)'));assert.ok(source.includes('current,access,releaseLease)'));
  assert.ok(source.indexOf('var access=new ProjectionMeshUpload.Access')<source.indexOf('var lease=cpu.retain()'));
  assert.ok(source.indexOf('var consumerClaim=')<source.indexOf('var lease=cpu.retain()'));
  assert.ok(source.includes('if(!consumerClaim.beginConsumer())return'));
  assert.ok(source.includes('if(consumerClaim.rejectBeforeConsumption())'));
  assert.ok(!source.includes('consumerStarted.get()'));
});
test('retirement frees the current reallocated base using the matching allocator',()=>{
  assert.ok(storage.includes('MemoryUtil.memAddress0(buffer)'));assert.ok(storage.includes('MemoryUtil.getAllocator(false).free(address)'));
  assert.ok(storage.indexOf('voxelstudio$setNativeBuffer(null)')<storage.indexOf('.free(address)'));
  assert.ok(!storage.includes('Tessellator'));assert.ok(!accessor.includes('@Inject'));assert.ok(!accessor.includes('@Redirect'));
});
test('native access remains client-only without changing compatibility IDs',()=>{
  assert.ok(mixins.client.includes('BufferBuilderNativeAccess'));assert.ok(!mixins.mixins.includes('BufferBuilderNativeAccess'));
  assert.ok(accessor.includes('@Mixin(BufferBuilder.class)'));assert.ok(source.includes('faces > 2000000'));
});
test('whole and legacy difference meshes own one arena outside both original/proposed section loops',()=>{
  assert.ok(patch.includes('try(var cpu=ProjectionBufferStorage.allocate())'));
  assert.ok(patch.indexOf('try(var cpu=ProjectionBufferStorage.allocate())')<patch.indexOf('for(boolean original:'));
  assert.ok(!patch.includes('new BufferBuilder('));
  assert.ok(patch.includes('cpu.resource()'));assert.ok(patch.includes('if(buffer.isBuilding())'));
});
test('difference meshes retain until actual upload consumption, block late publication and preserve errors',()=>{
  for(const marker of ['ProjectionMeshUpload.executeRetained','ProjectionMeshUpload.abandon(uploaded)','consumed.get(30, TimeUnit.SECONDS);uploaded.get()','if(!consumerClaim.beginConsumer())return','if(consumerClaim.rejectBeforeConsumption())','ready.release()','lease.close()','ProjectionMeshUpload.describe(failure)','catch(Exception | Error failure)'])assert.ok(patch.includes(marker),marker);
  assert.ok(patch.indexOf('var access=new ProjectionMeshUpload.Access')<patch.indexOf('var lease=cpu.retain()'));
  assert.ok(!patch.includes('uploaded.complete(null)'));assert.ok(patch.includes('finally { meshes.clear(); }'));
});
