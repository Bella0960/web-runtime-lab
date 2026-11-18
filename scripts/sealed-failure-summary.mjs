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
    return String(sealedLog).includes('Node, Vite and Chromium tests passed.')
      ? 'post-test-safety-gate' : 'initial-safety-gate';
  }
  return 'unclassified-private-failure';
}
