// Synthetic stdio fixture ONLY. Configured explicitly by a free test; never
// delegates to a provider, reads an account, runs tools or accesses a world.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {createInterface}=require('node:readline'),{randomUUID,createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
if(process.argv[2]==='--version'){assert.equal(process.argv.length,3);process.stdout.write('codex-cli 0.159.0-synthetic\n');process.exit(0);}
assert.deepEqual(process.argv.slice(2),['app-server']);
const send=v=>process.stdout.write(JSON.stringify(v)+'\n'),read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');let config,modules;
async function ready(){
  if(config)return;
  config=await read(path.join(__dirname,'config.json'));
  assert.deepEqual(Object.keys(config).sort(),['directory','referenceInput','sourceRoot','mode','auditDirectory','model'].sort());
  assert.ok(['staged','v4'].includes(config.mode));assert.equal(config.model,'gpt-6.1-sol');
  for(const k of ['directory','sourceRoot','auditDirectory'])assert.equal(await fs.realpath(config[k]),config[k]);
  assert.equal(path.dirname(config.directory),path.dirname(config.auditDirectory));
  const load=p=>import(pathToFileURL(path.join(config.sourceRoot,p)).href);
  const [reference,brief,staged,v4]=await Promise.all([load('bridge/reference-generation-binding.mjs'),load('tests/bridge/reference-generation-fixture.mjs'),
    load('tests/bridge/decomposed-assembly-fixtures.mjs'),load('tests/bridge/quality-v4-fixtures.mjs')]);modules={reference,brief,staged,v4};
}
async function save(name,v){assert.ok(!/[\\/]/.test(name));await fs.writeFile(path.join(config.auditDirectory,name),JSON.stringify(v),{flag:'wx'});}
async function loadThread(id){assert.match(id,/^thread-[a-f0-9-]{36}$/);return read(path.join(config.auditDirectory,id+'.json'));}
async function complete(params,turnId){
  try{
    const thread=await loadThread(params.threadId);assert.equal(params.model,config.model);assert.equal(params.effort,'max');
    assert.equal(params.approvalPolicy,'never');assert.deepEqual(params.sandboxPolicy,{type:'readOnly',networkAccess:false});
    assert.equal(params.input[0].type,'text');assert.ok(params.input.slice(1).every(i=>i.type==='localImage'));
    const input=JSON.parse(params.input[0].text.split('Assembly input (data):\n').at(-1)),format=params.outputSchema.properties.format.enum[0];
    const pending=[];for(const name of await fs.readdir(path.join(config.directory,'assembly-journal'))){
      if(!/^call-[0-9]+\.json$/.test(name))continue;
      const r=await read(path.join(config.directory,'assembly-journal',name));
      if(r.value.state==='pending'&&r.value.providerBinding?.threadId===params.threadId)pending.push(r.value);
    }
    assert.equal(pending.length,1);const index=pending[0].index;assert.ok(index>=1&&index<=26);
    const reference=await modules.reference.readJobReferenceInput({directory:config.directory,input:config.referenceInput,model:config.model});
    const imageHashes=[];for(const image of params.input.slice(1)){
      const actual=await fs.realpath(image.path);assert.equal(actual,image.path);assert.ok(actual.startsWith(config.directory+path.sep));
      imageHashes.push(sha(await fs.readFile(actual)));
    }
    if(format==='ArchitectureReferenceBrief')assert.deepEqual(imageHashes,reference.manifest.references.map(r=>r.sha256));
    const answer=format==='ArchitectureReferenceBrief'?modules.brief.referenceBrief(reference):
      (config.mode==='staged'?modules.staged.stagedResponse:modules.v4.v4Response)(input,{outputSchema:params.outputSchema});
    const text=JSON.stringify(answer),turn={id:turnId,status:'completed',startedAt:thread.createdAt,completedAt:Date.now(),itemsView:'full',items:[
      {type:'userMessage',content:params.input},{type:'agentMessage',phase:'final_answer',text}]};
    await save(turnId+'.json',{index,threadId:params.threadId,turn,format,params,imageHashes,
      referenceBindingHash:format==='ArchitectureReferenceBrief'?reference.binding.bindingHash:null,
      nativeImages:format!=='ArchitectureReferenceBrief'&&imageHashes.length>0,originalProductionAdapter:true,actualModelCalls:0});
    send({method:'item/completed',params:{threadId:params.threadId,turnId,item:{type:'agentMessage',phase:'final_answer',text}}});
    send({method:'turn/completed',params:{threadId:params.threadId,turn}});
  }catch(error){await save('failed-'+turnId+'.json',{error:String(error),actualModelCalls:0});
    send({method:'turn/completed',params:{threadId:params.threadId,turn:{id:turnId,status:'failed',items:[],error:{message:'Synthetic stdio fixture failure'}}}});}
}
async function handle(m){
  if(m.id===undefined)return;await ready();const p=m.params??{};let result;
  switch(m.method){
    case 'initialize':result={userAgent:'Synthetic no-provider regression fixture'};break;
    case 'account/read':assert.equal(p.refreshToken,false);result={account:null,requiresOpenaiAuth:false};break;
    case 'model/list':result={data:[{model:config.model,displayName:'Synthetic exact-model fixture',isDefault:true,hidden:false,
      inputModalities:['text','image'],supportedReasoningEfforts:[{reasoningEffort:'high'},{reasoningEffort:'max'}],defaultReasoningEffort:'max'}],nextCursor:null};break;
    case 'config/read':result={config:{mcp_servers:{fixture_forbidden:{command:'NEVER_EXECUTE'}}}};break;
    case 'thread/start':{
      assert.equal(p.cwd,config.directory);assert.equal(p.model,config.model);assert.equal(p.ephemeral,false);
      assert.equal(p.sandbox,'read-only');assert.equal(p.approvalPolicy,'never');assert.equal(p.config.web_search,'disabled');
      assert.deepEqual(p.config.mcp_servers,{fixture_forbidden:{enabled:false}});
      for(const k of ['shell_tool','multi_agent','enable_mcp_apps','apps','plugins','hooks','skill_search'])assert.equal(p.config['features.'+k],false);
      const id='thread-'+randomUUID();await save(id+'.json',{id,createdAt:Date.now(),params:p});result={thread:{id,ephemeral:false}};break;
    }
    case 'turn/start':{await loadThread(p.threadId);const id='turn-'+randomUUID();
      send({id:m.id,result:{turn:{id,status:'inProgress'}}});setImmediate(()=>complete(p,id));return;}
    case 'thread/read':{
      const thread=await loadThread(p.threadId),turns=[];assert.equal(p.includeTurns,true);
      for(const name of await fs.readdir(config.auditDirectory))if(/^turn-[a-f0-9-]{36}\.json$/.test(name)){
        const r=await read(path.join(config.auditDirectory,name));if(r.threadId===p.threadId)turns.push(r.turn);}
      result={thread:{id:thread.id,ephemeral:false,turns,status:{type:turns.length?'idle':'active'}}};break;
    }
    case 'thread/unsubscribe':await loadThread(p.threadId);result={status:'unsubscribed'};break;
    default:throw Error('Unexpected synthetic fixture method');
  }
  send({id:m.id,result});
}
let queue=Promise.resolve();const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
lines.on('line',line=>{assert.ok(Buffer.byteLength(line)<=4*1024**2);const m=JSON.parse(line);
  queue=queue.then(()=>handle(m)).catch(async error=>{if(config)await save('failed-rpc-'+randomUUID()+'.json',{method:m.method,error:String(error),actualModelCalls:0});
    if(m.id!==undefined)send({id:m.id,error:{code:-32603,message:'Synthetic fixture rejected request'}});});});
lines.on('close',()=>queue.then(()=>process.exit(0)));
