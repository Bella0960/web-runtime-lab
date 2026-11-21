# web-runtime-lab

Web interface experiments and isolated verification utilities.

This is a **public runner**, not a source mirror. Never push restricted application code, personal information, credentials, account settings, or private test logs here. The public content guard is mandatory.

## One QA path

- Develop and review restricted source in its own repository. Do not start CI jobs there just to obtain a test receipt.
- Use the existing **Sealed candidate verification** workflow on the public runner for gated verification (`verify`) or an explicitly approved isolated QA publication (`release` with its required confirmation). The public runner obtains the permitted source using its existing restricted checkout credentials; it never publishes that source to this repository.
- The lightweight **Candidate verification (manual)** workflow is only for checking public runner changes. It does not deploy the application and does not upload build artifacts.
- Do not create a separate one-time workflow for each change. Reuse the existing gates and pin the intended candidate revision. Do not infer that an old successful run verifies a newer revision.
- Check each run once for its final receipt instead of polling job steps. If a run is still in progress, report that state without repeating queries.

The public runner's local checks are:

```sh
npm run check:public
npm test
npm run build
npm run test:bundle
```

Existing historical one-time workflows are left untouched. New additions must use the unified workflow instead of extending that collection.
