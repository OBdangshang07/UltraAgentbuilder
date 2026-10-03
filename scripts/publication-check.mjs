import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const privatePath = /(?:[A-Za-z]:[\\/]+(?:Users[\\/]+(?!fixture(?:[\\/]|$)|test(?:[\\/]|$))[^\\/\s'"<>]+|Tencent[\\/]+|AI_project[\\/]+|voxel-studio-build-[\d-]+[\\/]+))|https:\/\/[^\s'"/]+\.trycloudflare\.com/i;
const secret = /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-proj-[A-Za-z0-9_-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
const excluded = /(?:^|\/)(?:node_modules|build|dist|data|sessions|jobs|saves|worlds|screenshots|crash-reports|client-state|\.gradle|\.codex|\.claude|\.dsh|\.studio-data)(?:\/|$)|(?:^|\/)(?:\.env(?:\..*)?|auth\.json|credentials\.json|connection\.json)$|\.(?:log|tmp|zip|exe|schem|schematic)$/i;
const wrapper = 'mod/gradle/wrapper/gradle-wrapper.jar';
const wrapperHash = '2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046';

export function publicationIssues(relative, bytes) {
  const issues = [];
  if (relative !== relative.replaceAll('\\', '/') || relative.startsWith('/') || relative.split('/').includes('..')) issues.push('unsafe-path');
  if (excluded.test(relative) && relative !== '.env.example') issues.push('private-or-generated-file');
  if (relative.endsWith('.jar')) {
    if (relative !== wrapper || createHash('sha256').update(bytes).digest('hex') !== wrapperHash) issues.push('unapproved-binary');
    return issues;
  }
  if (bytes.includes(0)) issues.push('unapproved-binary');
  const content = bytes.toString('utf8');
  if (privatePath.test(content)) issues.push('private-local-path-or-temporary-url');
  if (secret.test(content)) issues.push('credential-or-private-key');
  return issues;
}

export async function checkPublication(root = project) {
  root = await fs.realpath(root);
  if (await fs.realpath(path.join(root, '.git')) !== path.join(root, '.git')) throw new Error('An independent, non-redirected .git directory is required');
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {cwd: root, encoding: 'utf8', windowsHide: true}).trim();
  if (path.resolve(top) !== root) throw new Error('Refusing to inspect a parent repository');
  const indexed = new Set(execFileSync('git', ['ls-files', '-z', '--cached'], {cwd: root, encoding: 'utf8', windowsHide: true}).split('\0').filter(Boolean));
  const names = [...new Set([...indexed, ...execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], {cwd: root, encoding: 'utf8', windowsHide: true}).split('\0').filter(Boolean)])].sort();
  if (!names.length) throw new Error('No public source files found');
  const failures = [];
  for (const relative of names) {
    if (indexed.has(relative)) {
      const issues = publicationIssues(relative, execFileSync('git', ['cat-file', 'blob', ':' + relative], {cwd: root, windowsHide: true, maxBuffer: 8 * 1024 * 1024}));
      if (issues.length) failures.push({path: relative, source: 'index', issues});
    }
    const full = path.resolve(root, relative);
    let stat;
    try { stat = await fs.lstat(full); } catch (error) { if (error.code === 'ENOENT' && indexed.has(relative)) continue; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || await fs.realpath(full) !== full || !full.startsWith(root + path.sep)) {
      failures.push({path: relative, issues: ['redirect-or-non-file']}); continue;
    }
    const issues = publicationIssues(relative, await fs.readFile(full));
    if (issues.length) failures.push({path: relative, source: 'working-tree', issues});
  }
  return {result: failures.length ? 'failed' : 'passed', checkedFiles: names.length, failures, limitations: 'Pattern checks supplement staged diff review; they are not a complete secrets audit.', modelCalls: 0, worldWrites: 0};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await checkPublication(); console.log(JSON.stringify(report));
  if (report.result !== 'passed') process.exitCode = 1;
}
