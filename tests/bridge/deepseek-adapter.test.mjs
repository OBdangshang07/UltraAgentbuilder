import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import http from 'node:http';
import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {dataOnlyPatch,parseDeepseekSpec,runDeepseekSdk,findDeepseek,safeUsage,safeDeepseekFailure,supportedDeepseekVersions} from '../../bridge/deepseek-adapter.mjs';
import {sampleSpec} from '../../src/generation/sample.mjs';import {compileSpec} from '../../src/generation/compiler.mjs';
import {mkdtempSync,readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {CompletedResponseFormatError} from '../../bridge/model-json.mjs';
import {createHash} from 'node:crypto';
const temp=()=>mkdtempSync(path.join(os.tmpdir(),'voxel-dsh-evidence-'));
// Exercise the installed transport, not only a mocked SDK event stream.
function fixtureStream(res,version,answer,finish='stop'){
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 if(finish==='malformed'){res.end('event: message_start\ndata: {broken}\n\n');return;}
 if(version==='0.1.5-rc.1'){
  res.write('data: '+JSON.stringify({id:'fixture',model:'deepseek-flash',choices:[{index:0,delta:{role:'assistant',content:answer},finish_reason:null}]})+'\n\n');
  res.write('data: '+JSON.stringify({id:'fixture',model:'deepseek-flash',choices:[{index:0,delta:{},finish_reason:finish}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30,completion_tokens_details:{reasoning_tokens:12}}})+'\n\n');res.end('data: [DONE]\n\n');return;
 }
 const event=value=>res.write('event: '+value.type+'\ndata: '+JSON.stringify(value)+'\n\n');
 event({type:'message_start',message:{id:'fixture',type:'message',role:'assistant',model:'deepseek-flash',content:[],usage:{input_tokens:10,output_tokens:0,cache_read_input_tokens:5}}});
 event({type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'private-fixture-reasoning'}});
 event({type:'content_block_stop',index:0});
 event({type:'content_block_start',index:1,content_block:{type:'text',text:''}});
 event({type:'content_block_delta',index:1,delta:{type:'text_delta',text:answer}});
 event({type:'content_block_stop',index:1});
 event({type:'message_delta',delta:{stop_reason:finish==='length'?'max_tokens':'end_turn'},usage:{output_tokens:20}});
 if(finish!=='disconnect')event({type:'message_stop'});
 res.end();
}
test('DSH explicit data-only profile disables shells and retry, contains no credential',()=>{
 const patch=dataOnlyPatch({baseURL:'https://api.deepseek.com',models:[]});for(const id of ['persistent-bash','persistent-pwsh','subprocess','pty','llm-retry','session-log-deepseek','plugin-package-inventory-deepseek'])assert.equal(patch.find(r=>r.id===id).disabled,true);
 assert.equal(patch.find(r=>r.id==='llm-deepseek').config.retryPolicy.maxRetries,0);assert.equal(patch.find(r=>r.id==='sandbox-policy').config.mode,'read-only');
 assert.equal(Object.hasOwn(patch.find(r=>r.id==='llm-deepseek').config,'maxTokens'),false);
 assert.equal(dataOnlyPatch({maxTokens:131072}).find(r=>r.id==='llm-deepseek').config.maxTokens,131072);
 assert.equal(Object.hasOwn(patch.find(r=>r.id==='llm-deepseek').config,'streamIdleTimeoutMs'),false);
 assert.equal(dataOnlyPatch({streamIdleTimeoutMs:300000}).find(r=>r.id==='llm-deepseek').config.streamIdleTimeoutMs,300000);
 assert.deepEqual(safeUsage({inputTokens:10,outputTokens:20,reasoningTokens:12,totalTokens:30,privateText:'secret',cacheReadTokens:-1}),{inputTokens:10,outputTokens:20,totalTokens:30,reasoningTokens:12});
 assert.equal(compileSpec(parseDeepseekSpec('```json\n'+JSON.stringify(sampleSpec())+'\n```')).manifest.setCount,1937);assert.throws(()=>parseDeepseekSpec('explanation {}'));
});
test('DSH SDK cancellation kills only its subprocess and never resends the prompt',async()=>{
 let killed=false,prompts=0;const abort=new AbortController();
 const spawnProcess=()=>{const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.stdin=new PassThrough();c.kill=()=>{killed=true;queueMicrotask(()=>c.emit('close',1));};c.stdin.on('data',b=>{const f=JSON.parse(b);if(f.method==='initialize')queueMicrotask(()=>c.stdout.write(JSON.stringify({id:1,result:{serverInfo:{name:'deepseek-harness-sdk-runtime'}}})+'\n'));if(f.method==='session/prompt'){prompts++;abort.abort();}});return c;};
 const run=runDeepseekSdk({cli:{file:'fixture'},cwd:temp(),home:'.',patch:'fixture',model:'deepseek-flash',prompt:'fixture',signal:abort.signal,spawnProcess});await assert.rejects(run.result,/cancelled/);assert.equal(killed,true);assert.equal(prompts,1);
});
test('installed DSH SDK uses selected budget, reports usage and makes one request per authorized turn', {timeout:100000},async t=>{
 let cli;try{cli=await findDeepseek();}catch{return t.skip('DSH not installed');}
 if(!supportedDeepseekVersions.includes(cli.version))return t.skip('Verified DSH runtime unavailable');
 let calls=0,wire,route,finish='stop',answer=JSON.stringify(sampleSpec());const spec=sampleSpec();const server=http.createServer(async(req,res)=>{
  calls++;route=req.url;const chunks=[];for await(const b of req)chunks.push(b);wire=JSON.parse(Buffer.concat(chunks));
  if(finish==='transport'){req.socket.destroy();return;}
  fixtureStream(res,cli.version,answer,finish);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-dsh-sdk-')),home=path.join(dir,'isolated'),patch=path.join(dir,'patch.json');await fs.mkdir(home);
 await fs.writeFile(patch,JSON.stringify(dataOnlyPatch({baseURL:'http://127.0.0.1:'+server.address().port,maxTokens:131072,models:[{id:'deepseek-flash',maxTokens:196608}]})));
 try{
  const inherited=runDeepseekSdk({cli,cwd:dir,home,patch,key:'local-fixture-not-a-key',model:'deepseek-flash',prompt:'Return fixture.',timeout:90000});assert.deepEqual((await inherited.result).spec,spec);assert.equal(wire.max_tokens,196608);assert.equal(calls,1);
  const run=runDeepseekSdk({cli,cwd:dir,home,patch,key:'local-fixture-not-a-key',model:'deepseek-flash',prompt:'Return the fixture JSON.',maxOutputTokens:262144,timeout:90000});const output=await run.result;
  assert.deepEqual(output.spec,spec);assert.equal(calls,2);assert.equal(wire.model,'deepseek-flash');assert.equal(wire.tools?.length??0,0);assert.equal(wire.max_tokens,262144);assert.equal(output.usage.outputTokens,20);assert.equal(output.diagnostic.harnessVersion,cli.version);
  assert.equal(Object.hasOwn(wire,'dsh_session_log'),false);assert.equal(Object.hasOwn(wire,'dsh_plugin_packages'),false);assert.ok(!JSON.stringify(wire).includes(dir));
  if(cli.version==='0.1.5-rc.1'){assert.equal(output.usage.reasoningTokens,12);assert.match(route,/chat\/completions$/);}else{assert.match(route,/\/messages$/);assert.equal(output.usage.totalTokens,35);assert.equal(output.usage.cacheReadTokens,5);assert.equal(output.usage.reasoningTokens,undefined);assert.deepEqual(wire.thinking,{type:'disabled'});}
  // Even parseable JSON must not be accepted if the provider reports truncation.
  finish='length';const next=runDeepseekSdk({cli,cwd:dir,home,patch,key:'local-fixture-not-a-key',model:'deepseek-flash',prompt:'Return fixture.',maxOutputTokens:262144,timeout:90000});
  await assert.rejects(next.result,e=>{assert.match(e.message,/max-tokens/);assert.match(e.message,/262144/);assert.equal(e.diagnostic.reason,'max-tokens');assert.equal(e.diagnostic.usage.outputTokens,20);assert.ok(e.diagnostic.receivedTextBytes>0);assert.ok(!JSON.stringify(e.diagnostic).includes('local-fixture-not-a-key'));assert.ok(!JSON.stringify(e.diagnostic).includes('nodes'));return true;});assert.equal(calls,3);
  const inheritedTruncated=runDeepseekSdk({cli,cwd:dir,home,patch,key:'local-fixture-not-a-key',model:'deepseek-flash',prompt:'Return fixture.',inheritedMaxOutputTokens:196608,timeout:90000});
  await assert.rejects(inheritedTruncated.result,e=>{assert.match(e.message,/Harness \/ 模型配置或服务端/);assert.equal(e.diagnostic.budgetSource,'harness-model-default');assert.equal(e.diagnostic.maxOutputTokens,196608);assert.equal(e.diagnostic.automaticRetries,0);return true;});assert.equal(wire.max_tokens,196608);assert.equal(calls,4);
  finish='stop';answer='{"中文":broken}';
  const invalid=runDeepseekSdk({cli,cwd:dir,home,patch,key:'local-fixture-not-a-key',model:'deepseek-flash',effort:'max',prompt:'Return JSON.',timeout:15000});
  await assert.rejects(invalid.result,e=>{assert.ok(e instanceof CompletedResponseFormatError);assert.equal(e.diagnostic.reason,'completed');const ev=e.diagnostic.responseEvidence;assert.equal(readFileSync(path.join(dir,ev.directory,ev.file),'utf8'),answer);return true;});
  assert.equal(calls,5);
  if(cli.version==='0.1.5-rc.1')assert.equal(wire.reasoning_effort,'max');else{assert.equal(wire.output_config.effort,'max');assert.deepEqual(wire.thinking,{type:'enabled'});}
  if(cli.version==='0.1.7-alpha.1'){
   finish='disconnect';answer=JSON.stringify(spec);const disconnected=runDeepseekSdk({cli,cwd:dir,home,patch,key:'local-fixture-not-a-key',model:'deepseek-flash',prompt:'Return JSON.',timeout:15000});
   await assert.rejects(disconnected.result,e=>{assert.equal(e.diagnostic.providerFailure.code,'STREAM_CLOSED');assert.equal(e.diagnostic.reason,'error');assert.equal(e.diagnostic.automaticRetries,0);return true;});assert.equal(calls,6);
   finish='malformed';const malformed=runDeepseekSdk({cli,cwd:dir,home,patch,key:'local-fixture-not-a-key',model:'deepseek-flash',prompt:'Return JSON.',timeout:15000});
   await assert.rejects(malformed.result,e=>{assert.equal(e.diagnostic.providerFailure.code,'MALFORMED_RESPONSE');assert.match(e.message,/Messages/);assert.equal(e.diagnostic.automaticRetries,0);return true;});assert.equal(calls,7);
   finish='transport';const transport=runDeepseekSdk({cli,cwd:dir,home,patch,key:'local-fixture-not-a-key',model:'deepseek-flash',prompt:'Return JSON.',timeout:15000});
   await assert.rejects(transport.result,e=>{assert.equal(e.diagnostic.providerFailure.code,'TRANSPORT');assert.equal(e.diagnostic.usage,null);assert.equal(e.diagnostic.automaticRetries,0);return true;});assert.equal(calls,8);
  }
  for(const entry of await fs.readdir(dir))if(entry.startsWith('deepseek-response-'))for(const name of await fs.readdir(path.join(dir,entry))){const text=await fs.readFile(path.join(dir,entry,name),'utf8');assert.ok(!text.includes('private-fixture-reasoning'));assert.ok(!text.includes('local-fixture-not-a-key'));}
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('invalid output budget rejects before spawning any runtime',()=>{
 let calls=0;assert.throws(()=>runDeepseekSdk({maxOutputTokens:-1,spawnProcess(){calls++;}}),/输出预算/);assert.equal(calls,0);
});

test('DSH failure facts allow only verified codes/status, never provider prose or opaque identifiers',()=>{
 const privateFields={message:'secret prompt context exceeded',requestId:'secret-key',headers:{Authorization:'secret-key'},cause:{code:'AUTH'}};
 assert.deepEqual(safeDeepseekFailure({...privateFields,code:'RATE_LIMIT',status:429}),{code:'RATE_LIMIT',status:429});
 assert.deepEqual(safeDeepseekFailure({...privateFields,code:'secret-key',status:402}),{code:'UNKNOWN',status:402});
 assert.deepEqual(safeDeepseekFailure({...privateFields,code:'HTTP_402',status:402}),{code:'HTTP_402',status:402});
 assert.deepEqual(safeDeepseekFailure({...privateFields,code:'HTTP_401',status:402}),{code:'UNKNOWN',status:402});
 for(const status of [NaN,Infinity,399,600,429.5,'429'])assert.deepEqual(safeDeepseekFailure({...privateFields,status}),{code:'UNKNOWN'});
 for(const value of [undefined,null,[],42,'AUTH',privateFields])assert.deepEqual(safeDeepseekFailure(value),{code:'UNKNOWN'});
});

test('DSH structured turn failure preserves safe evidence, ignores other sessions, and never resends',async()=>{
 let prompts=0,kills=0;
 const spawnProcess=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{kills++;};
  child.stdin.on('data',bytes=>{const f=JSON.parse(bytes);if(f.method==='initialize')queueMicrotask(()=>child.stdout.write(JSON.stringify({id:1,result:{serverInfo:{name:'deepseek-harness-sdk-runtime'}}})+'\n'));
   if(f.method==='session/prompt'){prompts++;queueMicrotask(()=>{
    child.stderr.write('secret-key raw server error');
    for(const [sessionId,code,status] of [['another-session','AUTH',401],[f.params.sessionId,'SERVER',503]])child.stdout.write(JSON.stringify({method:'session.event',params:{sessionId,event:{type:'turn/end',data:{reason:{kind:'error',error:{code,status,message:'secret-key private prompt',requestId:'secret-key'}}}}}})+'\n');
   });}
  });return child;
 };
 const run=runDeepseekSdk({cli:{file:'fixture'},cwd:temp(),home:'.',patch:'fixture',model:'deepseek-flash',prompt:'fixture',spawnProcess});
 await assert.rejects(run.result,e=>{assert.match(e.message,/\[DSH:SERVER\].*HTTP 503/);assert.deepEqual(e.diagnostic.providerFailure,{code:'SERVER',status:503});assert.equal(e.diagnostic.usage,null);assert.equal(e.diagnostic.automaticRetries,0);assert.ok(!JSON.stringify([e.message,e.diagnostic]).includes('secret-key'));return true;});
 assert.equal(prompts,1);assert.equal(kills,1);
});

test('installed DSH maps HTTP failures into redacted facts with one loopback request and zero retries', {timeout:100000},async t=>{
 let cli;try{cli=await findDeepseek();}catch{return t.skip('DSH not installed');}if(!supportedDeepseekVersions.includes(cli.version))return t.skip('Verified DSH unavailable');
 let calls=0,current;const server=http.createServer(async(req,res)=>{for await(const _ of req){}calls++;res.writeHead(current.status,{'Content-Type':'application/json','x-request-id':'secret-request-id','retry-after':'1'});res.end(JSON.stringify({error:{message:current.message+' private-prompt secret-key'}}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-dsh-errors-')),home=path.join(dir,'isolated'),patch=path.join(dir,'patch.json');await fs.mkdir(home);
 await fs.writeFile(patch,JSON.stringify(dataOnlyPatch({baseURL:'http://127.0.0.1:'+server.address().port,models:[{id:'deepseek-flash'}]})));
 try{
  const cases=[{status:401,code:'AUTH',message:'Unauthorized'},{status:402,code:cli.version==='0.1.5-rc.1'?'HTTP_402':'QUOTA',message:'Rejected'},{status:429,code:'RATE_LIMIT',message:'Rate limited'},{status:503,code:'SERVER',message:'Unavailable'},{status:400,code:'CONTEXT_WINDOW_EXCEEDED',message:'maximum context length exceeded'},{status:400,code:'INVALID_REQUEST',message:'Invalid parameter'}];
  for(const [i,value] of cases.entries()){
   current=value;const run=runDeepseekSdk({cli,cwd:dir,home,patch,key:'loopback-fixture',model:'deepseek-flash',prompt:'Return JSON.',timeout:15000});
   await assert.rejects(run.result,e=>{assert.deepEqual(e.diagnostic.providerFailure,{code:value.code,status:value.status});assert.equal(e.diagnostic.reason,'error');assert.equal(e.diagnostic.automaticRetries,0);assert.equal(e.diagnostic.usage,null);assert.ok(!/private-prompt|secret-key|secret-request-id/.test(JSON.stringify([e.message,e.diagnostic])));return true;});assert.equal(calls,i+1);
  }
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('default initialize omits token override and cumulative stream beyond 8 MiB is not cut off',async()=>{
 let initialize;
 const spawnProcess=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{};
  child.stdin.on('data',bytes=>{const frame=JSON.parse(bytes);if(frame.method==='initialize'){initialize=frame.params;queueMicrotask(()=>child.stdout.write(JSON.stringify({id:1,result:{serverInfo:{name:'deepseek-harness-sdk-runtime'}}})+'\n'));}
   if(frame.method==='session/prompt')queueMicrotask(()=>{const event=e=>child.stdout.write(JSON.stringify({method:'session.event',params:{sessionId:frame.params.sessionId,event:e}})+'\n');
    const progress=JSON.stringify({method:'progress',text:'x'.repeat(8192)})+'\n';for(let i=0;i<1100;i++)child.stdout.write(progress);
    event({type:'assistant/message',data:{message:{content:[{type:'text',text:JSON.stringify(sampleSpec())}]}}});event({type:'turn/end',data:{reason:{kind:'completed'}}});
   });
  });return child;
 };
 const run=runDeepseekSdk({cli:{file:'fixture'},cwd:temp(),home:'.',patch:'fixture',model:'deepseek-flash',prompt:'fixture',spawnProcess});
 assert.deepEqual((await run.result).spec,sampleSpec());assert.equal(Object.hasOwn(initialize,'maxTokens'),false);
});

test('raw completed/invalid/truncated/cancelled evidence is flushed before kill, without private reasoning',async()=>{
 for(const mode of ['valid','invalid','truncated','cancelled','protocol','empty','storage']){
  const cwd=temp(),abort=new AbortController();let kills=0,prompts=0;
  const raw=mode==='valid'?'```JSON\n{"中文":[1,],}\n```':mode==='invalid'?'\n{"中文":broken}':'{"中文":1}';
  const spawnProcess=()=>{const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.stdin=new PassThrough();
   c.kill=()=>{kills++;const dir=path.join(cwd,readdirSync(cwd)[0]),receipt=JSON.parse(readFileSync(path.join(dir,'receipt.json')));assert.equal(receipt.reason,mode==='cancelled'||mode==='protocol'?'incomplete':mode==='truncated'?'max-tokens':'completed');
    assert.equal(readFileSync(path.join(dir,'answer-1.txt'),'utf8'),raw);assert.equal(receipt.responseEvidence.persisted,true);assert.ok(!JSON.stringify(receipt).includes('private-reasoning'));};
   c.stdin.on('data',bytes=>{const f=JSON.parse(bytes);if(f.method==='initialize')queueMicrotask(()=>c.stdout.write(JSON.stringify({id:1,result:{serverInfo:{name:'deepseek-harness-sdk-runtime'}}})+'\n'));
    if(f.method==='session/prompt'){prompts++;queueMicrotask(()=>{const event=e=>c.stdout.write(JSON.stringify({method:'session.event',params:{sessionId:f.params.sessionId,event:e}})+'\n');
     event({type:'assistant/message',data:{usage:{totalTokens:7},message:{content:[{type:'reasoning',text:'private-reasoning'},{type:'text',text:raw}]}}});
     if(mode==='cancelled'){abort.abort();return;}if(mode==='protocol'){c.stdout.write('{malformed-frame\n');return;}
     if(mode==='empty')event({type:'assistant/message',data:{message:{content:[]}}});
     if(mode==='storage')mkdirSync(path.join(cwd,readdirSync(cwd)[0],'candidate.txt'));
     event({type:'turn/end',data:{reason:{kind:mode==='truncated'?'max-tokens':'completed'}}});
    });}
   });return c;
  };
  const run=runDeepseekSdk({cli:{file:'fixture'},cwd,home:cwd,patch:'fixture',model:'deepseek-flash',prompt:'fixture',spawnProcess,signal:abort.signal});
  if(mode==='valid'){const r=await run.result;assert.deepEqual(r.spec,{'中文':[1]});assert.equal(r.diagnostic.json.changes.length,2);}
  else await assert.rejects(run.result,e=>{assert.equal(e instanceof CompletedResponseFormatError,['invalid','empty'].includes(mode));assert.equal(e.diagnostic.usage.totalTokens,7);if(mode==='invalid'){assert.equal(e.responseText,raw);assert.equal(Object.keys(e).includes('responseText'),false);assert.equal(e.diagnostic.receivedTextSha256,createHash('sha256').update(raw).digest('hex'));}if(mode==='storage')assert.equal(e.diagnostic.failureKind,'evidence-storage');if(mode==='protocol')assert.equal(e.diagnostic.failureKind,'protocol-json');if(mode==='empty')assert.equal(e.diagnostic.receivedTextBytes,0);return true;});
  assert.equal(prompts,1);assert.equal(kills,1);
 }
});

test('unavailable evidence directory stops before any runtime request',()=>{
 let spawned=false;assert.throws(()=>runDeepseekSdk({cwd:path.join(temp(),'missing'),spawnProcess(){spawned=true;}}));assert.equal(spawned,false);
});
