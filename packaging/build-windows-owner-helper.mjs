import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {ownerRuntimeSource,readOwnerRuntimeBytes,readWindowsOwnerRuntime,WINDOWS_OWNER_HELPER_FILES} from '../bridge/windows-owner-runtime.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
async function compilerBytes(file){
 // Windows servicing legitimately hardlinks its framework compiler. Only
 // this fixed read-only OS input permits that; generated/source runtime
 // files still require one link and exact bytes through the shared reader.
 const before=await fs.lstat(file);
 if(!before.isFile()||before.isSymbolicLink()||before.size<1||before.size>16*1024*1024||await fs.realpath(file)!==file)throw Error('Invalid Windows framework compiler');
 const bytes=await fs.readFile(file),after=await fs.lstat(file);
 if(bytes.length!==before.size||after.size!==before.size||after.dev!==before.dev||after.ino!==before.ino||after.mtimeMs!==before.mtimeMs)throw Error('Framework compiler changed during read');
 return bytes;
}
// Explicit developer/packaging operation only. Runtime observation NEVER calls
// a compiler, repairs a partial cache, retries a query or upgrades a task.
export async function buildWindowsOwnerHelper({project}={}){
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('Windows x64 owner helper build required');
 const source=await ownerRuntimeSource(project),parent=path.join(source.project,'build/windows-owner-helpers');
 await fs.mkdir(parent,{recursive:true});if(await fs.realpath(parent)!==parent)throw Error('Redirected owner helper build directory');
 const directory=path.join(parent,source.sourceHash);
 try{await fs.lstat(directory);return readWindowsOwnerRuntime(directory,source.sourceHash);}catch(error){if(error.code!=='ENOENT')throw error;}
 // SystemRoot may spell the same Windows directory with a different case.
 // Resolve this OS input before comparison; never canonicalize a generated
 // source/output path to excuse a redirect.
 const framework=await fs.realpath(path.join(process.env.SystemRoot??'C:/Windows','Microsoft.NET/Framework64/v4.0.30319'));
 const compiler=path.join(framework,'csc.exe'),compilerHash=sha(await compilerBytes(compiler));
 try{await fs.mkdir(directory);}catch(error){if(error.code!=='EEXIST')throw error;return readWindowsOwnerRuntime(directory,source.sourceHash);}
 const executable=path.join(directory,WINDOWS_OWNER_HELPER_FILES.executable),temp=path.join(directory,'tmp');await fs.mkdir(temp);
 const env={...process.env,TEMP:temp,TMP:temp,TMPDIR:temp};
 for(const key of Object.keys(env))if(/^(?:CODEX_|OPENAI|ANTHROPIC|DEEPSEEK|DSH_|GH_TOKEN$|GITHUB_TOKEN$)/i.test(key))delete env[key];
 const log=await fs.open(path.join(directory,'compiler.log'),'wx');let error=null,timedOut=false;
 const child=spawn(compiler,['/nologo','/target:exe','/platform:x64','/optimize+','/debug-','/out:'+executable,'/reference:'+path.join(framework,'System.Management.dll'),source.file],
  {cwd:directory,env,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
 const timer=setTimeout(()=>{timedOut=true;child.kill();},120000);timer.unref();
 const exit=await new Promise(resolve=>{child.once('error',value=>error=value.code??'OTHER');child.once('close',(code,signal)=>resolve({code,signal}));});
 clearTimeout(timer);await log.close();
 await fs.writeFile(path.join(directory,'compile-exit.json'),JSON.stringify({...exit,error,timedOut,originalHelperClosed:true}),{flag:'wx'});
 if(error||timedOut||exit.code!==0||exit.signal!==null)throw Error('Windows owner helper compilation failed; original partial build preserved');
 if(sha(await readOwnerRuntimeBytes(source.file,65536))!==source.sourceHash||sha(await compilerBytes(compiler))!==compilerHash)throw Error('Owner helper source/compiler changed during build');
 const bytes=await readOwnerRuntimeBytes(executable,4*1024*1024);
 const manifest={format:'WindowsOwnerHelperBuild',version:1,platform:'windows-x64-netfx4',sourceHash:source.sourceHash,helperHash:sha(bytes),helperBytes:bytes.length,compilerHash};
 await fs.writeFile(path.join(directory,WINDOWS_OWNER_HELPER_FILES.manifest),JSON.stringify(manifest),{flag:'wx'});
 return readWindowsOwnerRuntime(directory,source.sourceHash);
}
