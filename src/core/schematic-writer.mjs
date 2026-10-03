import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { validateAssetShape, validateBlockState, validateDimensions } from './asset-schema.mjs';
import { encodeVarInt, varIntSize } from './varint.mjs';
import { ensureDir } from './paths.mjs';
import { hashFile } from './hash.mjs';

const TAG = {
  end: 0,
  byte: 1,
  short: 2,
  int: 3,
  byteArray: 7,
  string: 8,
  list: 9,
  compound: 10,
};

function utf8(value) {
  const payload = Buffer.from(value, 'utf8');
  if (payload.length > 0xffff) throw new RangeError(`NBT string is too long: ${payload.length}`);
  const result = Buffer.allocUnsafe(2 + payload.length);
  result.writeUInt16BE(payload.length, 0);
  payload.copy(result, 2);
  return result;
}

function tagHeader(type, name) {
  return Buffer.concat([Buffer.from([type]), utf8(name)]);
}

function namedInt(name, value) {
  const result = Buffer.allocUnsafe(1 + 2 + Buffer.byteLength(name) + 4);
  let offset = 0;
  result[offset++] = TAG.int;
  offset = writeStringInto(result, offset, name);
  result.writeInt32BE(value, offset);
  return result;
}

function namedShort(name, value) {
  const result = Buffer.allocUnsafe(1 + 2 + Buffer.byteLength(name) + 2);
  let offset = 0;
  result[offset++] = TAG.short;
  offset = writeStringInto(result, offset, name);
  result.writeInt16BE(value, offset);
  return result;
}

function emptyCompoundList(name) {
  const header = tagHeader(TAG.list, name);
  const suffix = Buffer.alloc(5);
  suffix[0] = TAG.compound;
  suffix.writeInt32BE(0, 1);
  return Buffer.concat([header, suffix]);
}

function writeStringInto(target, offset, value) {
  const size = Buffer.byteLength(value);
  target.writeUInt16BE(size, offset);
  offset += 2;
  target.write(value, offset, size, 'utf8');
  return offset + size;
}

function blockDataHeader(byteLength) {
  const header = tagHeader(TAG.byteArray, 'BlockData');
  const length = Buffer.allocUnsafe(4);
  length.writeInt32BE(byteLength, 0);
  return Buffer.concat([header, length]);
}

export function prepareAsset(asset, mapping, options = {}) {
  validateAssetShape(asset);
  const volume = validateDimensions(asset.dimensions);
  const duplicatePolicy = options.duplicatePolicy ?? asset.duplicatePolicy ?? 'error';
  if (!['error', 'first-wins', 'last-wins'].includes(duplicatePolicy)) {
    throw new TypeError(`Unsupported duplicate policy: ${duplicatePolicy}`);
  }

  if (asset.voxelOrder === 'linear-index-ascending-unique') {
    if (duplicatePolicy !== 'error') {
      throw new Error(`Ordered unique asset ${asset.id} must use duplicatePolicy=error`);
    }
    return prepareOrderedUniqueAsset(asset, mapping, volume, options);
  }

  const raw = [];
  const missing = new Set();
  const usedSourceTypes = new Set();
  let inputVoxels = 0;

  for (const voxel of asset.voxels) {
    inputVoxels++;
    if (!Array.isArray(voxel) || voxel.length < 4) {
      throw new TypeError(`Invalid voxel tuple at input ${inputVoxels}: ${JSON.stringify(voxel)}`);
    }
    const [x, y, z, sourceType] = voxel;
    if (![x, y, z].every(Number.isInteger)) {
      throw new TypeError(`Voxel coordinates must be integers: ${JSON.stringify(voxel)}`);
    }
    if (x < 0 || x >= asset.dimensions.width || y < 0 || y >= asset.dimensions.height || z < 0 || z >= asset.dimensions.length) {
      throw new RangeError(`Voxel is outside ${asset.dimensions.width}x${asset.dimensions.height}x${asset.dimensions.length}: ${JSON.stringify(voxel)}`);
    }
    const sourceKey = String(sourceType);
    const blockState = mapping[sourceKey];
    if (blockState === undefined) {
      missing.add(sourceKey);
      continue;
    }
    validateBlockState(blockState);
    if (blockState === 'minecraft:air' && !options.allowAirMapping) {
      throw new Error(`Source type ${sourceKey} maps to air; pass allowAirMapping only when this data loss is intentional`);
    }
    usedSourceTypes.add(sourceKey);
    const index = x + z * asset.dimensions.width + y * asset.dimensions.width * asset.dimensions.length;
    raw.push([index, blockState, sourceKey]);
  }

  if (missing.size > 0) {
    throw new Error(`Unmapped source types in ${asset.id}: ${[...missing].sort().join(', ')}`);
  }
  if (inputVoxels === 0) throw new Error(`Asset ${asset.id} contains no voxels`);

  raw.sort((a, b) => a[0] - b[0]);
  const unique = [];
  let duplicates = 0;
  let conflictingDuplicates = 0;
  for (let i = 0; i < raw.length;) {
    let end = i + 1;
    while (end < raw.length && raw[end][0] === raw[i][0]) end++;
    const count = end - i;
    if (count > 1) {
      duplicates += count - 1;
      const states = new Set(raw.slice(i, end).map(item => item[1]));
      if (states.size > 1) conflictingDuplicates += count - 1;
      if (duplicatePolicy === 'error') {
        throw new Error(`Duplicate voxel index ${raw[i][0]} encountered ${count} times in ${asset.id}`);
      }
    }
    unique.push(duplicatePolicy === 'last-wins' ? raw[end - 1] : raw[i]);
    i = end;
  }

  const palette = ['minecraft:air'];
  const paletteIndex = new Map([[palette[0], 0]]);
  const placements = [];
  const blockHistogram = new Map();
  const sourceHistogram = new Map();
  for (const [index, blockState, sourceKey] of unique) {
    let id = paletteIndex.get(blockState);
    if (id === undefined) {
      id = palette.length;
      paletteIndex.set(blockState, id);
      palette.push(blockState);
    }
    placements.push([index, id]);
    blockHistogram.set(blockState, (blockHistogram.get(blockState) ?? 0) + 1);
    sourceHistogram.set(sourceKey, (sourceHistogram.get(sourceKey) ?? 0) + 1);
  }

  let blockDataBytes = volume;
  for (const [, id] of placements) blockDataBytes += varIntSize(id) - 1;
  if (blockDataBytes > 0x7fffffff) {
    throw new RangeError(`Encoded BlockData exceeds the NBT signed-int length limit: ${blockDataBytes}`);
  }

  return {
    asset,
    volume,
    palette,
    placements,
    blockDataBytes,
    metrics: {
      inputVoxels,
      uniqueVoxels: unique.length,
      nonAir: placements.length,
      duplicates,
      conflictingDuplicates,
      duplicatePolicy,
      paletteSize: palette.length,
      usedSourceTypes: [...usedSourceTypes].sort(),
      blockHistogram: Object.fromEntries([...blockHistogram].sort((a, b) => b[1] - a[1])),
      sourceHistogram: Object.fromEntries([...sourceHistogram].sort((a, b) => b[1] - a[1])),
    },
  };
}

function prepareOrderedUniqueAsset(asset, mapping, volume, options) {
  if (!Number.isInteger(asset.voxelCount) || asset.voxelCount <= 0 || asset.voxelCount > volume) {
    throw new RangeError(`Ordered unique asset ${asset.id} requires voxelCount in 1..${volume}; received ${asset.voxelCount}`);
  }

  const indices = new Uint32Array(asset.voxelCount);
  const paletteIds = new Uint32Array(asset.voxelCount);
  const palette = ['minecraft:air'];
  const paletteIndex = new Map([[palette[0], 0]]);
  const blockHistogram = new Map();
  const sourceHistogram = new Map();
  const usedSourceTypes = new Set();
  const missing = new Set();
  const plane = asset.dimensions.width * asset.dimensions.length;
  let previousIndex = -1;
  let count = 0;
  let blockDataBytes = volume;

  for (const voxel of asset.voxels) {
    if (!Array.isArray(voxel) || voxel.length < 4) {
      throw new TypeError(`Invalid voxel tuple at input ${count + 1}: ${JSON.stringify(voxel)}`);
    }
    const [x, y, z, sourceType] = voxel;
    if (![x, y, z].every(Number.isInteger)) {
      throw new TypeError(`Voxel coordinates must be integers: ${JSON.stringify(voxel)}`);
    }
    if (x < 0 || x >= asset.dimensions.width || y < 0 || y >= asset.dimensions.height || z < 0 || z >= asset.dimensions.length) {
      throw new RangeError(`Voxel is outside ${asset.dimensions.width}x${asset.dimensions.height}x${asset.dimensions.length}: ${JSON.stringify(voxel)}`);
    }
    if (count >= asset.voxelCount) {
      throw new Error(`Ordered unique asset ${asset.id} yielded more than voxelCount=${asset.voxelCount}`);
    }

    const index = x + z * asset.dimensions.width + y * plane;
    if (index <= previousIndex) {
      throw new Error(`Ordered unique asset ${asset.id} is not strictly ascending at index ${index} after ${previousIndex}`);
    }
    previousIndex = index;

    const sourceKey = String(sourceType);
    const blockState = mapping[sourceKey];
    if (blockState === undefined) {
      missing.add(sourceKey);
      continue;
    }
    validateBlockState(blockState);
    if (blockState === 'minecraft:air' && !options.allowAirMapping) {
      throw new Error(`Source type ${sourceKey} maps to air; pass allowAirMapping only when this data loss is intentional`);
    }
    usedSourceTypes.add(sourceKey);

    let paletteId = paletteIndex.get(blockState);
    if (paletteId === undefined) {
      paletteId = palette.length;
      paletteIndex.set(blockState, paletteId);
      palette.push(blockState);
    }
    indices[count] = index;
    paletteIds[count] = paletteId;
    blockDataBytes += varIntSize(paletteId) - 1;
    blockHistogram.set(blockState, (blockHistogram.get(blockState) ?? 0) + 1);
    sourceHistogram.set(sourceKey, (sourceHistogram.get(sourceKey) ?? 0) + 1);
    count++;
  }

  if (missing.size > 0) {
    throw new Error(`Unmapped source types in ${asset.id}: ${[...missing].sort().join(', ')}`);
  }
  if (count !== asset.voxelCount) {
    throw new Error(`Ordered unique asset ${asset.id} yielded ${count} voxels; expected ${asset.voxelCount}`);
  }
  if (blockDataBytes > 0x7fffffff) {
    throw new RangeError(`Encoded BlockData exceeds the NBT signed-int length limit: ${blockDataBytes}`);
  }

  const placements = {
    indices,
    paletteIds,
    length: count,
    *[Symbol.iterator]() {
      for (let i = 0; i < count; i++) yield [indices[i], paletteIds[i]];
    },
  };
  return {
    asset,
    volume,
    palette,
    placements,
    blockDataBytes,
    metrics: {
      inputVoxels: count,
      uniqueVoxels: count,
      nonAir: count,
      duplicates: 0,
      conflictingDuplicates: 0,
      duplicatePolicy: 'error',
      paletteSize: palette.length,
      usedSourceTypes: [...usedSourceTypes].sort(),
      blockHistogram: Object.fromEntries([...blockHistogram].sort((a, b) => b[1] - a[1])),
      sourceHistogram: Object.fromEntries([...sourceHistogram].sort((a, b) => b[1] - a[1])),
      storage: 'compact-ordered-unique',
    },
  };
}

export async function writeSchematic(asset, mapping, outputFile, options = {}) {
  const prepared = prepareAsset(asset, mapping, options);
  const studioQuality=options.studioQuality===undefined?null:utf8(JSON.stringify(options.studioQuality));
  const dataVersion = options.dataVersion ?? 3465;
  if (!Number.isInteger(dataVersion) || dataVersion <= 0) {
    throw new RangeError(`Invalid DataVersion: ${dataVersion}`);
  }

  ensureDir(path.dirname(outputFile));
  const tempFile = `${outputFile}.${process.pid}.${Date.now()}.tmp`;
  const output = fs.createWriteStream(tempFile, { flags: 'wx' });
  const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION, mtime: 0 });
  gzip.pipe(output);

  const write = async buffer => {
    if (!gzip.write(buffer)) await once(gzip, 'drain');
  };

  try {
    await write(tagHeader(TAG.compound, 'Schematic'));
    await write(namedInt('Version', 2));
    await write(namedInt('DataVersion', dataVersion));
    await write(namedShort('Width', asset.dimensions.width));
    await write(namedShort('Height', asset.dimensions.height));
    await write(namedShort('Length', asset.dimensions.length));
    if(studioQuality){await write(tagHeader(TAG.compound,'Metadata'));await write(tagHeader(TAG.string,'VoxelStudioQuality'));await write(studioQuality);await write(Buffer.from([TAG.end]));}
    await write(namedInt('PaletteMax', prepared.palette.length));
    await write(tagHeader(TAG.compound, 'Palette'));
    for (let i = 0; i < prepared.palette.length; i++) {
      await write(namedInt(prepared.palette[i], i));
    }
    await write(Buffer.from([TAG.end]));
    await write(blockDataHeader(prepared.blockDataBytes));

    let payload = Buffer.allocUnsafe(64 * 1024);
    let payloadOffset = 0;
    const flushPayload = async () => {
      if (payloadOffset === 0) return;
      await write(payload.subarray(0, payloadOffset));
      payload = Buffer.allocUnsafe(64 * 1024);
      payloadOffset = 0;
    };
    let cursor = 0;
    for (const [index, paletteId] of prepared.placements) {
      let gap = index - cursor;
      while (gap > 0) {
        const size = Math.min(gap, payload.length - payloadOffset);
        payload.fill(0, payloadOffset, payloadOffset + size);
        payloadOffset += size;
        gap -= size;
        if (payloadOffset === payload.length) await flushPayload();
      }
      const bytes = encodeVarInt(paletteId);
      let sourceOffset = 0;
      while (sourceOffset < bytes.length) {
        const size = Math.min(bytes.length - sourceOffset, payload.length - payloadOffset);
        bytes.copy(payload, payloadOffset, sourceOffset, sourceOffset + size);
        payloadOffset += size;
        sourceOffset += size;
        if (payloadOffset === payload.length) await flushPayload();
      }
      cursor = index + 1;
    }
    let tail = prepared.volume - cursor;
    while (tail > 0) {
      const size = Math.min(tail, payload.length - payloadOffset);
      payload.fill(0, payloadOffset, payloadOffset + size);
      payloadOffset += size;
      tail -= size;
      if (payloadOffset === payload.length) await flushPayload();
    }
    await flushPayload();

    await write(emptyCompoundList('BlockEntities'));
    await write(emptyCompoundList('Entities'));
    await write(Buffer.from([TAG.end]));
    gzip.end();
    await finished(output);
    await fs.promises.copyFile(tempFile, outputFile);
    await fs.promises.unlink(tempFile);
  } catch (error) {
    gzip.destroy();
    output.destroy();
    await fs.promises.rm(tempFile, { force: true });
    throw error;
  }

  const stat = await fs.promises.stat(outputFile);
  const sha256 = await hashFile(outputFile);
  return {
    ...prepared,
    outputFile,
    dataVersion,
    compressedBytes: stat.size,
    sha256,
  };
}
