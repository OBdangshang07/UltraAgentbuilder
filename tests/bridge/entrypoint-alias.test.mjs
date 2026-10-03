import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import {setTimeout as delay} from 'node:timers/promises';

test('Bridge starts through a project junction/alias and shuts down without any model invocation',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-entrypoint-')),alias=path.join(root,'中文 alias'),data=path.join(root,'data');
 await fs.symlink(fileURLToPath(new URL('../../',import.meta.url)),alias,process.platform==='win32'?'junction':'dir');
 const child=spawn(process.execPath,[path.join(alias,'bridge/server.mjs'),'--data-dir',data],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let stderr='',ended=false;const exited=new Promise(resolve=>child.once('exit',code=>{ended=true;resolve(code);}));child.stderr.on('data',b=>stderr+=b);
 try{
  let connection;for(let i=0;i<100;i++){if(ended)throw Error('Bridge exited through alias: '+stderr);try{connection=JSON.parse(await fs.readFile(path.join(data,'connection.json'),'utf8'));break;}catch(e){if(e.code!=='ENOENT')throw e;}await delay(50);}
  assert.ok(connection,'Alias CLI did not start');assert.equal(connection.pid,child.pid);
  const base='http://127.0.0.1:'+connection.port,headers={Authorization:'Bearer '+connection.token};
  const health=await (await fetch(base+'/v1/health',{headers})).json();assert.equal(health.protocol,1);
  const jobs=await (await fetch(base+'/v1/jobs',{headers})).json();assert.deepEqual(jobs.jobs,[]);
 }finally{if(!ended)child.kill('SIGTERM');await exited;}
});
