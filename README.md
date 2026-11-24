# web-runtime-lab

Isolated verification tooling and the reusable QA request entry point.

## Current QA request path

Use `.github/workflows/reusable-qa-request.yml` via the owner-authorized request file `.github/qa-release-request.json` or its manual dispatch. Select an immutable 40-character candidate commit on an approved integration or QA branch. Verify has no deployment credentials; release requires `qa-only` and the existing QA target guard. Contract test success is not a deployment receipt. Confirm the actual run and deployed candidate separately.

The reusable entry is the default migration path. The legacy sealed entry is retained only as a temporary fallback until a successful end-to-end cutover is independently verified. Do not edit workflow files to request a new version or create more one-off pinned workflows. Do not use historical candidate IDs as current release requests.

The `qa-candidate` branch has a separate opt-in generic experiment verification workflow. Ordinary changes to main do not request a release unless the request file changes.

```sh
npm test
npm run build
npm run test:bundle
```

Keep credentials, account data, local configuration and sensitive materials outside the repository. Existing public content, target, candidate and deployment guards remain mandatory. Retiring a workflow does not remove historical Git commits or rollback records.
