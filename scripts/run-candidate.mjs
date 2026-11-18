// Execute an isolated, credential-scoped validation without exposing source logs.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readSync, statSync, openSync, closeSync, unlinkSync, realpathSync } from 'node:fs';
import { summarizeSealedFailure } from './sealed-failure-summary.mjs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const mode = process.argv[2] || 'verify';
if (mode !== 'verify' && mode !== 'release') {
  throw new Error('Only verify and release operations are supported');
}
if (process.env.GITHUB_ACTIONS !== 'true') {
  throw new Error('This runner is restricted to an isolated CI job');
}

const workspace = realpathSync(process.env.GITHUB_WORKSPACE || process.cwd());
const source = realpathSync(resolve(workspace, 'candidate'));
if (!source.startsWith(workspace + '/')) {
  throw new Error('Candidate checkout must stay inside the isolated workspace');
}

const script = join(source, 'scripts', 'qa-direct-release.mjs');
if (!existsSync(script)) {
  throw new Error('Candidate does not contain its expected release gates');
}
const releaseSource = readFileSync(script, 'utf8');
if (!releaseSource.includes('preflightCheckout();') ||
    !releaseSource.includes('await cloudflarePreflight()') ||
    !releaseSource.includes('assertReadyForUpload({ allowPinned: qaOnly })')) {
  throw new Error('Expected candidate validation and safety gates are missing');
}

const environment = { ...process.env };
const args = [script];
if (mode === 'release') {
  if (process.env.CANDIDATE_RELEASE_ACK !== 'qa-only' ||
      !environment.CLOUDFLARE_API_TOKEN || !environment.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error('QA-only confirmation and scoped deployment credentials are required');
  }
  const worker = releaseSource.match(/const QA\s*=\s*'([^']+)'/);
  const confirmation = releaseSource.match(
    /assert\.equal\(process\.env\.([A-Z_][A-Z0-9_]*),\s*QA,/
  );
  if (!worker || !confirmation) {
    throw new Error('QA-only target or confirmation contract was not verified');
  }
  environment[confirmation[1]] = worker[1];
  args.push('--qa-only');
}

// Private build output can include internal file paths, URLs, or test fixtures.
// Keep it in the ephemeral runner only. Never expose it as public Actions logs
// or upload it to public artifacts, even if verification fails.
const outputPath = join(process.env.RUNNER_TEMP || tmpdir(), 'sealed-' + randomUUID() + '.log');
let descriptor;
try {
  descriptor = openSync(outputPath, 'w', 0o600);
  const result = spawnSync(process.execPath, args, {
    cwd: source,
    env: environment,
    stdio: ['ignore', descriptor, descriptor],
    timeout: 75 * 60 * 1000
  });
  if (result.error || result.status !== 0) {
    // Read only a bounded tail of the sealed local log. The classification
    // is a fixed generic label; no private output enters public Actions logs.
    const size = statSync(outputPath).size;
    const length = Math.min(size, 128 * 1024);
    const bytes = Buffer.alloc(length);
    const reader = openSync(outputPath, 'r');
    try { if (length) readSync(reader, bytes, 0, length, size - length); }
    finally { closeSync(reader); }
    const stage = summarizeSealedFailure(releaseSource, bytes.toString('utf8'), {
      timedOut: result.error?.code === 'ETIMEDOUT'
    });
    throw new Error('Candidate validation stopped at ' + stage +
      '; private logs were withheld');
  }
  console.log(mode === 'release'
    ? 'Isolated QA-only release passed its private safety and origin checks.'
    : 'Isolated candidate validation passed; no deployment was attempted.');
} finally {
  if (descriptor !== undefined) closeSync(descriptor);
  try { unlinkSync(outputPath); } catch { /* ephemeral runner removes residual files */ }
}
