import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {rendererLifecycle} from './quality-renderer-lifecycle.mjs';

/** Visible, project-isolated asset-only client. Never submits model requests. */
export async function startNativeRenderer(project,root,bridge,{startupTimeoutMs=180000}={}){
 if(path.dirname(root)!==path.join(project,'build')||!/^quality-native-[a-f0-9]{32}$/.test(path.basename(root)))throw Error('Invalid isolated renderer root');
 const instanceId=randomUUID();
 await fs.writeFile(path.join(root,'renderer-authorization.json'),JSON.stringify({instanceId,assetOnly:true,visibleWindowAuthorized:true,bridgePid:bridge.connection.pid}),{flag:'wx'});
 const log=await fs.open(path.join(root,'client.log'),'wx');
 const temporary=path.join(root,'tmp');await fs.mkdir(temporary);
 let env={...process.env,TEMP:temporary,TMP:temporary,TMPDIR:temporary,JDK_JAVA_OPTIONS:[process.env.JDK_JAVA_OPTIONS??'','-Djdk.net.unixdomain.tmpdir='+path.join(project,'build/quality-java-tmp').replaceAll('\\','/'),'-Djava.io.tmpdir='+temporary.replaceAll('\\','/')].join(' ').trim()};
 const sourceFork=/^p3-selection-development-[a-f0-9]{32}$/.test(path.basename(project));
 if(sourceFork){
  const copy=JSON.parse(await fs.readFile(path.join(project,'development-workspace.json'),'utf8'));
  if(copy.root!==project||copy.result!=='passed'||copy.developmentOnly!==true||copy.worldsCopied!==false||copy.accountDataCopied!==false)throw Error('Invalid source-fork renderer identity');
  if(await fs.realpath(project)!==project||await fs.realpath(copy.gradleUserHome)!==copy.gradleUserHome)throw Error('Renderer cannot follow a redirected development cache');
  const profile=path.join(root,'java-profile');await fs.mkdir(profile);
  env={...env,GRADLE_USER_HOME:copy.gradleUserHome,APPDATA:path.join(profile,'AppData/Roaming'),LOCALAPPDATA:path.join(profile,'AppData/Local'),JDK_JAVA_OPTIONS:env.JDK_JAVA_OPTIONS+' -Duser.home='+profile.replaceAll('\\','/')};
  await fs.mkdir(env.APPDATA,{recursive:true});await fs.mkdir(env.LOCALAPPDATA,{recursive:true});
 }
 const child=spawn('cmd.exe',['/d','/c','gradlew.bat',...(sourceFork?['--offline']:[]),'--no-daemon','runClient','-PstudioEvidenceTestRoot='+root],{cwd:path.join(project,'mod'),windowsHide:true,env,stdio:['ignore',log.fd,log.fd]});
 const control=async value=>{const file=path.join(root,'renderer-control.json'),tmp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(value),{flag:'wx'});await fs.rename(tmp,file);};
 const lifecycle=rendererLifecycle({child,root,closeLog:()=>log.close(),sendStop:()=>control({stop:true}),
  readFailure:async()=>{try{return await fs.readFile(path.join(root,'renderer-failure.json'),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;return null;}},
  readReceipt:async()=>JSON.parse(await fs.readFile(path.join(root,'renderer-result.json'),'utf8')),
  readProcessIdentity:async()=>{
   const identity=JSON.parse(await fs.readFile(path.join(root,'renderer-process.json'),'utf8'));
   if(identity.instanceId!==instanceId||!Number.isSafeInteger(identity.pid)||identity.pid<1||!Number.isSafeInteger(identity.startedAt)||identity.startedAt<1)throw Error('Invalid renderer process identity');
   return identity;
  },
  isProcessAlive:pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}},
  saveOutcome:outcome=>fs.writeFile(path.join(root,'renderer-exit.json'),JSON.stringify(outcome,null,2),{flag:'wx'})});
 try{
  const deadline=Date.now()+startupTimeoutMs;
  for(;;){await lifecycle.check();try{const ready=JSON.parse(await fs.readFile(path.join(root,'renderer-ready.json'),'utf8'));if(ready.ready&&ready.assetOnly&&ready.visible)break;throw Error('Invalid renderer readiness');}catch(e){if(e.code!=='ENOENT')throw e;}if(Date.now()>deadline)throw Error('Renderer startup timed out');await delay(1000);}
 }catch(e){e.rendererOutcome=await lifecycle.settle();throw e;}
 return {...lifecycle,observe:id=>control({jobId:id})};
}
