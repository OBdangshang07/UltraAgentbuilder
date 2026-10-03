import {createHash} from 'node:crypto';
const sha=text=>createHash('sha256').update(text).digest('hex');

// Local formatting only. Never infer missing values, close a truncated object,
// select one of several answers, evaluate expressions, or change string data.
export function parseModelJson(raw){
  let text=raw.trim();const changes=[];
  if(text!==raw)changes.push('outer-whitespace-or-bom');
  const fence=/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(text);
  if(fence){text=fence[1];changes.push('single-json-fence');}
  let quoted=false,escape=false,last='',out='',removed=0;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){out+=c;if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;last=c;continue;}
    if(c==='"'){quoted=true;out+=c;last=c;continue;}
    if(c===','){
      let j=i+1;while(/[\t\r\n ]/.test(text[j]??'!'))j++;
      if(['}',']'].includes(text[j])&&last&&!['{','[',',',':'].includes(last)){removed++;continue;}
    }
    out+=c;if(!/[\t\r\n ]/.test(c))last=c;
  }
  if(removed)changes.push('trailing-commas:'+removed);
  text=out;
  const facts={version:1,originalSha256:sha(raw),candidateSha256:sha(text),changes,coordinates:'normalized-candidate-utf16',valid:false};
  const fail=(code,position=null)=>{
    const prefix=position===null?null:text.slice(0,position),line=prefix===null?null:prefix.split('\n').length,column=prefix===null?null:position-prefix.lastIndexOf('\n');
    return {spec:null,text,facts:{...facts,code,position,line,column}};
  };
  let spec;try{spec=JSON.parse(text);}catch(error){const match=/position (\d+)/.exec(error.message);return fail('invalid-json',match?Number(match[1]):/end of JSON/i.test(error.message)?text.length:null);}
  if(!spec||typeof spec!=='object'||Array.isArray(spec))return fail('root-not-object',0);
  // JSON.parse accepts duplicate keys silently. Reject them, including escaped
  // spellings of the same key, without leaking key names into public errors.
  const stack=[];
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='{'||c==='['){stack.push(c==='{'?new Set():null);if(stack.length>128)return fail('nesting-limit',i);}
    else if(c==='}'||c===']')stack.pop();
    else if(c==='"'){
      const start=i;while(++i<text.length){if(text[i]==='\\'){i++;continue;}if(text[i]==='"')break;}
      let j=i+1;while(/[\t\r\n ]/.test(text[j]??'!'))j++;
      if(text[j]===':'){
        const key=JSON.parse(text.slice(start,i+1)),keys=stack.at(-1);
        if(keys.has(key))return fail('duplicate-key',start);keys.add(key);
      }
    }
  }
  return {spec,text,facts:{...facts,valid:true,code:'valid'}};
}

// Only the adapter may attach a completed, durably saved answer. Raw content is
// non-enumerable: public job errors/diagnostics never contain generated text.
export class CompletedResponseFormatError extends Error {
  constructor(parsed,provider='DeepSeek'){
    super(provider+' 完整响应格式校验失败 [JSON:'+parsed.facts.code+']'+(parsed.facts.line?` 第 ${parsed.facts.line} 行，第 ${parsed.facts.column} 列`:'')+'；原文已保留，未用于建造');
    this.name='CompletedResponseFormatError';this.parseFacts=parsed.facts;
  }
}
