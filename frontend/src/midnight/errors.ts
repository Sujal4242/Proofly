/**
 * Proofly — error classification.
 *
 * Maps rejection messages from the Live Preprod flow into a `VerificationState`.
 *
 * The circuit assertion failure — `Income below required minimum` — is a
 * *local* failure raised during proof generation, BEFORE any transaction is
 * submitted, so the private income never leaves the prover. It must surface as
 * `denied`. Wallet/funds/network problems must surface as `error`.
 */

import type { VerificationState } from './types.js';

/** The exact assertion string produced by `contracts/proofly.compact`. */
export const INCOME_DENIED_MESSAGE = 'Income below required minimum';

const DENIED_HINTS = [INCOME_DENIED_MESSAGE];

const FUNDS_HINTS = ['balance', 'dust', 'funds'];

/** Collapse native-code assertion messages (wasm/zkir/circuit) to one string. */
export function extractAssertion(message: string): string {
  for (const hint of DENIED_HINTS) {
    if (message.includes(hint)) return hint;
  }
  return message;
}

export function classifyError(message: string): VerificationState {
  const lower = message.toLowerCase();
  if (DENIED_HINTS.some((hint) => lower.includes(hint.toLowerCase()))) {
    return { state: 'denied', message: extractAssertion(message) };
  }
  if (FUNDS_HINTS.some((hint) => lower.includes(hint))) {
    return {
      state: 'error',
      message:
        'Insufficient funds — obtain Preprod test tokens to cover the transaction fee.',
    };
  }
  return { state: 'error', message };
}