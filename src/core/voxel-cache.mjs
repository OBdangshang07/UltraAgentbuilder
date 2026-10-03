import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { ensureDir } from './paths.mjs';
import { validateAssetShape } from './asset-schema.mjs';

export async function writeVoxelCache(asset, outputFile) {
  validateAssetShape(asset);
  ensureDir(path.dirname(outputFile));
  const output = fs.createWriteStream(outputFile);
  const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION, mtime: 0 });
  gzip.pipe(output);
  const metadata = { ...asset, voxels: undefined };
  if (!gzip.write(`${JSON.stringify({ type: 'meta', value: metadata })}\n`)) await once(gzip, 'drain');
  let count = 0;
  for (const voxel of asset.voxels) {
    if (!gzip.write(`${JSON.stringify({ type: 'voxel', value: voxel })}\n`)) await once(gzip, 'drain');
    count++;
  }
  gzip.end();
  await finished(output);
  return { outputFile, count, bytes: (await fs.promises.stat(outputFile)).size };
}

export async function readVoxelCache(inputFile) {
  const input = fs.createReadStream(inputFile).pipe(zlib.createGunzip());
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let metadata = null;
  const voxels = [];
  for await (const line of lines) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (record.type === 'meta') metadata = record.value;
    else if (record.type === 'voxel') voxels.push(record.value);
    else throw new Error(`Unknown voxel-cache record type: ${record.type}`);
  }
  if (!metadata) throw new Error(`Voxel cache has no metadata record: ${inputFile}`);
  return { ...metadata, voxels };
}
