import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ensureDir, resolveProject } from './paths.mjs';

export function extractScriptContaining(html, needle) {
  const position = html.indexOf(needle);
  if (position < 0) throw new Error(`Could not find script marker: ${needle}`);
  const startTag = html.lastIndexOf('<script', position);
  if (startTag < 0) throw new Error(`Could not find <script> before marker: ${needle}`);
  const start = html.indexOf('>', startTag);
  const end = html.indexOf('</script>', position);
  if (start < 0 || end < 0) throw new Error(`Could not isolate script containing: ${needle}`);
  return html.slice(start + 1, end);
}

export function extractFirstModuleScript(html) {
  const marker = /<script\b[^>]*\btype=["']module["'][^>]*>/i.exec(html);
  if (!marker) throw new Error('Could not find a module script');
  const start = marker.index + marker[0].length;
  const end = html.indexOf('</script>', start);
  if (end < 0) throw new Error('Module script is not closed');
  return html.slice(start, end);
}

export function extractScriptById(html, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const marker = new RegExp(`<script\\b[^>]*\\bid=["']${escaped}["'][^>]*>`, 'i').exec(html);
  if (!marker) throw new Error(`Could not find script #${id}`);
  const start = marker.index + marker[0].length;
  const end = html.indexOf('</script>', start);
  if (end < 0) throw new Error(`Script #${id} is not closed`);
  return html.slice(start, end);
}

export async function evaluateGeneratedModule(id, code, options = {}) {
  const cacheDir = ensureDir(options.cacheDir ?? resolveProject('.voxel-cache', 'generated'));
  const hash = crypto.createHash('sha256').update(code).digest('hex').slice(0, 16);
  const file = path.join(cacheDir, `${id}-${hash}.mjs`);
  await fs.promises.writeFile(file, code, { encoding: 'utf8', flag: 'w' });
  try {
    const module = await import(`${pathToFileURL(file).href}?run=${Date.now()}`);
    if (module.default === undefined) throw new Error(`Generated module ${id} has no default export`);
    return module.default;
  } finally {
    if (!options.keepGenerated && process.env.VOXEL_KEEP_GENERATED !== '1') {
      await fs.promises.rm(file, { force: true });
    }
  }
}

export function sourceInspection(sourcePath, html, signals) {
  const found = signals.filter(signal => html.includes(signal));
  return {
    source: sourcePath,
    bytes: Buffer.byteLength(html),
    signals: found,
    confidence: found.length >= 3 ? 'high' : found.length >= 1 ? 'medium' : 'low',
  };
}
