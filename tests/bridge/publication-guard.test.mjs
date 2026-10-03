import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {publicationIssues, checkPublication} from '../../scripts/publication-check.mjs';

const bytes = value => Buffer.from(value);
test('ordinary public source and compatibility identifiers are allowed', () => {
  assert.deepEqual(publicationIssues('mod/src/main/resources/fabric.mod.json', bytes('{"name":"UltraAgentbuilder","id":"voxel_studio"}')), []);
  assert.deepEqual(publicationIssues('docs/STATUS.md', bytes('Offline tests do not certify production placement.')), []);
});
test('private runtime data, accounts, worlds and exports are rejected', () => {
  for (const name of ['data/connection.json', '.env', '.codex/auth.json', 'sessions/answer.txt', 'mod/run/saves/demo/level.dat', 'build/report.json', 'captures.zip', 'runtime/node.exe', 'building.schem']) assert.ok(publicationIssues(name, bytes('{}')).includes('private-or-generated-file'), name);
});
test('sensitive content is reported without returning the actual value', () => {
  const localPath = ['D:', 'AI_project', 'private', 'answer.json'].join('/');
  const url = 'https://' + 'example-private-tunnel' + '.trycloudflare' + '.com/mcp';
  for (const value of [localPath, url]) assert.deepEqual(publicationIssues('docs/example.md', bytes(value)), ['private-local-path-or-temporary-url']);
  const token = 'gh' + 'o_' + 'A'.repeat(40);
  assert.deepEqual(publicationIssues('bridge/example.mjs', bytes(token)), ['credential-or-private-key']);
});
test('unexpected binary, changed wrapper, and unsafe paths are rejected', () => {
  assert.deepEqual(publicationIssues('photo.png', Buffer.from([0, 1, 2])), ['unapproved-binary']);
  assert.deepEqual(publicationIssues('mod/gradle/wrapper/gradle-wrapper.jar', bytes('replacement')), ['unapproved-binary']);
  assert.ok(publicationIssues('../outside.mjs', bytes('')).includes('unsafe-path'));
});
test('the repository guard rejects a directory with no independent git root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'public-guard-'));
  try { await assert.rejects(checkPublication(root)); }
  finally { await fs.rm(root, {recursive: true, force: false}); }
});
