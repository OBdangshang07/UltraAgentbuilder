import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {setTimeout as delay} from 'node:timers/promises';
import {startBridge} from '../../bridge/server.mjs';import {sampleSpec} from '../../src/generation/sample.mjs';
import {hash} from '../../src/generation/compiler.mjs';
test('every Agent receives detailed rules and compiled examples; quality failure is reviewable without retry',async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-review-bridge-'));let calls=0;
 const adapter={close(){},async generate({prompt}){calls++;assert.match(prompt,/VERIFIED TEACHING EXAMPLES/);assert.match(prompt,/Individual|individual support column/);const s=sampleSpec();s.nodes.push({nodeId:'blocked',op:'box',origin:[8,2,2],size:[3,3,1],material:'wall'});return {spec:s};}};
 const server=await startBridge({dataDir,adapter,claudeAdapter:adapter,deepseekAdapter:adapter}),base=`http://127.0.0.1:${server.connection.port}`,headers={Authorization:`Bearer ${server.connection.token}`,'Content-Type':'application/json'};
 const request=async(route,input)=>{const r=await fetch(base+route,{method:input?'POST':'GET',headers,body:input?JSON.stringify(input):undefined});assert.ok(r.ok,await r.clone().text());return r.json();};
 const wait=async id=>{for(let i=0;i<150;i++){const j=await request('/v1/jobs/'+id);if(['failed','preview-ready'].includes(j.state))return j;await delay(20);}throw new Error('Timed out');};
 try{
  for(const agent of ['codex','claude','deepseek']){const j=await wait((await request('/v1/jobs',{key:agent,agent,model:'fixture',prompt:'office with entrance'})).id);assert.equal(j.state,'preview-ready',j.error);assert.equal(j.manifest.quality.navigation,'unverified');assert.equal(j.manifest.quality.requiresAcknowledgement,true);assert.equal(j.generations.length,1);}
  assert.equal(calls,3);
  const strict=await wait((await request('/v1/jobs',{key:'strict',agent:'deepseek',model:'fixture',prompt:'office',navigationPolicy:'strict'})).id);assert.equal(strict.state,'failed');assert.equal(calls,4);
  const original=await fs.readFile(path.join(dataDir,'jobs',strict.id,'job.json'));const repaired=await wait((await request('/v1/jobs',{key:'local-recheck',revalidateJobId:strict.id})).id);
  assert.equal(repaired.state,'preview-ready',repaired.error);assert.equal(repaired.manifest.quality.requiresAcknowledgement,true);assert.equal(calls,4);assert.deepEqual(await fs.readFile(path.join(dataDir,'jobs',strict.id,'job.json')),original);
  const saved=JSON.parse(await fs.readFile(path.join(dataDir,'jobs',repaired.id,'spec.json'),'utf8'));
  const edited=await wait((await request('/v1/jobs',{key:'review-patch',baseJobId:repaired.id,baseHash:repaired.assetHash,patch:{baseHash:hash(saved),palette:{roof:'red'}}})).id);
  assert.equal(edited.state,'preview-ready',edited.error);assert.equal(edited.manifest.quality.requiresAcknowledgement,true);assert.equal(calls,4);
  const strictPatch=await wait((await request('/v1/jobs',{key:'strict-patch',baseJobId:repaired.id,baseHash:repaired.assetHash,navigationPolicy:'strict',patch:{baseHash:hash(saved),palette:{roof:'red'}}})).id);
  assert.equal(strictPatch.state,'failed');assert.equal(calls,4);
 }finally{await server.close();}
});
