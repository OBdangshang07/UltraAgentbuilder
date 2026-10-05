import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Source-level integration guard only. The private installed-player gate
// separately checks the real conditional controls; this is not UI acceptance.
const source=await fs.readFile(new URL('../../mod/src/main/java/dev/voxelstudio/client/StudioScreen.java',import.meta.url),'utf8');
const handler=source.match(/private void cycleAssemblyQuality\(\)\{([\s\S]*?)\n    \}/)?.[1];
test('normal quality button uses one idle-only sidebar transition',()=>{
 assert.ok(handler,'Missing named normal quality callback');
 assert.match(source,/sideButton\([^\n]+质量 v4[^\n]+\(\)->idle\(\)[^\n]+this::cycleAssemblyQuality\);/);
 assert.match(handler,/^\s*if\(!idle\(\)\)return;/);
});
test('quality transition retains budget and prototype reset before rebuilding conditional rows',()=>{
 assert.match(handler,/assemblyQualityVersion=assemblyQualityVersion%4\+1;/);
 assert.match(handler,/assemblyQualityVersion>=3\)\{assemblyImageReview=true;assemblyCalls=Math\.max\(7,assemblyCalls\);\}/);
 assert.match(handler,/assemblyQualityVersion!=4&&!assemblyPrototypeMode\.equals\("off"\)/);
 assert.match(handler,/assemblyPrototypeMode="off";/);
 assert.equal(handler.match(/clearAndInit\(\);/g)?.length,1);
 assert.match(handler,/clearAndInit\(\);\s*$/);
 assert.match(source,/if\(assemblyQualityVersion==4\)sideButton/);
});
test('sidebar refresh does not submit, authorize or replace player/model data',()=>{
 assert.doesNotMatch(handler,/BRIDGE|submitRequest|generate\(|assemblyConfirmed|prepareOffline|setText|selectedModel\s*=|description\s*=|projection\(\)\.load/);
 assert.match(source,/prompt\.setText\(description\);prompt\.setChangeListener/);
 assert.match(source,/scroll=StudioLayout\.clampScroll\(scroll,contentHeight,layout\.content\(\)\.height\(\)\);/);
});
