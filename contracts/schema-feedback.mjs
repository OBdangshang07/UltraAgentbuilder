// Read-only diagnostics for our checked-in JSON schemas, never remote schemas.
// Bound work independently of provider output tokens. Never coerce model data.
import {isDeepStrictEqual} from 'node:util';
export function schemaFeedback(value,root,{maxIssues=128,maxChecks=100000}={}){
  let checks=0,exhausted=false;
  const issues=[];
  const walk=(v,s,p,out,depth=0)=>{
    if(++checks>maxChecks||depth>128){exhausted=true;return;}
    const issue=(code,details={})=>{if(out.length<maxIssues+1)out.push({path:p,code,...details});};
    if(!s){issue('unknown-schema-reference');return;}
    if(s.$ref)return walk(v,root.$defs?.[s.$ref.split('/').at(-1)],p,out,depth+1);
    if(s.anyOf){
      const selected=s.anyOf.find(o=>o.properties?.kind?.enum?.includes(v?.kind))
        ??s.anyOf.find(o=>o.properties?.mode?.enum?.includes(v?.mode));
      if(selected)return walk(v,selected,p,out,depth+1);
      let best=null;
      for(const option of s.anyOf){const candidate=[];walk(v,option,p,candidate,depth+1);if(!candidate.length)return;if(!best||candidate.length<best.length)best=candidate;}
      for(const e of best??[])if(out.length<maxIssues+1)out.push(e);return;
    }
    const type=v===null?'null':Array.isArray(v)?'array':typeof v,types=Array.isArray(s.type)?s.type:[s.type];
    if(!types.includes(type)&&!(type==='number'&&types.includes('integer')&&Number.isSafeInteger(v))){issue('type',{expected:types});return;}
    if(s.enum&&!s.enum.some(option=>isDeepStrictEqual(option,v)))issue('enum',{allowed:s.enum});
    if(type==='number'&&(!Number.isFinite(v)||v<(s.minimum??-Infinity)||v>(s.maximum??Infinity)))issue('range',{minimum:s.minimum,maximum:s.maximum});
    if(type==='string'){
      if(v.length<(s.minLength??0)||v.length>(s.maxLength??4096))issue('string-length',{minimum:s.minLength??0,maximum:s.maxLength??4096});
      if(s.pattern&&!new RegExp(s.pattern).test(v))issue('pattern',{pattern:s.pattern});
    }
    if(type==='array'){
      if(v.length<(s.minItems??0)||v.length>(s.maxItems??256))issue('array-length',{minimum:s.minItems??0,maximum:s.maxItems??256});
      for(let i=0;i<v.length&&!exhausted;i++)walk(v[i],s.items,p+'['+i+']',out,depth+1);
    }
    if(type==='object'){
      for(const k of Object.keys(v))if(!Object.hasOwn(s.properties??{},k))issue('unknown-field',{field:k,allowed:Object.keys(s.properties??{})});
      for(const k of s.required??[])if(!Object.hasOwn(v,k))issue('missing-field',{field:k});
      for(const [k,x] of Object.entries(v))if(Object.hasOwn(s.properties??{},k)&&!exhausted)walk(x,s.properties[k],p+'.'+k,out,depth+1);
    }
  };
  const serialized=JSON.stringify(value);
  if(serialized===undefined)return {valid:false,issues:[{path:'$',code:'missing-value'}],checksComplete:true,truncated:false};
  if(Buffer.byteLength(serialized)>1200000)return {valid:false,issues:[{path:'$',code:'data-byte-quota'}],checksComplete:false,truncated:false};
  walk(value,root,'$',issues);
  return {valid:!issues.length&&!exhausted,issues:issues.slice(0,maxIssues),checksComplete:!exhausted,truncated:issues.length>maxIssues,checks};
}
