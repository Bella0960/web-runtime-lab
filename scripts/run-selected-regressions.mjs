// A narrow, read-only diagnostic: run only recently changed tests in isolation.
// Never print private paths, test names, test output, or credentials.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, realpathSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Isolated CI required');
const workspace = realpathSync(process.env.GITHUB_WORKSPACE || process.cwd());
const root = realpathSync(resolve(workspace, 'candidate'));
if (!root.startsWith(workspace + '/')) throw new Error('Unsafe candidate checkout');
const changed = execFileSync('git', ['diff', '--name-only', 'HEAD~12', 'HEAD', '--', 'tests'], {
  cwd: root, encoding: 'utf8'
}).split(/\r?\n/).filter(Boolean).sort();
const files = changed.filter(file => /^tests\/[a-zA-Z0-9._-]+\.test\.mjs$/.test(file));
if (files.length < 1 || files.length > 8 || changed.length !== files.length ||
    files.some(file => !existsSync(join(root, file)))) {
  throw new Error('No safe bounded regression test selection');
}
const original = execFileSync('git', ['status', '--porcelain'], {cwd:root,encoding:'utf8'});
if (original.trim()) throw new Error('Candidate checkout must be clean');
const results = [];
for (const [i, file] of files.entries()) {
  const log = join(process.env.RUNNER_TEMP || tmpdir(), 'isolated-' + randomUUID() + '.log');
  let handle;
  try {
    handle = openSync(log, 'w', 0o600);
    const result = spawnSync(process.execPath, ['--test', file], {
      cwd: root, env: process.env, stdio: ['ignore', handle, handle], timeout: 180000
    });
    results.push({caseNumber:i+1,pass:!result.error && result.status===0});
  } finally {
    if (handle !== undefined) closeSync(handle);
    try { unlinkSync(log); } catch { /* temporary only */ }
  }
}
const finalStatus = execFileSync('git', ['status', '--porcelain'], {cwd:root,encoding:'utf8'});
if (finalStatus.trim()) throw new Error('Diagnostic changed tracked files');
for (const item of results) console.log('Case ' + item.caseNumber + '/' + results.length +
  ': ' + (item.pass ? 'PASS' : 'FAIL'));
if (results.some(x => !x.pass)) process.exitCode = 1;
