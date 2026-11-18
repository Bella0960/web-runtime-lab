import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/sealed-candidate.yml', import.meta.url), 'utf8');
const script = readFileSync(new URL('../scripts/run-candidate.mjs', import.meta.url), 'utf8');

test('sealed verification can only be manually dispatched', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^  push:/m);
  assert.doesNotMatch(workflow, /^  pull_request:/m);
  assert.match(workflow, /permissions:\s*\n  contents: read/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test('candidate requires restricted source and release requires explicit acknowledgement', () => {
  assert.match(workflow, /secrets\.CANDIDATE_REPOSITORY/);
  assert.match(workflow, /secrets\.CANDIDATE_READ_TOKEN/);
  assert.match(workflow, /secrets\.CANDIDATE_REF/);
  assert.match(workflow, /CONFIRMATION.*qa-only|qa-only.*confirmation/is);
  assert.match(script, /args\.push\('--qa-only'\)/);
  assert.doesNotMatch(script, /args\.push\('--deploy'\)/);
});

test('candidate source, build artifacts and raw output are never published', () => {
  assert.doesNotMatch(workflow, /upload-artifact|actions\/cache|working-directory: candidate/);
  assert.match(script, /stdio:\s*\['ignore', descriptor, descriptor\]/);
  assert.match(script, /unlinkSync\(outputPath\)/);
  assert.match(script, /Expected candidate validation and safety gates are missing/);
  assert.doesNotMatch(script, /console\.(log|error)\(.*(releaseSource|result\.stderr|readFileSync\(outputPath)/);
});

test('workflow source includes no forbidden identifying tokens', () => {
  const forbidden = String.fromCharCode(109, 97, 111);
  for (const content of [workflow, script]) {
    assert.equal(content.toLowerCase().includes(forbidden), false);
  }
});
