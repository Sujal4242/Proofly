# Proofly — Security and Secrets

Proofly is a **privacy-first, secret-free** application: the only secret in the
system — the applicant's exact income — never leaves the browser tab, and the
repository contains **no** private keys, seeds, or credentials. This document
records the guarantees, the audit surface, and the policy that keeps those
guarantees true.

## Threat model

- **The verifier/lender** sees only the public surface: `proofCount`,
  `usedNullifiers`, `requiredMonthlyIncome`, `applicationId`, and the Groth16
  transcript. They cannot learn the income. Claim single-use is intentionally
  public: the disclosed application-scoped nullifier and `usedNullifiers` show
  which Application IDs have already claimed.
- **The indexer / node / network** see the same public surface.
- **A compromised static host** (Netlify) can serve a malicious page, but no
  secrets are stored for it to steal, and income never touches any external
  service.
- **A local attacker** on the applicant's machine shares the OS sandbox already
  trusted by the browser; the app adds no origin storage (see below).

## Repository guarantees (audited)

- No private keys, mnemonics, seeds, or `PROOFLY_DEPLOYER_SEED` values in the
  repository, tests, docs, or CI.
- `frontend/.env` and root `.env`/`.env.local`/`.env.preprod` are **gitignored**
  and untracked.
- `.midnight-wallet-state/` (deployer wallet state) is gitignored.
- The deployer seed is read **only** from the `PROOFLY_DEPLOYER_SEED`
  environment variable on the operator's machine — never hardcoded, printed,
  committed, or exposed to the app/CI/Netlify.
- The deploy script's LevelDB private-state files are protected by a private-state
  password and live under gitignored paths.

## What the app never does

Verified across `frontend/src`:

- **No persistent origin storage**: no `localStorage`, `sessionStorage`,
  `IndexedDB`, or cookie writes. Nothing survives a page reload — income is
  in-memory React state only.
- **No console leaks**: no `console.log` / `info` / `debug`; only `warn`/`error`
  for operational diagnostics that never include income.
- **No custom application network**: no `XMLHttpRequest`, raw `WebSocket`, or
  `fetch` to any custom/third-party backend or API. The one direct fetch is
  `FetchZkConfigProvider`, which loads Proofly's own compiled ZK assets
  (zkir / keys) from the application's own static origin (`ZK_ASSETS_BASE`);
  all other network traffic goes through the midnight-js providers to Lace and
  the public Midnight Preprod indexer.
- **No backend, no custom API**: every call goes to Midnight/Lace
  infrastructure. There is no server-side copy of applicant data.
- **No URL leakage**: no state is encoded into the URL.

## Where income lives (and doesn't)

- `income` is bound into the **witness closure** only
  (`createProoflyWitnesses(income)` + `CC.withWitnesses`) and passed into the
  local circuit / proof generation. There is no `applicantId` witness.
- It never appears in `tx.public`, the public transcript, the preimage, the
  ledger, console output, storage, or network payloads.
- The Live UI deliberately never re-displays income; only the Local Demo tab
  shows the entered value, and it does so to demonstrate the privacy property.
- The contract's two assertion strings (below-threshold, replay) are the only
  income-related messages, and they reveal nothing about the value.

## Application-scoped replay protection (public by design)

The on-chain nullifier is `persistentHash(["proofly:claim:", applicationId])`
— keyed by the public `applicationId` **only**. Income and threshold are not
part of it. Consequently:

- An **Application ID is single-use**: a second claim for the same
  `applicationId` is denied with `Claim already used for this application`,
  regardless of threshold or income. This is intentionally observable via the
  disclosed nullifier and the `usedNullifiers` ledger set.
- Different Application IDs are independent claims; they never block each other.
- No device identity, fingerprint, or persistent browser identity is used, and
  no `applicantId` witness exists. Replay protection comes purely from the
  public Application ID scope.

## Public values (safe to commit)

These are public by design and are committed / documented intentionally:

| Value | Why it is public |
|---|---|
| `VITE_NETWORK_ID=preprod` | Testnet id; no access control |
| `VITE_CONTRACT_ADDRESS` | Everyone must be able to find/prove against the contract |
| `VITE_INDEXER_URL` / `VITE_INDEXER_WS_URL` | Public Midnight indexer endpoints |
| Deployer public address, tx ids, block ids | On-chain facts in `docs/evidence/DEPLOYMENT.md` |

## Secret policy (operators)

1. Set `PROOFLY_DEPLOYER_SEED` in the shell or a gitignored `.env`; never commit it.
2. Never paste a real contract address into source — use `VITE_CONTRACT_ADDRESS`
   in a gitignored `frontend/.env` or the public CI/Netlify build config.
3. Re-run the secret scan below after any change and before any push.

## Secret scan (runs clean)

```bash
git grep -nEi "seed|private.?key|mnemonic|PROOFLY_DEPLOYER_SEED=" -- ':!docs/SECURITY-AND-SECRETS.md' || true
git ls-files | grep -Ei '\.env' || true          # expect: .env.example only
```

## Related

- Private-income privacy verification — `tests/proofly.privacy.test.ts`,
  `docs/LEVEL3-ARCHITECTURE.md` §4.
- Operator deployment security — `docs/LEVEL2-DEPLOYMENT.md` §7.
- CI has no secrets — `docs/CI-CD.md`.
- Netlify env is public only — `docs/STATIC-HOSTING.md`.