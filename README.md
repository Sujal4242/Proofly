# Proofly

**Private Proof-of-Income on Midnight — prove `monthlyIncome >= requiredThreshold` without revealing the income.**

Proofly runs as **two modes** in the same app and repository:

- **Local Demo** — the offline, wallet-free experience. Generates and verifies the
  zero-knowledge proof using the real compiled circuit entirely in the browser
  tab, and demonstrates the privacy property (different incomes → byte-identical
  public inputs) and replay protection (one claim per application). Works
  without Lace or Preprod.
- **Live Preprod** — the real Midnight flow. Connects the **Lace wallet**
  (Midnight DApp Connector) to **Midnight Preprod**, assembles the midnight-js
  browser providers, and proves `income >= requiredMonthlyIncome` on a **deployed
  Proofly contract** via `callTx.proveIncome(requiredMonthlyIncome, applicationId)`.
  Requires Lace, a deployed Proofly contract address, and testnet funds only —
  **no real money**.

## Current state

- **Levels 1–3 are complete and deployed.** The Level 3 contract that adds
  per-application replay protection is deployed on Midnight Preprod; the
  operator deployment is recorded in `docs/evidence/DEPLOYMENT.md`.
- **Level 4 production architecture is configured:** a GitHub Actions CI
  workflow (`.github/workflows/ci.yml`) validates every push/PR, and a Netlify
  static-hosting config (`netlify.toml`) publishes the frontend. Both are
  committed; see `docs/CI-CD.md` and `docs/STATIC-HOSTING.md`.
- Test suite: **47/47 tests passing** across 8 test files.

## Privacy model

- **Public:** the `proofCount` on-chain ledger, the used-nullifier set, the two
  public circuit arguments (`requiredMonthlyIncome`, `applicationId`), and the
  ZK proof/transcript.
- **Private:** the exact monthly income (the `income` witness) and a fresh
  per-claim `applicantId` identity (a second witness that scopes the claim and
  derives the nullifier). Both live only in-memory in the applicant's browser —
  never circuit arguments, never ledger state, never logged, never in a URL,
  never in localStorage/sessionStorage, never sent to a custom API.
- Enforced by tests: `tests/proofly.privacy.test.ts` (byte-identical public
  inputs across different incomes at the same threshold), a real Groth16 proof
  test in `tests/proofly.contract.test.ts`, the nullifier/replay suite
  (`tests/proofly.nullifier.test.ts`), and the Level 2/3 frontend suites covering
  witness wiring, sub-threshold denial, replay denial, error classification,
  config defaults, and Live-mode gating when no contract address is configured.

The **Live mode UI never re-shows the entered income** after proof submission;
only the Local Demo (an explicit local demonstration) displays the values the
applicant typed.

## Level 3: proof-of-income with replay protection

The contract circuit is:

```text
proveIncome(requiredMonthlyIncome: Uint<32>, applicationId: Bytes<32>)
```

- The **exact income is a witness**, never an argument.
- The claim is scoped by a **public `applicationId`** (the applicant must prove
  "my income is ≥ this threshold, for *this* application").
- A **nullifier** is derived from a secret `applicantId` witness plus the
  application scope, and every accepted claim inserts its nullifier into the
  on-chain `usedNullifiers` set. The circuit asserts the nullifier is not
  already present — **repeating the same claim is denied by the contract
  itself**, not by convention in the frontend.

### Replay semantics (what the nullifier actually binds)

The nullifier is `persistentHash(prefix || applicationId || threshold || applicantId)`.
Consequences, all verified by `tests/proofly.nullifier.test.ts`:

| Scenario | Result |
|---|---|
| Same `applicationId` re-claimed with the same identity | **denied** (`Claim already used for this application`) |
| Same `applicationId`, *different* applicant identity | **accepted** — a different, independent claim |
| Different `applicationId`, same identity | **accepted** — a different claim scope |
| Changing only the income (same scope + identity) | **denied** — the nullifier does not depend on income, so the scope is already used |

In **Local Demo** one identity is held fixed per sequence check so replay is
observable; in **Live mode** every claim generates a fresh `applicantId`, so a
claim on a previously used `applicationId` silently becomes a fresh, valid
claim (only a full contract-level replay of the identical triple is denied).

### Deterministic preflight (Live mode)

Before the wallet/prover is asked to produce anything, a **local unproven-circuit
preflight** (`preflightProveIncome`) runs the same circuit + witnesses + public
arguments against the current on-chain ledger. A deterministic denial (income
below threshold, exact replay) surfaces as `Proof denied — <assertion>` and the
wallet is never contacted. Generic preflight failures (indexer/decode) are
non-fatal and fall through to the real wallet flow.

## Architecture

```
Browser static frontend (React + Vite)
        ↓
Lace DApp Connector (window.midnight)
        ↓
midnight-js providers (Midnight.js)
        ↓
Midnight Preprod (public indexer + deployed Proofly contract)
```

No custom backend. No server-side state, no proxy, no deployed "engine", no
custom API. The frontend is static; every network call goes to Midnight/Lace
infrastructure or the public indexer. See `docs/LEVEL3-ARCHITECTURE.md` for the
current provider, privacy, and replay architecture (`docs/LEVEL2-ARCHITECTURE.md`
retains the original Level 2 description).

## Requirements

| Tool | Version |
|---|---|
| **Node.js** | 22.x |
| **Compact CLI** | `compact` (Midnight devtools) **0.5.1**, compiler toolchain **0.31.1** |
| **OS** | Linux / WSL / macOS. The same commands run in GitHub Actions. |

> The compiler is deliberately pinned to **0.31.1** (contract `pragma language_version >= 0.23`, `contracts/managed/proofly/compiler/contract-info.json` reports compiler `0.31.1` / runtime `0.16.0`). Do **not** switch to 0.34.0 — the generated artifacts must match the pinned toolchain.

## Fresh-clone setup

Generated artifacts under `contracts/managed/proofly/` are **gitignored and never committed**, so a fresh clone must compile the contract before anything that reads those artifacts (tests, TypeScript checks under `npm run build`, and the frontend build/dev). The npm scripts below enforce this automatically: if the artifacts are missing, the commands fail fast with:

```
[check-compiled] Missing compiled contract artifacts:
  - contracts/managed/proofly/...
[check-compiled] Fix: run  npm run compile
```

### 1. Install Node 22.x

Use your preferred manager (`nvm`, `fnm`, system packages). Verify:

```bash
node --version   # v22.x
npm --version
```

### 2. Install the Compact devtools CLI and pin the toolchain

```bash
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/download/compact-v0.5.1/compact-installer.sh | sh
compact update 0.31.1
compact list           # 0.31.1 should be marked with →
compact compile --version   # must print 0.31.1
```

### 3. Install npm dependencies

```bash
npm ci                  # root (contract runtime + test tooling)
npm --prefix frontend ci
```

### 4. Compile the Compact contract

```bash
npm run compile
```

This regenerates `contracts/managed/proofly/` (gitignored) — the ZKIR, proving/verifying keys, and the compiled `contract/index.js` + type declarations consumed by both the tests and the frontend.

### 5. Run the tests

```bash
npm test
```

Runs the full **47-test** suite (8 files): contract behaviour + a real Groth16
proof generation/verification, privacy byte-comparisons, nullifier/replay
semantics, and the frontend suites (witness wiring, below-threshold denial,
replay denial, error classification, config defaults, Live-mode gating). The
proof tests fetch the public Groth16 SRS parameters from Midnight's dev S3
fileshare on first run.

### 6. TypeScript checks

```bash
npm run build
```

### 7. Frontend

```bash
npm run build:frontend   # production build (also runs copy-zk-assets from the compiled artifacts)
npm run dev:frontend     # hot-reload dev server → http://localhost:5173
```

### 8. Configure the Live Preprod contract address

Live submission is **disabled until a real deployment provides the address**:

```bash
# Optional, once a contract is deployed on Preprod:
cp frontend/.env.example frontend/.env
# set VITE_CONTRACT_ADDRESS=<hex address from the deployment>
```

Until then the wallet can be connected and the provider foundation is real, but
the "Prove income on Preprod" action stays disabled and the ProofCounter shows a
clear "no deployed contract" state. No contract address is invented.

### 9. Deploy the contract to Midnight Preprod (operator-only, one-time)

The repository contains a **local-only, operator-only deployment script**
(`scripts/deploy-proofly.ts`) that deploys the compiled Proofly contract to
Preprod with a dedicated deployer wallet. It is never run by Netlify or CI.

Operator prerequisites: Node 22, Compact 0.31.1, Docker (the local proof
server is required for the wallet-sdk proving path), and a **dedicated**
deployer seed funded with **testnet** tNIGHT/tDUST through the official
Midnight faucet process (no real money, no fake funding).

```bash
npm run deploy:proofly:validate   # preflight only — no wallet, no transactions
npm run proof-server:start        # local proof server (proof-server:8.1.0, port 6300)
PROOFLY_DEPLOYER_SEED="<64-hex>" npm run deploy:proofly
```

The deployer seed is read **only** from the `PROOFLY_DEPLOYER_SEED` environment
variable (never hardcoded, printed, committed, or exposed to the app/CI). The
script persists gitignored wallet state under `.midnight-wallet-state/`, a
mandatory guard refuses any network other than `preprod`, and it requires
typing `DEPLOY` to confirm. Only **non-secret** evidence is written to
`docs/evidence/DEPLOYMENT.md` (network, contract address, tx ID, block height,
block hash, timestamp, compiler/runtime versions).

Full instructions, security warnings, and verification steps:
**`docs/LEVEL2-DEPLOYMENT.md`**. The Level 3 deployment followed the exact same
procedure; its record is in the Level 3 section of `docs/evidence/DEPLOYMENT.md`.

## CI / CD

`.github/workflows/ci.yml` runs the full validation pipeline on every push and
PR: compile the contract, run all tests, run the TypeScript build, and build the
production frontend — all on the pinned Compact toolchain (0.5.1 CLI, 0.31.1
compiler) and Node 22. Deployments are **not** automated: the operator deploys
the contract manually, and Netlify (below) publishes the static frontend. See
`docs/CI-CD.md` for the exact steps and version pins.

## Static hosting (Netlify)

`netlify.toml` configures a static site build of `frontend/dist`. The Netlify
build repeats the same compile/test/build pipeline and bakes the public
`VITE_*` environment values into the bundle. Configured, committed — a live
deployment is a one-click Netlify action. See `docs/STATIC-HOSTING.md`.

## GitHub Actions compatibility

All build steps are plain POSIX commands (no WSL- or macOS-only syntax):

```
actions/checkout@v4 → actions/setup-node@v4 (node 22) → npm ci (root + frontend)
→ install Compact devtools 0.5.1 + compact update 0.31.1 → npm run compile
→ npm test → npm run build (tsc) → npm run build:frontend
```

## Repository layout

```
contracts/proofly.compact                 ← the Compact contract (source of truth)
scripts/check-compiled.mjs                ← shared guard used by npm lifecycle hooks
tests/                                    ← vitest suite (contract + privacy + nullifier + L2/L3 frontend)
frontend/                                 ← static Vite/React app
frontend/src/config.ts                    ← public config (Preprod defaults, no income)
frontend/src/hooks/useMidnight.ts         ← Lace discovery, connect, disconnect
frontend/src/hooks/useProofly.ts          ← Live proof + preflight + proofCount reads
frontend/src/midnight/providers.ts        ← 7 midnight-js browser providers
frontend/src/midnight/contract-service.ts ← CC.make('proofly').pipe(withWitnesses) + preflight
frontend/src/midnight/witnesses.ts        ← THE privacy boundary (income + applicantId witnesses)
frontend/src/midnight/errors.ts           ← denied vs wallet/funds/network classification
frontend/src/proofly/local-circuit.ts     ← Local Demo circuit runner + claim sequences
frontend/src/components/                  ← LocalDemo, WalletConnect, ProofPanel, ...
frontend/.env.example                     ← VITE_NETWORK_ID / VITE_CONTRACT_ADDRESS / indexer
.github/workflows/ci.yml                  ← full validation on every push/PR (Level 4)
netlify.toml                              ← static publishing config (Level 4)
docs/LEVEL2-ARCHITECTURE.md               ← provider + privacy architecture (original Level 2)
docs/LEVEL2-DEPLOYMENT.md                 ← one-time operator deployment guide (Preprod)
docs/LEVEL3-ARCHITECTURE.md               ← current Level 3 replay architecture
docs/CI-CD.md                             ← GitHub Actions pipeline reference
docs/STATIC-HOSTING.md                    ← Netlify static publishing reference
docs/SECURITY-AND-SECRETS.md              ← secret handling + surfacing policy
docs/FINAL-DEMO-RUNBOOK.md                ← end-to-end demo walkthrough script
docs/evidence/DEPLOYMENT.md               ← deployments actually executed (L2 + L3 records)
scripts/deploy-proofly.ts                 ← local-only deployer (seed via PROOFLY_DEPLOYER_SEED)
scripts/deploy-wallet-state.ts            ← gitignored deployer wallet-state persistence
compose.yml                               ← deploy-only local proof-server container (:6300)
contracts/managed/proofly/                ← generated by `npm run compile` (gitignored)
```