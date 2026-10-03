import test from 'node:test';
import assert from 'node:assert/strict';
import {requestedBounds,generationPreflight,validateRequestedHeight} from '../../bridge/generation-policy.mjs';

test('explicit XYZ boundary is retained and swapped height is rejected, never transformed',()=>{
 const prompt='在40×24×36格边界内设计木构茶室';
 const p=generationPreflight({prompt,generationMode:'scene'});assert.deepEqual(p.maximumBounds,{width:40,height:24,length:36});
 const c={manifest:{dimensions:{width:40,height:36,length:24}}};const before=JSON.stringify(c);
 assert.throws(()=>validateRequestedHeight(c,p),/height=36/);assert.equal(JSON.stringify(c),before);
 c.manifest.dimensions={width:39,height:22,length:34};assert.doesNotThrow(()=>validateRequestedHeight(c,p));
 assert.deepEqual(requestedBounds('40x24x36 block bounds'),p.maximumBounds);
 assert.equal(requestedBounds('长宽高40×36×24格范围'),null);
});
test('impossible explicit boundaries stop before a provider request',()=>{
 for(const prompt of ['300×24×36格边界','256×384×256格边界','0×24×36格边界','在64×200×64格边界内建高224米的塔'])assert.throws(()=>generationPreflight({prompt}),/尚未调用模型/);
});
