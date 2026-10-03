import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveProject } from '../src/core/paths.mjs';

const roots = ['src', 'scripts', 'tests', 'bridge', 'contracts', 'packaging', 'underground-nexus-1m'].map(directory => resolveProject(directory));
const files = [];
for (const root of roots) collect(root, files);
let failures = 0;
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures++;
    process.stderr.write(result.stderr || result.stdout || `Syntax check failed: ${file}\n`);
  }
}
console.log(`syntax files=${files.length} failures=${failures}`);
if (failures) process.exitCode = 1;

function collect(directory, output) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(file, output);
    else if (entry.isFile() && ['.js', '.mjs', '.cjs'].includes(path.extname(entry.name))) output.push(file);
  }
}
