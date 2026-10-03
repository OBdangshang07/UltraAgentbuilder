import test from 'node:test';
import assert from 'node:assert/strict';
import {compileSpec,hash} from '../../src/generation/compiler.mjs';
import {sampleSpec} from '../../src/generation/sample.mjs';

test('generated floor/feet and one-block headroom declaration corrects without touching geometry',()=>{
  const s=sampleSpec(),baseline=compileSpec(s);s.constraints.passages=s.constraints.passages.map(p=>({...p,origin:[p.origin[0],p.origin[1]-1,p.origin[2]],size:[p.size[0],1,p.size[2]]}));
  const before=JSON.stringify(s);assert.throws(()=>compileSpec(s),/two-block headroom/);
  const result=compileSpec(s,{normalizeGeneratedPassages:true});assert.equal(JSON.stringify(s),before);assert.deepEqual(result.binary,baseline.binary);assert.deepEqual(result.spec.nodes,s.nodes);assert.equal(result.spec.constraints.walkable,true);assert.equal(result.spec.constraints.interior,true);assert.ok(result.manifest.validationNotes.length);assert.equal(result.manifest.specHash,hash(result.spec));assert.doesNotThrow(()=>compileSpec(result.spec));
});
test('metadata normalization cannot bypass blocked checkpoints, missing floors or disconnected rooms',()=>{
  for(const [op,origin,size] of [['box',[8,2,2],[3,3,1]],['keep',[8,1,2],[3,1,1]],['box',[11,2,3],[1,5,11]]]){
    const s=sampleSpec();s.nodes.push({nodeId:'test-obstruction',op,origin,size,material:'wall'});s.constraints.passages[0].size[1]=1;
    assert.throws(()=>compileSpec(s,{normalizeGeneratedPassages:true}));
  }
});
