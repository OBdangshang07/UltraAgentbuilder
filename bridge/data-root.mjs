import fs from 'node:fs/promises';
import path from 'node:path';

async function directory(file,create=false){
  if(create)try{await fs.mkdir(file,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const stat=await fs.lstat(file,{bigint:true});
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Bridge data directory link/type rejected; original files preserved');
  return stat;
}
async function ancestors(file,create){
  let current=path.parse(file).root;await directory(current);
  for(const segment of path.relative(current,file).split(path.sep).filter(Boolean)){
    current=path.join(current,segment);await directory(current,create);
  }
}
// Normalize only the spelling of the explicitly selected data directory.
// Windows app containers and 8.3 names can resolve elsewhere without a link.
// Verify all ancestors on both sides and the same native file identity. Never
// move private data, follow a junction, adopt another store or change a job.
export async function resolveBridgeDataRoot(input){
  if(typeof input!=='string'||!input)throw Error('dataDir is required');
  const requested=path.resolve(input);await ancestors(requested,true);
  const original=await directory(requested),canonical=await fs.realpath(requested);
  await ancestors(canonical,false);const resolved=await directory(canonical);
  if(original.dev!==resolved.dev||original.ino!==resolved.ino||await fs.realpath(canonical)!==canonical)throw Error('Bridge data directory identity changed; original files preserved');
  return canonical;
}
