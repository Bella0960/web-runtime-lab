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
    if (String(sealedLog).includes('Node, Vite and Chromium tests passed.')) {
      return 'post-test-safety-gate';
    }
    const regressionStarted = /^(?:Validating original .* QA candidate; production is never targeted\.|QA_TEST_PLAN:(?:standard|presentation|module))\s*$/m.test(String(sealedLog));
    if (regressionStarted) {
      // Dynamic module gates are not in the legacy fixed TESTS array.
      // Return fixed categories only, never the terminal command or its paths.
      const command = stopped.match(/QA release stopped: ((?:npm|node|npx) [^\r\n]{1,4096}) failed \(exit (?:[0-9]+|null)\)/)?.[1] || '';
      if (/^npm ci(?: |$)/.test(command)) return 'adaptive-dependencies';
      if (/^npm run build(?: |$)/.test(command)) return 'adaptive-build';
      if (/^npx playwright install(?: |$)/.test(command)) return 'adaptive-browser-install';
      if (/^node .*\btests\/[a-zA-Z0-9._-]*(?:browser|\.smoke)\.mjs(?: |$)/.test(command)) return 'adaptive-browser-test';
      if (/^node --test(?: |$)|^node tests\/[a-zA-Z0-9._-]+\.test\.mjs(?: |$)|^npm run test:[a-zA-Z0-9:_-]+(?: |$)/.test(command)) return 'adaptive-tests';
      return 'regression-unclassified';
    }
    return 'initial-safety-gate';
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

// A bounded, allowlisted receipt emitted by browser tests. Never return arbitrary log text.
export function summarizeSealedBrowserFailure(log) {
  const matches = [...String(log).matchAll(/^SEALED_BROWSER_FAILURE:([0-9]{1,3}):(timeout|assertion|browser-environment|local-server|other)\s*$/gm)];
  const last = matches.at(-1);
  if (!last) return null;
  const phase = Number(last[1]);
  const allowed = [0, 1, ...[375,390,430].flatMap(w => Array.from({length:8},(_,i)=>w+i))];
  return allowed.includes(phase) ? {phase, code:last[2]} : null;
}


// Resolve the failing browser script from the terminal gate line, but only
// return a basename that exists in the candidate's tests/ directory and has
// an explicitly browser-oriented filename. Never echo the raw command/log.
export function summarizeSealedBrowserTestFailure(sealedLog, allowedBrowserFiles = []) {
  const allowed = new Set(allowedBrowserFiles.filter(name =>
    /^[a-z0-9][a-z0-9._-]{0,90}(?:\.browser|-browser|\.smoke)\.mjs$/i.test(name)
  ));
  if (!allowed.size) return null;
  const stopped = String(sealedLog).split(/\r?\n/)
    .reverse().find(line => line.includes('QA release stopped:')) || '';
  const match = stopped.match(
    /^QA release stopped: node tests\/([a-z0-9][a-z0-9._-]{0,90}\.mjs) failed \(exit (?:[0-9]+|null)\):/i
  );
  if (!match || !allowed.has(match[1])) return null;
  return { file: match[1], code: 'BROWSER_TEST_FAILED' };
}
