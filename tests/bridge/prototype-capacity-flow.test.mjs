import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {runDurableAssembly} from '../../bridge/assembly-durability.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyPlan} from '../design/assembly-fixtures.mjs';
import {shape} from '../design/fixtures.mjs';
import {setupPrototypes,prototypeRequest} from './assembly-prototypes-fixtures.mjs';

// Synthetic replies/transport pixels with the real durable assembly and
// compiler. This is not a native-game, paid-model or aesthetic acceptance.
function capacityReply(){
 const plan=assemblyPlan();
 const parts=Array.from({length:67},(_,i)=>shape('capacity'+i,[3+i%8,3,3+Math.floor(i/8)],[1,1,1],'frame'));
 plan.scene.components.push(...parts);
 return {format:'ScenePrototypePlan',version:1,plan,
  recipes:parts.map(c=>({component:c.id,mode:'repeat',count:2,step:[0,2,0]}))};
}

test('67 recipes traverse saved seed, full expansion, review, every package and final review, then durable replay adds no invocation',async()=>{
 const h=await setupPrototypes(({options})=>options.stageName==='plan'?capacityReply():undefined);
 const identity={requestHash:hash(prototypeRequest),runtimeHash:'synthetic-capacity-flow'};
 let branch;
 const result=await runDurableAssembly({...h.options,...identity,onRecovery:async record=>{if(record.branch)branch=path.join(h.directory,record.branch);}});
 assert.equal(h.calls.length,7);assert.equal(result.summary.completedPackages.length,2);
 assert.equal(result.summary.finalTextReviewAccepted,true);
 assert.equal(result.scene.components.filter(c=>c.id.startsWith('capacity')).length,67);
 assert.ok(result.scene.components.filter(c=>c.id.startsWith('capacity')).every(c=>c.repeat.count===2));
 const saved=JSON.parse(await fs.readFile(path.join(branch,'assembly','3','response.json'),'utf8'));
 assert.deepEqual(saved,capacityReply());assert.ok(saved.plan.scene.components.slice(1).every(c=>c.repeat.count===1));
 const witness=JSON.parse(await fs.readFile(path.join(branch,'assembly','3','prototype','expansion-witness.json'),'utf8'));
 assert.equal(witness.expansions.length,67);assert.ok(witness.expansions.every(e=>e.verifiedRepetitions===2));
 assert.equal(witness.canAuthorizePlacement,false);
 const calls=h.calls.length,captures=h.uploads.length;
 const replay=await runDurableAssembly({...h.options,...identity});
 assert.equal(h.calls.length,calls);assert.equal(h.uploads.length,captures);assert.equal(hash(replay.scene),hash(result.scene));
});

test('an invalid new 67th expansion still consumes an explicit bounded correction before any visual review',async()=>{
 const h=await setupPrototypes(({options,answer})=>{
  if(options.stageName==='plan'){const reply=capacityReply();reply.recipes[66].step=[0,20,0];return reply;}
  if(options.stageName==='correct-plan'){
   return {...answer,recipes:capacityReply().recipes};
  }
 });
 const result=await runDurableAssembly({...h.options,requestHash:hash(prototypeRequest),runtimeHash:'synthetic-capacity-correction'});
 assert.equal(h.calls.length,8);assert.equal(h.calls[3].phase,'correct-plan');assert.equal(h.calls[4].phase,'concept-review');
 assert.equal(h.calls[3].input.feedback.prototypeExpansion.geometryPassed,false);
 assert.equal(result.summary.completedPackages.length,2);assert.equal(result.summary.finalTextReviewAccepted,true);
 assert.equal(result.scene.components.find(c=>c.id==='capacity66').repeat.count,2);
});
