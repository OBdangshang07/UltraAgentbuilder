import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

// Developer fixtures use the locked independent NBT reader. Fail BEFORE a
// long regression when a fresh checkout has not installed dependencies. This
// neither installs packages nor changes the self-contained player companion.
try {await import('prismarine-nbt');}
catch(error) {throw new Error('Studio test dependencies unavailable: run npm ci --ignore-scripts before regression. No tests or model calls started.',{cause:error});}

// Hundreds of native-bundle tests must not accumulate on the system drive.
// Each run owns a new workspace-local temp root; failed evidence is retained.
const project=await fs.realpath(fileURLToPath(new URL('../',import.meta.url)));
const parent=path.join(project,'build','studio-tests');await fs.mkdir(parent,{recursive:true});
if(await fs.realpath(parent)!==parent)throw new Error('Test output parent must not redirect outside the workspace');
const run=await fs.mkdtemp(path.join(parent,'run-')),temp=path.join(run,'tmp');await fs.mkdir(temp);
const startedAt=new Date().toISOString();console.log('Isolated test TEMP: '+temp);
const args=process.argv.slice(2),only=args.indexOf('--only');
const options=only<0?args:args.slice(0,only);
const testFiles=only<0?['tests/generation/*.test.mjs','tests/bridge/*.test.mjs','tests/design/*.test.mjs']:args.slice(only+1);
if(only>=0){
 if(!testFiles.length||testFiles.some(file=>!/^tests\/(?:generation|bridge|design)\/[A-Za-z0-9_.-]+\.test\.mjs$/.test(file)))throw new Error('Explicit bounded Studio test files required');
 for(const file of testFiles){const full=path.join(project,file);if(await fs.realpath(full)!==full||(await fs.lstat(full)).isSymbolicLink())throw new Error('Targeted test path redirect rejected');}
}
const outcome=await new Promise(resolve=>{
 const child=spawn(process.execPath,['--test',...options,...testFiles],{cwd:project,env:{...process.env,TEMP:temp,TMP:temp,TMPDIR:temp},windowsHide:true,stdio:'inherit'});
 child.once('error',error=>resolve({exitCode:1,error:error.message}));child.once('exit',(code,signal)=>resolve({exitCode:code??1,signal}));
});
let temporaryDataRemoved=false;
if(outcome.exitCode===0){
 // Verify the precise, newly-created target before recursive cleanup. Never
 // remove a caller-provided directory or the workspace/build parent itself.
 const resolved=await fs.realpath(temp);
 if(resolved!==temp||path.dirname(resolved)!==run||path.dirname(run)!==parent)throw new Error('Unexpected test cleanup target');
 await fs.rm(resolved,{recursive:true,force:false,maxRetries:3,retryDelay:100});temporaryDataRemoved=true;
}
const report=path.join(run,'report.json');await fs.writeFile(report,JSON.stringify({type:only<0?'workspace-isolated-studio-regression':'workspace-isolated-targeted-studio-regression',scope:only<0?'full':'targeted',testFiles,startedAt,finishedAt:new Date().toISOString(),...outcome,temp,temporaryDataRemoved,failedEvidenceRetained:outcome.exitCode!==0,systemTempUsed:false},null,2),{flag:'wx'});
console.log('Studio regression receipt: '+report);process.exitCode=outcome.exitCode;
