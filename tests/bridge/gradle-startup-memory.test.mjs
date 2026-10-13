import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const text=await fs.readFile(new URL('../../mod/gradle.properties',import.meta.url),'utf8');
const entries=text.split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#')).map(line=>line.split(/=(.*)/s).slice(0,2));
const properties=new Map(entries);
test('Gradle memory settings are unambiguous',()=>assert.equal(properties.size,entries.length));
test('build starts with a bounded initial heap without reducing maximum heap',()=>{
  const args=properties.get('org.gradle.jvmargs').split(/\s+/);
  assert.deepEqual(args.filter(a=>a.startsWith('-Xms')),['-Xms256m']);
  assert.deepEqual(args.filter(a=>a.startsWith('-Xmx')),['-Xmx2G']);
});
test('build concurrency is bounded, not delegated to several 2 GiB workers',()=>{
  assert.equal(properties.get('org.gradle.parallel'),'false');
  assert.equal(properties.get('org.gradle.workers.max'),'1');
});
test('build settings do not add model, scene or game safety overrides',()=>{
  assert.deepEqual([...properties.keys()].sort(),['org.gradle.jvmargs','org.gradle.parallel','org.gradle.workers.max']);
});
