# web-runtime-lab

Web interface experiments and runtime utilities.

This repository contains isolated, dependency-free experiments and verification tooling. The `qa-candidate` branch has an opt-in verification workflow; ordinary edits to `main` do not run builds.

```sh
npm test
npm run build
npm run test:bundle
```

Only source files explicitly intended for publication belong here. Keep credentials, account data, local configuration, and other private materials outside the repository.

Candidate verification also rejects identifiable project references and credential-like material before building. The public repository should contain only deliberately generic source.
