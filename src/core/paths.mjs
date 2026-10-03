import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(CORE_DIR, '..', '..');

export function resolveProject(...parts) {
  return path.resolve(PROJECT_ROOT, ...parts);
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function relativeProject(file) {
  return path.relative(PROJECT_ROOT, file).split(path.sep).join('/');
}

export function assertInsideProject(file) {
  const resolved = path.resolve(file);
  const rel = path.relative(PROJECT_ROOT, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path is outside the project: ${resolved}`);
  }
  return resolved;
}
