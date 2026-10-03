import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { AsyncByteReader } from './stream-reader.mjs';
import { hashFile } from './hash.mjs';
import { validateBlockState, validateDimensions } from './asset-schema.mjs';

const TAG = { end: 0, byte: 1, short: 2, int: 3, long: 4, float: 5, double: 6, byteArray: 7, string: 8, list: 9, compound: 10, intArray: 11, longArray: 12 };

async function skipPayload(reader, type) {
  switch (type) {
    case TAG.byte: await reader.skip(1); break;
    case TAG.short: await reader.skip(2); break;
    case TAG.int: await reader.skip(4); break;
    case TAG.long: await reader.skip(8); break;
    case TAG.float: await reader.skip(4); break;
    case TAG.double: await reader.skip(8); break;
    case TAG.byteArray: {
      const length = await reader.readInt32();
      if (length < 0) throw new Error(`Negative NBT byte-array length: ${length}`);
      await reader.skip(length);
      break;
    }
    case TAG.string: await reader.readString(); break;
    case TAG.list: {
      const elementType = await reader.readByte();
      const length = await reader.readInt32();
      if (length < 0) throw new Error(`Negative NBT list length: ${length}`);
      for (let i = 0; i < length; i++) await skipPayload(reader, elementType);
      break;
    }
    case TAG.compound:
      while (true) {
        const childType = await reader.readByte();
        if (childType === TAG.end) break;
        await reader.readString();
        await skipPayload(reader, childType);
      }
      break;
    case TAG.intArray: {
      const length = await reader.readInt32();
      if (length < 0) throw new Error(`Negative NBT int-array length: ${length}`);
      await reader.skip(length * 4);
      break;
    }
    case TAG.longArray: {
      const length = await reader.readInt32();
      if (length < 0) throw new Error(`Negative NBT long-array length: ${length}`);
      await reader.skip(length * 8);
      break;
    }
    default: throw new Error(`Unknown NBT tag type ${type}`);
  }
}

async function readPalette(reader) {
  const entries = [];
  while (true) {
    const type = await reader.readByte();
    if (type === TAG.end) break;
    const state = await reader.readString();
    if (type !== TAG.int) throw new Error(`Palette entry ${state} is tag ${type}, expected TAG_Int`);
    const id = await reader.readInt32();
    validateBlockState(state);
    entries.push([state, id]);
  }
  return entries;
}

async function readBlockData(reader, byteLength, dimensions, paletteEntries = []) {
  const idHistogram = new Map();
  let decoded = 0;
  let nonAir = 0;
  let value = 0;
  let shift = 0;
  let maxPaletteId = 0;
  const bounds = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  const plane = dimensions.width * dimensions.length;
  const paletteById = [];
  for (const [state, id] of paletteEntries) paletteById[id] = state;
  const stateTokens = paletteById.map(state => crypto.createHash('sha256').update(state).digest().subarray(0, 8));
  const semanticHash = crypto.createHash('sha256');
  semanticHash.update(`${dimensions.width}x${dimensions.height}x${dimensions.length}\0`);
  let semanticBuffer = Buffer.allocUnsafe(64 * 1024);
  let semanticOffset = 0;
  const recordSemanticVoxel = (index, id) => {
    if (semanticOffset + 16 > semanticBuffer.length) {
      semanticHash.update(semanticBuffer.subarray(0, semanticOffset));
      semanticBuffer = Buffer.allocUnsafe(64 * 1024);
      semanticOffset = 0;
    }
    semanticBuffer.writeBigUInt64BE(BigInt(index), semanticOffset);
    const token = stateTokens[id] ?? crypto.createHash('sha256').update(`#invalid:${id}`).digest().subarray(0, 8);
    token.copy(semanticBuffer, semanticOffset + 8);
    semanticOffset += 16;
  };

  await reader.consume(byteLength, chunk => {
    for (const byte of chunk) {
      value += (byte & 0x7f) * (2 ** shift);
      if ((byte & 0x80) !== 0) {
        shift += 7;
        if (shift > 28) throw new Error('BlockData contains an overlong VarInt');
        continue;
      }
      if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid BlockData palette id: ${value}`);
      idHistogram.set(value, (idHistogram.get(value) ?? 0) + 1);
      maxPaletteId = Math.max(maxPaletteId, value);
      if (value !== 0) {
        nonAir++;
        recordSemanticVoxel(decoded, value);
        const x = decoded % dimensions.width;
        const z = Math.floor(decoded / dimensions.width) % dimensions.length;
        const y = Math.floor(decoded / plane);
        bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
        bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
        bounds.minZ = Math.min(bounds.minZ, z); bounds.maxZ = Math.max(bounds.maxZ, z);
      }
      decoded++;
      value = 0;
      shift = 0;
    }
  });
  if (shift !== 0) throw new Error('BlockData ends in the middle of a VarInt');
  if (semanticOffset) semanticHash.update(semanticBuffer.subarray(0, semanticOffset));
  return { decoded, nonAir, maxPaletteId, idHistogram, bounds: nonAir ? bounds : null, semanticSha256: semanticHash.digest('hex') };
}

export async function verifySchematic(file, options = {}) {
  const compressedBytes = (await fs.promises.stat(file)).size;
  const sha256 = await hashFile(file);
  const gunzip = fs.createReadStream(file).pipe(zlib.createGunzip());
  const reader = new AsyncByteReader(gunzip);
  const rootType = await reader.readByte();
  if (rootType !== TAG.compound) throw new Error(`Root tag is ${rootType}, expected TAG_Compound`);
  const rootName = await reader.readString();
  const fields = {};
  let palette = null;
  let blockData = null;
  let blockDataBytes = null;

  while (true) {
    const type = await reader.readByte();
    if (type === TAG.end) break;
    const name = await reader.readString();
    if (type === TAG.int && ['Version', 'DataVersion', 'PaletteMax'].includes(name)) {
      fields[name] = await reader.readInt32();
    } else if (type === TAG.short && ['Width', 'Height', 'Length'].includes(name)) {
      fields[name] = await reader.readInt16();
    } else if (name === 'Palette' && type === TAG.compound) {
      palette = await readPalette(reader);
    } else if (name === 'BlockData' && type === TAG.byteArray) {
      blockDataBytes = await reader.readInt32();
      if (blockDataBytes < 0) throw new Error(`Negative BlockData byte length: ${blockDataBytes}`);
      const dimensions = { width: fields.Width, height: fields.Height, length: fields.Length };
      validateDimensions(dimensions);
      blockData = await readBlockData(reader, blockDataBytes, dimensions, palette ?? []);
    } else {
      await skipPayload(reader, type);
    }
  }

  const trailingBytes = await reader.drain();
  const uncompressedSha256 = reader.digest();
  const dimensions = { width: fields.Width, height: fields.Height, length: fields.Length };
  const volume = validateDimensions(dimensions);
  const errors = [];
  if (rootName !== 'Schematic') errors.push(`root name is ${JSON.stringify(rootName)}`);
  if (fields.Version !== 2) errors.push(`Version is ${fields.Version}, expected 2`);
  if (!Number.isInteger(fields.DataVersion) || fields.DataVersion <= 0) errors.push(`invalid DataVersion ${fields.DataVersion}`);
  if (!palette) errors.push('Palette is missing');
  if (!blockData) errors.push('BlockData is missing');
  if (trailingBytes !== 0) errors.push(`${trailingBytes} trailing bytes after root compound`);

  const paletteById = [];
  if (palette) {
    for (const [state, id] of palette) {
      if (!Number.isInteger(id) || id < 0) errors.push(`invalid palette id ${id} for ${state}`);
      if (paletteById[id] !== undefined) errors.push(`duplicate palette id ${id}`);
      paletteById[id] = state;
    }
    if (fields.PaletteMax !== palette.length) errors.push(`PaletteMax ${fields.PaletteMax} != palette entries ${palette.length}`);
    for (let i = 0; i < palette.length; i++) if (paletteById[i] === undefined) errors.push(`palette id ${i} is missing`);
    if (paletteById[0] !== 'minecraft:air') errors.push(`palette id 0 is ${paletteById[0] ?? 'missing'}, expected minecraft:air`);
  }
  if (blockData) {
    if (blockData.decoded !== volume) errors.push(`decoded cells ${blockData.decoded} != volume ${volume}`);
    if (palette && blockData.maxPaletteId >= palette.length) errors.push(`BlockData palette id ${blockData.maxPaletteId} exceeds palette size ${palette.length}`);
  }
  if (options.expected) {
    for (const key of ['width', 'height', 'length']) {
      if (options.expected[key] !== undefined && dimensions[key] !== options.expected[key]) {
        errors.push(`${key} ${dimensions[key]} != expected ${options.expected[key]}`);
      }
    }
    if (options.expected.nonAir !== undefined && blockData?.nonAir !== options.expected.nonAir) {
      errors.push(`nonAir ${blockData?.nonAir} != expected ${options.expected.nonAir}`);
    }
    if (options.expected.sha256 !== undefined && sha256 !== options.expected.sha256) {
      errors.push(`compressed SHA-256 ${sha256} != expected ${options.expected.sha256}`);
    }
    if (options.expected.semanticSha256 !== undefined && blockData?.semanticSha256 !== options.expected.semanticSha256) {
      errors.push(`semantic SHA-256 ${blockData?.semanticSha256} != expected ${options.expected.semanticSha256}`);
    }
  }
  if (errors.length) throw new Error(`Invalid schematic ${file}: ${errors.join('; ')}`);

  const blockHistogram = {};
  for (const [id, count] of blockData.idHistogram) {
    blockHistogram[paletteById[id]] = count;
  }
  return {
    file,
    rootName,
    version: fields.Version,
    dataVersion: fields.DataVersion,
    dimensions,
    volume,
    paletteSize: palette.length,
    palette: paletteById,
    blockDataBytes,
    nonAir: blockData.nonAir,
    bounds: blockData.bounds,
    blockHistogram,
    compressedBytes,
    uncompressedBytes: reader.total,
    sha256,
    uncompressedSha256,
    semanticSha256: blockData.semanticSha256,
  };
}
