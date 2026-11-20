import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSealedFailure } from '../scripts/sealed-failure-summary.mjs';

const source = `const TESTS = [
  ['npm', ['ci', '--no-audit']],
  ['npm', ['run', 'test:unit']],
  ['npm', ['run', 'build']],
  ['node', ['--test']],
  ['npx', ['playwright', 'install', 'chromium']]
];`;

test('only a generic numeric gate and category are returned', () => {
  assert.equal(summarizeSealedFailure(source,
    'private content 123\nQA release stopped: npm run test:unit failed (exit 1): hidden'),
    'gate-2-of-5-tests');
  assert.equal(summarizeSealedFailure(source,
    'QA release stopped: npm ci --no-audit failed (exit 1): hidden'),
    'gate-1-of-5-dependencies');
  assert.equal(summarizeSealedFailure(source,
    'QA release stopped: npm run build failed (exit 1): hidden'),
    'gate-3-of-5-build');
  assert.equal(summarizeSealedFailure(source,
    'QA release stopped: npx playwright install chromium failed (exit 1): hidden'),
    'gate-5-of-5-browser');
});

test('preflight failures are distinguished without exposing private error details', () => {
  const privateMessage = 'private-stuff::path::credential';
  const result = summarizeSealedFailure(source, 'QA release stopped: ' + privateMessage);
  assert.equal(result, 'initial-safety-gate');
  assert.doesNotMatch(result, /private-stuff|credential/);
  assert.equal(summarizeSealedFailure(source,
    'Node, Vite and Chromium tests passed.\nQA release stopped: unexpected'),
    'post-test-safety-gate');
});

test('post-test blocking classifies only known safety gates without leaking private text', () => {
  const base = 'Node, Vite and Chromium tests passed.\nQA release stopped: ';
  assert.equal(summarizeSealedFailure(source, base +
    'Tests altered the checkout: refusing to upload uncommitted source (secret)'),
    'posttest-dirty-checkout');
  assert.equal(summarizeSealedFailure(source, base +
    'QA Vite asset missing after build: private-data'),
    'posttest-missing-dist');
  assert.equal(summarizeSealedFailure(source, base +
    'Read-only Cloudflare preflight failed at /hidden-path (HTTP 503)'),
    'posttest-cloudflare-api');
});

test('timeouts and unknown errors never reveal log lines', () => {
  assert.equal(summarizeSealedFailure(source, 'secret', { timedOut: true }), 'process-timeout');
  assert.equal(summarizeSealedFailure(source, 'hidden sensitive data'), 'unclassified-private-failure');
});
