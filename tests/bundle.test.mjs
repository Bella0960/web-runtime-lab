import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

test('built artifact matches its integrity manifest', async () => {
  const data = await readFile(new URL('../dist/runtime.mjs', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../dist/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.module, 'runtime.mjs');
  assert.equal(manifest.sha256, createHash('sha256').update(data).digest('hex'));
});
