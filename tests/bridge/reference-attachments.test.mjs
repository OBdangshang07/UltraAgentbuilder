import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {hash} from '../../src/generation/compiler.mjs';
import {REFERENCE_LIMITS, referenceUpload} from '../../contracts/reference-attachments.mjs';
import {encodeReferencePixels, normalizeReferencePng} from '../../bridge/reference-pixels.mjs';
import {importReferenceSet, readReferenceSet, prepareReferenceModelInput} from '../../bridge/reference-attachments.mjs';
import {validateModelImageFiles} from '../../bridge/native-evidence.mjs';

const rgba=Buffer.from([255,0,0,255,0,255,0,128,0,0,255,255,255,255,255,0]);
const png=encodeReferencePixels(2,2,rgba);
const annotation={purpose:'exterior',view:'front',caption:'正面参考',scale:{dimension:'height',meters:224}};
const upload=(references=[{png:png.toString('base64'),annotation}])=>({format:'UserReferenceUpload',version:1,mode:'reconstruct',references});
async function fixture(t){const parent=await fs.mkdtemp(path.join(os.tmpdir(),'reference-'));t.after(()=>fs.rm(parent,{recursive:true,force:true}));const root=path.join(parent,randomUUID());await fs.mkdir(root);return {parent,root};}
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;}
function chunk(type,data){const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4);data.copy(out,8);out.writeUInt32BE(crc32(out.subarray(4,8+data.length)),8+data.length);return out;}
function customPng(width,height,rows,channels=4){const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=channels===4?6:2;return Buffer.concat([png.subarray(0,8),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);}
function args(root,set){const requestHash='a'.repeat(64),provider='codex',model='gpt-6.1-sol';return {directory:root,setHash:set.setHash,requestHash,provider,model,capability:{id:model,supportsImages:true},confirmation:{format:'ReferenceSendConfirmation',version:1,ownerId:path.basename(root),requestHash,setHash:set.setHash,provider,model,accepted:true}};}

test('canonical reference pixels are deterministic and are not 512px legacy evidence',()=>{
  const result=normalizeReferencePng(png);assert.deepEqual(result.bytes,png);assert.equal(result.sha256,hash(png));assert.equal(result.width,2);assert.equal(result.height,2);
});
test('RGB imports normalize to identical opaque RGBA pixels',()=>{
  const rgb=customPng(1,1,Buffer.from([0,14,27,39]),3);assert.deepEqual(normalizeReferencePng(rgb).bytes,encodeReferencePixels(1,1,Buffer.from([14,27,39,255])));
});
for(const mode of [0,1,2,3,4])test(`PNG filter ${mode} reconstructs exact pixels`,()=>{
  const stride=8,rows=Buffer.alloc(18);
  for(let y=0;y<2;y++){rows[y*9]=mode;for(let x=0;x<stride;x++){const at=y*stride+x,a=x>=4?rgba[at-4]:0,b=y?rgba[at-stride]:0,c=y&&x>=4?rgba[at-stride-4]:0,p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c),predict=mode===0?0:mode===1?a:mode===2?b:mode===3?Math.floor((a+b)/2):da<=db&&da<=dc?a:db<=dc?b:c;rows[y*9+x+1]=(rgba[at]-predict)&255;}}
  assert.deepEqual(normalizeReferencePng(customPng(2,2,rows)).bytes,png);
});
test('metadata, animation, bad checksum, trailing bytes and truncated PNG are rejected',()=>{
  for(const type of ['tEXt','eXIf','acTL','iCCP'])assert.throws(()=>normalizeReferencePng(Buffer.concat([png.subarray(0,33),chunk(type,Buffer.from('private source metadata')),png.subarray(33)])),/pixels only/);
  const corrupt=Buffer.from(png);corrupt[30]^=1;assert.throws(()=>normalizeReferencePng(corrupt),/checksum/);
  assert.throws(()=>normalizeReferencePng(Buffer.concat([png,Buffer.from([0])])),/end/);assert.throws(()=>normalizeReferencePng(png.subarray(0,png.length-1)),/Incomplete/);
});
test('pixel quotas reject oversized declarations before decompression',()=>{
  assert.throws(()=>normalizeReferencePng(customPng(REFERENCE_LIMITS.dimension+1,1,Buffer.from([0]))),/quota/);
  assert.throws(()=>normalizeReferencePng(customPng(1,1,Buffer.from([0,1,2,3,4,5]))),/stream mismatch/);
  assert.throws(()=>normalizeReferencePng(customPng(1,1,Buffer.from([5,1,2,3,4]))),/row filter/);
  assert.throws(()=>normalizeReferencePng(customPng(1,1,Buffer.alloc(65536))),/larger|Output|size|length/i);
});
test('upload accepts pixels and annotations, not files, URLs, accounts or write permissions',()=>{
  for(const value of [{...upload(),file:'C:/private.jpg'},{...upload(),url:'https://example.com/a.png'},{...upload(),canAuthorizePlacement:true},{...upload(),provider:'codex'},upload([{...upload().references[0],path:'../secret.png'}])])assert.throws(()=>referenceUpload(value),/fields/);
  for(const annotation of [{purpose:'exterior',view:'front',caption:'x',tool:'read_file'},{purpose:'exterior',view:'front',caption:'x\0'},{purpose:'exterior',view:'front',caption:'x',scale:{dimension:'height',meters:-1}}])assert.throws(()=>referenceUpload(upload([{png:png.toString('base64'),annotation}])));
  assert.throws(()=>referenceUpload(upload(Array.from({length:5},()=>upload().references[0]))));
});
test('a complete immutable import rereads identically and strips transport identity variation',async t=>{
  const {root}=await fixture(t),manifest=await importReferenceSet(root,upload());assert.deepEqual(await importReferenceSet(root,upload()),manifest);
  const result=await readReferenceSet(root,manifest.setHash);assert.equal(result.images.length,1);assert.equal(manifest.ownerId,path.basename(root));assert.equal(manifest.canAuthorizePlacement,false);assert.equal(manifest.untrustedData,true);
  assert.deepEqual(await fs.readFile(result.images[0]),png);assert.ok(!JSON.stringify(manifest).includes(root));
});
test('changing captions or pixel versions creates a new set without overwriting old evidence',async t=>{
  const {root}=await fixture(t),first=await importReferenceSet(root,upload()),second=await importReferenceSet(root,upload([{png:png.toString('base64'),annotation:{...annotation,caption:'侧面待核对'}}]));
  assert.notEqual(first.setHash,second.setHash);assert.deepEqual((await readReferenceSet(root,first.setHash)).manifest,first);
});
test('references remain separate from original four-view/native asset review',async t=>{
  const {root}=await fixture(t),set=await importReferenceSet(root,upload()),read=await readReferenceSet(root,set.setHash);
  await assert.rejects(validateModelImageFiles(read.images,root),/four isolated|four|Four|Only isolated|Exactly/);
});
test('single/multiple references require exact current request and advertised image capability',async t=>{
  const {root}=await fixture(t),set=await importReferenceSet(root,upload([upload().references[0],{png:png.toString('base64'),annotation:{...annotation,view:'side'}}])),input=args(root,set);
  const result=await prepareReferenceModelInput(input);assert.equal(result.images.length,2);assert.equal(result.additionalModelCalls,0);assert.equal(result.canAuthorizePlacement,false);assert.match(result.rules,/untrusted/);
  for(const key of ['requestHash','setHash','ownerId','provider','model'])await assert.rejects(prepareReferenceModelInput({...input,confirmation:{...input.confirmation,[key]:key==='ownerId'?randomUUID():key==='provider'?'claude-code':key==='model'?'different-model':'b'.repeat(64)}}));
  await assert.rejects(prepareReferenceModelInput({...input,confirmation:{...input.confirmation,accepted:false}}));
  for(const capability of [{id:input.model},{id:input.model,supportsImages:false},{id:'wrong-model',supportsImages:true}])await assert.rejects(prepareReferenceModelInput({...input,capability}));
});
test('another task cannot adopt an imported reference set',async t=>{
  const {parent,root}=await fixture(t),set=await importReferenceSet(root,upload()),other=path.join(parent,randomUUID());await fs.mkdir(other);
  await fs.cp(path.join(root,'reference-sets'),path.join(other,'reference-sets'),{recursive:true});await assert.rejects(readReferenceSet(other,set.setHash));
});
test('changed pixel bytes, traversal IDs and incomplete imports never become model inputs',async t=>{
  const {root}=await fixture(t),set=await importReferenceSet(root,upload()),read=await readReferenceSet(root,set.setHash);
  const changed=Buffer.from(png);changed[changed.length-1]^=1;await fs.writeFile(read.images[0],changed);await assert.rejects(prepareReferenceModelInput(args(root,set)));
  for(const id of ['../manifest','https://example.com/image','C:/image.png'])await assert.rejects(readReferenceSet(root,id));
  const incomplete='c'.repeat(64);await fs.mkdir(path.join(root,'reference-sets',incomplete));await fs.writeFile(path.join(root,'reference-sets',incomplete,'image-0.png'),png);await assert.rejects(readReferenceSet(root,incomplete));
});
test('reference quota rejection leaves no committed reference set',async t=>{
  const {root}=await fixture(t),large=encodeReferencePixels(2048,2048,Buffer.alloc(2048*2048*4));
  await assert.rejects(importReferenceSet(root,upload(Array.from({length:4},()=>({png:large.toString('base64'),annotation})))),/set quota/);
  assert.deepEqual(await fs.readdir(root),[]);
});
test('linked reference set directories cannot read outside the owning task',async t=>{
  const {parent,root}=await fixture(t),set=await importReferenceSet(root,upload()),other=path.join(parent,randomUUID());await fs.mkdir(other);
  await fs.symlink(path.join(root,'reference-sets'),path.join(other,'reference-sets'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(readReferenceSet(other,set.setHash),/link|symbolic|false/i);
});
test('even rehashed manifests cannot add paths, scopes or extra tools',async t=>{
  const {root}=await fixture(t),set=await importReferenceSet(root,upload());
  const {setHash,...content}=set;content.writeScope={allWorld:true};const forgedHash=hash(content),folder=path.join(root,'reference-sets',forgedHash);await fs.mkdir(folder);await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify({...content,setHash:forgedHash}));
  await assert.rejects(readReferenceSet(root,forgedHash),/Unknown reference manifest fields/);
});
