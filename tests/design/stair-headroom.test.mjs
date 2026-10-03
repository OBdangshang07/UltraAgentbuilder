import test from 'node:test';
import assert from 'node:assert/strict';
import {basicScene,mass,at,shape,once} from './fixtures.mjs';
import {compileScene} from '../../src/design/compiler.mjs';
import {transformPoint} from '../../src/generation/groups.mjs';

function repeated(rotation,width,run=4){
 const s=basicScene('four-metre-stairs');s.bounds={width:24,height:30,length:24};
 const local=[run,7,width*2+1],size=rotation%2?[local[2],local[1],local[0]]:local;
 s.components=[mass('main',[1,0,1],[22,30,22],[4,8,12,16,20,24]),{id:'flights',kind:'stairs',host:'main',at:at([6,0,6]),size,style:'switchback',rotation,width,rise:4,material:'floor',repeat:{count:6,step:[0,4,0]},allowOverwrite:[]}];
 s.constraints.passages=[0,4,8,12,16,20,24].map(y=>({origin:[3,y+1,3],size:[1,2,1]}));return s;
}
for(const rotation of [0,1,2,3])for(const width of [1,2,3])test(`stacked four-metre switchbacks keep real climbing headroom: rotation ${rotation}, width ${width}`,()=>{
 const s=repeated(rotation,width),before=JSON.stringify(s),compiled=compileScene(s,{navigationPolicy:'strict'});
 assert.equal(compiled.manifest.quality.navigation,'verified');assert.equal(JSON.stringify(s),before);assert.ok(compiled.designSources.stairAccess.every(a=>a.status==='local-opening-found'));
 // Restoring the OLD redundant underside creates a too-low ceiling over the
 // lower return tread. Even a valid local landing cannot waive this obstruction.
 const local=[4,7,width*2+1],p=transformPoint([2,6,width+1],local,rotation,false).map(v=>v+6);p[1]-=6;
 const p2=transformPoint([2,6,width*2],local,rotation,false).map(v=>v+6);p2[1]-=6;
 const origin=p.map((v,i)=>Math.min(v,p2[i])),size=p.map((v,i)=>Math.abs(v-p2[i])+1);
 s.components.push(shape('oldUnderPlatform',origin,size,'floor',{allowOverwrite:['flights']}));
 assert.throws(()=>compileScene(s,{navigationPolicy:'strict'}),/disconnected/);
});
test('eight-metre lobby stairs meet repeated four-metre office floors without shrinking or removing either flight',()=>{
 const s=repeated(1,2,6);s.bounds.height=36;s.components[0]=mass('main',[1,0,1],[22,36,22],[8,12,16,20,24,28]);
 const upper=s.components[1];upper.at=at([6,8,6]);upper.repeat.count=5;
 s.components.splice(1,0,{...structuredClone(upper),id:'lobby',at:at([6,0,6]),size:[5,11,6],rise:8,repeat:once});
 s.constraints.passages=[0,8,12,16,20,24,28].map(y=>({origin:[3,y+1,3],size:[1,2,1]}));
 assert.equal(compileScene(s,{navigationPolicy:'strict'}).manifest.quality.navigation,'verified');
});
