import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {startBridge} from '../../bridge/server.mjs';
import {CodexAdapter} from '../../bridge/codex-adapter.mjs';
import {assemblyRuntimeIdentity} from '../../bridge/assembly-durability.mjs';
import {readFrozenReferenceWorldPatchTaskSource} from '../../bridge/reference-world-patch-task-capsule.mjs';
import {contextHash} from '../../src/world/context-snapshot.mjs';
import {jointCapsuleFixture} from './reference-world-patch-capsule-fixture.mjs';
import {patchTaskProposal} from './world-patch-task-fixture.mjs';

/** Production paired HTTP, adapter, original stores and download workers.
 * Only upstream provider transport, answers and reference pixels are synthetic.
 * No actual account/model, game, world write or paid network endpoint. */
export async function referenceWorldPatchClientFixture(t, options={}) {
  const runtimeHash=await assemblyRuntimeIdentity();
  const f=await jointCapsuleFixture(t,{runtimeHash,...options});
  const original=await readFrozenReferenceWorldPatchTaskSource({dataDir:f.dir,capsuleId:f.receipt.capsuleId});
  const proposal=patchTaskProposal(original.saved.snapshot), adapter=new CodexAdapter({observationIntervalMs:10}), turns=[];
  adapter.connect=async()=>{};
  adapter.models=async()=>[{id:f.input.intent.model,supportsImages:true,efforts:[{reasoningEffort:'high'},{reasoningEffort:'max'}]}];
  adapter.request=async(method,params)=>{
    if(method==='config/read')return {config:{}};
    if(method==='thread/start')return {thread:{id:'synthetic-joint-client-thread',ephemeral:false}};
    if(method==='thread/unsubscribe')return {};
    assert.equal(method,'turn/start');turns.push(params);
    setImmediate(()=>adapter.emit('notification',{method:'turn/completed',params:{threadId:'synthetic-joint-client-thread',
      turn:{id:'synthetic-joint-client-turn',status:'completed',items:[{type:'agentMessage',phase:'final_answer',text:JSON.stringify(proposal)}]}}}));
    return {turn:{id:'synthetic-joint-client-turn',status:'inProgress'}};
  };
  const app=await startBridge({dataDir:f.dir,adapter,referenceWorldPatchSending:true});t.after(()=>app.close());
  const request=async(route,value)=>{
    const response=await fetch(`http://127.0.0.1:${app.connection.port}/v1/reference-world-patch${route}`,{
      method:value?'POST':'GET',headers:{Authorization:`Bearer ${app.connection.token}`,...(value?{'Content-Type':'application/json; charset=utf-8'}:{})},
      ...(value?{body:JSON.stringify(value)}:{})});
    assert.ok([200,202].includes(response.status),'Production synthetic joint HTTP must succeed');return Buffer.from(await response.arrayBuffer());
  };
  const imageFreeze=JSON.parse(await request(`/tasks/${f.receipt.capsuleId}/images`,f.send));
  await request(`/jobs/${f.receipt.capsuleId}/send`,f.send);
  let status;const deadline=Date.now()+15000;
  do{status=JSON.parse(await request(`/jobs/${f.receipt.capsuleId}`));
    if(status.state==='completed-checked')break;
    assert.ok(['running','checking','reserved-not-dispatched'].includes(status.state));assert.ok(Date.now()<deadline,'Only offline synthetic fixture settling deadline');await delay(10);
  }while(true);
  assert.equal(turns.length,1);assert.equal(status.callsReserved,1);assert.equal(turns[0].input.length,3);
  for(const [i,item] of turns[0].input.slice(1).entries()){assert.equal(item.type,'localImage');assert.deepEqual(await fs.readFile(item.path),f.pixels[i]);}
  assert.equal(status.canAuthorizePlacement,false);assert.equal(status.worldWrites,0);
  // Every pin comes from frozen original SEND/source + retained response/status,
  // independently of the downloaded candidate. Downloads cannot choose pins.
  const reference={capsuleId:f.receipt.capsuleId,manifestHash:f.receipt.manifestHash,submissionHash:contextHash(f.send),runtimeHash,
    responseHash:status.responseCheck.responseHash,candidateHash:status.candidateHash,
    referenceSetHash:f.receipt.referenceSetHash,imageCapabilityHash:f.receipt.imageCapabilityHash,
    selection:f.selection,contextRevision:original.saved.snapshot.fence.end,snapshotHash:f.receipt.snapshotHash,selectionHash:f.receipt.selectionHash,
    patchHash:status.responseCheck.patchHash,previewHash:status.responseCheck.previewHash};
  assert.equal(reference.submissionHash,status.submissionHash);
  const preview=await request(`/jobs/${f.receipt.capsuleId}/preview?candidateHash=${status.candidateHash}`);
  const candidate=await request(`/jobs/${f.receipt.capsuleId}/candidate?candidateHash=${status.candidateHash}`);
  const capabilities=JSON.parse(await request('/capabilities'));
  const expectedCapability={agent:f.input.intent.agent,model:f.input.intent.model,effort:f.input.intent.effort,
    supportsImages:true,advertisedEfforts:f.input.capability.efforts,runtimeHash};
  return {reference,preview,candidate,proposal,task:{contextId:f.id,id:f.id,selection:f.selection,contextRevision:original.saved.snapshot.fence.end,
    payload:f.payload.toString(),saved:f.saved,intent:f.input.intent,referenceManifest:original.reference.manifest,capability:expectedCapability,
    prepared:f.prepared,confirmation:f.confirmation,frozen:f.receipt,baseDisclosure:original.baseDisclosure,send:f.send,status,capabilities,imageFreeze},fixtureAdapterCalls:turns.length,realModelCalls:0,worldWrites:0};
}
