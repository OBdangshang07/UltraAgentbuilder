import {deflateSync} from 'node:zlib';
import {NATIVE_RENDERER} from '../../bridge/native-evidence.mjs';
// Synthetic transport pixels, never counted as native rendering/visual quality.
export function fixturePng(){
 const crc=b=>{let c=0xffffffff;for(const x of b){c^=x;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return (c^0xffffffff)>>>0;};
 const chunk=(name,b)=>{const type=Buffer.from(name),n=Buffer.alloc(4),check=Buffer.alloc(4);n.writeUInt32BE(b.length);check.writeUInt32BE(crc(Buffer.concat([type,b])));return Buffer.concat([n,type,b,check]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(512);header.writeUInt32BE(512,4);header[8]=8;header[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(512*(512*4+1)))),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
export const fixtureUpload=request=>({requestHash:request.requestHash,renderer:NATIVE_RENDERER,views:request.views.map(v=>({id:v.id,png:fixturePng(),faces:1,draws:1}))});
