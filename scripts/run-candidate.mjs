// Execute an isolated, credential-scoped validation without exposing source logs.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, readSync, statSync, openSync, closeSync, unlinkSync, realpathSync } from 'node:fs';
import { summarizeSealedFailure, summarizeSealedNodeFailures } from './sealed-failure-summary.mjs';
import { assertApprovedQaTarget } from './qa-target-guard.mjs';
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
// Run the complete diagnostic sweep only for non-deploy validation.
// Release remains strict fail-fast with all existing deployment guards.
if (mode === 'verify') {
  environment.SEALED_VERIFY_COLLECT_GATES = '1';
} else {
  delete environment.SEALED_VERIFY_COLLECT_GATES;
}
if (mode === 'release') {
  // Verify the immutable Worker identity and config before any deployment.
  // Matching filenames or an --qa-only flag alone is insufficient.
  const configPath = join(source, 'wrangler.qa.jsonc');
  if (!existsSync(configPath)) {
    throw new Error('Private QA deployment configuration missing');
  }
  const approvedWorker = assertApprovedQaTarget(
    releaseSource, readFileSync(configPath, 'utf8')
  );
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
  if (worker[1] !== approvedWorker) {
    throw new Error('Release Worker name mismatch');
  }
  environment[confirmation[1]] = approvedWorker;
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
    // Read a bounded tail for safe diagnostics. Raw output never enters public logs.
    const size = statSync(outputPath).size;
    const length = Math.min(size, 16 * 1024 * 1024);
    const bytes = Buffer.alloc(length);
    const reader = openSync(outputPath, 'r');
    try { if (length) readSync(reader, bytes, 0, length, size - length); }
    finally { closeSync(reader); }
    const sealedLog = bytes.toString('utf8');
    const stage = summarizeSealedFailure(releaseSource, sealedLog, {
      timedOut: result.error?.code === 'ETIMEDOUT'
    });
    // Any failed Node-based gate may emit TAP failures, not only the full
    // Node suite at gate 18. Only allowlisted test paths and fixed codes
    // leave the ephemeral runner; never echo raw npm/Node logs.
    const gateReport = [...sealedLog.matchAll(/^QA_DIAGNOSTIC_FAILED_GATES:([0-9,]{1,80})$/gm)]
      .map(match => match[1]).at(-1);
    if (stage === 'multiple-required-test-gates' && gateReport) {
      const gates = [...new Set(gateReport.split(',').map(Number))]
        .filter(n => Number.isSafeInteger(n) && n >= 1 && n <= 20)
        .sort((a, b) => a - b);
      if (gates.length) console.error('Failed required QA gate numbers: ' + gates.join(','));
    }
    // Browser suites do not use TAP. Emit only a fixed numeric progress
    // checkpoint rather than private browser errors, source or page data.
    if (mode === 'verify') {
      const checkpoints = [...sealedLog.matchAll(/^(?:#\s*)?SEALED_BROWSER_CHECKPOINT:([0-9]{1,3})$/gm)];
      const latest = checkpoints.at(-1)?.[1];
      const checkpoint = latest === undefined ? NaN : Number(latest);
      if ([0, 10, 375, 390, 391, 392, 393, 394, 430, 500, 600, 700].includes(checkpoint)) {
        console.error('Sanitized browser checkpoint: ' + checkpoint);
      }
    }
    // A complete Node suite includes browser tests without TAP stack frames.
    // Only bounded numeric checkpoints are allowed into public logs.
    if (mode === 'verify') {
      const memoryMatches = [...sealedLog.matchAll(/^(?:#\s*)?SEALED_MEMORY_CHECKPOINT:([0-9]{1,4})$/gm)];
      const lastMemory = memoryMatches.at(-1)?.[1];
      const memoryCheckpoint = lastMemory === undefined ? NaN : Number(lastMemory);
      const widths = [375, 390, 430, 1100];
      const permitted = [1, 2].concat(widths.flatMap(width =>
        [0, 1, 2, 3, 4, 5, 6, 7].map(n => width + n)));
      if (permitted.includes(memoryCheckpoint)) {
        console.error('Sanitized memory-browser checkpoint: ' + memoryCheckpoint);
      }
    }
    if (/^gate-\d+-of-\d+-tests$/.test(stage) ||
        stage === 'multiple-required-test-gates') {
      const testDir = join(source, 'tests');
      const files = existsSync(testDir)
        ? readdirSync(testDir, { withFileTypes: true })
            .filter(item => item.isFile()).map(item => item.name)
        : [];
      const locations = summarizeSealedNodeFailures(sealedLog, files);
      if (locations.length) {
        console.error('Sanitized failing test locations (test titles and values withheld):');
        for (const item of locations) {
          console.error('  tests/' + item.file + ':' + item.line + ' [' + item.code + ']');
        }
      } else {
        console.error('No safely extractable failing test locations in bounded Node output.');
      }
      if (size > length) console.error('Diagnostic log was truncated to a bounded tail.');
    }
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
