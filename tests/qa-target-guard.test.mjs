import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertApprovedQaTarget } from '../scripts/qa-target-guard.mjs';

const releaseScript = "const QA = 'neutral-preview';\nconst qaOnly = process.argv.includes('--qa-only');\n" +
  "run('npx', ['--yes', 'wrangler@4', 'deploy', '--config', 'wrangler.qa.jsonc']);";

test('unknown QA worker identity must fail closed', () => {
  const config = { name: 'neutral-preview', workers_dev: true, preview_urls: false };
  assert.throws(() => assertApprovedQaTarget(releaseScript, JSON.stringify(config)),
    /not the approved existing Worker/);
});

test('candidate source and config must agree', () => {
  const config = { name: 'different-preview', workers_dev: true, preview_urls: false };
  assert.throws(() => assertApprovedQaTarget(releaseScript, JSON.stringify(config)),
    /do not match/);
});

test('malformed target config or absent QA identity is refused', () => {
  assert.throws(() => assertApprovedQaTarget(releaseScript, '{not-json'));
  assert.throws(() => assertApprovedQaTarget('const TARGET = "neutral-preview";', '{}'),
    /target not found/);
});

test('workflow does not provide deployment secrets for source checks', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/sealed-candidate.yml', import.meta.url), 'utf8');
  const preflight = workflow.slice(
    workflow.indexOf('      - name: Verify restricted configuration'),
    workflow.indexOf('      - name: Checkout isolated candidate')
  );
  assert.doesNotMatch(preflight, /CANDIDATE_DEPLOY_TOKEN|CANDIDATE_ACCOUNT_ID|CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /github\.actor == github\.repository_owner/);
  assert.match(workflow, /inputs\.confirmation == 'qa-only'/);
  assert.match(workflow, /inputs\.operation == 'release' && secrets\.CANDIDATE_DEPLOY_TOKEN/);
});

test('public deployment code is pinned to a hashed target without literal identity', () => {
  const src = readFileSync(new URL('../scripts/qa-target-guard.mjs', import.meta.url), 'utf8');
  assert.match(src, /PINNED_QA_TARGET_DIGEST = '[a-f0-9]{64}'/);
  assert.match(src, /createHash\('sha256'\)/);
  assert.match(src, /Unexpected production routing configuration/);
  assert.match(src, /QA-only release contract changed/);
});
