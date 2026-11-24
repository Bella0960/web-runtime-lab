// Execute an isolated, credential-scoped validation without exposing source logs.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, readSync, statSync, openSync, closeSync, unlinkSync, realpathSync } from 'node:fs';
import { summarizeSealedFailure, summarizeSealedNodeFailures, summarizeSealedBrowserFailure } from './sealed-failure-summary.mjs';
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
  // Keep private logs on disk while exposing only a fixed, sanitized stage.
  // No test titles, file names, private source, or subprocess output leave CI.
  const result = await new Promise(resolveResult => {
    const child = spawn(process.execPath, args, {
      cwd: source,
      env: environment,
      stdio: ['ignore', descriptor, descriptor]
    });
    const stages = [
      ['preflight', /Pinned existing QA Worker version before tests:/],
      ['regression', /Validating original [A-Z]+ QA candidate/],
      ['post-test-guard', /Node, Vite and Chromium tests passed\./],
      ['upload', /QA-only release: identity core will remain untouched\./],
      ['origin-check', /Post-deployment QA HTTP readiness verified/]
    ];
    let offset = 0, stage = -1, carry = '', timedOut = false;
    const reader = openSync(outputPath, 'r');
    const progress = () => {
      try {
        const size = statSync(outputPath).size;
        while (offset < size) {
          const data = Buffer.alloc(Math.min(size - offset, 65536));
          const count = readSync(reader, data, 0, data.length, offset);
          if (!count) break;
          offset += count;
          const input = carry + data.subarray(0, count).toString('utf8');
          for (let i = stage + 1; i < stages.length; i++) {
            if (stages[i][1].test(input)) {
              stage = i;
              console.log('SEALED_QA_STAGE:' + stages[i][0]);
            }
          }
          carry = input.slice(-256);
        }
      } catch { /* progress output must never affect release safety */ }
    };
    const timer = setInterval(progress, 1000);
    const timeout = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 75 * 60 * 1000);
    let finished = false;
    const finish = result => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      clearTimeout(timeout);
      progress();
      closeSync(reader);
      resolveResult(timedOut ? { ...result, error: { code: 'ETIMEDOUT' } } : result);
    };
    child.once('error', error => finish({ error, status: null }));
    child.once('close', status => finish({ status }));
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
    if (stage === 'adaptive-browser-test' || /^gate-\d+-of-\d+-browser$/.test(stage)) {
      const receipt = summarizeSealedBrowserFailure(sealedLog);
      if (receipt) console.error('Sanitized browser failure: phase=' + receipt.phase + ' category=' + receipt.code);
    }
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
        stage === 'adaptive-tests' || stage === 'regression-unclassified' ||
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
    // Emit only a fixed allowlisted reason for the QA post-test safety gate.
    // Never echo private logs, variable values, requests or account identifiers.
    if (stage === 'post-test-safety-gate' || stage === 'initial-safety-gate') {
      const safeCauses = [
        ['checkout-changed', /Tests altered the checkout|Checkout must be clean/],
        ['candidate-ref-moved', /Unexpected remote branch ref|Remote QA HEAD changed|QA snapshot|candidate HEAD/],
        ['assets-missing', /QA Vite asset missing after build/],
        ['runtime-config-mismatch', /runtime variable|runtime binding|QA bootstrap lifecycle mismatch|Unexpected identity service binding/],
        ['identity-db-proof', /Cloudflare account counts are invalid|Cloudflare account query|founder\/admin no longer matches|identity core contains conflicting accounts/],
        ['cloudflare-read-failed', /Read-only Cloudflare preflight failed/],
        ['worker-version-changed', /QA Worker was deployed by another release|QA identity core changed|QA Worker changed after preflight|QA identity authority changed/],
        ['identity-route-check', /original QA workers\.dev|isolated identity core is unexpectedly public|preview URLs are enabled/],
        ['target-auth-check', /Cloudflare account ID is required|Cloudflare API token is required|QA-only confirmation/],
        ['qa-http-smoke', /QA login document|QA login stylesheet|QA setup cannot accept|QA core is not reachable|QA status endpoint/],
        ['post-upload-check', /QA deployment version did not advance|QA latest deployment|QA identity authority|QA deployed|owner QA domain/]
      ];
      // Use the terminal failure line first; successful earlier tests may contain
      // unrelated error strings. Only fixed labels may leave this runner.
      const stopped = sealedLog.split(/\r?\n/).reverse().find(line =>
        line.includes('QA release stopped:')) || '';
      const precise = [
        ['upload-command-failed', /QA release stopped: npx .*wrangler.*deploy.*failed/],
        ['transient-network', /fetch failed|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|AbortError|TimeoutError/],
        ['identity-db-read-proof', /Cannot prove Cloudflare account query was read-only|incomplete SQL counts/],
        ['identity-core-not-ready', /Refusing QA-only release until|Cannot verify QA identity core state/],
        ['owner-origin-receipt', /owner QA domain|different QA build than the tested git SHA/],
        ['qa-baseline-mismatch', /no longer matches the approved|Candidate must include the currently deployed QA source/],
        ['qa-baseline-receipt', /Current QA source receipt (?:unavailable|invalid)/],
        ['qa-version-proof', /invalid deployed version|latest deployment|identity core changed unexpectedly/],
        ['git-command-failed', /QA release stopped: git .*failed/]
      ];
      const matched = [...precise, ...safeCauses].find(([, pattern]) => pattern.test(stopped))
        || (stage === 'post-test-safety-gate' && safeCauses.find(([, pattern]) => pattern.test(sealedLog)));
      console.error('Sanitized QA ' + (stage === 'initial-safety-gate' ? 'initial' : 'post-test') + ' safety category: ' +
        (matched ? matched[0] : 'other-guard'));
    }
    throw new Error('Candidate validation stopped at ' + stage +
      '; private logs were withheld');
  }
  // Only safe numeric ECO performance receipts leave the sealed runner.
  // Neither raw private logs nor account names, roles or chat texts are published.
  if (mode === 'verify') {
    const receiptPath = join(source, 'test-results', 'eco-unified-browser-receipt.json');
    if (existsSync(receiptPath)) {
      const actual = spawnSync('git', ['-C', source, 'rev-parse', 'HEAD'],
        { encoding: 'utf8', timeout: 10000 });
      if (actual.status !== 0 || !/^[0-9a-f]{40}$/.test(String(actual.stdout || '').trim())) {
        throw new Error('Cannot pin ECO browser performance receipt to a verified SHA');
      }
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
      if (receipt.gitHead !== actual.stdout.trim() ||
          receipt.scope !== 'synthetic-browser-account-metadata (not real Worker login)' ||
          !Array.isArray(receipt.viewports) ||
          receipt.viewports.join(',') !== '375,390,430') {
        throw new Error('ECO browser performance receipt missing or candidate mismatched');
      }
      for (const width of [375, 390, 430]) {
        const times = ['singleChatMemoryQueryMs', 'syntheticAccountSwitchMs',
          'syntheticAccountIsolationQueryMs'].map(key => {
            const value = receipt.timings?.[key + width];
            if (typeof value !== 'number' || !Number.isFinite(value) ||
                value < 0 || value > 120000) {
              throw new Error('ECO browser metric missing: ' + key + width);
            }
            return value.toFixed(3);
          });
        console.log('ECO_CHROMIUM_METRIC:' + width +
          ':memory_query_ms=' + times[0] +
          ':synthetic_account_switch_ms=' + times[1] +
          ':synthetic_account_query_ms=' + times[2]);
      }
    }
  }
  console.log(mode === 'release'
    ? 'Isolated QA-only release passed its private safety and origin checks.'
    : 'Isolated candidate validation passed; no deployment was attempted.');
} finally {
  if (descriptor !== undefined) closeSync(descriptor);
  try { unlinkSync(outputPath); } catch { /* ephemeral runner removes residual files */ }
}
