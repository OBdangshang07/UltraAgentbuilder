import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {stagedRequest} from './decomposed-assembly-fixtures.mjs';
import {validateReferencePreparation} from '../../contracts/reference-preparation.mjs';
import {encodeReferencePixels} from '../../bridge/reference-pixels.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {hash} from '../../src/generation/compiler.mjs';

// Source-level request wiring and real Bridge preflight, NOT installed UI QA.
const source=await fs.readFile(new URL('../../mod/src/main/java/dev/voxelstudio/client/StudioScreen.java',import.meta.url),'utf8');
test('normal player reserve is default off and both request lanes use the same explicit builder',()=>{
 assert.match(source,/private static boolean assemblyCompletionReserve=false;/);
 assert.match(source,/if\(assemblyQualityVersion==4&&assemblyPrototypeMode\.equals\("staged"\)\)sideButton\([^\n]+StudioScreen::idle[^\n]+this::toggleCompletionReserve\);/);
 const builder=source.match(/private static void configureAssembly\(JsonObject req\)\{([\s\S]*?)\n    \}/)?.[1];
 assert.ok(builder);assert.match(builder,/StudioCompletionReserve\.configure\(req,assemblyCompletionReserve\);/);
 for(const name of ['referenceGenerationRequest','generationRequest']){
  const fn=source.match(new RegExp('(?:static JsonObject|private static JsonObject) '+name+'\\([^\\n]+\\)\\{([\\s\\S]*?)\\n    \\}'))?.[1];
  assert.ok(fn,name);assert.match(fn,/configureAssembly\(req\)/);
 }
 const toggle=source.match(/private void toggleCompletionReserve\(\)\{([\s\S]*?)\n    \}/)?.[1];
 assert.ok(toggle);assert.match(toggle,/if\(!idle\(\)\|\|!generationMode\.equals\("components"\)\|\|!qualityTier\.equals\("ultra"\)\|\|assemblyQualityVersion!=4\|\|!assemblyPrototypeMode\.equals\("staged"\)\)return;/);
 assert.doesNotMatch(toggle,/BRIDGE|submitRequest|generate\(|assemblyConfirmed|assemblyCalls\s*=|projection\(/);
});
test('leaving any required workflow clears the choice rather than silently retaining an old authorization',()=>{
 assert.match(source,/if\(assemblyQualityVersion!=4\)assemblyCompletionReserve=false;/);
 assert.match(source,/if\(!v\.equals\("components"\)\)\{assemblyProviderRecovery=false;assemblyCompletionReserve=false;\}/);
 assert.match(source,/if\(v\.equals\("staged"\)\)assemblyCalls=Math\.max\(22,assemblyCalls\);else assemblyCompletionReserve=false;/);
 assert.match(source,/if\(!v\.equals\("ultra"\)\)assemblyCompletionReserve=false;/);
});
test('explicit reference v2 keeps the reserve and same scope/budget; v1 cannot acquire it',()=>{
 const owner=randomUUID(),generation={...stagedRequest,key:owner,agent:'codex',model:'offline-vision',assemblyConfirmed:true,assemblyCompletionReserve:'design-correction-v1'};
 const png=encodeReferencePixels(1,1,Buffer.from([1,2,3,255]));
 const input={format:'ReferenceGenerationPreparationRequest',version:2,generation,upload:{format:'UserReferenceUpload',version:1,mode:'reconstruct',references:[{png:png.toString('base64'),annotation:{purpose:'exterior',view:'front',caption:'Synthetic reference data'}}]}};
 const before=hash(input),ordinary=generationPreflight(generation),prepared=validateReferencePreparation(owner,input);
 assert.equal(hash(input),before);assert.equal(prepared.maximumCalls,26);assert.equal(prepared.assembly.maxPackages,ordinary.assembly.maxPackages);
 assert.deepEqual(prepared.assembly.completionReserve,ordinary.assembly.completionReserve);assert.equal(prepared.assembly.prototypes.recoveryReserve,9);
 assert.equal(prepared.assembly.referenceAnalysis.requiredCalls,1);assert.equal(prepared.assembly.completionReserve.canAuthorizePlacement,false);
 assert.throws(()=>validateReferencePreparation(owner,{...input,version:1}),/reserve requires reference preparation v2/);
 const old=structuredClone(input);delete old.generation.assemblyCompletionReserve;
 assert.equal(validateReferencePreparation(owner,old).assembly.completionReserve,undefined);
 const invalid=structuredClone(input);invalid.generation.assemblyCompletionReserve='automatic';assert.throws(()=>validateReferencePreparation(owner,invalid));
 const field=structuredClone(input);field.generation.assemblyCompletionReservePolicy={};assert.throws(()=>validateReferencePreparation(owner,field));
});
