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
6. Application-scoped replay protection
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
| **3 — Replay protection** | On-chain `usedNullifiers` set; immutable `proofCount`; public `applicationId` single-use scope (nullifier = `persistentHash(["proofly:claim:", applicationId])`); deterministic local preflight; exact-denial classification | `contracts/proofly.compact` + `midnight/witnesses.ts`, `contract-service.ts`, `errors.ts`, `local-circuit.ts` |
| **4 — Production infra** | GitHub Actions CI (`.github/workflows/ci.yml`); Netlify static hosting config (`netlify.toml`) | repository root; see `docs/CI-CD.md` + `docs/STATIC-HOSTING.md` |

## 2. The contract (`contracts/proofly.compact`)

Source of truth. The generated artifacts under `contracts/managed/proofly/` are
gitignored and rebuilt by `npm run compile`.

- **Ledger** (all public):
  - `proofCount: Field` — monotonically increasing count of accepted claims.
  - `usedNullifiers: Map<Bytes<32>, Boolean>` — every accepted claim inserts its
    disclosed nullifier.
- **Witness** (private, supplied by the applicant's browser at prove time):
  - `income(): Uint<32>` — the exact monthly income. There is **no** `applicantId`
    witness and no device/browser identity anywhere.
- **Constructor**: sets `proofCount = 0` and an empty nullifier set.
- **Circuit** — a single operation:
  - `proveIncome(requiredMonthlyIncome: Uint<32>, applicationId: Bytes<32>)`
  - asserts `income() >= requiredMonthlyIncome`, otherwise
    `"Income below required minimum"`;
  - computes `nullifier = persistentHash<Vector<2, Bytes<32>>>([pad(32, "proofly:claim:"), applicationId])`
    — scoped to the public `applicationId` **only**; the threshold and income
    are not part of it;
  - asserts the nullifier is **not** already in `usedNullifiers`, otherwise
    `"Claim already used for this application"`;
  - `disclose`es the nullifier, inserts it into `usedNullifiers`, and increments
    `proofCount`.

The two assertion strings are the **exact** denial vocabulary used across the
tests and the frontend (`frontend/src/midnight/errors.ts`).

## 3. Nullifier construction and replay semantics

`nullifier = persistentHash("proofly:claim:" || applicationId)`

The nullifier binds the claim **scope** — the public `applicationId` **alone**.
The threshold is **not** part of the nullifier, and neither is the income, so an
**Application ID is single-use**. Verified by `tests/proofly.nullifier.test.ts`:

| Re-claim scenario | Nullifier | Verdict |
|---|---|---|
| Same `applicationId`, same threshold | same | **denied** — `Claim already used for this application` |
| Same `applicationId`, different threshold | same | **denied** — a threshold change cannot reset an Application ID |
| Same `applicationId`, different income | same (nullifier ignores income) | **denied** — the Application ID is already claimed |
| Different `applicationId` | different | **accepted** — independent claim scope |

Important consequence: privacy is preserved because the income value does not
enter any public state; replay protection is enforced purely by the public
Application ID scope on-chain. Re-claiming an already-used application is what
the contract itself refuses — there is no applicant identity involved, so no
"fresh identity" can make a used Application ID claimable again.

## 4. Public vs private surface

**Public (visible to the verifier / on-chain):**

- Ledger: `proofCount`, `usedNullifiers`.
- Circuit arguments: `requiredMonthlyIncome`, `applicationId` (SHA-256 encoded
  to 32 bytes by `frontend/src/midnight/application-id.ts`).
- The Groth16 proof and public transcript.

**Private (never leaves the applicant's tab):**

- The exact `income` witness.
- Nothing logs, stores, or transmits it. Verified by
  `tests/proofly.privacy.test.ts` (different incomes → byte-identical public
  inputs) and the frontend suites.

## 5. Claim scoping (`applicationId`)

A **public**, caller-supplied string (validated by `isValidApplicationId` and
encoded to 32 bytes). It answers "income ≥ threshold, **for this application**".
Because it is public, it can be checked by a lender, portal, or issuer without
any private data — and the on-chain nullifier makes each scoped claim
**single-use**: one claim per Application ID, regardless of threshold or income.
The Local Demo defaults to `loan-app-2026-01`; Live mode takes it from the
`ProofPanel` input.

## 6. Application-scoped replay protection

Replay protection needs **no secret identity**. The nullifier is derived purely
from the public `applicationId` (`persistentHash(["proofly:claim:", applicationId])`),
so:

- the same Application ID always produces the same nullifier — first claim
  succeeds, every later claim for that application is denied on-chain
  (`Claim already used for this application`);
- because the threshold is **not** in the nullifier, changing the threshold
  cannot mint a fresh claim for a used Application ID;
- different Application IDs produce different nullifiers and are fully
  independent.

There is no `applicantId` witness, no `crypto.getRandomValues` identity, and no
device fingerprinting. The only private input is the exact `income`; the only
replay mechanism is the public, on-chain `usedNullifiers` set keyed by
Application ID.

## 7. Local Demo architecture

`frontend/src/proofly/local-circuit.ts` compiles the same contract via nonce
`'proofly'` and runs `contract.circuits.proveIncome` with locally supplied
witnesses against a **fresh or accumulated in-memory ledger state**:

- `runProofOfIncome(income, threshold, applicationId)` — a single independent
  run against fresh state (Level 1 experience, now with the public
  `applicationId` input).
- `runClaimSequence(claims)` — a sequence against one accumulated state, so the
  tab demonstrates the application-scoped semantics:
  `[appA] accepted → [appA] replay denied (even with a changed threshold) →
  [appB] accepted`.
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

1. Runs the local preflight (section 9).
2. `findProoflyContract(providers, income)` — guarded by
   `VITE_CONTRACT_ADDRESS`; fails fast with `LIVE_DISABLED_REASON` when unset.
3. Calls `deployed.callTx.proveIncome(threshold, encodeApplicationId(applicationId))`
   (wallet approval + proof + submit + confirm inside midnight-js).
4. Decodes the post-tx `proofCount` from `tx.public.nextContractState` and shows
   the immutable public outcome only.

State machine: `generating → awaiting-wallet → confirming → granted | denied | error`.

## 9. Deterministic preflight

`preflightProveIncome` (in `contract-service.ts`) runs the **same circuit,
witness closures, and public arguments** as the real call, but unproven and
without a transaction, against the **current on-chain ledger** fetched through
the existing indexer path (`queryContractState`). Compact assertions surface
deterministically here:

- income below threshold → `Income below required minimum` → `Proof denied — …`;
- a re-claim of an already-used `applicationId` (regardless of threshold or
  income) → `Claim already used for this application` → `Proof denied — …`.

The wallet/prover is then never asked to generate a proof the app already knows
is doomed. Generic preflight failures (indexer down, decode error) are
non-fatal: the real wallet flow still runs so wallet/network/prover errors keep
their existing classification. No income is ever logged or rendered by the
preflight.

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

No income or secret is ever a build-time or runtime variable; the contract
address is public by design.

## 12. Testing strategy

52 tests across 8 files (all requiring a prior `npm run compile`):

| File | Coverage |
|---|---|
| `tests/proofly.contract.test.ts` (7) | Contract behaviour incl. a **real Groth16 proof** (~42 s) |
| `tests/proofly.privacy.test.ts` (4) | Byte-identical public inputs across incomes |
| `tests/proofly.nullifier.test.ts` (9) | Application-scoped nullifier/replay matrix incl. single-use despite threshold change |
| `tests/proofly.frontend-witness.test.ts` (4) | Single-income witness wiring / circuit surface |
| `tests/proofly.frontend-errors.test.ts` (8) | Denial vs wallet/funds/network classification |
| `tests/proofly.frontend-config.test.ts` (6) | Config defaults; Live disabled when no address |
| `tests/proofly.frontend-level3.test.ts` (8) | applicationId argument, application-scoped sequence, deny paths |
| `tests/proofly.frontend-preflight.test.ts` (6) | Preflight accepted/denied/failure semantics |

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

- **CI** validates every push/PR (compile, 52 tests, tsc, frontend build) —
  `docs/CI-CD.md`.
- **Netlify** publishes the static build with the public `VITE_*` env baked in —
  `docs/STATIC-HOSTING.md`.
- **Secrets** policy — `docs/SECURITY-AND-SECRETS.md`.
- End-to-end walkthrough — `docs/FINAL-DEMO-RUNBOOK.md`.