import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startBridge} from '../../bridge/server.mjs';
import {CodexAdapter} from '../../bridge/codex-adapter.mjs';
import {codexImageInput} from '../../bridge/codex-image-input.mjs';
import {codexRequestHash} from '../../bridge/codex-persistent-receipt.mjs';
import {assemblyRuntimeIdentity} from '../../bridge/assembly-durability.mjs';
import {readFrozenReferenceWorldPatchTaskSource} from '../../bridge/reference-world-patch-task-capsule.mjs';
import {REFERENCE_PATCH_SEND_PINS} from '../../contracts/reference-world-patch-send.mjs';
import {contextHash} from '../../src/world/context-snapshot.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {jointCapsuleFixture} from '../fixtures/reference-world-patch-capsule-fixture.mjs';
import {patchTaskProposal} from '../fixtures/world-patch-task-fixture.mjs';

// Actual paired HTTP server, CodexAdapter, original stores, pixel transport,
// durable invocation and response/download workers. Only upstream transport
// is synthetic: no paid call, account, user image, game or world operation.
const runtimeHash = await assemblyRuntimeIdentity(), prefix = '/v1/reference-world-patch';
async function fixture(t, {enabled = true, unknown = false, holdModels, holdTurn} = {}) {
  const f = await jointCapsuleFixture(t, {runtimeHash});
  f.snapshot = (await readFrozenReferenceWorldPatchTaskSource({dataDir:f.dir, capsuleId:f.receipt.capsuleId})).saved.snapshot;
  const adapter = new CodexAdapter({observationIntervalMs:10}), requests = [];
  let supportsImages = true, efforts = ['high','max'], modelQueries = 0;
  adapter.connect = async () => {};
  adapter.models = async () => {
    modelQueries++; await holdModels?.();
    return [{id:f.input.intent.model, supportsImages, efforts:efforts.map(reasoningEffort => ({reasoningEffort}))}];
  };
  adapter.readStoredTurn = async () => {throw Error('Synthetic original turn has no closing receipt');};
  adapter.request = async (method, params) => {
    requests.push({method, params});
    if (method === 'config/read') return {config:{}};
    if (method === 'thread/start') return {thread:{id:'http-joint-thread', ephemeral:false}};
    if (method === 'thread/unsubscribe') return {};
    assert.equal(method, 'turn/start'); await holdTurn?.();
    if (unknown) throw Error('Synthetic unknown ACK; no terminal provider evidence');
    setImmediate(() => adapter.emit('notification', {method:'turn/completed', params:{threadId:'http-joint-thread',
      turn:{id:'http-joint-turn', status:'completed', items:[{type:'agentMessage', phase:'final_answer', text:JSON.stringify(patchTaskProposal(f.snapshot))}]}}}));
    return {turn:{id:'http-joint-turn',status:'inProgress'}};
  };
  let app;
  const reopen = async () => {app = await startBridge({dataDir:f.dir, adapter, referenceWorldPatchSending:enabled,
    worldPatchSending:true, referenceGenerationSending:true});};
  await reopen(); t.after(() => app.close());
  const request = async (route, {method='GET', value, bytes, headers={}} = {}) => {
    const response = await fetch(`http://127.0.0.1:${app.connection.port}${route}`, {method,
      headers:{Authorization:`Bearer ${app.connection.token}`, ...(value !== undefined || bytes ? {'Content-Type':'application/json; charset=utf-8'} : {}), ...headers},
      ...(value !== undefined || bytes ? {body:bytes ?? JSON.stringify(value)} : {})});
    return {status:response.status, headers:response.headers, value:await response.json()};
  };
  return {...f, adapter, requests, request, close:() => app.close(), reopen,
    setImages:v => {supportsImages=v;}, setEfforts:v => {efforts=v;}, modelQueries:() => modelQueries};
}
function confirmation(prepared) {
  return {format:'SavedReferenceWorldPatchDesignConfirmation',version:1,purpose:'reference-world-patch-design',confirmed:true,
    taskDisclosureHash:prepared.taskDisclosureHash, taskHash:prepared.taskHash, requestHash:prepared.task.requestHash,
    disclosureHash:prepared.task.disclosure.disclosureHash, promptSha256:prepared.task.request.promptSha256,
    referenceSetHash:prepared.task.request.referenceSetHash, runtimeHash:prepared.task.request.runtimeHash,
    imageCapabilityHash:prepared.task.request.imageCapabilityHash};
}
async function prepare(f) {
  const intent = {...f.input.intent, prompt:f.input.intent.prompt + '\n基于双视图和环境改造入口，仅修改内选区。'};
  const prepared = await f.request(`${prefix}/contexts/${f.id}/disclosure`, {method:'POST',value:{intent}});
  assert.equal(prepared.status, 200); const consent = confirmation(prepared.value);
  const reviewed = await f.request(`${prefix}/contexts/${f.id}/review`, {method:'POST',value:{intent,confirmation:consent}});
  assert.equal(reviewed.status,200); assert.equal(reviewed.value.state,'reviewed-not-sent');
  const frozen = await f.request(`${prefix}/contexts/${f.id}/freeze`, {method:'POST',value:{intent,confirmation:consent}});
  assert.equal(frozen.status,200);
  const receipt = frozen.value, send = {format:'FrozenReferenceWorldPatchExplicitSend',version:1,purpose:'reference-world-patch-design',confirmed:true,
    ...Object.fromEntries(REFERENCE_PATCH_SEND_PINS.map(k => [k,receipt[k]])),maximumCalls:1};
  return {intent,prepared:prepared.value,consent,receipt,send,route:`${prefix}/jobs/${receipt.capsuleId}`};
}
async function images(f,p) {
  const response = await f.request(`${prefix}/tasks/${p.receipt.capsuleId}/images`, {method:'POST',value:p.send});
  assert.equal(response.status,200); assert.equal(response.value.state,'images-frozen-not-sent');
  assert.deepEqual(response.value.imageHashes, f.pixels.map(hash)); assert.equal(response.value.canAuthorizePlacement,false);
}
async function submit(f,p) {
  const sent = await f.request(p.route + '/send', {method:'POST',value:p.send}); assert.equal(sent.status,202);
  for (let i=0;i<200;i++) {
    const status = await f.request(p.route); assert.equal(status.status,200);
    if (!['running','checking'].includes(status.value.state)) return status.value;
    await delay(10);
  }
  assert.fail('Offline synthetic HTTP task did not settle');
}
const turns = f => f.requests.filter(r => r.method === 'turn/start');

test('joint HTTP exposes only fixed owner-query diagnostics and retains rejection with zero provider turns', async t => {
  const f = await fixture(t), diagnostic = {format:'WindowsOwnerQueryFailure',version:1,reason:'query-failed',phase:'process',
    helperStarted:true,helperClosed:true,helperExitCode:1,helperExitSignal:null,spawnCode:null,
    ownershipRecovered:false,canAuthorizePlacement:false};
  f.adapter.models = async () => {throw Object.assign(Error('synthetic-private-path-and-stderr'),
    {code:'WINDOWS_OWNER_QUERY_FAILED',observationDiagnostic:diagnostic});};
  const response = await f.request(`${prefix}/contexts/${f.id}/disclosure`, {method:'POST',value:{intent:f.input.intent}});
  assert.equal(response.status,409); assert.deepEqual(response.value.diagnostic,diagnostic);
  assert.equal(response.value.error,'Joint request rejected; original evidence retained; no automatic resubmission');
  assert.doesNotMatch(JSON.stringify(response.value),/synthetic-private/); assert.equal(turns(f).length,0);
  diagnostic.path='synthetic-private-path';
  const unrecognized = await f.request(`${prefix}/contexts/${f.id}/disclosure`, {method:'POST',value:{intent:f.input.intent}});
  assert.equal(unrecognized.status,409); assert.deepEqual(Object.keys(unrecognized.value),['error']);
  assert.equal(turns(f).length,0);
});

test('pure pixel HTTP preparation supplies a NEW exact set to joint disclosure and freeze with zero turns and no ordinary consent',async t=>{
  const f=await fixture(t),queries=f.modelQueries();
  const upload={format:'UserReferenceUpload',version:1,mode:'multi-view',references:f.pixels.map((png,i)=>({png:png.toString('base64'),annotation:{purpose:'style',view:i?'side':'front',caption:'新编辑的准确参考图'}}))};
  const stored=await f.request(`/v1/reference-drafts/${f.owner}/pixels`,{method:'POST',value:{format:'ReferencePixelPreparationRequest',version:1,upload}});
  assert.equal(stored.status,200,stored.value.error);assert.notEqual(stored.value.setHash,f.reference.setHash);assert.equal(f.modelQueries(),queries);assert.equal(turns(f).length,0);
  const intent={...f.input.intent,referenceSetHash:stored.value.setHash},route=`${prefix}/contexts/${f.id}`;
  const disclosed=await f.request(route+'/disclosure',{method:'POST',value:{intent}});assert.equal(disclosed.status,200,disclosed.value.error);
  assert.deepEqual(disclosed.value.task.disclosure.references,stored.value.references);assert.equal(disclosed.value.referenceConsentTransferable,false);
  const frozen=await f.request(route+'/freeze',{method:'POST',value:{intent,confirmation:confirmation(disclosed.value)}});assert.equal(frozen.status,200,frozen.value.error);
  assert.equal(frozen.value.referenceSetHash,stored.value.setHash);assert.equal(frozen.value.modelSent,false);
  const original=await readFrozenReferenceWorldPatchTaskSource({dataDir:f.dir,capsuleId:frozen.value.capsuleId});
  assert.deepEqual(original.reference.images,f.pixels);assert.deepEqual(original.reference.manifest,stored.value);assert.equal(turns(f).length,0);
  assert.equal(await fs.stat(path.join(f.dir,'reference-drafts',f.owner,'preparations')).then(()=>true,()=>false),false);
});

test('full joint HTTP disclosure/review/freeze/images/SEND/candidate chain uses exact original two images and no world authority', async t => {
  const f = await fixture(t), p = await prepare(f);
  assert.equal(f.requests.length,0);
  const capabilities = await f.request(prefix + '/capabilities');
  assert.equal(capabilities.value.sendingEnabled,true); assert.equal(capabilities.value.runtimeHash,runtimeHash);
  assert.equal(capabilities.value.placementImplemented,false);
  await images(f,p); const status = await submit(f,p);
  assert.equal(status.state,'completed-checked'); assert.equal(status.callsReserved,1); assert.equal(status.candidateCurrentFilesReverified,false);
  assert.equal(turns(f).length,1); assert.equal(turns(f)[0].params.input.length,3);
  for (const [i,image] of turns(f)[0].params.input.slice(1).entries()) assert.deepEqual(await fs.readFile(image.path),f.pixels[i]);
  assert.equal(turns(f)[0].params.sandboxPolicy.type,'readOnly'); assert.equal(turns(f)[0].params.sandboxPolicy.networkAccess,false);
  for (const kind of ['preview','candidate']) {
    const downloaded = await f.request(`${p.route}/${kind}?candidateHash=${status.candidateHash}`);
    assert.equal(downloaded.status,200); const value = downloaded.value, {downloadHash,...content} = value;
    assert.equal(value.format,kind === 'candidate' ? 'FrozenReferenceWorldPatchCandidateDownload' : 'FrozenReferenceWorldPatchPreviewDownload');
    assert.equal(downloadHash,contextHash(content)); assert.equal(value.referenceSetHash,p.receipt.referenceSetHash);
    assert.equal(value.candidateFilesReverified,true); assert.equal(value.originalResponseReverified,true);
    assert.equal(value.snapshotHash,f.snapshot.snapshotHash); assert.equal(value.serverBaselineVerified,false);
    assert.equal(value.canAuthorizePlacement,false); assert.equal(value.worldWrites,0); assert.equal(value.additionalModelCalls,0);
    assert.equal(Object.hasOwn(value,'proposal'),kind === 'candidate');
    if (kind === 'candidate') assert.deepEqual(value.proposal,patchTaskProposal(f.snapshot));
    assert.equal(JSON.stringify(value).includes(f.dir),false); assert.doesNotMatch(JSON.stringify(value),/modelPrompt|ownerReference|image-0\.png/);
  }
  const oldProtocol = await f.request(`/v2/world-patch/jobs/${p.receipt.capsuleId}/send`, {method:'POST',value:p.send});
  assert.equal(oldProtocol.status,400); assert.equal(turns(f).length,1);
  assert.equal((await f.request(p.route+'/place',{method:'POST',value:{confirmed:true}})).status,404);
  // Archived baseline audit after current capture removal grants no fresh
  // consent, model retry, current-server certificate or placement permission.
  await f.store.operation('discard',f.id);
  assert.equal((await f.request(p.route)).value.state,'completed-checked');
  const archived=await f.request(p.route+'/candidate?candidateHash='+status.candidateHash);
  assert.equal(archived.status,200); assert.equal(archived.value.serverBaselineVerified,false);
  assert.equal(turns(f).length,1);
});

test('joint disabled startup cannot be upgraded by HTTP, config, legacy confirmation or caller capability', async t => {
  const f = await fixture(t,{enabled:false});
  const caps = await f.request(prefix+'/capabilities'); assert.equal(caps.value.sendingEnabled,false); assert.equal(caps.value.runtimeHash,null);
  const disabled = await f.request(`${prefix}/contexts/${f.id}/disclosure`,{method:'POST',value:{intent:f.input.intent,enabled:true}});
  assert.equal(disabled.status,409); assert.equal(f.modelQueries(),0); assert.deepEqual(f.requests,[]);
  await assert.rejects(fs.stat(path.join(f.dir,'reference-world-patch-invocations')),{code:'ENOENT'});
});

test('default-disabled joint lane rejects every exact action and read, while method boundaries remain strict and all provider work stays zero', async t => {
  const f = await fixture(t,{enabled:false}), id=f.receipt.capsuleId, task=`${prefix}/tasks/${id}`, job=`${prefix}/jobs/${id}`;
  for (const [route,method,value] of [
    ...['disclosure','review','freeze'].map(action => [`${prefix}/contexts/${f.id}/${action}`,'POST',{intent:f.input.intent,confirmation:f.confirmation}]),
    [task,'GET'],[task+'/images','POST',{}],[job,'GET'],[job+'/send','POST',{}],
    [job+'/observe-original','POST',{confirmed:true}],
    ...['preview','candidate'].map(kind => [`${job}/${kind}?candidateHash=${'a'.repeat(64)}`,'GET']),
  ]) assert.equal((await f.request(route,{method,value})).status,409,method+' '+route);
  for (const [route,method] of [[task,'POST'],[task+'/images','GET'],[job,'POST'],[job+'/send','GET'],[job+'/observe-original','GET']])
    assert.equal((await f.request(route,{method})).status,405,method+' '+route);
  const caps=(await f.request(prefix+'/capabilities')).value;
  for (const key of ['preparationEnabled','sendingEnabled','playerUiImplemented','placementImplemented','serverBaselineVerified','canAuthorizePlacement'])
    assert.equal(caps[key],false,key);
  assert.equal(caps.legacyConsentTransferable,false);assert.equal(caps.runtimeHash,null);
  assert.equal(f.modelQueries(),0);assert.deepEqual(f.requests,[]);assert.equal(turns(f).length,0);
  await assert.rejects(fs.stat(path.join(f.dir,'reference-world-patch-invocations')),{code:'ENOENT'});
});

test('paired loopback authorization, exact route/method/query and fatal UTF-8/byte quota reject before discovery or SEND', async t => {
  const f = await fixture(t), route = `${prefix}/contexts/${f.id}/disclosure`;
  assert.equal((await f.request(prefix+'/capabilities',{headers:{Authorization:'Bearer synthetic-wrong'}})).status,401);
  assert.equal((await f.request(prefix+'/capabilities',{headers:{Origin:'null'}})).status,403);
  assert.equal((await f.request(prefix+'/capabilities?enabled=true')).status,400);
  assert.equal((await f.request(route)).status,405);
  assert.equal((await f.request(route,{method:'POST',bytes:Buffer.from([123,34,120,34,58,34,255,34,125])})).status,400);
  assert.equal((await f.request(route,{method:'POST',bytes:Buffer.alloc(32769,32)})).status,413);
  assert.equal((await f.request(route,{method:'POST',value:{intent:f.input.intent},headers:{'Content-Type':'application/json; charset=utf-16'}})).status,400);
  assert.equal((await f.request(prefix+'/contexts/not-an-id/disclosure',{method:'POST',value:{}})).status,404);
  for (const extra of [{capability:f.input.capability},{runtimeHash},{path:'../private'},{operation:'reference-patch-original-input'}])
    assert.equal((await f.request(route,{method:'POST',value:{intent:f.input.intent,...extra}})).status,409);
  assert.equal(f.modelQueries(),0); assert.deepEqual(f.requests,[]);
});

test('unadvertised image capability or exact effort is rejected before freeze and before any paid transport', async t => {
  const f = await fixture(t); f.setImages(false);
  const request = () => f.request(`${prefix}/contexts/${f.id}/disclosure`,{method:'POST',value:{intent:f.input.intent}});
  assert.equal((await request()).status,409); f.setImages(true); f.setEfforts(['high']);
  assert.equal((await request()).status,409); assert.deepEqual(f.requests,[]);
});

test('legacy confirmation or a changed prompt/set cannot freeze the independently reviewed joint data', async t => {
  const f = await fixture(t), p = await prepare(f), route = `${prefix}/contexts/${f.id}/freeze`;
  for (const value of [
    {intent:p.intent,confirmation:{confirmed:true}},
    {intent:{...p.intent,prompt:p.intent.prompt+'changed'},confirmation:p.consent},
    {intent:{...p.intent,referenceSetHash:'c'.repeat(64)},confirmation:p.consent},
  ]) assert.equal((await f.request(route,{method:'POST',value})).status,400);
  assert.equal((await f.request(`${prefix}/tasks/${p.receipt.capsuleId}`)).value.manifestHash,p.receipt.manifestHash);
  assert.deepEqual(f.requests,[]);
});

test('the joint lane is reserved across asynchronous capability discovery, blocking configuration, other SEND and source mutation', async t => {
  let release, enteredResolve;
  const wait = new Promise(resolve => {release=resolve;}), entered = new Promise(resolve => {enteredResolve=resolve;});
  const f = await fixture(t,{holdModels:async () => {enteredResolve();await wait;}});
  t.after(() => release());
  const pending = f.request(`${prefix}/contexts/${f.id}/disclosure`,{method:'POST',value:{intent:f.input.intent}});
  await entered;
  for (const [route,value] of [
    ['/v1/config/codex-path',{codexPath:''}], ['/v1/jobs',{key:'synthetic-never-dispatched',prompt:'ignored',model:'gpt-6.1-sol'}],
    ['/v1/reference-generation-jobs',{}], [`/v1/world-contexts/${f.id}/discard`,{}], [`/v1/reference-drafts/${f.owner}/archive`,{}],
  ]) assert.equal((await f.request(route,{method:'POST',value})).status,409);
  release(); assert.equal((await pending).status,200); assert.deepEqual(f.requests,[]);
});

test('repeated and reopened unknown joint SEND retains the original spent budget even after capability disappears', async t => {
  const f = await fixture(t,{unknown:true}), p = await prepare(f); await images(f,p);
  const status = await submit(f,p); assert.equal(status.state,'unknown'); assert.equal(status.callsReserved,1);
  f.setImages(false); const queries=f.modelQueries();
  const duplicate=await f.request(p.route+'/send',{method:'POST',value:p.send}); assert.equal(duplicate.status,200);
  assert.equal(duplicate.value.state,'unknown'); assert.equal(f.modelQueries(),queries); assert.equal(turns(f).length,1);
  assert.equal((await f.request(p.route+'/send',{method:'POST',value:{...p.send,snapshotHash:'b'.repeat(64)}})).status,409);
  await f.close(); await f.reopen();
  const reopened=await f.request(p.route+'/send',{method:'POST',value:p.send}); assert.equal(reopened.status,200);
  assert.equal(reopened.value.callsReserved,1); assert.equal(reopened.value.candidatePublished,false); assert.equal(turns(f).length,1);
});

test('stored image corruption blocks first SEND, preserves damage, and cannot be repaired by automatically resending', async t => {
  const f=await fixture(t),p=await prepare(f); await images(f,p);
  const image=path.join(f.dir,'reference-world-patch-task-images',p.receipt.capsuleId,'image-0.png');
  await fs.appendFile(image,'synthetic damage');
  assert.equal((await f.request(p.route+'/send',{method:'POST',value:p.send})).status,400);
  assert.deepEqual(f.requests,[]); assert.ok((await fs.readFile(image)).includes(Buffer.from('synthetic damage')));
});

test('candidate byte tampering and wrong/multiple download identities reject without a replacement proposal or second call', async t => {
  const f=await fixture(t),p=await prepare(f); await images(f,p); const status=await submit(f,p);
  for (const query of ['', '?candidateHash='+status.candidateHash+'&candidateHash='+status.candidateHash, '?candidateHash='+status.candidateHash+'&path=other'])
    assert.equal((await f.request(p.route+'/candidate'+query)).status,400);
  assert.equal((await f.request(p.route+'/candidate?candidateHash='+'e'.repeat(64))).status,409);
  const file=path.join(f.dir,'reference-world-patch-invocations',p.receipt.capsuleId,'candidate/preview.json');
  await fs.appendFile(file,' '); const before=await fs.readFile(file);
  assert.equal((await f.request(p.route+'/candidate?candidateHash='+status.candidateHash)).status,409);
  assert.deepEqual(await fs.readFile(file),before); assert.equal(turns(f).length,1);
  const still=await f.request(p.route); assert.equal(still.value.candidateCurrentFilesReverified,false);
});

test('closing during read-only model discovery cancels preparation without dispatch or adopting a new owner', async t => {
  let release, enteredResolve;
  const wait=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{enteredResolve=resolve;});
  const f=await fixture(t,{holdModels:async()=>{enteredResolve();await wait;}});
  const pending=f.request(`${prefix}/contexts/${f.id}/disclosure`,{method:'POST',value:{intent:f.input.intent}});
  await entered; const closing=f.close();
  const response=await pending; assert.equal(response.status,503); await closing; release();
  assert.deepEqual(f.requests,[]);
  await assert.rejects(fs.stat(path.join(f.dir,'reference-world-patch-invocations',f.receipt.capsuleId)),{code:'ENOENT'});
});

test('HTTP original observation returns while its exact closed-turn reader is pending, keeps status pollable, and never starts a second turn', async t => {
  let release, enteredResolve, captured, generations=0;
  const wait=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{enteredResolve=resolve;});
  t.after(() => release());
  const f=await fixture(t),p=await prepare(f); await images(f,p);
  f.adapter.generate=async args=>{
    generations++; const imageInput=await codexImageInput(args),requestHash=await codexRequestHash({...args,...imageInput});
    const binding={version:1,provider:'codex',storage:'persistent-single-turn',model:args.model,effort:args.effort,
      threadId:'http-original-thread',turnId:null,requestHash};
    await args.onProviderBinding(binding); await args.onProviderBinding({...binding,turnId:'http-original-turn'});
    captured={args,imageInput};
    const error=Error('Synthetic original bound unknown');error.diagnostic={provider:'codex',reason:'unknown'};throw error;
  };
  const status=await submit(f,p);assert.equal(status.state,'unknown');assert.equal(status.canObserveOriginal,true);
  f.adapter.request=async()=>assert.fail('Original-only observation must not start/resume/interrupt a provider turn');
  f.adapter.readStoredTurn=async()=>{
    enteredResolve();await wait;
    return {thread:{id:'http-original-thread',ephemeral:false,turns:[{id:'http-original-turn',status:'completed',
      startedAt:1,completedAt:2,itemsView:'full',items:[
        {type:'userMessage',content:[{type:'text',text:captured.args.prompt},...captured.imageInput.images.map(path=>({type:'localImage',path}))]},
        {type:'agentMessage',phase:'final_answer',text:JSON.stringify(patchTaskProposal(f.snapshot))}]}]}};
  };
  const observing=await f.request(p.route+'/observe-original',{method:'POST',value:{confirmed:true}});
  assert.equal(observing.status,202);await entered;
  const pending=await f.request(p.route);assert.equal(pending.status,200);assert.equal(pending.value.callsReserved,1);
  assert.equal(pending.value.canAuthorizePlacement,false);
  assert.equal((await f.request(p.route+'/observe-original',{method:'POST',value:{confirmed:true}})).status,409);
  release();
  let done;
  for(let i=0;i<200;i++){
    done=await f.request(p.route);if(done.value.state==='completed-checked')break;await delay(10);
  }
  assert.equal(done.value.state,'completed-checked');assert.equal(generations,1);assert.equal(done.value.callsReserved,1);
  const claim=path.join(f.dir,'reference-world-patch-invocations',p.receipt.capsuleId,'_observer.json');
  await assert.rejects(fs.stat(claim),{code:'ENOENT'});
});
