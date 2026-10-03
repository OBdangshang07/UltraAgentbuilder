import {mkdtempSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

/** Private data-only answer evidence. Never save reasoning, account state or
 * provider stderr. Storage must work before a chargeable turn is submitted. */
export function responseEvidence(cwd,provider,request){
  if(!['codex','claude','deepseek'].includes(provider))throw new Error('Unknown evidence provider');
  // Unlike the promise-based journal IO, Windows mkdtempSync may still fail
  // past MAX_PATH unless its absolute prefix uses the extended path form.
  // Keep evidence under the same job; do not fall back to a shared temp root.
  const directory=mkdtempSync(path.toNamespacedPath(path.resolve(cwd,provider+'-response-')));
  const save=(name,value)=>{
    const fd=openSync(path.join(directory,name),'wx',0o600);
    try{writeFileSync(fd,value);fsyncSync(fd);}finally{closeSync(fd);}
  };
  save('request.json',JSON.stringify({version:1,provider,...request,createdAt:new Date().toISOString()}));
  return {
    save,
    finish(answer,metadata){
      save('answer-1.txt',answer);
      const receipt={provider,...metadata,receivedTextBytes:Buffer.byteLength(answer),
        receivedTextSha256:createHash('sha256').update(answer).digest('hex'),automaticRetries:0,
        responseEvidence:{directory:path.basename(directory),file:'answer-1.txt',persisted:true}};
      save('receipt.json',JSON.stringify(receipt,null,2));
      return receipt;
    }
  };
}

export function safeCodexUsage(value){
  if(!value||typeof value!=='object')return null;
  const usage={};
  for(const key of ['inputTokens','cachedInputTokens','outputTokens','reasoningOutputTokens','totalTokens']){
    if(Number.isSafeInteger(value[key])&&value[key]>=0)usage[key]=value[key];
  }
  return Object.keys(usage).length?usage:null;
}
