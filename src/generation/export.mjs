import fs from 'node:fs/promises';
import path from 'node:path';
import { writeSchematic } from '../core/schematic-writer.mjs';
import { verifySchematic } from '../core/schematic-verifier.mjs';

export async function exportCompiled(compiled, directory) {
  const { manifest: m, cells } = compiled;
  if(m.diagnosticOnly)throw new Error('Diagnostic-only assets cannot be exported for building');
  const { width: w, length: d } = m.dimensions;
  const asset = {
    id: m.id, dimensions: m.dimensions, voxelOrder: 'linear-index-ascending-unique', voxelCount: m.setCount,
  };
  asset.voxels = (function* () {
    for (let i = 0; i < cells.length; i++) if (cells[i] >= 2) yield [i % w, Math.floor(i / (w * d)), Math.floor(i / w) % d, cells[i]];
  })();
  const mapping = Object.fromEntries(m.palette.slice(2).map((v, i) => [i + 2, v]));
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `${m.id}.schem`);
  const written = await writeSchematic(asset, mapping, file, { dataVersion: 3465,studioQuality:{navigation:m.quality?.navigation??'unknown',requiresAcknowledgement:m.quality?.requiresAcknowledgement??true,warning:m.quality?.navigation==='verified'?'Only conservative full-block navigation checked':'通行未验证：可预览不等于楼梯/入口可通行；外部粘贴工具可能不显示此警告。'} });
  const verified = await verifySchematic(file, { expected: { ...m.dimensions, nonAir: m.setCount } });
  const report = { assetHash: m.assetHash, specHash: m.specHash, dimensions: m.dimensions, setCount: m.setCount, clearCount: m.clearCount, verified,quality:m.quality??null,validationNotes:m.validationNotes??[],schematic: path.basename(file), airPolicy: 'Schematic air includes both keep and clear; native placement uses cells.bin to preserve masks. Schematic verification checks serialization, NOT walkability. External tools do not enforce Voxel Studio navigation acknowledgement; share export-report.json too.' };
  await fs.writeFile(path.join(directory, 'export-report.json'), JSON.stringify(report, null, 2));
  return { file, report, outputHash: written.outputHash };
}
