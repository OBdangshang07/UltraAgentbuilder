import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const OMIT_DIRS = new Set(['node_modules', 'dist', '.git', 'test', 'docs']);

export async function hashPath(target) {
  const stat = await fs.promises.stat(target);
  if (stat.isFile()) return hashSingleFile(target);
  const files = [];
  await collect(target, target, files);
  const hash = crypto.createHash('sha256');
  for (const file of files.sort((a, b) => a.relative.localeCompare(b.relative))) {
    hash.update(file.relative.replaceAll(path.sep, '/'));
    hash.update('\0');
    hash.update(await fs.promises.readFile(file.absolute));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function collect(root, current, files) {
  for (const entry of await fs.promises.readdir(current, { withFileTypes: true })) {
    if (entry.isDirectory() && OMIT_DIRS.has(entry.name)) continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) await collect(root, absolute, files);
    else if (entry.isFile()) files.push({ absolute, relative: path.relative(root, absolute) });
  }
}

async function hashSingleFile(file) {
  const hash = crypto.createHash('sha256');
  hash.update(await fs.promises.readFile(file));
  return hash.digest('hex');
}
