import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const source = await readFile(new URL('../src/runtime.mjs', import.meta.url));
const destination = new URL('../dist/', import.meta.url);
await mkdir(destination, { recursive: true });
await writeFile(new URL('../dist/runtime.mjs', import.meta.url), source);
const manifest = {
  module: 'runtime.mjs',
  sha256: createHash('sha256').update(source).digest('hex')
};
await writeFile(new URL('../dist/manifest.json', import.meta.url),
  JSON.stringify(manifest, null, 2) + '\n');
console.log('Built verified runtime artifact.');
