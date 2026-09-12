/**
 * Proofly — shared witness wiring.
 *
 * This is THE privacy boundary of the application. One secret is bound into a
 * Compact WITNESS closure (the ShadowBid / ShadowPass-Level5 pattern):
 *
 *   `income` — the applicant's exact monthly income.
 *
 * It is therefore:
 *   - NEVER a circuit argument (only `requiredMonthlyIncome` and `applicationId`
 *     are public);
 *   - NEVER written to ledger state;
 *   - NEVER logged, stored, or placed in a URL.
 *
 * The secret enters here from the React component state and flows exclusively
 * through `ctx.privateState` machinery into the zero-knowledge circuit.
 */

import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/**
 * Public ledger shape observed by the compiled contract (and passed to witnesses
 * via their `WitnessContext`). Structurally matches the generated `Ledger` type
 * in `compiled-contract.d.ts`.
 */
export interface ProoflyLedger {
  readonly proofCount: bigint;
  usedNullifiers: {
    isEmpty(): boolean;
    size(): bigint;
    member(key: Uint8Array): boolean;
    lookup(key: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<[Uint8Array, boolean]>;
  };
}

/** Structural shape the compiled Proofly `Contract` constructor requires. */
export interface ProoflyWitnesses<PS = unknown> {
  income(context: WitnessContext<ProoflyLedger, PS>): [PS, bigint];
}

/**
 * Build the `income` witness for a single live run.
 *
 * @param income The applicant's exact monthly income. Referenced through
 *               this closure only — never a circuit argument, never stored.
 */
export function createProoflyWitnesses<PS = unknown>(
  income: bigint,
): ProoflyWitnesses<PS> {
  return {
    income(context: WitnessContext<ProoflyLedger, PS>): [PS, bigint] {
      return [context.privateState, income];
    },
  };
}