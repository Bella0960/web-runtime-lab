import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSealedFailure, summarizeSealedNodeFailures } from '../scripts/sealed-failure-summary.mjs';

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

test('timeouts and unknown errors never reveal log lines', () => {
  assert.equal(summarizeSealedFailure(source, 'secret', { timedOut: true }), 'process-timeout');
  assert.equal(summarizeSealedFailure(source, 'hidden sensitive data'), 'unclassified-private-failure');
});


test('sanitized failing test locations omit test names, data and absolute paths', () => {
  const secret = 'PRIVATE-VALUE-DO-NOT-PRINT';
  const log = [
    'TAP version 13',
    '# Subtest: ' + secret,
    'not ok 12 - ' + secret,
    '  ---',
    "  location: '/home/runner/work/project/tests/chat-error.test.mjs:42:1'",
    "  code: 'ERR_ASSERTION'",
    '  error: ' + secret,
    '  stack: |-',
    '    TestContext.<anonymous> (file:///home/runner/work/project/tests/chat-error.test.mjs:49:12)',
    '  ...',
    'not ok 13 - second failure',
    '  ---',
    "  location: '/home/runner/work/project/tests/forum-data.test.mjs:10:1'",
    "  code: 'ERR_TEST_FAILURE'",
    '  ...'
  ].join('\n');
  const found = summarizeSealedNodeFailures(log, ['chat-error.test.mjs', 'forum-data.test.mjs']);
  assert.deepEqual(found, [
    { file: 'chat-error.test.mjs', line: 49, code: 'ERR_ASSERTION' },
    { file: 'forum-data.test.mjs', line: 10, code: 'ERR_TEST_FAILURE' }
  ]);
  assert.doesNotMatch(JSON.stringify(found), /PRIVATE-VALUE|home\/runner|Subtest/);
});

test('untrusted test output cannot inject paths, credentials or error details', () => {
  const log = [
    'TAP version 13',
    'not ok 1 - fabricated title',
    '  ---',
    "  location: '/tmp/tests/unapproved.test.mjs:2:1'",
    "  code: 'ERR_ASSERTION'",
    '  ...',
    'not ok 2 - allowed title',
    '  ---',
    "  location: '/tmp/tests/allowed.test.mjs:12:1'",
    "  code: 'ERR_NOT_A_SAFE_VALUE'",
    '  ...'
  ].join('\n');
  assert.deepEqual(summarizeSealedNodeFailures(log, ['allowed.test.mjs']), [
    { file: 'allowed.test.mjs', line: 12, code: 'TEST_FAILURE' }
  ]);
  assert.deepEqual(summarizeSealedNodeFailures(log, []), []);
});


test('verify-only diagnostic reports multiple required gate failures without exposing raw logs', () => {
  const log = [
    'TAP version 13',
    'not ok 1 - private test title',
    '  ---',
    "  location: '/private/tests/first-failure.test.mjs:12:1'",
    "  code: 'ERR_ASSERTION'",
    '  ...',
    'QA release stopped at intermediate test gate (private)',
    'TAP version 13',
    'not ok 2 - second private name',
    '  ---',
    "  location: '/private/tests/second-failure.test.mjs:34:1'",
    "  code: 'ERR_TEST_FAILURE'",
    '  ...',
    'QA_DIAGNOSTIC_FAILED_GATES:6,8,18'
  ].join('\n');
  assert.equal(summarizeSealedFailure(source, log), 'multiple-required-test-gates');
  const found = summarizeSealedNodeFailures(log, ['first-failure.test.mjs','second-failure.test.mjs']);
  assert.deepEqual(found, [
    { file: 'first-failure.test.mjs', line: 12, code: 'ERR_ASSERTION' },
    { file: 'second-failure.test.mjs', line: 34, code: 'ERR_TEST_FAILURE' }
  ]);
  assert.doesNotMatch(JSON.stringify(found), /private test title|second private name|private\//);
});
