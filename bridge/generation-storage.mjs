import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// A pre-dispatch safety reserve, not a token limit, disk reservation, account
// migration or watchdog for an existing turn. No credentials/files are read.
export const generationStorageReserveBytes=1024n**3n;
const roles={provider:'Codex 持久会话',sqlite:'Codex 状态数据库',evidence:'建筑成果与调用回执'};
const safeCodes=new Set(['EPERM','EACCES','EBUSY','ENOENT','ENOSPC','EIO']);
function unavailable(role,code='EIO',low=false){
  const error=new Error(low?`${roles[role]}所在盘不足 1 GiB 安全余量；没有提交模型，不会自动重发。`
    :`无法核验${roles[role]}所在盘的可用空间；没有提交模型，不会自动重发。`);
  error.code=safeCodes.has(code)?code:'EIO';return error;
}
function directory(value,role,base){
  if(typeof value!=='string'||!value||value.includes('\0'))throw unavailable(role);
  return path.resolve(base,value);
}
export async function assertCodexStorageReserve(cwd,{env=process.env,home=os.homedir(),base=process.cwd(),
  inspectSqlite=false,sqliteHome,realpath=fs.realpath,statfs=fs.statfs}={}){
  const provider=directory(env.CODEX_HOME||path.join(home,'.codex'),'provider',base);
  const targets=[['provider',provider],['evidence',directory(cwd,'evidence',base)]];
  if(inspectSqlite){
    // Effective config wins over environment. A relative effective config
    // cannot be assigned to an unknown config-layer base; refuse, don't guess.
    if(sqliteHome!=null&&(typeof sqliteHome!=='string'||!path.isAbsolute(sqliteHome)))throw unavailable('sqlite');
    targets.push(['sqlite',directory(sqliteHome??(env.CODEX_SQLITE_HOME||provider),'sqlite',base)]);
  }
  const checked=[];
  for(const [role,target] of targets){
    let available;
    try{
      const physical=await realpath(target),space=await statfs(physical,{bigint:true});
      if(typeof space.bavail!=='bigint'||typeof space.bsize!=='bigint'||space.bavail<0n||space.bsize<=0n)throw unavailable(role);
      available=space.bavail*space.bsize;
    }catch(error){throw unavailable(role,error?.code);}
    if(available<generationStorageReserveBytes)throw unavailable(role,'ENOSPC',true);
    // Never expose profile paths or account/configuration contents.
    checked.push({role,availableBytes:available.toString(),requiredBytes:generationStorageReserveBytes.toString()});
  }
  return checked;
}
