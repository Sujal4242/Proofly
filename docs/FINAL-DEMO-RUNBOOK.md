# Proofly — Final Demo Runbook

A scripted, end-to-end walkthrough of Proofly (local demo, read-only privacy
demonstration, and the Live Preprod proof-of-income flow) for a demo operator.

## 1. Purpose and audience

Show that Proofly proves `monthlyIncome >= requiredThreshold` on Midnight
Preprod **without revealing the income**, and that the Level 3 contract enforces
**one claim per application** via on-chain nullifiers. Audience: technical
reviewers, evaluators, Midnight/Compact reviewers.

## 2. Preconditions (verify first)

| Requirement | How to verify |
|---|---|
| Node 22.x | `node --version` → `v22.x` |
| Compact devtools 0.5.1 + toolchain 0.31.1 | `compact --version` → `compact 0.5.1`; `compact compile --version` → `0.31.1` |
| Dependencies installed | `npm ci && npm --prefix frontend ci` |
| Compiled artifacts present | `npm run compile` (idempotent, fast when cached) |
| Full test suite green | `npm test` → **52 passing** |
| Lace wallet on Preprod, funded with tNIGHT/tDUST | wallet shows Preprod, sufficient dust |
| Contract address configured for Live mode | `VITE_CONTRACT_ADDRESS` set in `frontend/.env` (or Netlify env); matches `docs/evidence/DEPLOYMENT.md` |

Local Demo works with **no** wallet, network, or config. Live Preprod requires
Lace, Preprod funds, and the configured address.

## 3. Local gate check (read-only, safe)

```bash
npm test
npm run build
npm run build:frontend
```

## 4. Local Demo walkthrough (offline tab)

Start the dev server: `npm run dev:frontend` → http://localhost:5173.

Keep the **Local Demo** tab selected. Defaults (`82500` income, `50000`
threshold, `loan-app-2026-01`) are pre-filled.

1. **Generate proof locally** → expect `✓ Proof accepted` showing `proofCount = 1`,
   the preimage size/first bytes, and `localIncome 82500 ≥ 50000`. Note this is
   the *only* surface that displays income, deliberately.
2. **Check privacy property** → two different incomes produce **byte-identical**
   public inputs (identical SHAs). State point: *the verifier cannot distinguish
   the two incomes.*
3. **Check replay protection** → the sequence runs `[loan-app-2026-01] accepted
   → [loan-app-2026-01] replay denied (even after changing the threshold) →
   [loan-app-2026-01-alt] accepted` against one accumulated in-memory ledger.
   Observe the replay row and its exact reason (`Claim already used for this
   application`).
4. **Below-threshold** → set income `30000`, threshold `50000`, Generate → expect
   rejection with `Income below required minimum`.
5. **Reset** defaults for the Live section.

## 5. Live Preprod walkthrough

Switch to **Live Preprod**.

1. **Step 1 — Connect Lace**: connect on Preprod. The **ProofCounter** should
   appear; it polls the public `proofCount` every 5 s from the indexer and shows
   the on-chain count from the configured contract address.
2. **Step 2 — Prove income on Preprod**: enter income (private), threshold, and
   an `applicationId` (e.g. `loan-app-2026-A`). Submit.
   - A **local deterministic preflight** runs first (unproven circuit against
     the current on-chain ledger). If the claim is a deterministic denial, you
     see `Proof denied — <assertion>` and the wallet is never invoked.
   - Otherwise the wallet asks for approval; after signing you reach
     `granted` with the tx id, block height, and the decoded `proofCount`,
     which must equal `previous + 1`.
   - **Observe the privacy property**: the income value is **never shown again**
     after submission — the panel shows only the public outcome.
3. **Second claim, same application** → the Application ID is **single-use**, so
   a second claim for the same `applicationId` is a replay of the claim scope
   (regardless of threshold or income): expect `Proof denied — Claim already
   used for this application`, with exact contract-level replay exercised locally
   and by the test suite.
4. **Claim a different application** → a new `applicationId` (e.g.
   `loan-app-2026-B`) is independent: expect `granted`, `proofCount` incremented
   again.
5. **Below-threshold in Live** → income below threshold for a fresh application
   → expect `Proof denied — Income below required minimum` without wallet
   interaction.
6. (Optional) ProofCounter cross-check: reconcile the number shown with the
   count of successful operations above.

## 6. On-chain verification (the explorer)

- Open the contract address from `docs/evidence/DEPLOYMENT.md` in the Midnight
  Preprod explorer.
- Confirm the ledger shows `proofCount` matching the counter and transactions
  recorded at the reported block heights.
- Tx ids shown in the granted panel should match explorer entries.

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Live panel disabled "no deployed contract" | `VITE_CONTRACT_ADDRESS` unset → configure and rebuild |
| Connect succeeds but panel still disabled | Lace not on Preprod, or provider not found; reconnect on Preprod |
| `Proof denied — Claim already used for this application` | That `applicationId` was already claimed (single-use); use a different application id |
| `Insufficient funds — obtain Preprod test tokens…` | Wallet lacks tDUST; fund through official faucet |
| ProofCounter error "indexer returned no contract state" | Address/config typo or indexer lag; verify address in evidence file |
| Tests fail with `[check-compiled]` | Run `npm run compile` first |

## 8. Cleanup and posture

- Disconnect the wallet at the end; the app stores **nothing** — close the tab
  and all in-memory state (income) is gone.
- No console, URL, network, or storage copy of income is produced at any point.

## 9. Recording the demo

After the demo, optionally record: numbers of accepted claims, one block height
for a granted proof, the preflight-denied message observed. Non-sequel evidence
goes in `docs/evidence/DEPLOYMENT.md` (already holds the L2 + L3 deployment
records with contract address, tx id, block height/hash, compiler/runtime) and
new proof confirms should cross-check against the explorer.

## 10. Related

- Architecture — `docs/LEVEL3-ARCHITECTURE.md`.
- Deployment records — `docs/evidence/DEPLOYMENT.md`.
- Deployment procedure — `docs/LEVEL2-DEPLOYMENT.md`.
- Security posture — `docs/SECURITY-AND-SECRETS.md`.