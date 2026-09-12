# Proofly Level 4 Evidence

**Project:** Proofly — Privacy-Preserving Proof-of-Income (Midnight)

This document maps the **Level 4 (Waxing Gibbous)** submission checklist to
**actual, existing** Proofly evidence in this repository. It contains only
verifiable facts: repository files, on-chain deployment identifiers recorded in
`docs/evidence/DEPLOYMENT.md`, and live links. No evidence is fabricated.

> Non-secret document. Contains **no** deployer seed, wallet keys, local
> environment secrets, private income values, or credentials.

---

## Requirement 1 — Working MVP

**Status: COMPLETE — live on Midnight Preprod.**

- A working, full-functionality MVP is deployed on **Midnight Preprod**
  (testnet; no real funds) at the official Midnight indexer/node endpoints.
- The frontend is a static React/Vite app hosted on **Netlify**:
  **Live Demo: <https://proofly-midnight.netlify.app/>**
- With the **Lace** wallet (Midnight DApp Connector) connected on Preprod, the
  app proves that a **private monthly income meets or exceeds a public required
  threshold** using a zero-knowledge proof, then submits it on-chain
  (`proofly.compact` → `callTx.proveIncome`).
- The MVP demonstrates the Midnight privacy model:
  - **Private income verification against a public threshold** — the exact
    income is a private witness and is never disclosed by the proof result.
  - **Successful on-chain proof submission** — proofs are generated locally and
    recorded on Preprod.
  - **Application-scoped replay protection** — each proof is bound to a public
    `applicationId`.
  - **Reuse of the same Application ID is rejected** — replay protection denies
    a second claim for an already-used Application ID.
  - **A different Application ID is accepted** — an independent Application ID
    produces its own valid proof.

### Task → requirement mapping

| Level 4 requirement | Proofly evidence |
|---|---|
| Working MVP live on Midnight Preprod | Live site (above) + deployed contract (Requirement 6) + frontend `src/` (Lace connect, proof call) |
| Verifiable deployed contract address | `docs/evidence/DEPLOYMENT.md` — Requirement 6 below |
| Application-scoped replay protection | `contracts/proofly.compact`, `tests/proofly.nullifier.test.ts`, screenshots `03`/`04` |
| Privacy-preserving income proof | `frontend/src/midnight/witnesses.ts`, `tests/proofly.privacy.test.ts`, screenshot `01`/`02` |

---

## Requirement 2 — Documentation

**Status: COMPLETE.**

- **README** (`README.md`) — the primary documentation:
  - Project overview and the "Why Proofly" product idea.
  - **Privacy model** table (public vs private witness surface).
  - **Application-scoped replay protection** explanation and re-claim matrix.
  - **Setup instructions** ("Getting started": Node 22, Compact devtools pinned
    to CLI `0.5.1` / compiler `0.31.1`, `npm ci`, `npm run compile`, `npm test`,
    `npm run build:frontend`, `frontend/.env.example`).
  - **Usage instructions** ("Product modes": Live Proof with Lace on Preprod,
    offline Local Demo; "How it works").
  - Architecture diagram, status table, security section, license.
- **Deep documentation** under `docs/`:
  - `docs/LEVEL3-ARCHITECTURE.md` — contract, privacy, and replay architecture.
  - `docs/FINAL-DEMO-RUNBOOK.md` — scripted end-to-end demo walkthrough.
  - `docs/SECURITY-AND-SECRETS.md` — threat model and secret policy.
  - `docs/CI-CD.md`, `docs/STATIC-HOSTING.md`, `docs/LEVEL2-DEPLOYMENT.md`.
  - `docs/evidence/DEPLOYMENT.md` — on-chain deployment records.

---

## Requirement 3 — CI/CD

**Status: COMPLETE — pipeline running with passing runs.**

- **Workflow file:** `.github/workflows/ci.yml` — job `compile-test-build`,
  triggers on **every push and pull request**.
- Pipeline steps: checkout → Node **22** → install **Compact devtools 0.5.1** →
  select toolchain **0.31.1** → `npm ci` (root + frontend) → `npm run compile`
  → `copy-zk-assets` → `npm test` (52 tests across 8 files) → root TypeScript
  build → `npm run build:frontend`. Public `VITE_*` env only; **no secrets**,
  **no deployments**.
- **Verified passing run (read-only inspection of the project's GitHub Actions
  on 2026-09-12):**
  - Commit: `48fcb47681606c2280082e414ce4d8fbbd4155ed`
    (`docs: fix Lace screenshot caption`)
  - GitHub Actions run `34686026099` (run **#13**) — **status `completed`,
    conclusion `success`**; job `compile-test-build` passed.
  - Prior runs (#9–#12) also completed with `success`.
- **CI badge** present in README:
  `https://github.com/Sujal4242/Proofly/actions/workflows/ci.yml/badge.svg`.
- Static hosting config: `netlify.toml` (publish `frontend/dist`, same pinned
  toolchain; public `VITE_*` env including the current contract address).

---

## Requirement 4 — Product X Profile

**Status: COMPLETE.**

- Product X profile (publicly accessible): <https://x.com/ProoflyMidnight>
- The profile is live and is linked from the README
  (`README.md` → "Live Demo & Evidence" → **Product X**).

---

## Requirement 5 — Demo Evidence

**Status: COMPLETE.**

- **Live demo:** <https://proofly-midnight.netlify.app/>
- **Demo video:** <https://youtu.be/5YH5ETNPBCU>
- **Screenshots** (committed under `docs/evidence/screenshots/` and embedded in
  README):
  - `01-live-proof-ready.jpeg` — Live Preprod application with Lace connected
    and private/public inputs.
  - `02-proof-accepted.jpeg` — a private income proof recorded on-chain.
  - `03-replay-protection.jpeg` — reusing the same Application ID is rejected.
  - `04-different-application.jpeg` — a different Application ID is accepted.
- **Minimum 15 meaningful commits:** the project's `main` branch has **18
  commits** (all substantive feature/CI/documentation work; no no-op commits),
  satisfying the ≥15 threshold.

---

## Requirement 6 — Contract Verification

**Status: COMPLETE — verifiable on Midnight Preprod.**

Current (replay-redesigned) deployment, per the **current** record in
`docs/evidence/DEPLOYMENT.md`:

| Item | Value |
|---|---|
| Network | Midnight **PREPROD** (testnet; no real funds) |
| **Contract address** | `c06250181abf7349097a6817774e9ef0119b10682d2f1cee6feed5df02c8d12b` |
| **Transaction ID** | `0083d84f3b252bb7815209d1bc638f673a0f41a5de21017f32b2d7c1a15e152b59` |
| **Block height** | 2511493 |
| Block hash | `70247409f98300f38895a2cf36b7c5c46b094a698bbb3a2c8f6655d41d28c476` |
| Compact compiler | 0.31.1 |
| Compact runtime | 0.16.0 |
| Deployed at | 2026-09-12T02:53:28.903Z |
| Deployer address (public) | `mn_addr_preprod1zz4glm0avntr0qc0d8huwm5knz3utvr68jpcgl8rk79q3ltq73ysmaultu` |

Contract surface (current, income-only privacy boundary):

- Circuit: `proveIncome(requiredMonthlyIncome: Uint<32>, applicationId: Bytes<32>)`
- Ledger: `proofCount: Field`, `usedNullifiers: Map<Bytes<32>, Boolean>`
- Private witnesses: `income(): Uint<32>` (the only private input)
- Nullifier: `persistentHash(["proofly:claim:", applicationId])` — an
  Application ID is single-use regardless of threshold or income.

**Historical records preserved (not current):**

| Deployment | Address | Notes |
|---|---|---|
| Level 2 (original) | `977c1d027a23283d528a59336f2b348b51b1b8205a4e0d78796b6175bb316ff6` | `income()` witness; `proofCount` only |
| Prior Level 3 | `bc9c4a53aac2d1c67d17456083d646fc302e32935acd351ad45b82c9d511dc2a` | included an `applicantId` witness/non-current nullifier |

The current config surfaces reference the **current** address:
`netlify.toml` and `.github/workflows/ci.yml` both set
`VITE_CONTRACT_ADDRESS=c06250181abf7349097a6817774e9ef0119b10682d2f1cee6feed5df02c8d12b`.

---

## Submission Status

| Level 4 checklist item | Status | Evidence |
|---|---|---|
| Public GitHub repository with full documentation | **COMPLETE** | `Sujal4242/Proofly`, README + `docs/` |
| Live Preprod demo link + contract address | **COMPLETE** | Live site + Requirement 6 |
| CI/CD badge OR workflow file with passing runs | **COMPLETE** | `ci.yml`, run #13 success |
| Link to Product X profile | **COMPLETE** | <https://x.com/ProoflyMidnight> linked from README |
| Demo video of MVP | **COMPLETE** | <https://youtu.be/5YH5ETNPBCU> |
| Minimum 15 meaningful commits | **COMPLETE** | 18 commits on `main` |

---

## Remaining Items

1. **September idea approval (PENDING):** no record of an approved idea /
   proposal from the provided idea list currently exists in the repository. If
   approval evidence exists outside the repo, record it here with non-secret
   provenance; it is not currently claimed complete.
2. **Recommended (optional) supplement:** an on-chain explorer screenshot of the
   deployed contract address (Requirement 6 screenshot coverage) and a test
   runner screenshot (compile/test output with the 52 passing tests) would round
   out the visual evidence pack alongside the four live-demo screenshots.