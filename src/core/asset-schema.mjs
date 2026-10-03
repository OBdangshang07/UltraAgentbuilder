const BLOCK_STATE_RE = /^[a-z0-9_.-]+:[a-z0-9_./-]+(?:\[[a-z0-9_=,.-]+\])?$/;

export function validateDimensions(dimensions) {
  const names = ['width', 'height', 'length'];
  for (const name of names) {
    const value = dimensions?.[name];
    if (!Number.isInteger(value) || value <= 0 || value > 32767) {
      throw new RangeError(`${name} must be an integer in 1..32767; received ${value}`);
    }
  }
  const volume = dimensions.width * dimensions.height * dimensions.length;
  if (!Number.isSafeInteger(volume) || volume > 0x7fffffff) {
    throw new RangeError(`Sponge v2 BlockData cannot represent volume ${volume}`);
  }
  return volume;
}

export function validateBlockState(blockState) {
  if (typeof blockState !== 'string' || !BLOCK_STATE_RE.test(blockState)) {
    throw new TypeError(`Invalid Minecraft block state: ${JSON.stringify(blockState)}`);
  }
  return blockState;
}

export function validateAssetShape(asset) {
  if (!asset || typeof asset !== 'object') throw new TypeError('Adapter returned no asset');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(asset.id ?? '')) {
    throw new TypeError(`Invalid asset id: ${JSON.stringify(asset.id)}`);
  }
  validateDimensions(asset.dimensions);
  if (!asset.voxels || typeof asset.voxels[Symbol.iterator] !== 'function') {
    throw new TypeError(`Asset ${asset.id} must expose an iterable voxels collection`);
  }
  return asset;
}

export function normalizeSparseVoxels(voxels, { typeIndex = 3 } = {}) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const list = [];
  for (const voxel of voxels) {
    if (!Array.isArray(voxel) || voxel.length <= typeIndex) {
      throw new TypeError(`Invalid voxel tuple: ${JSON.stringify(voxel)}`);
    }
    const [x, y, z] = voxel;
    if (![x, y, z].every(Number.isInteger)) {
      throw new TypeError(`Voxel coordinates must be integers: ${JSON.stringify(voxel)}`);
    }
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
    list.push(voxel);
  }
  if (list.length === 0) throw new Error('Cannot normalize an empty voxel collection');
  return {
    dimensions: {
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      length: maxZ - minZ + 1,
    },
    origin: { x: minX, y: minY, z: minZ },
    voxels: list.map(voxel => [voxel[0] - minX, voxel[1] - minY, voxel[2] - minZ, voxel[typeIndex]]),
  };
}
