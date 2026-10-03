import path from 'node:path';
import os from 'node:os';

// Bounded known locations only: never recursively scan disks, execute wrapper scripts or read credentials.
export function agentDirectories(env=process.env,executable=process.execPath){
  const home=env.USERPROFILE??os.homedir();
  const values=[...(env.PATH??'').split(path.delimiter),path.dirname(executable),env.NVM_SYMLINK,
    env.APPDATA&&path.join(env.APPDATA,'npm'),env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'Programs/nodejs'),
    env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'Microsoft/WinGet/Links'),
    env.ProgramFiles&&path.join(env.ProgramFiles,'nodejs'),path.join(home,'.local/bin'),path.join(home,'scoop/shims')];
  const seen=new Set();return values.filter(Boolean).map(s=>s.trim().replace(/^"(.*)"$/,'$1')).filter(s=>{
    if(!path.isAbsolute(s))return false;const id=path.normalize(s).toLowerCase();if(seen.has(id))return false;seen.add(id);return true;
  }).slice(0,128);
}
