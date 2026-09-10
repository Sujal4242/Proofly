/**
 * Proofly — Live Preprod proof hook.
 *
 * Drives the real `proveIncome(requiredMonthlyIncome)` transaction path and
 * reads the public `proofCount` from the indexer via the generated ledger
 * decoder. No transaction is ever submitted unless `VITE_CONTRACT_ADDRESS` is
 * configured AND `findProoflyContract` resolves to a deployed contract.
 *
 * The exact monthly income is bound into the witness closure exclusively —
 * it is never logged, never shown in `tx.public`, and never placed anywhere
 * outside the local proof generation.
 */

import { useCallback, useState } from 'react';

import type { ProoflyProviders } from '../midnight/providers.js';
import {
  findProoflyContract,
  readProofCountFromLedger,
  type DeployedContract,
} from '../midnight/contract-service.js';
import { classifyError } from '../midnight/errors.js';
import { asContractAddress } from '@midnight-ntwrk/midnight-js-types';
import { CONTRACT_ADDRESS, isContractConfigured } from '../config.js';
import type { VerificationState } from '../midnight/types.js';

function isSucceedEntirely(status: unknown): boolean {
  if (
    status !== null &&
    typeof status === 'object' &&
    'tag' in (status as Record<string, unknown>)
  ) {
    return (status as { tag: string }).tag === 'SucceedEntirely';
  }
  return String(status).includes('SucceedEntirely');
}

export function useProofly() {
  const [verification, setVerification] = useState<VerificationState>({ state: 'idle' });
  const [proofCount, setProofCount] = useState<number | null>(null);
  const [proofCountError, setProofCountError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setVerification({ state: 'idle' });
  }, []);

  /**
   * Prove income >= threshold on Preprod.
   *
   * State flow observed:
   *   generating → awaiting-wallet → confirming → granted | denied | error
   *
   * `submitting` is defined by the state machine and rendered by the UI, but
   * wallet approval + signing + submission all happen inside the single
   * `callTx.proveIncome` promise (midnight-js contract flow), so it currently
   * collapses into `awaiting-wallet` / `confirming`.
   */
  const prove = useCallback(
    async (providers: ProoflyProviders, income: bigint, threshold: bigint) => {
      setVerification({ state: 'generating' });
      try {
        // Rebinds the income witness to THIS run's value (Level5 pattern) and
        // fetches the current public contract state for the proof.
        setVerification({ state: 'awaiting-wallet' });
        const deployed: DeployedContract = await findProoflyContract(providers, income);

        // Generates the proof, requests wallet approval, signs, submits, and
        // waits for confirmation.
        const tx: any = await (deployed.callTx.proveIncome as any)(threshold);
        setVerification({ state: 'confirming' });

        const status = tx?.public?.status;
        if (isSucceedEntirely(status)) {
          const txId = String(tx?.public?.txId ?? '');
          const blockHeight = Number(tx?.public?.blockHeight ?? 0);

          let count = 0;
          try {
            const nextState =
              (tx?.public as any)?.nextContractState?.data ??
              (tx?.public as any)?.nextContractState;
            count = readProofCountFromLedger(nextState);
            setProofCount(count);
            setProofCountError(null);
          } catch (err) {
            console.warn('[Proofly] Could not decode proofCount from next state:', err);
          }

          setVerification({ state: 'granted', txId, blockHeight, proofCount: count });
        } else {
          setVerification({
            state: 'denied',
            message: `Transaction rejected (status: ${JSON.stringify(status)})`,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setVerification(classifyError(message));
      }
    },
    [],
  );

  /**
   * Read the public `proofCount` from the indexer (`queryContractState` +
   * generated ledger decoder). Gracefully handles the case where no contract
   * address is configured yet — no chain state is ever invented.
   */
  const refreshProofCount = useCallback(async (providers: ProoflyProviders | null) => {
    if (!providers || !isContractConfigured()) {
      setProofCount(null);
      setProofCountError(null);
      return;
    }
    try {
      const contractState = await providers.publicDataProvider.queryContractState(
        asContractAddress(CONTRACT_ADDRESS),
      );
      if (!contractState) {
        setProofCount(null);
        setProofCountError('The indexer returned no contract state yet. Is the contract deployed?');
        return;
      }
      setProofCount(readProofCountFromLedger(contractState.data));
      setProofCountError(null);
    } catch (err) {
      setProofCountError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return { verification, proofCount, proofCountError, prove, reset, refreshProofCount };
}