import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {stagedRequest} from './decomposed-assembly-fixtures.mjs';
import {validateReferencePreparation} from '../../contracts/reference-preparation.mjs';
import {prototypeValidationPolicy} from '../../contracts/assembly-prototype-validation.mjs';
import {encodeReferencePixels} from '../../bridge/reference-pixels.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {hash} from '../../src/generation/compiler.mjs';

// Wiring/contract checks, not installed UI, game pixels or model acceptance.
const source=await fs.readFile(new URL('../../mod/src/main/java/dev/voxelstudio/client/StudioScreen.java',import.meta.url),'utf8');
test('ordinary and reference builders share a default-off, idle-only explicit new-task validation setting',()=>{
 assert.match(source,/private static boolean assemblyExpandedRoutes=false;/);
 assert.match(source,/if\(assemblyQualityVersion==4&&assemblyPrototypeMode\.equals\("staged"\)\)sideButton\([^\n]+StudioScreen::idle[^\n]+this::togglePrototypeValidation\);/);
 const builder=source.match(/private static void configureAssembly\(JsonObject req\)\{([\s\S]*?)\n    \}/)?.[1];
 assert.ok(builder);assert.match(builder,/StudioAssembly\.configurePrototypes[\s\S]*StudioPrototypeValidation\.configure\(req,assemblyExpandedRoutes\);/);
 for(const pattern of [/private static JsonObject referenceGenerationRequest\(String owner,String prompt\)\{([\s\S]*?)\n    \}/,/private static JsonObject generationRequest\(String key,boolean revise\)\{([\s\S]*?)\n    \}/]){
  const body=source.match(pattern)?.[1];assert.ok(body);assert.match(body,/configureAssembly\(req\)/);
 }
 const toggle=source.match(/private void togglePrototypeValidation\(\)\{([\s\S]*?)\n    \}/)?.[1];assert.ok(toggle);
 assert.match(toggle,/if\(!idle\(\)\|\|!generationMode\.equals\("components"\)\|\|!qualityTier\.equals\("ultra"\)\|\|assemblyQualityVersion!=4\|\|!assemblyPrototypeMode\.equals\("staged"\)\)return;/);
 assert.doesNotMatch(toggle,/BRIDGE|submitRequest|generate\(|assemblyConfirmed|assemblyCalls\s*=|projection\(/);
});
test('leaving the staged workflow, v4, Ultra or component lane clears selection; offline preparation resets it',()=>{
 for(const pattern of [/if\(assemblyQualityVersion!=4\)assemblyExpandedRoutes=false;/,/if\(!value\.equals\("ultra"\)\)assemblyExpandedRoutes=false;/,
  /if\(!v\.equals\("staged"\)\)assemblyExpandedRoutes=false;/,/if\(!v\.equals\("components"\)\)assemblyExpandedRoutes=false;/])assert.match(source,pattern);
 const offline=source.match(/static void prepareOfflineFlow\(boolean extendedCorrections,boolean nativeEvidence,int qualityVersion,String prototypes,boolean explicitEffort\)\{([\s\S]*?)\n    \}/)?.[1];
 assert.ok(offline);assert.match(offline,/assemblyExpandedRoutes=false;/);
 assert.match(source,/state\.addProperty\("expandedRoutesSelected",assemblyExpandedRoutes\)/);
});
test('reference v2 explicitly binds expanded-route validation and original budget, while legacy preparation rejects it',()=>{
 for(const calls of [22,23,24,25,26])for(const composed of [false,true]){
  const owner=randomUUID(),generation={...stagedRequest,key:owner,agent:'codex',model:'offline-vision',assemblyCalls:calls,assemblyConfirmed:true,assemblyPrototypeValidation:'expanded-routes-v1',
   ...(composed?{assemblyCompletionReserve:'design-correction-v1',assemblyEvidence:'representative-v1',assemblyProviderRecovery:'bounded',effort:'max'}:{})};
  const png=encodeReferencePixels(1,1,Buffer.from([1,2,3,255]));
  const input={format:'ReferenceGenerationPreparationRequest',version:2,generation,upload:{format:'UserReferenceUpload',version:1,mode:'reconstruct',references:[{png:png.toString('base64'),annotation:{purpose:'exterior',view:'front',caption:'Synthetic data'}}]}};
  const before=hash(input),ordinary=generationPreflight(generation),prepared=validateReferencePreparation(owner,input);
  assert.equal(hash(input),before);assert.equal(prepared.maximumCalls,calls);assert.equal(prepared.assembly.maxPackages,ordinary.assembly.maxPackages);
  assert.equal(prepared.assembly.prototypes.version,6);assert.deepEqual(prepared.assembly.prototypes.validation,prototypeValidationPolicy());
  assert.equal(prepared.assembly.prototypes.recoveryReserve,ordinary.assembly.prototypes.recoveryReserve-1);
  const legacy=structuredClone(input);delete legacy.generation.assemblyCompletionReserve;delete legacy.generation.assemblyEvidence;delete legacy.generation.assemblyProviderRecovery;
  assert.throws(()=>validateReferencePreparation(owner,{...legacy,version:1}),/Expanded-route validation requires reference preparation v2/);
  delete legacy.generation.assemblyPrototypeValidation;assert.equal(validateReferencePreparation(owner,{...legacy,version:1}).assembly.prototypes.version,5);
  for(const value of [true,null,'automatic']){const bad=structuredClone(input);bad.generation.assemblyPrototypeValidation=value;assert.throws(()=>validateReferencePreparation(owner,bad));}
  const extra=structuredClone(input);extra.generation.assemblyPrototypeValidationPolicy={};assert.throws(()=>validateReferencePreparation(owner,extra));
 }
});
