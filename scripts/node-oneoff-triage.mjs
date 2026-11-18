// One-run, read-only test triage. Private test output stays in the runner.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, openSync, closeSync, readFileSync, rmSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

if (process.env.GITHUB_ACTIONS !== 'true') throw Error('CI only');
const workspace = realpathSync(process.env.GITHUB_WORKSPACE || process.cwd());
const root = realpathSync(resolve(workspace, 'candidate'));
if (!root.startsWith(workspace + '/')) throw Error('Invalid source path');
const temp = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'sealed-case-'));
const tracked = execFileSync('git', ['ls-files', '--', 'tests'], { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/).filter(file => /(?:\.test|\.spec)\.(?:mjs|cjs|js)$/.test(file)).sort();

function closedRun(label, command, args, { capture = false, timeout = 18 * 60 * 1000 } = {}) {
  const outputFile = join(temp, 'stage.log');
  const handle = openSync(outputFile, 'w', 0o600);
  let result;
  try {
    result = spawnSync(command, args, {
      cwd: root, env: process.env,
      stdio: ['ignore', handle, handle], timeout
    });
  } finally { closeSync(handle); }
  if (result.error || result.status !== 0) {
    if (capture) return { success: false, output: readFileSync(outputFile, 'utf8') };
    throw Error('Private preparation failed at ' + label);
  }
  return capture ? { success: true, output: '' } : { success: true };
}
try {
  if (tracked.length < 1) throw Error('No candidate tests discovered');
  console.log('Scoped run: only dependency setup, build, browser dependency, Node regression.');
  closedRun('dependencies', 'npm', ['ci', '--no-audit']);
  closedRun('build', 'npm', ['run', 'build']);
  closedRun('browser-dependency', 'npx', ['playwright', 'install', '--with-deps', 'chromium'], {timeout: 25*60*1000});
  const result = closedRun('node-suite', process.execPath, ['--test', '--test-reporter=tap'], { capture: true, timeout: 25*60*1000 });
  if (result.success) {
    console.log('Node regression PASS');
  } else {
    const lines = result.output.split(/\r?\n/);
    const attributed = new Set();
    let failureCount = 0;
    let unknownCount = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!/^not ok\s+\d+\s+-\s+/.test(lines[i])) continue;
      failureCount++;
      const excerpt = lines.slice(i, i + 24).join('\n');
      const possible = tracked.map((file, index) => ({
        index: index + 1,
        file,
        position: excerpt.indexOf(file)
      })).filter(x => x.position >= 0).sort((a,b) => a.position - b.position);
      if (possible.length) attributed.add(possible[0].index);
      else unknownCount++;
    }
    console.log('Node regression FAIL; affected numeric test indices: ' +
      ([...attributed].sort((a,b) => a-b).join(',') || 'unavailable'));
    console.log('Failure entries: ' + failureCount + '; unattributed: ' + unknownCount);
    process.exitCode = 1;
  }
} finally {
  try { rmSync(temp, { recursive: true, force: true }); } catch { /* ephemeral only */ }
}
