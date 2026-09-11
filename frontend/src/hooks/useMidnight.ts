/**
 * Proofly — Lace (Midnight DApp Connector) hook.
 *
 * Manages the wallet lifecycle used by Live Preprod mode:
 *   findWallets → connect('preprod') → buildProviders → findDeployedContract
 *   → disconnect
 *
 * Modeled on ShadowPass-Level5's `useMidnight.ts` with Proofly's optional
 * contract address taken into account: if `VITE_CONTRACT_ADDRESS` is not yet
 * configured the wallet can still connect (provider foundation is real) but no
 * deployed contract is looked up and Live submission stays disabled.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { InitialAPI, ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';

import { buildProviders, type ProoflyProviders } from '../midnight/providers.js';
import {
  findProoflyContract,
  type DeployedContract,
} from '../midnight/contract-service.js';
import { isContractConfigured, NETWORK_ID } from '../config.js';
import type { ConnectionState } from '../midnight/types.js';

const CONNECT_TIMEOUT_MS = 60_000;

/** Discover wallets injected into the page by the Midnight DApp Connector. */
export function findWallets(): InitialAPI[] {
  const midnight = (window as any).midnight as Record<string, InitialAPI> | undefined;
  if (!midnight) return [];
  return Object.values(midnight).filter(
    (c): c is InitialAPI =>
      typeof c === 'object' &&
      typeof c.name === 'string' &&
      typeof c.icon === 'string' &&
      typeof c.apiVersion === 'string' &&
      typeof c.connect === 'function',
  );
}

interface ConnectResult {
  connectedAPI: ConnectedAPI;
  providers: ProoflyProviders;
  deployed: DeployedContract | null;
  walletAddress: string;
}

export function useMidnight() {
  const [wallets, setWallets] = useState<InitialAPI[]>([]);
  const [connection, setConnection] = useState<ConnectionState>({ state: 'disconnected' });
  const [providers, setProviders] = useState<ProoflyProviders | null>(null);
  const [deployed, setDeployed] = useState<DeployedContract | null>(null);
  const connectedAPIRef = useRef<ConnectedAPI | null>(null);

  useEffect(() => {
    setWallets(findWallets());
  }, []);

  const connect = useCallback(async (wallet: InitialAPI) => {
    setConnection({ state: 'connecting' });

    const connectWithTimeout = async (): Promise<ConnectResult> => {
      // Step 1: Wallet connection (triggers the authorization popup if needed).
      const connectedAPI = await wallet.connect(NETWORK_ID);

      // Step 2: Providers (network id, config, keys, proving, indexer, wallet).
      const p = await buildProviders(connectedAPI, NETWORK_ID);

      // Step 2b: Wallet address for display (best-effort).
      let walletAddress = '';
      try {
        walletAddress = (await connectedAPI.getShieldedAddresses()).shieldedAddress ?? '';
      } catch (err) {
        console.warn('[Proofly] getShieldedAddresses for display failed:', err);
      }

      // Step 3: Find the deployed contract only if an address is configured.
      let deployed: DeployedContract | null = null;
      if (isContractConfigured()) {
        // Placeholder witnesses — only matter at proof time; each proof
        // re-binds the real income + fresh claim identity (see useProofly/prove).
        deployed = await findProoflyContract(p, 0n, new Uint8Array(32));
      }

      return { connectedAPI, providers: p, deployed, walletAddress };
    };

    try {
      const result = await Promise.race([
        connectWithTimeout(),
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Connection timed out after ${CONNECT_TIMEOUT_MS / 1000}s. Check that the Lace Midnight extension is installed and enabled for Midnight Preprod.`,
                ),
              ),
            CONNECT_TIMEOUT_MS,
          ),
        ),
      ]);

      connectedAPIRef.current = result.connectedAPI;
      setProviders(result.providers);
      setDeployed(result.deployed);
      setConnection({
        state: 'connected',
        walletName: wallet.name,
        walletVersion: wallet.apiVersion,
        walletAddress: result.walletAddress,
      });
    } catch (err) {
      console.error('[Proofly] Wallet connection failed:', err);
      connectedAPIRef.current = null;
      setProviders(null);
      setDeployed(null);
      setConnection({
        state: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const disconnect = useCallback(() => {
    connectedAPIRef.current = null;
    setProviders(null);
    setDeployed(null);
    setConnection({ state: 'disconnected' });
  }, []);

  return { wallets, connection, providers, deployed, connect, disconnect };
}