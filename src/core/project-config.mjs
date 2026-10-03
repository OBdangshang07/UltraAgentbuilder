import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveProject } from './paths.mjs';

let cachedConfig;
let cachedBaselineManifest;

export function loadProjectConfig() {
  if (!cachedConfig) {
    const file = resolveProject('config', 'assets.json');
    cachedConfig = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ids = new Set();
    for (const asset of cachedConfig.assets ?? []) {
      if (ids.has(asset.id)) throw new Error(`Duplicate asset id in config: ${asset.id}`);
      ids.add(asset.id);
    }
  }
  return cachedConfig;
}

export function getAssetConfig(id) {
  const asset = loadProjectConfig().assets.find(candidate => candidate.id === id);
  if (!asset) throw new Error(`Unknown asset ${JSON.stringify(id)}. Available: ${listAssetIds().join(', ')}`);
  return asset;
}

export function listAssetIds() {
  return loadProjectConfig().assets.map(asset => asset.id);
}

export function loadBaselineManifest() {
  if (!cachedBaselineManifest) {
    const file = resolveProject('baseline', 'manifest.json');
    cachedBaselineManifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return cachedBaselineManifest;
}

export function getFrozenBaseline(config) {
  return loadBaselineManifest().artifacts?.[config.output] ?? null;
}

export function getOutputExpectation(config) {
  const frozen = getFrozenBaseline(config);
  return {
    ...(config.baseline ?? {}),
    ...(frozen?.semanticSha256 ? { semanticSha256: frozen.semanticSha256 } : {}),
  };
}

export function createAssetContext(config, overrides = {}) {
  return {
    config,
    sourcePath: resolveProject(config.source),
    cacheDir: overrides.cacheDir ?? resolveProject('.voxel-cache', 'generated'),
    keepGenerated: overrides.keepGenerated ?? false,
    options: { ...(config.options ?? {}), ...(overrides.options ?? {}) },
  };
}

export async function loadAdapter(config) {
  const file = resolveProject('src', 'adapters', config.adapter);
  if (!fs.existsSync(file)) throw new Error(`Adapter does not exist for ${config.id}: ${file}`);
  const adapter = await import(`${pathToFileURL(file).href}?load=${Date.now()}`);
  if (typeof adapter.inspect !== 'function' || typeof adapter.extract !== 'function') {
    throw new Error(`Adapter ${path.basename(file)} must export inspect() and extract()`);
  }
  return adapter;
}

export function loadMapping(config) {
  const file = resolveProject('mappings', config.mapping);
  if (!fs.existsSync(file)) throw new Error(`Mapping does not exist for ${config.id}: ${file}`);
  const reviewFile = resolveProject('mappings', 'review.json');
  const review = fs.existsSync(reviewFile) ? JSON.parse(fs.readFileSync(reviewFile, 'utf8')).assets?.[config.id] : null;
  if (!review || review.status !== 'approved') throw new Error(`Mapping for ${config.id} is not approved in mappings/review.json`);
  return { file, mapping: JSON.parse(fs.readFileSync(file, 'utf8')), review };
}

export function resolveDataVersion({ dataVersion, minecraft } = {}) {
  if (dataVersion !== undefined) {
    const parsed = Number(dataVersion);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid --data-version: ${dataVersion}`);
    return parsed;
  }
  if (minecraft) {
    const versions = JSON.parse(fs.readFileSync(resolveProject('config', 'data-versions.json'), 'utf8'));
    if (!versions[minecraft]) throw new Error(`Unknown Minecraft version ${minecraft}; available: ${Object.keys(versions).join(', ')}`);
    return versions[minecraft];
  }
  return loadProjectConfig().defaultDataVersion;
}
