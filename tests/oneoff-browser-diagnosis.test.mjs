import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const script=readFileSync(new URL('../scripts/oneoff-browser-diagnosis.mjs', import.meta.url),'utf8');
const flow=readFileSync(new URL('../.github/workflows/oneoff-browser.yml', import.meta.url),'utf8');
test('browser triage prints no private test name or output and cannot deploy',()=>{
 assert.match(script,/const singleTest = tests\[45\]/);
 assert.match(script,/stdio: \['ignore', descriptor, descriptor\]/);
 assert.match(script,/rmSync\(folder/);
 assert.doesNotMatch(script,/console\.log\(.*r\.text\)/);
 assert.doesNotMatch(flow,/CANDIDATE_DEPLOY_TOKEN|CLOUDFLARE_API_TOKEN|upload-artifact/);
});
