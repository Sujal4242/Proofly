/**
 * Proofly — shared witness wiring.
 *
 * This is THE privacy boundary of the application. The exact monthly income is
 * bound into the Compact `income` WITNESS closure (the ShadowBid /
 * ShadowPass-Level5 pattern) and is therefore:
 *   - NEVER a circuit argument (only `requiredMonthlyIncome` is public);
 *   - NEVER written to ledger state;
 *   - NEVER logged, stored, or placed in a URL.
 *
 * The income enters here from the React component state and flows exclusively
 * through `ctx.privateState` machinery into the zero-knowledge circuit.
 */

import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/** Structural shape the compiled Proofly `Contract` constructor requires. */
export interface ProoflyWitnesses<PS = unknown> {
  income(context: WitnessContext<{ proofCount: bigint }, PS>): [PS, bigint];
}

/**
 * Build the `income` witness for a single live run.
 *
 * @param income The applicant's exact monthly income. It is referenced through
 *               this closure only — it never becomes a circuit argument.
 */
export function createProoflyWitnesses<PS = unknown>(income: bigint): ProoflyWitnesses<PS> {
  return {
    income(context: WitnessContext<{ proofCount: bigint }, PS>): [PS, bigint] {
      return [context.privateState, income];
    },
  };
}