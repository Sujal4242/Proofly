# Proofly — Static Hosting (Netlify)

Proofly's frontend is a **static bundle** (`frontend/dist`) built by Vite. There
is no server, no database, no backend API — so it is published exactly like any
static site. `netlify.toml` configures that build and publishes the result.

## Status

- `netlify.toml` is **committed** (`feat: add static Netlify hosting config`)
  and locally validated (build succeeds, valid config syntax confirmed via
  `tomllib`).
- A live deployment is **configured, not yet deployed**: creating/publishing the
  Netlify site is a deliberate one-click operator action. Nothing here assumes
  the site is live yet.

## What gets published

`netlify.toml` (`[build] base = "."`, `publish = "frontend/dist"`) and a
9-step build command that mirrors the CI pipeline so the deployed bundle is
always built from the same contracts and versions:

```bash
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/download/compact-v0.5.1/compact-installer.sh | sh
export PATH="$HOME/.local/bin:$HOME/.compact/bin:$PATH"
compact --version
compact update 0.31.1
compact compile --version
npm ci
npm --prefix frontend ci
npm run compile
npm run build:frontend
```

Netlify does **not** compile or run tests by default here beyond what is needed
for the publish — the workflow compiles the contract and builds the frontend
distribution. Any deployment CLI needed is fetched from the official
`compact-v0.5.1/compact-installer.sh` artifact (same flow as CI).

## Environment (public by design)

`[build.environment]` bakes these into the bundle at build time:

| Variable | Value |
|---|---|
| `NODE_VERSION` | `22` |
| `VITE_NETWORK_ID` | `preprod` |
| `VITE_CONTRACT_ADDRESS` | the deployed Proofly contract address |
| `VITE_INDEXER_URL` | `https://indexer.preprod.midnight.network/api/v4/graphql` |
| `VITE_INDEXER_WS_URL` | `wss://indexer.preprod.midnight.network/api/v4/graphql/ws` |

These are the **same public values** as `frontend/.env.example`, `.env` in local
runs, and the CI build step. They contain no secrets. After a contract
redeployment, only `VITE_CONTRACT_ADDRESS` needs to change and the site rebuilt.

## How it works in the app

- `frontend/src/config.ts` reads the `VITE_*` values at build time.
- Without `VITE_CONTRACT_ADDRESS` the site builds and serves fine, but Live
  mode shows the "no deployed contract" disabled state (LIVE_DISABLED_REASON) —
  the wallet can connect, the proof count is simply not read.
- All runtime traffic flows from the browser to Lace / Midnight Preprod
  infrastructure; the static host only serves files.

## Operators: publishing a new version

1. Commit the contract and/or frontend changes (CI validates them first).
2. Push to the Netlify branch (or trigger a manual deploy) — Netlify runs the
   build command above from the committed `netlify.toml`.
3. Confirm the deploy log reports a clean `npm run compile` and
   `npm run build:frontend`, and that `frontend/dist` artifacts are present.
4. Verify the live site: Local Demo works offline; Live mode requires Lace on
   Preprod and shows the deployed `proofCount` from the configured address.

## Related

- CI validation pipeline — `docs/CI-CD.md`.
- Secret handling — `docs/SECURITY-AND-SECRETS.md`.
- End-to-end walkthrough — `docs/FINAL-DEMO-RUNBOOK.md`.