// Return a deliberately non-sensitive failure location from a sealed process log.
// Never return logs, commands, filenames, repository identifiers or test output.
export function summarizeSealedFailure(releaseSource, sealedLog, { timedOut = false } = {}) {
  if (timedOut) return 'process-timeout';
  const body = String(releaseSource).match(/const TESTS\s*=\s*\[([\s\S]*?)\n\];/)?.[1] || '';
  const gates = [...body.matchAll(/^\s*\['(npm|node|npx)',\s*\[([^\]\n]+)\]\],?\s*$/gm)]
    .map(match => ({
      command: match[1],
      arguments: [...match[2].matchAll(/'([^']*)'/g)].map(part => part[1])
    }));
  const stopped = String(sealedLog).split(/\r?\n/)
    .reverse().find(line => line.includes('QA release stopped:')) || '';
  for (const [index, gate] of gates.entries()) {
    const command = gate.command + ' ' + gate.arguments.join(' ');
    if (!stopped.includes('QA release stopped: ' + command + ' failed (exit ')) continue;
    let category = 'tests';
    if (gate.command === 'npm' && gate.arguments[0] === 'ci') category = 'dependencies';
    else if (gate.arguments.includes('build')) category = 'build';
    else if (gate.arguments.some(x => /browser|playwright|chromium/.test(x))) category = 'browser';
    return 'gate-' + (index + 1) + '-of-' + gates.length + '-' + category;
  }
  if (stopped) {
    if (!String(sealedLog).includes('Node, Vite and Chromium tests passed.'))
      return 'initial-safety-gate';
    // Fixed allowlist: output generic post-test stage only, never private values.
    for (const [pattern, category] of [
      ['Tests altered the checkout', 'posttest-dirty-checkout'],
      ['QA Vite asset missing', 'posttest-missing-dist'],
      ['Unexpected remote branch ref', 'posttest-remote-branch'],
      ['QA Worker was deployed by another release', 'posttest-worker-race'],
      ['QA identity core changed', 'posttest-core-race'],
      ['Read-only Cloudflare preflight failed at', 'posttest-cloudflare-api'],
      ['QA bootstrap lifecycle mismatch', 'posttest-identity-bootstrap'],
      ['The original QA founder/admin no longer matches', 'posttest-founder-state'],
      ['The isolated identity core contains conflicting accounts', 'posttest-core-state'],
      ['QA snapshot', 'posttest-snapshot'],
      ['Release would unexpectedly change', 'posttest-binding-change']
    ]) {
      if (stopped.includes(pattern)) return category;
    }
    return 'post-test-safety-gate';
  }
  return 'unclassified-private-failure';
}
