import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {RELEASE_VERSION} from './release.mjs';

const MANIFEST_LIMIT = 1024 * 1024, FILE_LIMIT = 128 * 1024 * 1024, TOTAL_LIMIT = 200 * 1024 * 1024;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function requireValue(condition) { if (!condition) throw new Error('Builtin runtime identity verification failed; no Bridge started'); }
async function physical(file, directory = false) {
  const stat = await fs.lstat(file);
  requireValue(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1));
  requireValue(await fs.realpath(file) === file);
  return stat;
}
async function readExact(file, size, maximum, retain = false) {
  const before = await physical(file); requireValue(Number.isSafeInteger(size) && size >= 0 && size <= maximum && before.size === size);
  const handle = await fs.open(file, 'r'), digest = createHash('sha256'), parts = [];
  try {
    const opened = await handle.stat(); requireValue(opened.isFile() && opened.nlink === 1 && opened.ino === before.ino && opened.dev === before.dev && opened.size === size);
    const buffer = Buffer.alloc(65536); let total = 0;
    for (;;) {
      const {bytesRead} = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead; requireValue(total <= size);
      digest.update(buffer.subarray(0, bytesRead));
      if (retain) parts.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    requireValue(total === size);
    const after = await handle.stat(); requireValue(after.size === size && after.mtimeMs === opened.mtimeMs);
    const named = await physical(file); requireValue(named.ino === opened.ino && named.dev === opened.dev && named.size === size);
    return {hash: digest.digest('hex'), bytes: retain ? Buffer.concat(parts, size) : undefined};
  } finally { await handle.close(); }
}

// Capture the server's own verified module root and executable BEFORE a lock.
// Client expectations and task data cannot choose this identity. A present but
// invalid bundle is rejected, never reinterpreted as source-only mode.
export async function builtinRuntimeIdentity(root, executable = process.execPath) {
  const originalRoot = path.resolve(root), originalExecutable = path.resolve(executable);
  root = originalRoot; let metadataFile = path.join(root, 'bundle-manifest.json');
  let stat;
  try { stat = await fs.lstat(metadataFile); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  // Windows packaged apps can map a non-link LocalAppData path into their
  // package cache. Resolve our OWN module root once, not a client-supplied path,
  // and retain exact physical identities. Real junctions/symlinks stay rejected.
  for (let current = originalRoot;; current = path.dirname(current)) {
    const directory = await fs.lstat(current); requireValue(directory.isDirectory() && !directory.isSymbolicLink());
    if (path.dirname(current) === current) break;
  }
  const originalRootStat = await fs.lstat(originalRoot);
  root = await fs.realpath(originalRoot); const resolvedRootStat = await physical(root, true);
  requireValue(originalRootStat.dev === resolvedRootStat.dev && originalRootStat.ino === resolvedRootStat.ino);
  for (let current = path.dirname(root);; current = path.dirname(current)) {
    await physical(current, true); if (path.dirname(current) === current) break;
  }
  requireValue(path.relative(originalRoot, originalExecutable) === path.join('runtime', 'node.exe'));
  const resolvedExecutable = await fs.realpath(originalExecutable);
  requireValue(resolvedExecutable === path.join(root, 'runtime', 'node.exe'));
  await physical(resolvedExecutable);
  metadataFile = path.join(root, 'bundle-manifest.json');
  const resolvedMetadataStat = await physical(metadataFile);
  requireValue(stat.dev === resolvedMetadataStat.dev && stat.ino === resolvedMetadataStat.ino && stat.size === resolvedMetadataStat.size);
  const original = await readExact(metadataFile, stat.size, MANIFEST_LIMIT, true);
  const metadata = JSON.parse(original.bytes.toString('utf8'));
  requireValue(metadata.schemaVersion === 1 && metadata.version === RELEASE_VERSION && metadata.platform === 'windows-x64');
  requireValue(Array.isArray(metadata.files) && metadata.files.length > 0 && metadata.files.length <= 512);
  const names = new Set(); let total = 0;
  for (const entry of metadata.files) {
    requireValue(entry && typeof entry.path === 'string' && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(entry.path));
    requireValue(!entry.path.split('/').some(p => p === '.' || p === '..') && !names.has(entry.path.toLowerCase()));
    requireValue(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && entry.bytes <= FILE_LIMIT && /^[a-f0-9]{64}$/.test(entry.sha256 ?? ''));
    names.add(entry.path.toLowerCase()); total += entry.bytes; requireValue(total <= TOTAL_LIMIT);
  }
  requireValue(['runtime/node.exe', 'bridge/server.mjs', 'bridge/builtin-runtime-identity.mjs', 'package.json', '.agents/skills/voxel-studio/skill.md'].every(p => names.has(p)));
  for (const entry of metadata.files) {
    const file = path.join(root, entry.path);
    for (let parent = path.dirname(file); parent !== root; parent = path.dirname(parent)) await physical(parent, true);
    requireValue((await readExact(file, entry.bytes, FILE_LIMIT)).hash === entry.sha256);
  }
  requireValue((await readExact(metadataFile, stat.size, MANIFEST_LIMIT, true)).hash === original.hash);
  requireValue(await fs.realpath(originalRoot) === root && await fs.realpath(originalExecutable) === resolvedExecutable);
  const finalRoot = await fs.lstat(originalRoot);
  requireValue(finalRoot.isDirectory() && !finalRoot.isSymbolicLink() && finalRoot.dev === originalRootStat.dev && finalRoot.ino === originalRootStat.ino);
  return Object.freeze({manifestSha256: sha(original.bytes)});
}
