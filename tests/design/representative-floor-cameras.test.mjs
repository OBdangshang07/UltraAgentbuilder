import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {basicScene,mass,shape} from './fixtures.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {inspectCheckpoint} from '../../bridge/scene-checkpoints.mjs';
import {createAssemblyCameraBasis,verifyAssemblyCameraBasis} from '../../bridge/assembly-camera-evidence.mjs';
import {nativeViewsForQualityV4} from '../../src/design/quality-v4-evidence.mjs';
import {hash} from '../../src/generation/compiler.mjs';

const request={agent:'codex',model:'offline',prompt:'24×48×24格边界内设计建筑',generationMode:'scene',sceneWorkflow:'components',
 qualityTier:'ultra',assemblyCalls:26,assemblyQuality:'v4',assemblyDesignReview:'native',assemblyRecovery:'safe',assemblyPrototypes:'staged',assemblyEvidence:'representative-v1',maxRepairs:0};
const policy=generationPreflight(request);
function sceneFixture(){
 const scene=basicScene('representative-camera-study');scene.bounds={width:24,height:48,length:24};
 scene.constraints={interior:true,walkable:true,passages:[{origin:[12,1,12],size:[1,2,1]}]};
 scene.components=[mass('main',[2,0,2],[20,48,20],[8,15,23,32,40]),
  {id:'rooms',kind:'storeyRoom',host:'main',floors:{source:'main',first:2,count:4},
   offset:[4,4],footprint:[3,4],ceilingInset:1,use:'room',purpose:'Public label, not function proof',floorMaterial:'frame',boundaries:[],allowOverwrite:[]}];
 return scene;
}
const responsibilities=ids=>({'typical-floor-core':[{kind:'typical-floor',components:ids},{kind:'core-interface',components:['main']}]});
async function saved(scene,ids=['rooms']){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'representative-cameras-')),stage=path.join(directory,'stage');await fs.mkdir(stage);
 const bundleDirectory=path.join(stage,'diagnostic');
 await fs.writeFile(path.join(stage,'scene.json'),JSON.stringify(scene));
 const feedback=await inspectCheckpoint(scene,policy,bundleDirectory,new AbortController().signal,{});
 assert.equal(feedback.geometryPassed,true,feedback.error);
 const options={directory,bundleDirectory,scene,assetHash:feedback.diagnosticAssetHash,tier:policy.assembly,representatives:responsibilities(ids)};
 const basis=await createAssemblyCameraBasis(options);
 return {directory,options,basis,feedback,async verify(b=basis,views=basis.views){return verifyAssemblyCameraBasis({directory,basis:b,tier:policy.assembly,representatives:options.representatives,views});}};
}
test('saved irregular storeyRoom rows, including later compact bands, select actual floor geometry',async()=>{
 const h=await saved(sceneFixture()),selected=h.basis.selection.selected;
 assert.equal(selected.base,23);assert.equal(selected.instance,1);assert.equal(selected.basis,'room-zone');
 assert.equal(h.basis.selection.candidateCount,4);
 assert.equal(h.basis.views.find(v=>v.purpose==='typical-floor').max[1],31);
 assert.equal(h.basis.selection.purposeLabelsUsed,false);
 assert.equal(h.basis.selection.functionVerified,false);
 assert.equal((await h.verify()).basisHash,h.basis.basisHash);
});
test('changing office/public purpose labels cannot change the representative floor or camera',async()=>{
 const a=sceneFixture(),b=sceneFixture();b.components[1].purpose='Office quality certified by untrusted prose';
 const first=await saved(a),second=await saved(b);
 assert.notEqual(first.basis.sourceHash,second.basis.sourceHash);
 assert.deepEqual(first.basis.selection,second.basis.selection);
 assert.deepEqual(first.basis.views.find(v=>v.purpose==='typical-floor'),second.basis.views.find(v=>v.purpose==='typical-floor'));
});
test('a surviving furniture shape inside a saved room uses that room context, not the furnishing crop',async()=>{
 const scene=sceneFixture();scene.components.push(shape('desk',[7,24,7],[1,1,1]));
 const h=await saved(scene,['desk']),selected=h.basis.selection.selected;
 assert.equal(selected.component,'rooms');assert.equal(selected.base,23);assert.equal(selected.basis,'room-zone');
 const view=h.basis.views.find(v=>v.purpose==='typical-floor');
 assert.deepEqual([view.min[0],view.max[0],view.min[2],view.max[2]],[0,24,0,24]);
});
test('a covered representative with no surviving own geometry is unresolved, not certified by a room label',async()=>{
 const scene=sceneFixture();scene.components[1].floors={source:'main',first:3,count:1};
 scene.components.push(shape('cover',[6,23,6],[3,8,4],'wall',{allowOverwrite:['rooms']}));
 const h=await saved(scene);
 assert.equal(h.basis.selection.status,'unresolved');assert.equal(h.basis.selection.selected,null);
 assert.match(h.basis.views.find(v=>v.purpose==='typical-floor').framing,/UNRESOLVED/);
});
test('raw representative details use the real host floor and disclose the missing semantic room program',async()=>{
 const scene=sceneFixture();scene.components.pop();scene.components.push(shape('detail',[7,33,7],[1,1,1]));
 const h=await saved(scene,['detail']);
 assert.equal(h.basis.selection.selected.base,32);assert.equal(h.basis.selection.selected.basis,'floor-associated-detail');
 assert.match(h.basis.views.find(v=>v.purpose==='typical-floor').framing,/semantic room program missing/);
});
test('unassociated masses cannot become office evidence merely by being called typical-floor',async()=>{
 const scene=sceneFixture();scene.components.pop();const h=await saved(scene,['main']);
 assert.equal(h.basis.selection.status,'unresolved');assert.equal(h.basis.selection.candidateCount,0);
});
test('independent verifier rejects rehashed selection and modified full-camera crops',async()=>{
 const h=await saved(sceneFixture()),forged=structuredClone(h.basis);
 forged.selection.selected.base=32;const {basisHash,...data}=forged;forged.basisHash=hash(data);
 await assert.rejects(h.verify(forged),/original saved geometry/);
 const views=structuredClone(h.basis.views);views[2].min[1]++;
 await assert.rejects(h.verify(h.basis,views),/cameras changed/);
 const wrong=structuredClone(h.basis);wrong.representatives['typical-floor-core'][0].components=['main'];
 await assert.rejects(h.verify(wrong),/identity\/responsibilities changed/);
});
for(const file of ['cells.bin','source-owners.bin','design-sources.json'])test('camera verifier refuses changed original saved '+file,async()=>{
 const h=await saved(sceneFixture()),target=path.join(h.directory,h.basis.bundle,file),bytes=await fs.readFile(target);
 bytes[0]^=1;await fs.writeFile(target,bytes);
 await assert.rejects(h.verify());
});
test('legacy V4 has unchanged cameras and gains no representative policy or claims',async()=>{
 const scene=sceneFixture(),h=await saved(scene);
 const before=nativeViewsForQualityV4(scene,'ultra',h.feedback.occupiedBounds),identity=hash(before);
 assert.equal(before.find(v=>v.purpose==='typical-floor').min[1],23);
 await h.verify();
 assert.equal(hash(nativeViewsForQualityV4(scene,'ultra',h.feedback.occupiedBounds)),identity);
 const legacy=generationPreflight({...request,assemblyEvidence:undefined});
 assert.equal(legacy.assembly.cameraEvidence,undefined);
 await assert.rejects(createAssemblyCameraBasis({...h.options,tier:legacy.assembly}),/not selected/);
});
test('camera subject creation refuses a parent junction BEFORE writing any immutable copies outside the job',async()=>{
 const h=await saved(sceneFixture()),directory=await fs.mkdtemp(path.join(os.tmpdir(),'camera-link-job-'));
 const stage=path.join(directory,'stage');await fs.mkdir(stage);
 const bundleDirectory=path.join(stage,'diagnostic');await fs.cp(h.options.bundleDirectory,bundleDirectory,{recursive:true});
 await fs.copyFile(path.join(path.dirname(h.options.bundleDirectory),'scene.json'),path.join(stage,'scene.json'));
 const outside=await fs.mkdtemp(path.join(os.tmpdir(),'camera-link-outside-'));
 await fs.symlink(outside,path.join(directory,'assembly-camera-bases'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(createAssemblyCameraBasis({...h.options,directory,bundleDirectory}),/store links forbidden/);
 assert.deepEqual(await fs.readdir(outside),[]);
});
test('rehashed paths cannot escape the original camera subject, and changed source bytes are refused',async()=>{
 const h=await saved(sceneFixture());
 for(const sceneFile of ['../scene.json',path.resolve(h.directory,'scene.json')]){
  const b={...structuredClone(h.basis),sceneFile};const {basisHash,...data}=b;b.basisHash=hash(data);
  await assert.rejects(h.verify(b),/Unsafe evidence path/);
 }
 const file=path.join(h.directory,h.basis.sceneFile),scene=JSON.parse(await fs.readFile(file));
 scene.components[1].purpose='Changed original source';await fs.writeFile(file,JSON.stringify(scene));
 await assert.rejects(h.verify(),/changed saved source\/dimensions/);
});
