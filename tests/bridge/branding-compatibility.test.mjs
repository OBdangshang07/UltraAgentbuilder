import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = relative => fs.readFile(new URL('../../' + relative, import.meta.url), 'utf8');
test('public metadata and key labels use the exact formal product name', async () => {
  const metadata = JSON.parse(await read('mod/src/main/resources/fabric.mod.json'));
  assert.equal(metadata.name, 'UltraAgentbuilder');
  assert.equal(metadata.id, 'voxel_studio');
  assert.deepEqual(metadata.entrypoints, {main: ['dev.voxelstudio.VoxelStudio'], client: ['dev.voxelstudio.client.StudioClient']});
  assert.deepEqual(metadata.mixins, ['voxel-studio.mixins.json']);
  for (const locale of ['en_us', 'zh_cn']) {
    const labels = JSON.parse(await read('mod/src/main/resources/assets/voxel_studio/lang/' + locale + '.json'));
    assert.equal(labels['key.categories.voxel_studio'], metadata.name);
    assert.ok(labels['key.voxel_studio.open'].includes(metadata.name));
  }
});
test('branding stays separate from persisted protocol and data names', async () => {
  assert.match(await read('mod/src/main/java/dev/voxelstudio/StudioBrand.java'), /NAME = "UltraAgentbuilder"/);
  const screen = await read('mod/src/main/java/dev/voxelstudio/client/StudioScreen.java');
  assert.match(screen, /super\(Text.literal\(dev.voxelstudio.StudioBrand.NAME\)\)/);
  assert.match(screen, /StudioTheme.fit\(textRenderer,dev.voxelstudio.StudioBrand.NAME/);
  assert.match(screen, /Math.max\(0,width-90\)/);
  assert.match(await read('mod/src/main/java/dev/voxelstudio/client/BridgeClient.java'), /"voxel-studio"/);
  assert.match(await read('mod/src/main/java/dev/voxelstudio/client/ProjectionController.java'), /"voxel-studio-draft.json"/);
  assert.match(await read('mod/src/main/java/dev/voxelstudio/PlacementService.java'), /"voxel-studio-journals"/);
  assert.match(await read('mod/build.gradle'), /archivesName = 'UltraAgentbuilder'/);
});
test('Java checks use own processed metadata and regenerate expiring fixtures', async () => {
  const build = await read('mod/build.gradle');
  assert.match(build, /systemProperty 'ultraagentbuilder.testModMetadata', layout.buildDirectory.file\('resources\/main\/fabric.mod.json'\)/);
  assert.match(build, /inputs.dir layout.buildDirectory.dir\('test-fixtures'\)/);
  assert.match(build, /outputs.upToDateWhen \{ false \}/);
  const java = await read('mod/src/test/java/dev/voxelstudio/StudioBrandTest.java');
  assert.match(java, /System.getProperty\("ultraagentbuilder.testModMetadata"\)/);
  assert.ok(!java.includes('getResourceAsStream'));
});
