# Proofly — Midnight Preprod Deployment Evidence

**Project:** Proofly — Private Proof-of-Income

**Purpose:** Prove that a private monthly income meets or exceeds a public
required threshold **without revealing the exact income**. The only public
circuit argument is `requiredMonthlyIncome`; the exact monthly income flows
exclusively through the private `income` witness.

> Non-secret deployment record. It intentionally contains **no** deployer seed,
> wallet private keys, local environment variables containing secrets, private
> income values, wallet state, or credentials of any kind.

## Network

- **Network:** Midnight Preprod (**testnet**)
- **Testnet only — no real funds are involved** in any part of this deployment,
  funding, or verification.

## Deployed contract

- **Contract:** Proofly (`contracts/proofly.compact`)
- **Contract address:**
  `977c1d027a23283d528a59336f2b348b51b1b8205a4e0d78796b6175bb316ff6`
- **Privacy circuit:** `proveIncome(requiredMonthlyIncome)` — asserts
  `privateIncome >= requiredMonthlyIncome` and increments `proofCount`.
- **Ledger:** `proofCount: Field` — a simple public counter that records how
  many threshold proofs have been accepted.
- **Income witness:** the exact monthly income is supplied through the private
  `income()` **witness**; the threshold is supplied as the **public** circuit
  argument.

## Privacy statement

The exact monthly income is **not** stored in public ledger state. The
`proofCount` ledger holds only a non-secret incrementing counter, and the
`requiredMonthlyIncome` threshold is the only public circuit argument. The
income is bound in the prover's browser through the Compact witness closure and
never enters ledger state, logs, URLs, storage, or any custom backend. The app
UI never re-displays the income after a live proof submission.

## Deployment process summary

The contract was deployed once to Midnight Preprod by a **dedicated operator
deployer wallet** (separate from any personal Lace wallet), using the local
`scripts/deploy-proofly.ts`:

1. **Dedicated Preprod deployer** — an HD wallet derived locally from a
   deployer seed kept only in the operator's environment.
2. **tNIGHT testnet funding** — the deployer address was funded with tNIGHT
   through the official Midnight Preprod faucet process (testnet tokens;
   no real money).
3. **DUST registration / resource generation** — tNIGHT UTXOs were registered
   to generate tDUST, which fuels transaction fees on Preprod.
4. **Contract deployment** — the compiled Proofly contract was deployed via
   `deployContract`, with proof generation performed by the local
   proof-server container (`midnightntwrk/proof-server:8.1.0`).

The deployment script is **not** part of the deployed application; the Netlify
app is a static frontend that interacts with this contract through the Lace
wallet.

## Verification

The deployment was confirmed on Midnight Preprod with the following
identifiers:

| Item | Value |
|---|---|
| Transaction ID | `00beaf5cb2a332a42d463c9707fb0c9395a8a54210dc30c3b59643f3dc0442bd8a` |
| Block height | `2500733` |
| Block hash | `01030dcb785674effc2c65b701b3514551cdf2a8831cbf5034da13e3a4770b50` |
| Compact compiler | `0.31.1` |
| Compact runtime | `0.16.0` |
| Deployment timestamp | `2026-09-11T08:57:28.313Z` |
| Deployer address (public) | `mn_addr_preprod1ehqqv3n8zwxrw9mde9snfa327jemnkf9pw425cdhx9jjdhzw98ws2vlzr6` |

## Security / Secrets

The deployer seed and all private credentials are **intentionally NOT
included** here. The seed was read from the `PROOFLY_DEPLOYER_SEED` environment
variable during the one-time deployment, was never printed or written to disk
by the deployment tool, and is retained only in the operator's local
environment. Wallet sync state and local environment files are excluded from
Git. This document contains only public, on-chain identifiers.