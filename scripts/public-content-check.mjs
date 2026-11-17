/**
 * Public-surface preflight. Keeps identifying strings and common credentials
 * out of the published source tree and recent commit subjects.
 * This is a release guard, not a replacement for reviewing data before commit.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const markers = [
  [0x6d, 0x61, 0x6f],
  [0x62, 0x65, 0x6c, 0x6c, 0x61, 0x30, 0x39, 0x36, 0x30],
  [0x5c0f, 0x624b, 0x673a],
  [0x7c73, 0x7c73],
  [0x70, 0x68, 0x6f, 0x6e, 0x65, 0x2d, 0x73, 0x69, 0x6d, 0x75, 0x6c, 0x61, 0x74, 0x6f, 0x72]
].map(codePoints => String.fromCodePoint(...codePoints).toLowerCase());

const forbiddenPath = /(?:^|\/)(?:\.env(?:\.|$)|[^/]+\.(?:pem|key|p12|pfx|sqlite|db|zip|tar|gz)$)/i;
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:ghp|gho|ghu|ghs|github_pat)_[a-zA-Z0-9_]{18,}\b/,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}['"]/i
];

const paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0').filter(Boolean);
const violations = [];
for (const path of paths) {
  if (forbiddenPath.test(path)) {
    violations.push(path + ': restricted file type');
    continue;
  }
  const data = readFileSync(path);
  if (data.includes(0)) {
    violations.push(path + ': binary content requires explicit review');
    continue;
  }
  const text = data.toString('utf8');
  const searchable = (path + '\n' + text).toLowerCase();
  if (markers.some(marker => searchable.includes(marker))) {
    violations.push(path + ': identifying marker');
  }
  if (secretPatterns.some(pattern => pattern.test(text))) {
    violations.push(path + ': credential-like material');
  }
}

const subjects = execFileSync('git',
  ['log', '-n', '50', '--format=%s'], { encoding: 'utf8' }).toLowerCase();
if (markers.some(marker => subjects.includes(marker))) {
  violations.push('git history: identifying subject');
}
if (violations.length) {
  console.error('Public content check failed:\n' + violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Public content check passed (' + paths.length + ' tracked files).');
}
