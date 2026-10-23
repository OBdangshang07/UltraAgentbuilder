import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const projectRoot=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
export const WINDOWS_OWNER_HELPER_FILES=Object.freeze({executable:'windows-owner-helper.exe',manifest:'windows-owner-helper.json'});
const sha=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const keys=['format','version','platform','sourceHash','helperHash','helperBytes','compilerHash'];
export async function readOwnerRuntimeBytes(file,limit){
 const before=await fs.lstat(file);
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size<1||before.size>limit||await fs.realpath(file)!==file)throw Error('Invalid Windows owner runtime file');
 const bytes=await fs.readFile(file),after=await fs.lstat(file);
 if(bytes.length!==before.size||after.size!==before.size||after.dev!==before.dev||after.ino!==before.ino||after.mtimeMs!==before.mtimeMs)throw Error('Windows owner runtime changed during read');
 return bytes;
}
export async function ownerRuntimeSource(project=projectRoot){
 project=path.resolve(project);
 const file=path.join(project,'bridge/windows-owner-observation.cs'),bytes=await readOwnerRuntimeBytes(file,65536);
 return {project,file,bytes,sourceHash:sha(bytes)};
}
export async function readWindowsOwnerRuntime(directory,sourceHash){
 directory=path.resolve(directory);if(await fs.realpath(directory)!==directory||!(await fs.lstat(directory)).isDirectory())throw Error('Redirected Windows owner runtime');
 const manifestFile=path.join(directory,WINDOWS_OWNER_HELPER_FILES.manifest),executable=path.join(directory,WINDOWS_OWNER_HELPER_FILES.executable);
 const manifest=JSON.parse(await readOwnerRuntimeBytes(manifestFile,4096));
 if(!manifest||Object.keys(manifest).sort().join(',')!==[...keys].sort().join(',')||manifest.format!=='WindowsOwnerHelperBuild'||manifest.version!==1
  ||manifest.platform!=='windows-x64-netfx4'||!digest(sourceHash)||manifest.sourceHash!==sourceHash||!digest(manifest.helperHash)||!digest(manifest.compilerHash)
  ||!Number.isSafeInteger(manifest.helperBytes)||manifest.helperBytes<1||manifest.helperBytes>4*1024*1024)throw Error('Invalid Windows owner runtime manifest');
 const bytes=await readOwnerRuntimeBytes(executable,4*1024*1024);
 if(bytes.length!==manifest.helperBytes||sha(bytes)!==manifest.helperHash)throw Error('Windows owner runtime hash mismatch');
 return {executable,manifest,manifestFile};
}
async function exists(file){try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
export async function resolveWindowsOwnerRuntime({project=projectRoot}={}){
 const source=await ownerRuntimeSource(project),bundled=path.join(source.project,'runtime');
 // A packaged companion MUST use its pinned helper. Missing/tampered bundle
 // members cannot silently fall back to another query or a different helper.
 if(await exists(path.join(source.project,'bundle-manifest.json'))||await exists(path.join(source.project,'manifest.json'))||await exists(path.join(bundled,WINDOWS_OWNER_HELPER_FILES.manifest))||await exists(path.join(bundled,WINDOWS_OWNER_HELPER_FILES.executable)))
  return {...await readWindowsOwnerRuntime(bundled,source.sourceHash),kind:'bundled'};
 const development=path.join(source.project,'build/windows-owner-helpers',source.sourceHash);
 if(await exists(development))return {...await readWindowsOwnerRuntime(development,source.sourceHash),kind:'development'};
 // Unprepared source checkouts retain the previous PowerShell path. This is
 // chosen BEFORE any query, never after a helper failed or an outcome is unknown.
 return null;
}
