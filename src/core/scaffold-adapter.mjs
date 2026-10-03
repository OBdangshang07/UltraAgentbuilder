import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, resolveProject } from './paths.mjs';

export function scaffoldAdapter(id, sourceFile, outputFile = resolveProject('src', 'adapters', `${id}.mjs`)) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`Invalid adapter id: ${id}`);
  if (fs.existsSync(outputFile)) throw new Error(`Refusing to overwrite existing adapter: ${outputFile}`);
  ensureDir(path.dirname(outputFile));
  const relativeSource = path.relative(resolveProject(), path.resolve(sourceFile)).split(path.sep).join('/');
  const template = `import fs from 'node:fs';
import { sourceInspection } from '../core/generated-module.mjs';

export const metadata = { id: ${JSON.stringify(id)}, kind: 'unknown', execution: 'review-required' };

export async function inspect(context) {
  const html = fs.readFileSync(context.sourcePath, 'utf8');
  return { ...metadata, ...sourceInspection(context.sourcePath, html, []) };
}

export async function extract(context) {
  // Source observed when scaffolded: ${relativeSource}
  // Replace this error with reviewed extraction logic that returns
  // { id, dimensions: { width, height, length }, voxels, materials, transforms }.
  throw new Error('Adapter ${id} requires implementation and review');
}
`;
  fs.writeFileSync(outputFile, template, 'utf8');
  return outputFile;
}
