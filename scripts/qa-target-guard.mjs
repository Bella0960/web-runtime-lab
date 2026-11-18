// Compare the private candidate's QA target against an approved fixed digest.
// The public repository never stores the private Worker name or account ID.
import { createHash } from 'node:crypto';

const PINNED_QA_TARGET_DIGEST = 'a47c119a7579a712ec8b78e47c8534d889dedfd69561ea52e4d6f3b30ff3879c';

export function assertApprovedQaTarget(releaseSource, configSource) {
  const source = String(releaseSource);
  const assignment = source.match(/const QA\s*=\s*'([^']+)'/);
  if (!assignment) throw new Error('Private QA release target not found');
  const config = JSON.parse(configSource);
  if (config?.name !== assignment[1]) {
    throw new Error('Release source and QA deployment configuration do not match');
  }
  const digest = createHash('sha256').update(config.name, 'utf8').digest('hex');
  if (digest !== PINNED_QA_TARGET_DIGEST) {
    throw new Error('QA deployment target is not the approved existing Worker');
  }
  for (const key of ['routes', 'route', 'custom_domains', 'zone_id', 'zone_name']) {
    if (Object.hasOwn(config, key)) {
      throw new Error('Unexpected production routing configuration');
    }
  }
  if (config.workers_dev !== true || config.preview_urls !== false) {
    throw new Error('QA public URL policy changed');
  }
  if (!source.includes('const qaOnly = process.argv.includes(\'--qa-only\')') ||
      !source.includes("run('npx', ['--yes', 'wrangler@4', 'deploy', '--config', 'wrangler.qa.jsonc'])")) {
    throw new Error('QA-only release contract changed');
  }
  return config.name;
}
