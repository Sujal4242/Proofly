/**
 * Proofly — L2 configuration defaults + Live-mode gating tests.
 *
 * Verifies that:
 *   1. default network is Midnight Preprod with the public indexer endpoints;
 *   2. no contract address is configured by default, so Live mode is disabled;
 *   3. `findProoflyContract` fails FAST with a clear reason when the address is
 *      absent — no chain interaction, no invented state;
 *   4. income is never read from the environment (no VITE_INCOME anywhere).
 */
import { describe, expect, it } from 'vitest';

import {
  CONTRACT_ADDRESS,
  INDEXER_URL,
  INDEXER_WS_URL,
  isContractConfigured,
  LIVE_DISABLED_REASON,
  NETWORK_ID,
  ZK_ASSETS_BASE,
} from '../frontend/src/config.js';

describe('Proofly configuration defaults', () => {
  it('defaults to the Midnight Preprod network', () => {
    expect(NETWORK_ID).toBe('preprod');
  });

  it('defaults the indexer to the public Preprod indexer', () => {
    expect(INDEXER_URL).toBe('https://indexer.preprod.midnight.network/api/v4/graphql');
    expect(INDEXER_WS_URL).toBe('wss://indexer.preprod.midnight.network/api/v4/graphql/ws');
  });

  it('has no contract address configured by default (Live disabled)', () => {
    expect(CONTRACT_ADDRESS).toBe('');
    expect(isContractConfigured()).toBe(false);
    expect(LIVE_DISABLED_REASON).toContain('VITE_CONTRACT_ADDRESS');
  });

  it('resolves a static ZK assets base (window-independent, non-browser)', () => {
    expect(ZK_ASSETS_BASE).toBe('/midnight/proofly');
  });

  it('never reads the income from the environment (no VITE_INCOME)', async () => {
    const env = (import.meta as any as { env?: Record<string, unknown> }).env ?? {};
    expect('VITE_INCOME' in env).toBe(false);

    const config = await import('../frontend/src/config.js');
    expect(Object.keys(config)).not.toContain('VITE_INCOME');
    expect(Object.keys(config)).not.toContain('INCOME');
  });
});

describe('Proofly Live mode is disabled until a contract address exists', () => {
  it('findProoflyContract fails fast without interacting with any chain', async () => {
    const { findProoflyContract } = await import('../frontend/src/midnight/contract-service.js');

    // A deliberately bogus provider: if the function touched any provider this
    // would blow up indirectly; instead it must reject with the clear reason
    // BEFORE any provider is used.
    const providers = { doesNotMatter: true } as any;
    await expect(findProoflyContract(providers, 1n, new Uint8Array(32))).rejects.toThrow(
      LIVE_DISABLED_REASON,
    );
  });
});