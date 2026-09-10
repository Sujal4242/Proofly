# Proofly

**Private Proof-of-Income on Midnight — prove `monthlyIncome >= requiredThreshold` without revealing the income.**

Proofly runs as **two modes** in the same app and repository:

- **Local Demo** — the offline, wallet-free experience. Generates and verifies the
  zero-knowledge proof using the real compiled circuit entirely in the browser
  tab, and demonstrates the privacy property (different incomes → byte-identical
  public inputs). Works without Lace or Preprod.
- **Live Preprod** — the real Midnight flow. Connects the **Lace wallet**
  (Midnight DApp Connector) to **Midnight Preprod**, assembles the midnight-js
  browser providers, and proves `income >= requiredMonthlyIncome` on a **deployed
  Proofly contract** via `callTx.proveIncome(threshold)`. Requires Lace, a
  deployed Proofly contract address, and testnet funds only — **no real money**.

## Privacy model

- **Public:** `proofCount` on-chain ledger, the `requiredMonthlyIncome` circuit
  argument (the ONLY circuit argument), and the ZK proof/transcript.
- **Private:** the exact monthly income — the `income` witness only, in-memory in
  the applicant's browser. Never a circuit argument, never ledger state, never
  logged, never in a URL, never in localStorage/sessionStorage, never sent to a
  custom API.
- Enforced by tests: `tests/proofly.privacy.test.ts` (byte-identical public
  inputs across different incomes at the same threshold), a real Groth16 proof
  test in `tests/proofly.contract.test.ts`, and the Level 2 suite
  (`tests/proofly.frontend-*.test.ts`) covering witness wiring, sub-threshold
  denial, error classification, config defaults, and Live-mode gating when no
  contract address is configured.

The **Live mode UI never re-shows the entered income** after proof submission;
only the Local Demo (an explicit local demonstration) displays the values the
applicant typed.

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

No custom backend. No server-side state, no proxy, no deployed "engine". The
frontend is static; every network call goes to Midnight/Lace infrastructure or
the public indexer. See `docs/LEVEL2-ARCHITECTURE.md` for the full provider and
privacy architecture.

## Requirements

| Tool | Version |
|---|---|
| **Node.js** | 22.x |
| **Compact CLI** | `compact` (Midnight devtools), compiler toolchain **0.31.1** |
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

### 2. Install the Compact CLI and pin the toolchain

```bash
compact update 0.31.1
compact list          # 0.31.1 should be marked with →
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

Runs the full suite: contract behaviour, a real Groth16 proof generation +
verification, privacy byte-comparisons (Level 1), plus the Level 2 frontend
tests (witness wiring, sub-threshold denial, error classification, config
defaults, Live-mode gating). The proof tests fetch the public Groth16 SRS
parameters from Midnight's dev S3 fileshare on first run.

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

## GitHub Actions compatibility

All build steps are plain POSIX commands (no WSL- or macOS-only syntax):

```
actions/checkout@v4 → actions/setup-node@v4 (node 22) → npm ci (root + frontend)
→ install Compact CLI + compact update 0.31.1 → npm run compile
→ npm run build (tsc) → npm run build:frontend → npm test
```

## Repository layout

```
contracts/proofly.compact                 ← the Compact contract (source of truth)
scripts/check-compiled.mjs                ← shared guard used by npm lifecycle hooks
tests/                                    ← vitest suite (contract + privacy + L2 frontend)
frontend/                                 ← static Vite/React app
frontend/src/config.ts                    ← public config (Preprod defaults, no income)
frontend/src/hooks/useMidnight.ts         ← Lace discovery, connect, disconnect
frontend/src/hooks/useProofly.ts          ← Live proof + proofCount reads
frontend/src/midnight/providers.ts        ← 7 midnight-js browser providers
frontend/src/midnight/contract-service.ts ← CC.make('proofly').pipe(withWitnesses)
frontend/src/midnight/witnesses.ts        ← THE privacy boundary (income witness)
frontend/src/midnight/errors.ts           ← denied vs wallet/funds/network classification
frontend/src/components/                  ← LocalDemo, WalletConnect, ProofPanel, ...
frontend/.env.example                     ← VITE_NETWORK_ID / VITE_CONTRACT_ADDRESS / indexer
docs/LEVEL2-ARCHITECTURE.md               ← provider + privacy architecture (Level 2)
contracts/managed/proofly/                ← generated by `npm run compile` (gitignored)
```