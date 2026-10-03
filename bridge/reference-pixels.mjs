import {inflateSync, deflateSync} from 'node:zlib';
import {hash} from '../src/generation/compiler.mjs';
import {REFERENCE_LIMITS as limits} from '../contracts/reference-attachments.mjs';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); result.write(type, 4, 'ascii'); data.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, data.length + 8)), data.length + 8); return result;
}
function extent(width, height) {
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= limits.dimension)
      || width * height > limits.pixelsPerImage) throw new Error('Reference pixel quota exceeded');
}
// Re-encode decoded pixels with no EXIF, text, palette, profile or source path.
export function encodeReferencePixels(width, height, rgba) {
  extent(width, height);
  if (!Buffer.isBuffer(rgba) || rgba.length !== width * height * 4) throw new Error('Invalid reference pixels');
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) rgba.copy(rows, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  const bytes = Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(rows, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
  if (bytes.length > limits.bytesPerImage) throw new Error('Normalized reference byte quota exceeded');
  return bytes;
}
function paeth(a, b, c) {
  const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
}
// This transport accepts ONLY the client's decoded RGB/RGBA PNG, not an
// arbitrary source file. JPEG, palette and interlaced source decoding belongs
// to the bounded client normalizer; legacy 512px review validation stays intact.
export function normalizeReferencePng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 45 || bytes.length > limits.bytesPerImage
      || !bytes.subarray(0, 8).equals(signature)) throw new Error('Reference transport is not a bounded PNG');
  let at = 8, width, height, channels, ended = false, seenData = false;
  const compressed = [];
  while (at + 12 <= bytes.length) {
    const n = bytes.readUInt32BE(at), type = bytes.toString('ascii', at + 4, at + 8);
    if (n > bytes.length - at - 12) throw new Error('Truncated reference PNG');
    const data = bytes.subarray(at + 8, at + 8 + n);
    if (crc32(bytes.subarray(at + 4, at + 8 + n)) !== bytes.readUInt32BE(at + 8 + n)) throw new Error('Reference PNG checksum mismatch');
    if (!['IHDR', 'IDAT', 'IEND'].includes(type)) throw new Error('Reference transport must contain pixels only');
    if (at === 8) {
      if (type !== 'IHDR' || n !== 13) throw new Error('Missing reference PNG header');
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); extent(width, height);
      if (data[8] !== 8 || ![2, 6].includes(data[9]) || data[10] || data[11] || data[12]) throw new Error('Reference PNG must be decoded noninterlaced RGB/RGBA');
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === 'IHDR') throw new Error('Repeated reference PNG header');
    if (type === 'IDAT') { compressed.push(data); seenData = true; }
    if (type === 'IEND') {
      if (n !== 0 || at + 12 !== bytes.length || !seenData) throw new Error('Invalid reference PNG end');
      ended = true; break;
    }
    at += n + 12;
  }
  if (!ended) throw new Error('Incomplete reference PNG');
  const packed = Buffer.concat(compressed), stride = width * channels, length = height * (stride + 1);
  const decoded = inflateSync(packed, {maxOutputLength: length + 1, info: true});
  if (decoded.buffer.length !== length || decoded.engine.bytesWritten !== packed.length) throw new Error('Reference PNG pixel stream mismatch');
  const samples = Buffer.alloc(width * height * channels), rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const mode = decoded.buffer[y * (stride + 1)];
    if (mode > 4) throw new Error('Invalid reference PNG row filter');
    for (let x = 0; x < stride; x++) {
      const offset = y * stride + x;
      const a = x >= channels ? samples[offset - channels] : 0, b = y > 0 ? samples[offset - stride] : 0;
      const c = y > 0 && x >= channels ? samples[offset - stride - channels] : 0;
      const prediction = mode === 0 ? 0 : mode === 1 ? a : mode === 2 ? b : mode === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c);
      samples[offset] = (decoded.buffer[y * (stride + 1) + x + 1] + prediction) & 255;
    }
  }
  for (let i = 0; i < width * height; i++) {
    samples.copy(rgba, i * 4, i * channels, i * channels + 3); rgba[i * 4 + 3] = channels === 4 ? samples[i * 4 + 3] : 255;
  }
  const canonical = encodeReferencePixels(width, height, rgba);
  return {bytes: canonical, width, height, pixels: width * height, sha256: hash(canonical)};
}
