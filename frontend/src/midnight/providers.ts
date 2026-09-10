/**
 * Proofly — browser provider assembly.
 *
 * Wires the 7 midnight-js providers from a live Lace DApp Connector connection,
 * following the proven ShadowPass-Level5 "Flash Loan" pattern:
 *   1. setNetworkId
 *   2. getConfiguration          → wallet's own indexer/prover endpoints
 *   3. getShieldedAddresses      → coin + encryption public keys
 *   4. getProvingProvider        → wallet-delegated (browser) proving w/ timeout
 *   5. httpClientProofProvider   → fallback to the wallet's proverServerUri
 *   6. indexerPublicDataProvider → public indexer reads
 *   7. InMemoryPrivateStateProvider + walletProvider + midnightProvider
 *
 * No custom backend is involved: every network call goes to Midnight/Lace
 * infrastructure only.
 */

import type {
  CoinPublicKey,
  EncPublicKey,
  FinalizedTransaction,
} from '@midnight-ntwrk/ledger-v8';
import { Transaction } from '@midnight-ntwrk/ledger-v8';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import type {
  ZKConfigProvider,
  ProofProvider,
  PublicDataProvider,
  WalletProvider,
  MidnightProvider,
  UnboundTransaction,
  PrivateStateId,
} from '@midnight-ntwrk/midnight-js-types';
import { createProofProvider } from '@midnight-ntwrk/midnight-js-types';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';

import { ZK_ASSETS_BASE, INDEXER_URL, INDEXER_WS_URL } from '../config.js';
import {
  PROOFLY_PRIVATE_STATE_ID,
  InMemoryPrivateStateProvider,
} from './in-memory-private-state-provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToUint8Array(hex: string): Uint8Array {
  const cleaned = hex.startsWith('0x') ? hex.slice(2) : hex;
  const matches = cleaned.match(/.{1,2}/g) ?? [];
  return new Uint8Array(matches.map((byte) => parseInt(byte, 16)));
}

const PROVING_PROVIDER_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Provider shape
// ---------------------------------------------------------------------------

export interface ProoflyProviders {
  zkConfigProvider: ZKConfigProvider<string>;
  proofProvider: ProofProvider;
  privateStateProvider: InMemoryPrivateStateProvider;
  publicDataProvider: PublicDataProvider;
  walletProvider: WalletProvider;
  midnightProvider: MidnightProvider;
  privateStateId: PrivateStateId;
}

// ---------------------------------------------------------------------------
// buildProviders
// ---------------------------------------------------------------------------

/**
 * Wires all providers from a live DApp Connector connection.
 * Must be called after `wallet.connect(NETWORK_ID)` has succeeded.
 */
export async function buildProviders(
  connectedAPI: ConnectedAPI,
  networkId: string,
): Promise<ProoflyProviders> {
  // 1. Set the network id (matches the Flash Loan / ShadowPass pattern).
  setNetworkId(networkId);

  // 2. Wallet's own configuration (endpoints, proving).
  const config = await connectedAPI.getConfiguration();

  // 3. Wallet addresses → public keys.
  const shielded = await connectedAPI.getShieldedAddresses();

  // 4. ZK config: served from the static site (zkir / keys).
  const zkConfigProvider = new FetchZkConfigProvider(
    ZK_ASSETS_BASE,
    window.fetch.bind(window),
  );

  // 5. Proof provider: prefer wallet-delegated proving, fall back to the
  //    wallet's proof server URI. Either way all proof material stays with
  //    Midnight/Lace infrastructure.
  let proofProvider: ProofProvider;
  try {
    const provingProvider = await Promise.race([
      connectedAPI.getProvingProvider(zkConfigProvider.asKeyMaterialProvider()),
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error(`getProvingProvider timed out (${PROVING_PROVIDER_TIMEOUT_MS / 1000}s)`)),
          PROVING_PROVIDER_TIMEOUT_MS,
        ),
      ),
    ]);
    proofProvider = createProofProvider(provingProvider);
  } catch (err) {
    console.warn('[Proofly] getProvingProvider unavailable, falling back to wallet proof server:', err);
    const proofServerUrl = config.proverServerUri;
    if (proofServerUrl) {
      proofProvider = httpClientProofProvider(proofServerUrl, zkConfigProvider);
    } else {
      throw new Error(
        'No proving provider available: wallet getProvingProvider failed and no proverServerUri is configured in the wallet.',
      );
    }
  }

  // 6. Public data: the public indexer (wallet endpoints win, Preprod defaults otherwise).
  const indexerUrl = config.indexerUri ?? INDEXER_URL;
  const indexerWsUrl = config.indexerWsUri ?? INDEXER_WS_URL;
  const publicDataProvider = indexerPublicDataProvider(indexerUrl, indexerWsUrl);

  // 7. Private state: strictly in-memory.
  const privateStateProvider = new InMemoryPrivateStateProvider();

  // 8. Wallet provider (balances/signs transactions via the wallet).
  const walletProvider: WalletProvider = {
    getCoinPublicKey(): CoinPublicKey {
      return shielded.shieldedCoinPublicKey;
    },
    getEncryptionPublicKey(): EncPublicKey {
      return shielded.shieldedEncryptionPublicKey;
    },
    async balanceTx(tx: UnboundTransaction, _ttl?: Date): Promise<FinalizedTransaction> {
      const serialized = tx.serialize();
      const result = await connectedAPI.balanceUnsealedTransaction(uint8ArrayToHex(serialized));
      return Transaction.deserialize(
        'signature',
        'proof',
        'binding',
        hexToUint8Array(result.tx),
      ) as FinalizedTransaction;
    },
  };

  // 9. Midnight provider (submits the signed transaction).
  const midnightProvider: MidnightProvider = {
    async submitTx(tx) {
      const serialized = tx.serialize();
      await connectedAPI.submitTransaction(uint8ArrayToHex(serialized));
      return tx.identifiers()[0];
    },
  };

  return {
    zkConfigProvider,
    proofProvider,
    privateStateProvider,
    publicDataProvider,
    walletProvider,
    midnightProvider,
    privateStateId: PROOFLY_PRIVATE_STATE_ID,
  };
}