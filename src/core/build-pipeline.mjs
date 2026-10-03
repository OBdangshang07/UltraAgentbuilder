import fs from 'node:fs';
import path from 'node:path';
import { getAssetConfig, createAssetContext, getFrozenBaseline, getOutputExpectation, loadAdapter, loadMapping, resolveDataVersion } from './project-config.mjs';
import { writeSchematic } from './schematic-writer.mjs';
import { verifySchematic } from './schematic-verifier.mjs';
import { hashPath } from './path-hash.mjs';
import { hashFile } from './hash.mjs';
import { ensureDir, relativeProject, resolveProject } from './paths.mjs';
import { writePreviewBundle } from './preview-bundle.mjs';
import { capturePreview } from './visual-runner.mjs';
import { writeTileSet } from './tile-export.mjs';

export async function inspectAsset(id, options = {}) {
  const config = getAssetConfig(id);
  const context = createAssetContext(config, options);
  if (!fs.existsSync(context.sourcePath)) throw new Error(`Source does not exist for ${id}: ${context.sourcePath}`);
  const adapter = await loadAdapter(config);
  return adapter.inspect(context);
}

export async function extractAsset(id, options = {}) {
  const config = getAssetConfig(id);
  const context = createAssetContext(config, options);
  if (!fs.existsSync(context.sourcePath)) throw new Error(`Source does not exist for ${id}: ${context.sourcePath}`);
  const adapter = await loadAdapter(config);
  const started = performance.now();
  const asset = await adapter.extract(context);
  return { config, context, asset, extractMs: Math.round(performance.now() - started) };
}

export async function buildAsset(id, options = {}) {
  const { config, context, asset, extractMs } = await extractAsset(id, options);
  const { file: mappingFile, mapping, review } = loadMapping(config);
  const dataVersion = resolveDataVersion(options);
  const outputDir = path.resolve(options.outputDir ?? resolveProject('build', 'schematics'));
  const outputFile = path.join(outputDir, config.output);
  const reportDir = path.resolve(options.reportDir ?? resolveProject('reports', id));
  ensureDir(outputDir); ensureDir(reportDir);
  const sourceSha256 = await hashPath(context.sourcePath);
  const mappingSha256 = await hashFile(mappingFile);
  const started = performance.now();
  const written = await writeSchematic(asset, mapping, outputFile, {
    dataVersion,
    duplicatePolicy: config.duplicatePolicy,
  });
  const writeMs = Math.round(performance.now() - started);
  const verifyStarted = performance.now();
  const frozen = getFrozenBaseline(config);
  const baselineEnforced = options.enforceBaseline !== false;
  const verified = await verifySchematic(outputFile, { expected: baselineEnforced ? getOutputExpectation(config) : undefined });
  const verifyMs = Math.round(performance.now() - verifyStarted);
  const baselineMetricsMatch = ['width', 'height', 'length'].every(key => verified.dimensions[key] === config.baseline[key]) && verified.nonAir === config.baseline.nonAir;
  const semanticMatch = frozen?.semanticSha256 ? verified.semanticSha256 === frozen.semanticSha256 : null;
  const tileSet = config.tiles ? await writeTileSet(id, written, outputDir, config.tiles, { dataVersion }) : null;
  const preview = await writePreviewBundle(id, written, reportDir);
  const screenshots = options.visual ? await capturePreview(preview, { browserPath: options.browserPath }) : [];
  const report = {
    schemaVersion: 1,
    status: 'passed',
    generatedAt: new Date().toISOString(),
    asset: { id, name: config.name, source: relativeProject(context.sourcePath), sourceSha256, adapter: config.adapter },
    mapping: { file: relativeProject(mappingFile), sha256: mappingSha256, review, usedTypes: written.metrics.usedSourceTypes },
    output: { file: relativeProject(outputFile), sha256: verified.sha256, uncompressedSha256: verified.uncompressedSha256, semanticSha256: verified.semanticSha256, compressedBytes: verified.compressedBytes, uncompressedBytes: verified.uncompressedBytes },
    format: { kind: 'Sponge Schematic', version: verified.version, dataVersion: verified.dataVersion },
    dimensions: verified.dimensions,
    volume: verified.volume,
    nonAir: verified.nonAir,
    bounds: verified.bounds,
    palette: verified.palette,
    blockHistogram: verified.blockHistogram,
    sourceStats: asset.sourceStats ?? {},
    transforms: asset.transforms ?? {},
    preparation: written.metrics,
    timingMs: { extract: extractMs, write: writeMs, verify: verifyMs, tiles: tileSet?.timingMs ?? 0, total: extractMs + writeMs + verifyMs + (tileSet?.timingMs ?? 0) },
    baseline: { enforced: baselineEnforced, expected: config.baseline, frozen, metricsMatch: baselineMetricsMatch, semanticMatch },
    tiles: tileSet ? {
      directory: relativeProject(tileSet.directory),
      manifest: relativeProject(tileSet.manifestFile),
      count: tileSet.tileCount,
      totalNonAir: tileSet.totalNonAir,
      status: tileSet.totalNonAir === verified.nonAir ? 'verified' : 'count-mismatch',
    } : null,
    visual: {
      preview: relativeProject(preview.htmlFile),
      data: relativeProject(preview.dataFile),
      screenshots: screenshots.map(item => ({ view: item.view, file: relativeProject(item.file), bytes: item.bytes, stats: item.stats })),
      status: options.visual ? 'captured' : 'preview-ready'
    },
  };
  const reportFile = path.join(reportDir, 'build-report.json');
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { report, reportFile, outputFile, prepared: written };
}
