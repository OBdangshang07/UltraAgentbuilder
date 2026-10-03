import test from 'node:test';
import assert from 'node:assert/strict';
import {compileSpec,hash,patchSpec} from '../../src/generation/compiler.mjs';
import {sampleSpec} from '../../src/generation/sample.mjs';
import {compareCompiled} from '../../src/generation/diff.mjs';
import {specSchema} from '../../contracts/building-spec.schema.mjs';

test('model schema declares the compiler asset-ID contract',()=>{const pattern=new RegExp(specSchema.properties.id.pattern);assert.ok(pattern.test('simple-house'));for(const id of ['小屋','Simple House','simple_house','a'.repeat(65)])assert.ok(!pattern.test(id));});
test('composable room, roof, windows, lamps and stair components stay bounded',()=>{
  for(const op of ['room','gableRoof','windowRow','lampRow','staircase']){
    const s=sampleSpec();s.constraints={interior:false,walkable:false,passages:[]};s.nodes=[{nodeId:'part',op,origin:[1,1,1],size:[9,4,9],material:op==='gableRoof'?'roof':'wall',axis:'x'}];assert.ok(compileSpec(s).manifest.setCount>0);
  }
  const s=sampleSpec();s.constraints={interior:false,walkable:false,passages:[]};s.nodes=[{nodeId:'too-steep',op:'staircase',origin:[1,1,1],size:[2,5,2],material:'floor'}];assert.throws(()=>compileSpec(s),/too-steep.*水平 2 格、高 5 格/);
});
test('disconnected rooms are rejected even when each local passage has clearance',()=>{
  const s=sampleSpec();s.nodes.push({nodeId:'partition',op:'box',origin:[11,2,3],size:[1,5,11],material:'wall'});assert.throws(()=>compileSpec(s),/disconnected/);
  s.nodes.push({nodeId:'partition-door',op:'clear',origin:[11,2,5],size:[1,2,2]});assert.doesNotThrow(()=>compileSpec(s));
});
test('local roof change reports exact replacement cells and preserves base hash',()=>{
  const s=sampleSpec(),beforeHash=hash(s),next=patchSpec(s,{baseHash:beforeHash,palette:{roof:'red'}}),diff=compareCompiled(compileSpec(s),compileSpec(next));assert.equal(hash(s),beforeHash);assert.equal(diff.added,0);assert.equal(diff.removed,0);assert.equal(diff.maskChanged,0);assert.ok(diff.replaced>0);assert.ok(diff.chunks.length>0);
});
test('diff distinguishes keep/clear changes invisible in schematics',()=>{const a=sampleSpec(),b=structuredClone(a);b.nodes.push({nodeId:'excavate',op:'clear',origin:[0,8,0],size:[1,1,1]});const diff=compareCompiled(compileSpec(a),compileSpec(b));assert.equal(diff.changed,1);assert.equal(diff.maskChanged,1);});
