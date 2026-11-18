import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const s=readFileSync(new URL('../scripts/run-selected-regressions.mjs',import.meta.url),'utf8');
test('narrow diagnostic only reads a bounded, sanitized test list',()=>{
 assert.match(s,/HEAD~12/);
 assert.match(s,/files\.length > 8/);
 assert.match(s,/git', \['status', '--porcelain'\]/);
 assert.match(s,/stdio: \['ignore', handle, handle\]/);
 assert.match(s,/unlinkSync\(log\)/);
 assert.doesNotMatch(s,/console\.log\(.*file\)/);
});
