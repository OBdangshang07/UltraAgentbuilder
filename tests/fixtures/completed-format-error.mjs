import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../../src/generation/compiler.mjs';

// Offline adapters only. Caller supplies the runtime's own Error class/parser
// so the packaged runtime is checked, not accidentally the workspace class.
export async function completedFormatError(cwd,ErrorType,parse,raw='{"title":"离线格式错误", "broken":}',provider='deepseek'){
 const parsed=parse(raw),error=new ErrorType(parsed,provider),dir=await fs.mkdtemp(path.join(cwd,provider+'-response-'));
 await fs.writeFile(path.join(dir,'answer-1.txt'),raw,{flag:'wx'});
 await fs.writeFile(path.join(dir,'candidate.txt'),parsed.text,{flag:'wx'});
 await fs.writeFile(path.join(dir,'json-validation.json'),JSON.stringify(parsed.facts),{flag:'wx'});
 error.diagnostic={provider,reason:'completed',failureKind:'answer-json',receivedTextSha256:hash(raw),receivedTextBytes:Buffer.byteLength(raw),usage:{totalTokens:17},automaticRetries:0,json:parsed.facts,responseEvidence:{directory:path.basename(dir),file:'answer-1.txt',persisted:true}};
 await fs.writeFile(path.join(dir,'receipt.json'),JSON.stringify(error.diagnostic),{flag:'wx'});
 Object.defineProperty(error,'responseText',{value:raw});return error;
}
