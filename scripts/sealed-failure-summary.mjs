// Return a deliberately non-sensitive failure location from a sealed process log.
// The stage summary never returns raw log content. The separate diagnostic helper only returns
// allowlisted test filenames, numeric line numbers and fixed error codes.
export function summarizeSealedFailure(releaseSource, sealedLog, { timedOut = false } = {}) {
  if (timedOut) return 'process-timeout';
  // Verify-only diagnostics still fail the job; report the complete set of
  // required failed gates rather than just the final failing test.
  if (/^QA_DIAGNOSTIC_FAILED_GATES:[0-9,]{1,80}$/m.test(String(sealedLog))) {
    return 'multiple-required-test-gates';
  }
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


// Extract source locations from TAP failures while never emitting raw diagnostics.
// The caller supplies filenames from the checked-out repository's tests/ folder.
export function summarizeSealedNodeFailures(sealedLog, allowedTestFiles = []) {
  const allowed = new Set(allowedTestFiles.filter(
    name => /^[a-z0-9][a-z0-9._-]{0,90}\.test\.(?:mjs|js)$/i.test(name)
  ));
  if (!allowed.size) return [];
  const input = String(sealedLog);
  // Verify-only may contain several test processes. Parse all TAP blocks in
  // the bounded ephemeral log, not just the last process's TAP header.
  const tapStart = input.indexOf('TAP version 13');
  const lines = (tapStart >= 0 ? input.slice(tapStart) : input).split(/\r?\n/);
  const failures = [];
  let block = null;
  const pathMatch = line => line.match(
    /(?:^|[\\/])tests[\\/]([a-z0-9][a-z0-9._-]{0,90}\.test\.(?:mjs|js)):(\d{1,6}):(\d{1,6})\b/i
  );
  const save = () => {
    if (!block) return;
    const location = block.stack || block.location;
    if (location && failures.length < 40) {
      failures.push({ file: location.file, line: location.line, code: block.code });
    }
    block = null;
  };
  for (const line of lines) {
    if (/^not ok \d+ - /.test(line)) {
      save();
      block = { code: 'TEST_FAILURE', location: null, stack: null, inStack: false };
      continue;
    }
    if (!block) continue;
    if (/^\s*\.\.\.\s*$/.test(line)) { save(); continue; }
    if (/^\s*stack:/.test(line)) block.inStack = true;
    const location = pathMatch(line);
    if (location && allowed.has(location[1])) {
      const clean = { file: location[1], line: Number(location[2]) };
      if (/^\s*location:/.test(line)) block.location = clean;
      else if (block.inStack && !block.stack) block.stack = clean;
    }
    const code = line.match(
      /^\s*code: '(ERR_ASSERTION|ERR_TEST_FAILURE|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND)'\s*$/
    );
    if (code) block.code = code[1];
  }
  save();
  return [...new Map(
    failures.map(item => [item.file + ':' + item.line + ':' + item.code, item])
  ).values()];
}
