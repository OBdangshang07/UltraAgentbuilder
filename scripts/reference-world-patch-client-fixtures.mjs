import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {referenceWorldPatchClientFixture} from '../tests/fixtures/reference-world-patch-client-fixture.mjs';

/** FREE generated Java test data only, never a real user's task or images. */
export async function makeReferenceWorldPatchClientFixtures(){
  const output=path.resolve(fileURLToPath(new URL('../mod/build/test-fixtures/',import.meta.url)));
  const temporaryParent=path.join(output,'reference-patch-client-temp');await fs.mkdir(temporaryParent,{recursive:true});
  if(await fs.realpath(output)!==output||await fs.realpath(temporaryParent)!==temporaryParent)throw Error('Physical project-owned fixture directories required');
  const cleanup=[];
  try{
    const f=await referenceWorldPatchClientFixture({after:fn=>cleanup.push(fn)},{temporaryParent});
    await fs.writeFile(path.join(output,'reference-world-patch-preview-download.json'),f.preview);
    await fs.writeFile(path.join(output,'reference-world-patch-candidate-download.json'),f.candidate);
    await fs.writeFile(path.join(output,'reference-world-patch-client-reference.json'),JSON.stringify({reference:f.reference,
      fixtureAdapterCalls:f.fixtureAdapterCalls,realModelCalls:f.realModelCalls,worldWrites:f.worldWrites}));
    await fs.writeFile(path.join(output,'reference-world-patch-client-task.json'),JSON.stringify({...f.task,
      fixtureAdapterCalls:f.fixtureAdapterCalls,realModelCalls:f.realModelCalls,worldWrites:f.worldWrites}));
  }finally{
    const failures=[];for(const fn of cleanup.reverse())try{await fn();}catch(error){failures.push(error);}
    if(failures.length)throw new AggregateError(failures,'Synthetic joint client fixture cleanup failed; original evidence not promoted');
  }
}

// A real module entry point avoids passing eval-only Node flags to the
// production worker threads. This command generates synthetic data only.
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await makeReferenceWorldPatchClientFixtures();
  console.log(JSON.stringify({syntheticFixtureGeneration:'completed',realModelCalls:0,worldWrites:0,javaTestsExecuted:false}));
}
