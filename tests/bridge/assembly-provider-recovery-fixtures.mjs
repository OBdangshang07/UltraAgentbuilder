import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {hash} from '../../src/generation/compiler.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {CodexAdapter} from '../../bridge/codex-adapter.mjs';
import {assemblyProviderRecoveryPolicy} from '../../contracts/assembly-provider-recovery.mjs';
import {assemblyPlan,packageEdit,acceptReview,planEdit} from '../design/assembly-fixtures.mjs';
import {setupStaged,stagedRequest} from './decomposed-assembly-fixtures.mjs';

export const capacityMessage='Selected model is at capacity. Please try a different model.';
export const recoveryModel='gpt-6.1-sol',recoveryEffort='max';
export const recoveryRequest={key:'synthetic-capacity-workflow',agent:'codex',model:recoveryModel,effort:recoveryEffort,
  prompt:'16×10×16格离线组件工程测试',generationMode:'scene',sceneWorkflow:'components',qualityTier:'ultra',
  assemblyDesignReview:'text',assemblyRecovery:'safe',assemblyConfirmed:true,maxRepairs:0};
export const enableRecovery=policy=>({...structuredClone(policy),assembly:{...structuredClone(policy.assembly),
  providerRetries:2,providerRecovery:assemblyProviderRecoveryPolicy()}});
const response=(input,options)=>{
  switch(options.outputSchema.properties.format.enum[0]){
    case 'SceneAssemblyPlan':return assemblyPlan();
    case 'SceneAssemblyPlanEdit':return planEdit(input.priorPlan,assemblyPlan());
    case 'SceneConceptReview':return {format:'SceneConceptReview',version:1,planHash:input.planHash,sourceHash:input.sourceHash,
      evidenceHash:input.designEvidence.evidenceHash,verdict:'accept',summary:'Synthetic engineering acceptance only',issues:[]};
    case 'SceneAssemblyReview':return acceptReview(input);
    default:return packageEdit(input);
  }
};

// Actual adapter, persisted answer files and actual durable journal. ONLY the
// app-server transport/model answers are synthetic; no account or model calls.
export async function recoveryHarness(t,{staged=false,enabled=true,requestDelta={},choose=()=>({})}={}){
  const request={...(staged?stagedRequest:recoveryRequest),model:recoveryModel,effort:recoveryEffort,...requestDelta};
  let directory,base,options;
  if(staged){const h=await setupStaged(null,request);directory=await fs.realpath(h.directory);base=h.options.invoke;options=h.options;}
  else{
    directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'voxel-bounded-recovery-')));
    const rules=await fs.readFile(new URL('../../prompts/scene-v1.md',import.meta.url),'utf8');
    options={directory,prompt:request.prompt,rules,policy:generationPreflight(request),onStage:async()=>{}};
    base=async(prompt,index,stage)=>response(JSON.parse(prompt.split('Assembly input (data):\n').at(-1)),stage);
  }
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const policy=enabled?enableRecovery(options.policy):options.policy,events=[],calls=[],waits=[],transport=[];
  const controller=new AbortController();
  Object.assign(options,{directory,policy,model:recoveryModel,effort:recoveryEffort,signal:controller.signal,
    runtimeHash:hash('Synthetic pinned bounded-recovery runtime'),requestHash:hash({request,policy}),
    wait:async(ms,value,{signal})=>{signal.throwIfAborted();waits.push(ms);},onRecovery:async event=>events.push(event)});
  options.invoke=async(prompt,index,stage)=>{
    const input=JSON.parse(prompt.split('Assembly input (data):\n').at(-1)),answer=await base(prompt,index,stage);
    const selected=choose({index,input,stage,answer,calls,directory})??{};
    calls.push({index,phase:stage.stageName,input,prompt,outputSchema:structuredClone(stage.outputSchema),
      referenceInput:stage.referenceInput,answer:structuredClone(answer),images:[...(stage.images??[])]});
    const adapter=new CodexAdapter({observationIntervalMs:5}),threadId='fixture-thread-'+index,turnId='fixture-turn-'+index;
    adapter.connect=async()=>{};adapter.models=async()=>[{id:recoveryModel,supportsImages:true,efforts:[{reasoningEffort:recoveryEffort}],defaultEffort:recoveryEffort}];
    adapter.readStoredTurn=async()=>{throw Error('Synthetic unavailable original observation');};
    adapter.request=async(method,params)=>{
      transport.push({method,index});
      if(method==='config/read')return {config:{}};
      if(method==='thread/start')return {thread:{id:threadId,ephemeral:false}};
      if(['thread/unsubscribe','turn/interrupt'].includes(method))return {};
      if(method!=='turn/start')throw Error('Unexpected synthetic transport request');
      const text=selected.text??JSON.stringify(selected.answer??answer),failed=selected.failure!==undefined;
      const items=[...(selected.commentary?[{type:'agentMessage',phase:'commentary',text:'Synthetic nonempty commentary'}]:[]),
        ...(!failed||selected.text!==undefined?[{type:'agentMessage',phase:'final_answer',text}]:[])];
      if(!selected.unknown)setImmediate(()=>adapter.emit('notification',{method:'turn/completed',params:{threadId,
        turn:{id:turnId,status:failed?'failed':'completed',...(failed?{error:{message:selected.failure}}:{}),items}}}));
      return {turn:{id:turnId,status:'inProgress'}};
    };
    const result=await adapter.generate({prompt,model:recoveryModel,effort:recoveryEffort,cwd:directory,signal:controller.signal,
      images:stage.images,referenceInput:stage.referenceInput,outputSchema:stage.outputSchema,onProviderBinding:stage.onProviderBinding,
      onEvent:async e=>{if(selected.unknown&&e.turnId)throw Error('Synthetic observer lost after original turn acknowledged');}});
    return result.spec;
  };
  return {directory,options,controller,events,calls,waits,transport,
    async journal(){
      const names=(await fs.readdir(path.join(directory,'assembly-journal'))).filter(n=>/^call-\d+\.json$/.test(n));
      return Promise.all(names.sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0])).map(async n=>
        JSON.parse(await fs.readFile(path.join(directory,'assembly-journal',n),'utf8')).value));
    }};
}
