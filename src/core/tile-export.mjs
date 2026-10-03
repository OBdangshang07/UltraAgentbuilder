import fs from 'node:fs';
import path from 'node:path';
import { writeSchematic } from './schematic-writer.mjs';
import { verifySchematic } from './schematic-verifier.mjs';
import { ensureDir } from './paths.mjs';

export async function writeTileSet(id, prepared, outputDir, tileConfig, options = {}) {
  const tileWidth = positiveInteger(tileConfig.width, 'tile width');
  const tileLength = positiveInteger(tileConfig.length, 'tile length');
  const recommendedMinecraftOrigin = validateOrigin(tileConfig.recommendedMinecraftOrigin ?? { x: 0, y: 32, z: 0 });
  const directory = path.join(outputDir, tileConfig.directory ?? `${id}-tiles`);
  ensureDir(directory);

  const { width, height, length } = prepared.asset.dimensions;
  const countX = Math.ceil(width / tileWidth);
  const countZ = Math.ceil(length / tileLength);
  const counts = new Uint32Array(countX * countZ);
  forEachPlacement(prepared.placements, index => {
    const x = index % width;
    const z = Math.floor(index / width) % length;
    counts[Math.floor(x / tileWidth) + Math.floor(z / tileLength) * countX]++;
  });

  const identityMapping = Object.fromEntries(prepared.palette.slice(1).map(state => [state, state]));
  const tiles = [];
  const started = performance.now();
  for (let tileZ = 0; tileZ < countZ; tileZ++) {
    for (let tileX = 0; tileX < countX; tileX++) {
      const offsetX = tileX * tileWidth;
      const offsetZ = tileZ * tileLength;
      const localWidth = Math.min(tileWidth, width - offsetX);
      const localLength = Math.min(tileLength, length - offsetZ);
      const tileIndex = tileX + tileZ * countX;
      const nonAir = counts[tileIndex];
      if (nonAir === 0) continue;
      const tileId = `${id}-x${String(tileX).padStart(2, '0')}-z${String(tileZ).padStart(2, '0')}`;
      const filename = `tile-x${String(offsetX).padStart(4, '0')}-z${String(offsetZ).padStart(4, '0')}.schem`;
      const outputFile = path.join(directory, filename);
      const asset = {
        id: tileId,
        dimensions: { width: localWidth, height, length: localLength },
        voxelCount: nonAir,
        voxelOrder: 'linear-index-ascending-unique',
        voxels: tileVoxels(prepared, { offsetX, offsetZ, width: localWidth, length: localLength }),
      };
      const written = await writeSchematic(asset, identityMapping, outputFile, { dataVersion: options.dataVersion });
      const verified = await verifySchematic(outputFile, {
        expected: { width: localWidth, height, length: localLength, nonAir },
      });
      tiles.push({
        file: filename,
        offset: { x: offsetX, y: 0, z: offsetZ },
        recommendedMinimumCorner: { x: recommendedMinecraftOrigin.x + offsetX, y: recommendedMinecraftOrigin.y, z: recommendedMinecraftOrigin.z + offsetZ },
        recommendedAxiomAnchor: { x: recommendedMinecraftOrigin.x + offsetX + Math.floor(localWidth / 2), y: recommendedMinecraftOrigin.y + Math.floor(height / 2), z: recommendedMinecraftOrigin.z + offsetZ + Math.floor(localLength / 2) },
        dimensions: { width: localWidth, height, length: localLength },
        nonAir,
        paletteSize: written.palette.length,
        compressedBytes: verified.compressedBytes,
        sha256: verified.sha256,
        semanticSha256: verified.semanticSha256,
        status: 'verified',
      });
    }
  }

  const manifest = {
    schemaVersion: 1,
    asset: id,
    format: 'Sponge Schematic v2',
    fullDimensions: { width, height, length },
    recommendedMinecraftOrigin,
    tileSize: { width: tileWidth, length: tileLength },
    grid: { x: countX, z: countZ },
    totalNonAir: tiles.reduce((sum, tile) => sum + tile.nonAir, 0),
    placementRule: "tile.offset is the minimum-corner offset. For Axiom's centered clipboard, paste at recommendedMinecraftOrigin + tile.offset + floor(tile.dimensions / 2).",
    tiles,
  };
  const manifestFile = path.join(directory, 'placement-manifest.json');
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return {
    directory,
    manifestFile,
    tileCount: tiles.length,
    totalNonAir: manifest.totalNonAir,
    timingMs: Math.round(performance.now() - started),
    tiles,
  };
}

function tileVoxels(prepared, bounds) {
  return {
    *[Symbol.iterator]() {
      const fullWidth = prepared.asset.dimensions.width;
      const fullLength = prepared.asset.dimensions.length;
      const plane = fullWidth * fullLength;
      const emit = (index, paletteId) => {
        const x = index % fullWidth;
        const z = Math.floor(index / fullWidth) % fullLength;
        if (x < bounds.offsetX || x >= bounds.offsetX + bounds.width || z < bounds.offsetZ || z >= bounds.offsetZ + bounds.length) return null;
        const y = Math.floor(index / plane);
        return [x - bounds.offsetX, y, z - bounds.offsetZ, prepared.palette[paletteId]];
      };
      if (prepared.placements.indices && prepared.placements.paletteIds) {
        for (let i = 0; i < prepared.placements.length; i++) {
          const voxel = emit(prepared.placements.indices[i], prepared.placements.paletteIds[i]);
          if (voxel) yield voxel;
        }
      } else {
        for (const [index, paletteId] of prepared.placements) {
          const voxel = emit(index, paletteId);
          if (voxel) yield voxel;
        }
      }
    },
  };
}

function forEachPlacement(placements, callback) {
  if (placements.indices && placements.paletteIds) {
    for (let i = 0; i < placements.length; i++) callback(placements.indices[i], placements.paletteIds[i]);
    return;
  }
  for (const [index, paletteId] of placements) callback(index, paletteId);
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0 || value > 32767) {
    throw new RangeError(`${label} must be an integer in 1..32767; received ${value}`);
  }
  return value;
}

function validateOrigin(origin) {
  if (!origin || !['x', 'y', 'z'].every(axis => Number.isSafeInteger(origin[axis]))) {
    throw new RangeError('recommendedMinecraftOrigin must contain safe integer x, y, z coordinates');
  }
  return { x: origin.x, y: origin.y, z: origin.z };
}
