/**
 * Proofly — error classification.
 *
 * Maps rejection messages from the Live Preprod flow into a `VerificationState`.
 *
 * The circuit assertion failures — `Income below required minimum` and
 * `Claim already used for this application` — are *local* failures raised
 * during proof generation, BEFORE any transaction is submitted, so the private
 * income and claim identity never leave the prover. They must surface as
 * `denied`. Wallet/funds/network problems must surface as `error`.
 *
 * The ladder is never inferred from wrapping text. Only the EXACT circuit
 * assertion strings count as a denial — a generic wallet/prover/network
 * "Request failed" is NEVER classified as replay or income-below-threshold
 * unless a local preflight already established the deterministic denial.
 */

import type { VerificationState } from './types.js';

/** The exact assertion strings produced by `contracts/proofly.compact`. */
export const INCOME_DENIED_MESSAGE = 'Income below required minimum';
export const REPLAY_DENIED_MESSAGE = 'Claim already used for this application';

const DENIED_HINTS = [INCOME_DENIED_MESSAGE, REPLAY_DENIED_MESSAGE];

const FUNDS_HINTS = ['balance', 'dust', 'funds'];

/** How deep we walk `Error.cause` on midnight-js/scoped-transaction wrappers. */
const ERROR_CAUSE_DEPTH = 6;

/** Collapse native-code assertion messages (wasm/zkir/circuit) to one string. */
export function extractAssertion(message: string): string {
  for (const hint of DENIED_HINTS) {
    if (message.includes(hint)) return hint;
  }
  return message;
}

/**
 * Collect a message per level along an error's `cause` chain, so assertion
 * text buried under `'check' returned an error` / `Unexpected error ... scoped
 * transaction ...` wrappers can still be seen (defensive only).
 */
export function messageChain(err: unknown): string[] {
  const messages: string[] = [];
  let current: unknown = err;
  for (let i = 0; i < ERROR_CAUSE_DEPTH && current != null; i += 1) {
    messages.push(current instanceof Error ? current.message : String(current));
    current = (current as { cause?: unknown })?.cause;
  }
  return messages;
}

/**
 * Find a deterministic application-level Compact assertion anywhere in the
 * cause chain. Returns the canonical hint, or undefined. A generic
 * wallet/network/prover failure ("Request failed") contains none of the exact
 * assertions, so it is never treated as a denial here.
 */
export function findDenialHint(err: unknown): string | undefined {
  for (const message of messageChain(err)) {
    for (const hint of DENIED_HINTS) {
      if (message.includes(hint)) return hint;
    }
  }
  return undefined;
}

/** Prefix used when surfacing a local-preflight denial to the user. */
export const DENIAL_MESSAGE_PREFIX = 'Proof denied — ';

/** Format a local-preflight denial: `Proof denied — <canonical assertion>`. */
export function formatDenialMessage(message: string): string {
  return `${DENIAL_MESSAGE_PREFIX}${extractAssertion(message)}`;
}

export function classifyError(err: unknown): VerificationState {
  const messages = messageChain(err);
  const raw = messages[0] ?? '';
  const lower = messages.join('\n').toLowerCase();

  const denialHint = findDenialHint(err);
  if (denialHint) {
    return { state: 'denied', message: denialHint };
  }
  if (FUNDS_HINTS.some((hint) => lower.includes(hint))) {
    return {
      state: 'error',
      message:
        'Insufficient funds — obtain Preprod test tokens to cover the transaction fee.',
    };
  }
  return { state: 'error', message: raw };
}