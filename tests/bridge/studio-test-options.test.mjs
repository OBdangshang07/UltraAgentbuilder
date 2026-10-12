import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {boundedStudioTestOptions} from '../../scripts/studio-test-options.mjs';

test('free Studio regression defaults to the existing bounded CI concurrency',()=>{
  assert.deepEqual(boundedStudioTestOptions([]),['--test-concurrency=3']);
});
test('reporter, timeout and selection options are retained without weakening them',()=>{
  const options=['--test-reporter=tap','--test-reporter-destination=synthetic.tap','--test-timeout=180000','--test-name-pattern=corruption'];
  assert.deepEqual(boundedStudioTestOptions(options),['--test-concurrency=3',...options]);
});
test('explicit equal-form concurrency is preserved without duplicate options',()=>{
  for(const value of ['1','3','5'])assert.deepEqual(boundedStudioTestOptions(['--test-concurrency='+value,'--test-reporter=tap']),
    ['--test-concurrency='+value,'--test-reporter=tap']);
});
test('explicit separate-form concurrency and invalid values remain for Node to validate',()=>{
  for(const value of ['1','3','0','invalid'])assert.deepEqual(boundedStudioTestOptions(['--test-concurrency',value]),['--test-concurrency',value]);
});
test('defaults do not mutate caller options or conceal unrelated lookalike flags',()=>{
  const options=Object.freeze(['--test-concurrency-other=1']);assert.deepEqual(boundedStudioTestOptions(options),['--test-concurrency=3',...options]);
  assert.deepEqual(options,['--test-concurrency-other=1']);
});
test('the original runner applies the policy after dependency preflight and keeps all default test groups',async()=>{
  const source=await fs.readFile(new URL('../../scripts/studio-tests.mjs',import.meta.url),'utf8');
  assert.ok(source.indexOf("await import('prismarine-nbt')")<source.indexOf("await import('./studio-test-options.mjs')"));
  assert.match(source,/const options=boundedStudioTestOptions\(only<0\?args:args\.slice\(0,only\)\)/);
  assert.match(source,/\['tests\/generation\/\*\.test\.mjs','tests\/bridge\/\*\.test\.mjs','tests\/design\/\*\.test\.mjs'\]/);
  assert.match(source,/\['--test',\.\.\.options,\.\.\.testFiles\]/);
});
