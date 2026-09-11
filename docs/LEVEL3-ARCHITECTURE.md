# Proofly — Level 3 Architecture

This document describes the **current** Proofly architecture: the completed
Level 1 → Level 3 implementation (local demo through on-chain replay-protected
proof-of-income) and how it slots into the Level 4 production setup. The
original Level 2 architecture is preserved as a historical record in
`docs/LEVEL2-ARCHITECTURE.md`.

## Contents

1. Levels 1–3 at a glance
2. The contract (`contracts/proofly.compact`)
3. Nullifier construction and replay semantics
4. Public vs private surface
5. Claim scoping (`applicationId`)
6. Per-claim identity (`applicantId`)
7. Local Demo architecture
8. Live Preprod architecture
9. Deterministic preflight
10. Error and denial classification
11. Configuration surface
12. Testing strategy
13. Reference deployments
14. Architecture diagram
15. L4 integration points

---

## 1. Levels 1–3 at a glance

| Level | What shipped | Where it lives today |
|---|---|---|
| **1 — Local Demo** | Offline in-tab proof generation/verification using the real compiled circuit; privacy property demo | `frontend/src/proofly/local-circuit.ts`, the `LocalDemo` tab |
| **2 — Live Preprod** | Lace wallet + midnight-js providers + `callTx.proveIncome` against a deployed contract; zero-income-display Live UI; SOURCE-controlled contract address | `frontend/src/hooks/useMidnight.ts`, `useProofly.ts`, `midnight/providers.ts`, `frontend/src/config.ts` |
| **3 — Replay protection** | On-chain `usedNullifiers` set; immutable `proofCount`; public `applicationId` claim scope; secret `applicantId` witness; deterministic local preflight; exact-denial classification | `contracts/proofly.compact` + `midnight/witnesses.ts`, `contract-service.ts`, `errors.ts`, `local-circuit.ts` |
| **4 — Production infra** | GitHub Actions CI (`.github/workflows/ci.yml`); Netlify static hosting config (`netlify.toml`) | repository root; see `docs/CI-CD.md` + `docs/STATIC-HOSTING.md` |

## 2. The contract (`contracts/proofly.compact`)

Source of truth. The generated artifacts under `contracts/managed/proofly/` are
gitignored and rebuilt by `npm run compile`.

- **Ledger** (all public):
  - `proofCount: Field` — monotonically increasing count of accepted claims.
  - `usedNullifiers: Map<Bytes<32>, Boolean>` — every accepted claim inserts its
    disclosed nullifier.
- **Witnesses** (private, supplied by the applicant's browser at prove time):
  - `income(): Uint<32>` — the exact monthly income.
  - `applicantId(): Bytes<32>` — a fresh claim identity used for nullifier
    derivation; never seen on-chain and never displayed.
- **Constructor**: sets `proofCount = 0` and an empty nullifier set.
- **Circuit** — a single operation:
  - `proveIncome(requiredMonthlyIncome: Uint<32>, applicationId: Bytes<32>)`
  - asserts `income() >= requiredMonthlyIncome`, otherwise
    `"Income below required minimum"`;
  - computes `nullifier = persistentHash<Vector<4, Bytes<32>>>([pad(32, "proofly:claim:"), applicationId, requiredMonthlyIncome as Field as Bytes<32>, applicantId()])`;
  - asserts the nullifier is **not** already in `usedNullifiers`, otherwise
    `"Claim already used for this application"`;
  - `disclose`es the nullifier, inserts it into `usedNullifiers`, and increments
    `proofCount`.

The two assertion strings are the **exact** denial vocabulary used across the
tests and the frontend (`frontend/src/midnight/errors.ts`).

## 3. Nullifier construction and replay semantics

`nullifier = persistentHash("proofly:claim:" || applicationId || threshold || applicantId)`

The nullifier binds the claim **scope** (application + threshold) to the
**identity** (applicant). Verified by `tests/proofly.nullifier.test.ts`:

| Re-claim scenario | Nullifier | Verdict |
|---|---|---|
| Same `applicationId`, same identity | same | **denied** — `Claim already used for this application` |
| Same `applicationId`, new identity | different | **accepted** — independent claim |
| Different `applicationId`, same identity | different | **accepted** — different claim scope |
| Same scope + identity, income changed | same (nullifier ignores income) | **denied** — the scope is already used |

Important consequence: privacy is preserved because the income value does not
enter the nullifier and the applicant can always obtain a *fresh* identity per
claim. Replaying the identical triple is what the contract itself refuses.

## 4. Public vs private surface

**Public (visible to the verifier / on-chain):**

- Ledger: `proofCount`, `usedNullifiers`.
- Circuit arguments: `requiredMonthlyIncome`, `applicationId` (SHA-256 encoded
  to 32 bytes by `frontend/src/midnight/application-id.ts`).
- The Groth16 proof and public transcript.

**Private (never leaves the applicant's tab):**

- The exact `income` witness.
- The `applicantId` claim identity (`crypto.getRandomValues(new Uint8Array(32))`,
  generated fresh per claim, in-memory only).
- Nothing logs, stores, or transmits them. Verified by
  `tests/proofly.privacy.test.ts` (different incomes → byte-identical public
  inputs) and the frontend suites.

## 5. Claim scoping (`applicationId`)

A **public**, caller-supplied string (validated by `isValidApplicationId` and
encoded to 32 bytes). It answers "income ≥ threshold, **for this application**".
Because it is public, it can be checked by a lender, portal, or issuer without
any private data — and the on-chain nullifier makes each scoped claim unique.
The Local Demo defaults to `loan-app-2026-01`; Live mode takes it from the
`ProofPanel` input.

## 6. Per-claim identity (`applicantId`)

A **private**, 32-byte, cryptographically random identity generated once per
proof run (`useProofly.prove` → `crypto.getRandomValues`). It is bound into the
witness closure exactly like income (`CC.withWitnesses(createProoflyWitnesses(income, applicantId))`)
and is never persisted, displayed, or transmitted. Effect in Live mode: a claim
on an already-used `applicationId` becomes a valid fresh claim rather than a
stale replay, matching the one-identity-per-execution semantics exercised by the
contract tests. `LocalDemo` holds one identity across a sequence *explicitly* so
replay protection is visible in the tab.

## 7. Local Demo architecture

`frontend/src/proofly/local-circuit.ts` compiles the same contract via nonce
`'proofly'` and runs `contract.circuits.proveIncome` with locally supplied
witnesses against a **fresh or accumulated in-memory ledger state**:

- `runProofOfIncome(income, threshold, applicationId)` — a single independent
  run against fresh state (Level 1 experience, now with the public
  `applicationId` input).
- `runClaimSequence(claims, applicantId)` — one fixed in-memory identity across
  a sequence, so the tab demonstrates: `[appA] accepted → [appA-alt] accepted →
  [appA] replay denied`.
- Circuit assertions throw their exact messages; the panel maps them to
  `replay` / `below-threshold` and displays the real reason.
- **The only UI surface that displays the entered income**, by design — it is an
  explicit demonstration of the privacy property.

The preimage is computed locally with `ocrt.proofDataIntoSerializedPreimage`
and shown size-limited; the real Groth16 proof is generated and verified under
`tests/proofly.contract.test.ts` using the same compiled contract.

## 8. Live Preprod architecture

`frontend/src/hooks/useMidnight.ts` discovers Lace and assembles the seven
midnight-js browser providers. `useProofly.prove`:

1. Generates a fresh `applicantId`.
2. Runs the local preflight (section 9).
3. `findProoflyContract(providers, income, applicantId)` — guarded by
   `VITE_CONTRACT_ADDRESS`; fails fast with `LIVE_DISABLED_REASON` when unset.
4. Calls `deployed.callTx.proveIncome(threshold, encodeApplicationId(applicationId))`
   (wallet approval + proof + submit + confirm inside midnight-js).
5. Decodes the post-tx `proofCount` from `tx.public.nextContractState` and shows
   the immutable public outcome only.

State machine: `generating → awaiting-wallet → confirming → granted | denied | error`.

## 9. Deterministic preflight

`preflightProveIncome` (in `contract-service.ts`) runs the **same circuit,
witness closures, and public arguments** as the real call, but unproven and
without a transaction, against the **current on-chain ledger** fetched through
the existing indexer path (`queryContractState`). Compact assertions surface
deterministically here:

- income below threshold → `Income below required minimum` → `Proof denied — …`;
- exact replay of the same triple → `Claim already used for this application` →
  `Proof denied — …`.

The wallet/prover is then never asked to generate a proof the app already knows
is doomed. Generic preflight failures (indexer down, decode error) are
non-fatal: the real wallet flow still runs so wallet/network/prover errors keep
their existing classification. No income or `applicantId` is ever logged or
rendered by the preflight.

## 10. Error and denial classification

`frontend/src/midnight/errors.ts`:

- Only the **exact** circuit assertions count as a denial
  (`findDenialHint` walks up to six `Error.cause` layers). A generic
  "Request failed" wrapper is NEVER misclassified as replay or below-threshold.
- Bare denials from the wallet flow report the canonical hint; local-preflight
  denials are prefixed `Proof denied — ` via `formatDenialMessage`.
- Funds/dust/balance text → a clear `Insufficient funds` error message.
- Everything else → error surfaced to `ProofStatus`.

## 11. Configuration surface

All public (`frontend/src/config.ts`, `.env.example`, and the committed
`netlify.toml` `[build.environment]` block):

| Variable | Default | Purpose |
|---|---|---|
| `VITE_NETWORK_ID` | `preprod` | Network the providers target |
| `VITE_CONTRACT_ADDRESS` | *(empty)* | Deployed contract address; Live mode is disabled until set |
| `VITE_INDEXER_URL` | `https://indexer.preprod.midnight.network/api/v4/graphql` | GraphQL indexer endpoint |
| `VITE_INDEXER_WS_URL` | `wss://indexer.preprod.midnight.network/api/v4/graphql/ws` | WebSocket indexer endpoint |

No income, applicant-id, or secret is ever a build-time or runtime variable; the
contract address is public by design.

## 12. Testing strategy

47 tests across 8 files (all requiring a prior `npm run compile`):

| File | Coverage |
|---|---|
| `tests/proofly.contract.test.ts` (7) | Contract behaviour incl. a **real Groth16 proof** (~42 s) |
| `tests/proofly.privacy.test.ts` (4) | Byte-identical public inputs across incomes |
| `tests/proofly.nullifier.test.ts` (6) | Nullifier/replay matrix (section 3) |
| `tests/proofly.frontend-witness.test.ts` (3) | Witness wiring / nonce / circuit surface |
| `tests/proofly.frontend-errors.test.ts` (8) | Denial vs wallet/funds/network classification |
| `tests/proofly.frontend-config.test.ts` (6) | Config defaults; Live disabled when no address |
| `tests/proofly.frontend-level3.test.ts` (8) | applicationId argument, preflight, deny paths |
| `tests/proofly.frontend-preflight.test.ts` (5) | Preflight accepted/denied/failure semantics |

`npm test`, `npm run build` (tsc), and `npm run build:frontend` are the three
local gates, duplicated in `.github/workflows/ci.yml`.

## 13. Reference deployments

The contract is deployed on **Midnight Preprod**. Evidence (non-secret only) is
maintained in `docs/evidence/DEPLOYMENT.md` — Level 2 (original) and Level 3
(current, replay-protected) records, each with contract address, tx ID, block
height/hash, timestamp, compiler `0.31.1` / runtime `0.16.0`, and the public
deployer address. The operator procedure is `docs/LEVEL2-DEPLOYMENT.md`.

## 14. Architecture diagram

```
┌────────────────────────── BROWSER (static, no backend) ─────────────────────────┐
│  React/Vite SPA                                                                 │
│    Local Demo tab ── frontend/src/proofly/local-circuit.ts                       │
│      runProofOfIncome / runClaimSequence  (offline, displays income by design)   │
│    Live Preprod tab ── useMidnight → Lace (window.midnight)                       │
│      useProofly.prove                                                           │
│        ├─ fresh applicantId  (crypto.getRandomValues, in-memory)                │
│        ├─ preflightProveIncome  (unproven run vs current on-chain ledger)       │
│        │      └─ deterministic denial → "Proof denied — <assertion>"            │
│        └─ findProoflyContract → callTx.proveIncome(threshold, applicationId)    │
│              └─ midnight-js providers (incl. publicDataProvider → indexer)      │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   ▼
                   Midnight Preprod (indexer + deployed contract)
                   ledger: proofCount, usedNullifiers   (all public)
```

## 15. L4 integration points

- **CI** validates every push/PR (compile, 47 tests, tsc, frontend build) —
  `docs/CI-CD.md`.
- **Netlify** publishes the static build with the public `VITE_*` env baked in —
  `docs/STATIC-HOSTING.md`.
- **Secrets** policy — `docs/SECURITY-AND-SECRETS.md`.
- End-to-end walkthrough — `docs/FINAL-DEMO-RUNBOOK.md`.