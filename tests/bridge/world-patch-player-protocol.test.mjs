import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {worldPatchDesignReviewProtocol} from '../../src/world/world-patch-design-input.mjs';
import {supportedBlockStateCatalog,validateState,stateText} from '../../src/generation/block-states.mjs';
import {MATERIALS} from '../../src/generation/materials.mjs';
test('packaged Java P4 review policy exactly matches live source rules and catalogs',async()=>{
  const saved=JSON.parse(await fs.readFile(new URL('../../contracts/world-patch-design-review-protocol.json',import.meta.url)));
  assert.deepEqual(saved,worldPatchDesignReviewProtocol());assert.ok(saved.rules.includes('WHOLE W'));assert.ok(saved.rules.includes('six immediately adjacent'));
});
test('shared baseline catalog validates every default and single property choice without enlarging the target catalog',()=>{
  const catalog=supportedBlockStateCatalog(),defaults=new Map(Object.values(MATERIALS).map(s=>[s.split('[')[0],s]));
  assert.equal(catalog.length,defaults.size);for(const entry of catalog){assert.equal(validateState(defaults.get(entry.id)),defaults.get(entry.id));
    const base=Object.fromEntries(defaults.get(entry.id).split('[')[1]?.slice(0,-1).split(',').map(p=>p.split('='))??[]);
    for(const [key,values] of Object.entries(entry.properties))for(const value of values)assert.doesNotThrow(()=>validateState(stateText({id:entry.id,properties:{...base,[key]:value}})));
  }
});
