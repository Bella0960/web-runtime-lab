import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../scripts/node-oneoff-triage.mjs',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../.github/workflows/oneoff-node.yml',import.meta.url),'utf8');
test('temporary triage does not receive deployment access or publish source files',()=>{
  assert.match(workflow,/CANDIDATE_READ_TOKEN/);
  assert.doesNotMatch(workflow,/CANDIDATE_DEPLOY_TOKEN|CLOUDFLARE_API_TOKEN|upload-artifact|cache@/);
  assert.match(workflow,/github\.actor == github\.repository_owner/);
  assert.match(source,/rmSync\(temp,/);
  assert.match(source,/stdio: \['ignore', handle, handle\]/);
  assert.doesNotMatch(source,/console\.log\(.*output\)/);
});
