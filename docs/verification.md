# Candidate verification

The `qa-candidate` branch runs a small, isolated build when a commit is pushed.
Ordinary work on `main` is intentionally not built on every change.

1. Run only the targeted tests for the public source in this repository.
2. Produce a deterministic artifact and verify its checksum.
3. Store that artifact for short-lived inspection. This workflow does **not** deploy any website.

Do not add credentials, account records, private source trees, or production environment variables.
Integration into another repository must be reviewed and released by that repository's own checks.
