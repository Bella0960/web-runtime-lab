// Run exactly one numbered browser regression from a disposable private checkout.
// Output only case numbers and fixed error categories; never source or full logs.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, openSync, closeSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

if (process.env.GITHUB_ACTIONS !== 'true') throw Error('CI only');
const workspace = realpathSync(process.env.GITHUB_WORKSPACE || process.cwd());
const root = realpathSync(resolve(workspace, 'candidate'));
if (!root.startsWith(workspace + '/')) throw Error('Invalid checkout');
const tests = execFileSync('git', ['ls-files', '--', 'tests'], { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/).filter(file => /(?:\.test|\.spec)\.(?:mjs|cjs|js)$/.test(file)).sort();
if (tests.length < 46) throw Error('Missing test selection');
const singleTest = tests[45];
const folder = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'browser-check-'));
function sealed(label, executable, args, timeout = 20 * 60 * 1000) {
  const logfile = join(folder, label + '.log');
  const descriptor = openSync(logfile, 'w', 0o600);
  let p;
  try {
    p = spawnSync(executable, args, { cwd: root, env: process.env,
      stdio: ['ignore', descriptor, descriptor], timeout });
  } finally { closeSync(descriptor); }
  return { ok: !p.error && p.status === 0, text: readFileSync(logfile, 'utf8') };
}
try {
  if (!sealed('deps', 'npm', ['ci', '--no-audit']).ok) throw Error('Preparation failed: dependencies');
  if (!sealed('browser', 'npx', ['playwright', 'install', '--with-deps', 'chromium'], 25*60*1000).ok)
    throw Error('Preparation failed: browser');
  const r = sealed('single', process.execPath, ['--test', '--test-reporter=tap', singleTest], 20*60*1000);
  if (r.ok) {
    console.log('Isolated browser regression: PASS');
  } else {
    const lines = r.text.split(/\r?\n/);
    const failed = [];
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^not ok\s+(\d+)\s+-\s+/);
      if (!match) continue;
      const nearby = lines.slice(i, i + 35).join('\n');
      let category='other';
      if (/TimeoutError|timeout of \d+ms exceeded|timed out/i.test(nearby)) category='timeout';
      else if (/AssertionError|ERR_ASSERTION/i.test(nearby)) category='assertion';
      else if (/pageerror|TargetClosedError|Navigation/i.test(nearby)) category='browser';
      failed.push({ ordinal: Number(match[1]), category });
    }
    console.log('Isolated browser regression: FAIL');
    for (const f of failed) console.log('Failure case ' + f.ordinal + ': ' + f.category);
    if (!failed.length) console.log('Failure category: test bootstrap or teardown');
    process.exitCode = 1;
  }
} finally {
  try { rmSync(folder, {recursive:true,force:true}); } catch {}
}
