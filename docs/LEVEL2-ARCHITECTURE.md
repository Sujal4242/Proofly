# Proofly — Level 2 Architecture

> Historical record — describes the Level 2 Live-Preprod foundation as built.
> The **current** Level 3 architecture (replay protection, public
> `applicationId` single-use claim scope, no applicant identity, deterministic
> preflight) is documented in `docs/LEVEL3-ARCHITECTURE.md`.

This document describes the Live Preprod foundation added on top of the Level 1
local proof demo. It mirrors the proven ShadowPass-V2 / ShadowPass-Level5 /
ShadowBid browser architectures, adapted to Proofly's single `income` witness.

## Overview

```
Browser static frontend (React + Vite)
        │
        ├── Local Demo ──────────────► offline compiled circuit (compiled-contract.js)
        │                              no wallet, no chain, privacy demo
        │
        └── Live Preprod ────────────► Lace DApp Connector (window.midnight)
                                         │
                                         ▼
                                   midnight-js providers
                                    - setNetworkId('preprod')
                                    - getConfiguration (wallet endpoints)
                                    - getShieldedAddresses
                                    - getProvingProvider         (browser proving)
                                      → httpClientProofProvider  (wallet fallback)
                                    - indexerPublicDataProvider
                                    - InMemoryPrivateStateProvider
                                         │
                                         ▼
                                   findDeployedContract → callTx.proveIncome(threshold)
                                         │
                                         ▼
                                   Midnight Preprod (public indexer)
```

No custom backend. The frontend is static; all network traffic is to Midnight /
Lace infrastructure (wallet endpoints, public indexer) and the static site's own
ZK assets. There is no server, no database, no proxy, and no custom API.

## Provider assembly (`frontend/src/midnight/providers.ts`)

`buildProviders(connectedAPI, NETWORK_ID)` — call only *after*
`wallet.connect('preprod')` succeeds:

1. `setNetworkId(networkId)` — pin the contract-flow runtime network.
2. `getConfiguration()` — read the wallet's own indexer/prover endpoints
   (fallbacks: public Preprod defaults from `config.ts`).
3. `getShieldedAddresses()` — the applicant's coin + encryption public keys.
4. Proving: prefer `getProvingProvider` (wallet-delegated, in-browser ZK) with a
   **30 s timeout**; on failure fall back to `httpClientProofProvider` using the
   wallet's `proverServerUri`. Never a self-hosted proof server.
5. `indexerPublicDataProvider(indexerUrl, indexerWsUrl)`.
6. `InMemoryPrivateStateProvider` — strictly in-memory (never persisted).
7. Hand-built `walletProvider` (`balanceTx` via the wallet) + `midnightProvider`
   (`submitTx`).

### Lace hook (`frontend/src/hooks/useMidnight.ts`)

- `findWallets()` reads `(window as any).midnight` and filters DApp Connector
  wallets by the `InitialAPI` shape.
- `connect(wallet)` → `wallet.connect(NETWORK_ID)` under a **60 s timeout**,
  then `buildProviders` + (only if `VITE_CONTRACT_ADDRESS` is set)
  `findProoflyContract`.
- Clean `disconnect()` clears provider/deployed state.
- If no contract address is configured the wallet can still connect (the
  provider foundation is genuine), but `deployed` stays `null` and Live
  submission stays disabled.

## Contract service (`frontend/src/midnight/contract-service.ts`)

```ts
const CC: any = CompiledContract;
export function buildProoflyContract(income: bigint) {
  return CC.make('proofly', Contract).pipe(
    CC.withWitnesses(createProoflyWitnesses(income)),
  );
}
```

- `findProoflyContract(providers, income)` → `findDeployedContract` against
  `CONTRACT_ADDRESS` with `privateStateId` + `initialPrivateState: {}`.
- `deployed.callTx.proveIncome(requiredMonthlyIncome)` — the threshold is the
  **only** public circuit argument. The income travels through the witness
  closure exclusively.
- `readProofCountFromLedger(state)` — the generated `ledger` decoder (`Ledger =
  { readonly proofCount: bigint }`). Public by design; on-chain state never
  contains income.

### Re-binding the witness per proof

ShadowPass-Level5 re-binds the witness material on every verification
(`findShadowPassContract(providers, material)`). Proofly does the same: each
`prove` run builds a fresh `CompiledContract` with this run's income via
`createProoflyWitnesses(income)`, so the value used is always the one the
applicant entered for that interaction.

## Privacy architecture (`frontend/src/midnight/witnesses.ts`)

`createProoflyWitnesses(income)` returns `{ income: (ctx) => [ctx.privateState, income] }`.
Guarantees:

- income is bound in a closure — it is **never a circuit argument**;
- it is **never written to ledger state** (`proofCount` only on-chain);
- it is **not logged** (no `console.*` of income anywhere in the Live flow);
- it is **not stored** — in-memory private state provider only, no
  localStorage/sessionStorage;
- it is **not placed in a URL** — Live UI and indexer reads carry only the
  public threshold + contract address;
- it is **not sent to any custom backend** — there is no backend.

The Live UI **does not re-display the entered income** after submission. Only
the Local Demo mode shows the typed values, explicitly as an offline
demonstration of the privacy property.

## Configuration (`frontend/src/config.ts`)

Public only: `VITE_NETWORK_ID` (default `preprod`), `VITE_CONTRACT_ADDRESS`
(empty until a real deployment), `VITE_INDEXER_URL` /
`VITE_INDEXER_WS_URL` (public Preprod defaults), and `ZK_ASSETS_BASE`
(static `{origin}/midnight/proofly`). There is deliberately **no
`VITE_INCOME`** — the income is runtime private state.

## Proof status machine

`VerificationState` (in `midnight/types.ts`):

```
idle → generating → awaiting-wallet → submitting → confirming
     → granted { txId, blockHeight, proofCount }
     → denied   { message }   (circuit: "Income below required minimum")
     → error    { message }   (wallet / funds / network)
```

## Failure semantics on Preprod

- **Sub-threshold income:** the circuit assertion fires during proof generation,
  *before* any wallet approval or transaction, so the attempt never reaches the
  chain and the income never leaves the prover. `errors.ts` classifies the
  message as `denied`.
- **Funds / dust / network / approval cancel:** classified as `error` with
  actionable copy.

## Reading `proofCount`

`useProofly.refreshProofCount` polls
`publicDataProvider.queryContractState(contractAddress)` and decodes with the
generated `ledger` decoder (`readProofCountFromLedger`). Graceful when no
contract address is configured: the ProofCounter shows an explanatory dormant
state and no chain state is ever invented. After a successful proof, the count
is also decoded from `tx.public.nextContractState`.

## Deployment (one-time, operator — OUT OF SCOPE until later)

Live submission is **disabled until an actual Preprod deployment** provides
`VITE_CONTRACT_ADDRESS`. There is no deployer seed in the code, no deployment
script in the app, and no deployment evidence yet. The plan for that step (a
wallet-sdk deploy script + `docs/evidence/`) is described in the Level 2
investigation but deliberately not implemented here.