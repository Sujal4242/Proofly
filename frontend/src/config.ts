/**
 * Proofly — public configuration.
 *
 * Every value here is deliberately PUBLIC: network endpoints and an optionally
 * configured contract address (which, once deployed, is visible on-chain).
 *
 * NEVER put secrets here and never add a `VITE_INCOME`-style variable: the exact
 * monthly income is runtime private state passed only through the `income`
 * witness in `midnight/witnesses.ts`.
 */

interface ProoflyEnv {
  VITE_NETWORK_ID?: string;
  VITE_CONTRACT_ADDRESS?: string;
  VITE_INDEXER_URL?: string;
  VITE_INDEXER_WS_URL?: string;
}

/* `import.meta.env` is Vite's typed by `vite/client`; cast so this module also
 * type-checks from Node (vitest / root tsc) where that ambient type is absent. */
const env: ProoflyEnv = (import.meta as unknown as { env?: ProoflyEnv }).env ?? {};

/** Network id passed to the Lace DApp Connector's `connect()`. */
export const NETWORK_ID: string = env.VITE_NETWORK_ID ?? 'preprod';

/**
 * Deployed Proofly contract address on Preprod, set only after a real
 * deployment (see docs/LEVEL2-ARCHITECTURE.md). Empty until then: the Live
 * proof action stays disabled and the indexer reads are skipped.
 */
export const CONTRACT_ADDRESS: string = env.VITE_CONTRACT_ADDRESS?.trim() ?? '';

/** Fallback indexer endpoints when the wallet does not advertise its own. */
export const INDEXER_URL: string =
  env.VITE_INDEXER_URL ?? 'https://indexer.preprod.midnight.network/api/v4/graphql';
export const INDEXER_WS_URL: string =
  env.VITE_INDEXER_WS_URL ?? 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws';

/** Base URL under which the compiled ZK assets (zkir / keys) are served. */
export const ZK_ASSETS_BASE: string =
  typeof window !== 'undefined'
    ? `${window.location.origin}/midnight/proofly`
    : '/midnight/proofly';

/** True once a deployed contract address has been configured. */
export function isContractConfigured(): boolean {
  return CONTRACT_ADDRESS.length > 0;
}

export const LIVE_DISABLED_REASON: string =
  'No deployed Proofly contract address configured yet (VITE_CONTRACT_ADDRESS). The Live mode becomes active after a real Preprod deployment.';