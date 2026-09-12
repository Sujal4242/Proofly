/**
 * Proofly — Live Preprod proof hook.
 *
 * Drives the real `proveIncome(requiredMonthlyIncome, applicationId)` transaction
 * path and reads the public `proofCount` from the indexer via the generated
 * ledger decoder. No transaction is ever submitted unless `VITE_CONTRACT_ADDRESS`
 * is configured AND `findProoflyContract` resolves to a deployed contract.
 *
 * The exact monthly income is bound into the witness closure exclusively — it
 * is never logged, never shown in `tx.public`, and never placed anywhere
 * outside the local proof generation. The `applicationId` is a PUBLIC
 * claim-scoping input supplied by the caller.
 *
 * Before the wallet/proving service is contacted, a LOCAL unproven circuit
 * preflight (`preflightProveIncome`) runs the same circuit against the current
 * on-chain ledger. Deterministic denials (income below threshold, a claim for
 * an already-used application) surface as `Proof denied — <assertion>` and the
 * wallet is never asked to prove them. Generic preflight failures
 * (indexer/decode) are non-fatal: the real wallet flow still runs, so
 * wallet/network/prover errors keep their existing classification. Because the
 * nullifier is scoped to `applicationId` alone, every claim for the same
 * application reuses the same nullifier and is denied on-chain — making each
 * Application ID single-use.
 */

import { useCallback, useState } from 'react';

import type { ProoflyProviders } from '../midnight/providers.js';
import {
  findProoflyContract,
  preflightProveIncome,
  readProofCountFromLedger,
  type DeployedContract,
} from '../midnight/contract-service.js';
import { classifyError, formatDenialMessage } from '../midnight/errors.js';
import { encodeApplicationId } from '../midnight/application-id.js';
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
   * Prove income >= threshold for a PUBLIC application on Preprod.
   *
   * The exact income is bound into the witness closure as the ONLY private
   * input — it is in-memory only, never stored, displayed, or sent anywhere.
   *
   * A local unproven-circuit preflight runs first (see module doc); a
   * deterministic denial short-circuits to `denied` before the wallet is asked
   * to prove anything.
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
    async (
      providers: ProoflyProviders,
      income: bigint,
      threshold: bigint,
      applicationId: string,
    ) => {
      setVerification({ state: 'generating' });
      try {
        // Local unproven-circuit preflight against the CURRENT on-chain ledger.
        // Deterministic denials (below-threshold, a claim for an already-used
        // application) are shown as `Proof denied — <assertion>` WITHOUT
        // contacting the wallet/prover. Generic preflight failures
        // (indexer/decode) are non-fatal — the real wallet flow below stays
        // authoritative for proving/network errors.
        try {
          await preflightProveIncome(income, threshold, applicationId, providers);
        } catch (preflightErr) {
          const verdict = classifyError(preflightErr);
          if (verdict.state === 'denied') {
            setVerification({ state: 'denied', message: formatDenialMessage(verdict.message) });
            return;
          }
          console.warn(
            '[Proofly] Local preflight could not run the circuit; continuing with the wallet proof.',
            verdict.state === 'error' ? verdict.message : String(preflightErr),
          );
        }

        // Rebinds the income witness to THIS run's value (Level5 pattern) and
        // fetches the current public contract state.
        setVerification({ state: 'awaiting-wallet' });
        const deployed: DeployedContract = await findProoflyContract(providers, income);

        // Generates the proof, requests wallet approval, signs, submits, and
        // waits for confirmation. `applicationId` is a public circuit argument.
        const tx: any = await (deployed.callTx.proveIncome as any)(
          threshold,
          encodeApplicationId(applicationId),
        );
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

          setVerification({
            state: 'granted',
            txId,
            blockHeight,
            proofCount: count,
            applicationId,
          });
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