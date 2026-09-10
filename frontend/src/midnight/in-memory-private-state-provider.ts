/**
 * Proofly — in-memory PrivateStateProvider for the browser.
 *
 * Proofly's `proveIncome` circuit has no persisted private state of its own —
 * the income lives exclusively in the witness closure. This provider is a
 * plumbing shim for `findDeployedContract` and keeps ALL private state in
 * memory (never localStorage, never serialized, never sent anywhere).
 */

import type {
  PrivateStateId,
  PrivateStateProvider,
  PrivateStateExport,
  SigningKeyExport,
  ImportPrivateStatesResult,
  ImportSigningKeysResult,
} from '@midnight-ntwrk/midnight-js-types';

export const PROOFLY_PRIVATE_STATE_ID = 'prooflyPrivateState';

export class InMemoryPrivateStateProvider<TState = unknown>
  implements PrivateStateProvider<PrivateStateId, TState>
{
  private contractAddress = '';
  private readonly state = new Map<PrivateStateId, TState>();
  private readonly signingKeys = new Map<string, string>();

  setContractAddress(address: string): void {
    this.contractAddress = address;
  }

  async set(privateStateId: PrivateStateId, state: TState): Promise<void> {
    this.assertScoped();
    this.state.set(privateStateId, state);
  }

  async get(privateStateId: PrivateStateId): Promise<TState | null> {
    this.assertScoped();
    return this.state.get(privateStateId) ?? null;
  }

  async remove(privateStateId: PrivateStateId): Promise<void> {
    this.assertScoped();
    this.state.delete(privateStateId);
  }

  async clear(): Promise<void> {
    this.state.clear();
  }

  async setSigningKey(address: string, signingKey: string): Promise<void> {
    this.signingKeys.set(address, signingKey);
  }

  async getSigningKey(address: string): Promise<string | null> {
    return this.signingKeys.get(address) ?? null;
  }

  async removeSigningKey(address: string): Promise<void> {
    this.signingKeys.delete(address);
  }

  async clearSigningKeys(): Promise<void> {
    this.signingKeys.clear();
  }

  async exportPrivateStates(): Promise<PrivateStateExport> {
    return { format: 'midnight-private-state-export', encryptedPayload: '', salt: '' };
  }

  async importPrivateStates(): Promise<ImportPrivateStatesResult> {
    return { imported: 0, skipped: 0, overwritten: 0 };
  }

  async exportSigningKeys(): Promise<SigningKeyExport> {
    return { format: 'midnight-signing-key-export', encryptedPayload: '', salt: '' };
  }

  async importSigningKeys(): Promise<ImportSigningKeysResult> {
    return { imported: 0, skipped: 0, overwritten: 0 };
  }

  private assertScoped(): void {
    if (!this.contractAddress) {
      throw new Error('setContractAddress must be called before using private state operations');
    }
  }
}