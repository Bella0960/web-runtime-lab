// One-off scoped full regression for an immutable restricted candidate.
// Never log source, test paths, command output, credentials or private fixtures.
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

if (process.env.GITHUB_ACTIONS !== 'true') throw Error('Isolated CI required');
const workspace = realpathSync(process.env.GITHUB_WORKSPACE || process.cwd());
const candidate = realpathSync(resolve(workspace, 'candidate'));
if (!candidate.startsWith(workspace + '/')) throw Error('Restricted candidate must remain isolated');

const entry = readFileSync(join(candidate, 'scripts', 'qa-direct-release.mjs'), 'utf8');
const block = entry.match(/const TESTS\s*=\s*\[([\s\S]*?)\n\];/);
if (!block) throw Error('Verification contract unavailable');
const gates = [...block[1].matchAll(/^\s*\['(npm|node|npx)',\s*\[([^\]\n]+)\]\],?\s*$/gm)]
    .map(m => ({ command: m[1], args: [...m[2].matchAll(/'([^']*)'/g)].map(x => x[1]) }));
if (gates.length < 18 || gates[0].command !== 'npm' || gates[0].args[0] !== 'ci' ||
    !gates.some(g => g.command === 'node' && g.args.includes('--test-concurrency=1')) ||
    !gates.some(g => g.command === 'npm' && g.args.includes('build'))) {
    throw Error('Full regression suite integrity check failed');
}
const log = join(process.env.RUNNER_TEMP || tmpdir(), 'private-' + randomUUID() + '.log');
let fd;
try {
    fd = openSync(log, 'w', 0o600);
    for (const [index, gate] of gates.entries()) {
        const status = spawnSync(gate.command, gate.args, {
            cwd: candidate,
            env: process.env,
            stdio: ['ignore', fd, fd],
            timeout: 70 * 60 * 1000
        });
        if (status.error || status.status !== 0) {
            throw Error('Full regression failed at sealed gate ' + (index + 1) +
                ' of ' + gates.length);
        }
    }
    console.log('Full restricted Node, build and Chromium regression gates passed (' + gates.length + ').');
} finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(log); } catch {}
}
