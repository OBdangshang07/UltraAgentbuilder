import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Windows app-container aliases need not be resolved by the module loader the
// same way as fs.realpath. Compare both real files, never one real and one
// logical spelling, a basename or a caller's assertion. This controls CLI
// startup only: it creates no model, retry, data-store or world authority.
export async function isDirectEntrypoint(argument,moduleUrl,realpath=fs.realpath){
  if(typeof argument!=='string'||!argument)return false;
  let modulePath;try{modulePath=fileURLToPath(moduleUrl);}catch{return false;}
  try{
    const original=await realpath(path.resolve(argument)),own=await realpath(modulePath);
    return typeof original==='string'&&typeof own==='string'&&original===own;
  }catch{return false;}
}
