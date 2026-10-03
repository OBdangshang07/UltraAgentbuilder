import test from 'node:test';
import assert from 'node:assert/strict';
import {revisionMeasurements} from '../../src/design/revision-measurements.mjs';
import {basicScene,mass,facade} from './fixtures.mjs';
import {hash} from '../../src/generation/compiler.mjs';

test('halving window rows and widening their pitch exposes the lost openings even if design prose praises the revision',()=>{
  const before=basicScene();before.components=[mass('main',[2,0,2],[24,20,24]),facade('windows','main','north',{kind:'panelFacade',borders:[0,0,0,1],recess:0,count:[3,4],size:[5,3],step:[8,4]})];
  const after=structuredClone(before),windows=after.components[1];windows.count[1]=2;windows.step[1]=8;windows.borders=[0,0,0,0];windows.kind='panelFacade';windows.recess=0;
  after.design.concept='Stone dominance was intentional; this prose is not proof of better architecture';
  const identity=hash({before,after}),r=revisionMeasurements(before,after),change=r.facadeChanges[0];
  assert.equal(change.before.nominalOpeningArea,120);assert.equal(change.after.nominalOpeningArea,90);assert.equal(change.nominalOpeningAreaDelta,-30);
  assert.equal(change.after.openingShareOfRepeatedUnit,15/64);assert.equal(change.before.openingShareOfRepeatedUnit,10/32);
  assert.deepEqual(r.requiredTradeoffFacts,['facade/windows']);
  assert.equal(r.aestheticQualityVerified,false);assert.equal(r.geometryChangeVerified,false);assert.equal(hash({before,after}),identity);
});
test('real loss of nominal opening area requires an explicit tradeoff, not a hardcoded glass percentage',()=>{
  const before=basicScene();before.components=[facade('windows','main','north',{count:[3,4],size:[5,3],step:[8,4]})];
  const after=structuredClone(before);after.components[0].count[1]=2;after.components[0].step[1]=8;
  const r=revisionMeasurements(before,after);assert.deepEqual(r.requiredTradeoffFacts,['facade/windows']);assert.equal(r.facadeChanges[0].nominalOpeningAreaDelta,-18);
  assert.equal(r.canAuthorizePlacement,false);
});
test('source-only changes and shared-module changes are not advertised as cell or aesthetic improvement',()=>{
  const before=basicScene(),after=structuredClone(before);after.design.concept+=' altered wording';
  const r=revisionMeasurements(before,after);assert.notEqual(r.beforeSourceHash,r.afterSourceHash);assert.deepEqual(r.changedComponents,[]);assert.deepEqual(r.facadeChanges,[]);
  before.modules=[{id:'desk',nodes:[]}];after.modules=[{id:'desk',nodes:[{material:'floor'}]}];assert.deepEqual(revisionMeasurements(before,after).changedModules,['desk']);
});
test('lower opening share needs explanation even when the declared opening area stays unchanged',()=>{
  const before=basicScene();before.components=[facade('windows','main','north',{count:[3,4],size:[5,3],step:[8,4]})];
  const after=structuredClone(before);after.components[0].step[1]=8;
  const facts=revisionMeasurements(before,after);assert.equal(facts.facadeChanges[0].nominalOpeningAreaDelta,0);assert.deepEqual(facts.requiredTradeoffFacts,['facade/windows']);
});
