import test from 'node:test';
import assert from 'node:assert/strict';
import {parseModelJson} from '../../bridge/model-json.mjs';

test('model JSON normalizes only whole-object framing and trailing commas, preserving strings',()=>{
 const raw='\uFEFF ```JSON\r\n{"title":"中文,} \\\"", "parts":[{"n":1,},2,],}\r\n``` \r\n';
 const p=parseModelJson(raw);assert.equal(p.facts.valid,true);assert.deepEqual(p.spec,{title:'中文,} "',parts:[{n:1},2]});
 assert.equal(p.facts.changes.length,3);assert.match(p.facts.originalSha256,/^[a-f0-9]{64}$/);assert.notEqual(p.facts.originalSha256,p.facts.candidateSha256);
 assert.equal(parseModelJson(JSON.stringify(p.spec)).facts.changes.length,0);
});
test('malformed data is never completed, evaluated, merged, or guessed',()=>{
 for(const s of ['{"a":','{"a":1','{"a":NaN}','{"a":Infinity}','{"a":224-1}','{"a":Array.from([])}','{,}','{"a":[1,,]}','{} {}','prefix {}','```json\n{}\n```\nextra','[]','null','42','{"x":1,"x":2}','{"x":1,"\\u0078":2}'])assert.equal(parseModelJson(s).facts.valid,false,s);
 assert.equal(parseModelJson('{"a":{"x":1},"b":{"x":2}}').facts.valid,true);
 assert.equal(parseModelJson('{"secret":"private",\n"broken" 1}').facts.line,2);
 assert.ok(!JSON.stringify(parseModelJson('{"secret":"private",\n"broken":}').facts).includes('private'));
 assert.equal(parseModelJson('{"a":'.repeat(129)+'1'+'}'.repeat(129)).facts.code,'nesting-limit');
});
