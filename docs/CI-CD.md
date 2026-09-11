# Proofly — CI / CD

Proofly uses **GitHub Actions** for CI. There is no automated CD: the contract
is deployed by a local operator script, and the static frontend is published by
Netlify (see `docs/STATIC-HOSTING.md`). Deploy credentials are never present in
CI.

## Status

- The workflow (`.github/workflows/ci.yml`) is **committed** (`ci: add GitHub
  Actions validation`).
- The exact same command sequence has been **run and passed locally** on Linux
  (gates + `actionlint` 1.7.12, exit 0). A GitHub run is triggered automatically
  on the next push / pull request.
- The workflow is **read-only**: `permissions: contents: read` — it cannot
  mutate the repository, and it carries no tokens, seeds, or wallets.

## Triggers

`on: push` and `on: pull_request` — every push to any branch and every PR
(including PRs from forks) runs the full pipeline. A 60-minute job timeout
guards against stalls.

## Pipeline (job `ci`, `ubuntu-latest`, Node 22)

```text
checkout@v4
setup-node@v4  (node 22, npm cache for root + frontend package-lock)
Install Compact devtools CLI 0.5.1   (official curl installer → ~/.local/bin + ~/.compact/bin)
Verify devtools     (compact --version  == compact 0.5.1)
Select toolchain    (compact update 0.31.1; compact list; compact compile --version == 0.31.1)
npm ci                                (root — contract runtime + test tooling)
npm --prefix frontend ci              (frontend — Vite/React)
npm run compile                       (regenerate gitignored compiled artifacts)
npm test                              (47 tests incl. real Groth16 proof)
npm run build                         (tsc, root)
npm run build:frontend                (production frontend build)
```

### Compact install details

The CLI is installed from the official Midnight release artifact
(`compact-v0.5.1/compact-installer.sh`) via curl, and both bin paths are added
to `$GITHUB_PATH`. It never runs from a cached/third-party image and requires no
secret. The compiler is then pinned to the project's toolchain **0.31.1** and
verified with `compact compile --version` before any compile step.

### Environment variables

The frontend build step sets the **step-level** (not job-level) public env:

```text
VITE_NETWORK_ID=preprod
VITE_CONTRACT_ADDRESS=<deployed Proofly contract address>
```

They are **step-level on purpose**: the vitest config suite
(`proofly.frontend-config.test.ts`) asserts that Live mode is disabled when no
contract address is configured, and a job-level default would break that test.
These values are public by design (see `docs/SECURITY-AND-SECRETS.md`); they
are the same values committed in `netlify.toml` and `frontend/.env.example`.

## What CI does NOT do

- Does **not** deploy the contract (operator-only, `scripts/deploy-proofly.ts`,
  local machine).
- Does **not** publish the frontend (Netlify does).
- Does **not** know `PROOFLY_DEPLOYER_SEED` or any wallet/private-state secret.
- Does **not** create or mutate GitHub artifacts/releases.

## Local reproduction

```bash
npm ci && npm --prefix frontend ci
npm run compile
npm test
npm run build
VITE_NETWORK_ID=preprod VITE_CONTRACT_ADDRESS=<address> npm run build:frontend
```

## Related

- `netlify.toml` repeats this pipeline for the static hosting build —
  `docs/STATIC-HOSTING.md`.
- Secret handling policy — `docs/SECURITY-AND-SECRETS.md`.