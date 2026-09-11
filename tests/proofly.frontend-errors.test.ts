/**
 * Proofly — L2 error classification tests.
 *
 * Ensures the Live Preprod flow distinguishes the circuit denial
 * ("Income below required minimum" — a proof that could not be produced) from
 * wallet / funds / network problems. No wallets or chains are touched.
 */
import { describe, expect, it } from 'vitest';

import {
  classifyError,
  extractAssertion,
  INCOME_DENIED_MESSAGE,
  REPLAY_DENIED_MESSAGE,
} from '../frontend/src/midnight/errors.js';

describe('Proofly error classification', () => {
  it('classifies the circuit assertion as denied', () => {
    const state = classifyError('failed assert: Income below required minimum');
    expect(state.state).toBe('denied');
  });

  it('classifies the Level 3 replay assertion as denied', () => {
    const state = classifyError('failed assert: Claim already used for this application');
    expect(state.state).toBe('denied');
    expect(state.state === 'denied' && state.message).toBe(REPLAY_DENIED_MESSAGE);
  });

  it('extracts the canonical denial message from native/wasm messages', () => {
    expect(extractAssertion('wasm: Income below required minimum at line 26')).toBe(
      INCOME_DENIED_MESSAGE,
    );
    expect(extractAssertion('wasm: Claim already used for this application at line 31')).toBe(
      REPLAY_DENIED_MESSAGE,
    );
    expect(extractAssertion('something unrelated')).toBe('something unrelated');
  });

  it('classifies funds/dust problems as errors (not denied)', () => {
    const dust = classifyError('Dust limit not met for 0 value output');
    const funds = classifyError('Insufficient funds to cover the transaction fee');
    expect(dust.state).toBe('error');
    expect(funds.state).toBe('error');
  });

  it('classifies network/wallet/approval failures as errors', () => {
    const network = classifyError('getConfiguration failed: Connection refused');
    const timeout = classifyError('Connection timed out after 60s');
    const cancel = classifyError('User declined the transaction request');
    expect(network.state).toBe('error');
    expect(timeout.state).toBe('error');
    expect(cancel.state).toBe('error');
  });

  it('never classifies a generic wallet/prover "Request failed" as a denial', () => {
    const basic = new Error("Error: 'check' returned an error: Error: Request failed");
    const nested = new Error(
      "Unexpected error submitting scoped transaction '<unnamed>': 'check' returned an error: Request failed",
      { cause: basic },
    );
    expect(classifyError(basic).state).toBe('error');
    expect(classifyError(nested).state).toBe('error');
  });

  it('recovers a denial hint buried under scoped-transaction/wallet wrappers', () => {
    const inner = new Error(`failed assert: ${REPLAY_DENIED_MESSAGE}`);
    const mid = new Error("'check' returned an error: Error: Request failed", { cause: inner });
    const outer = new Error(
      "Unexpected error submitting scoped transaction '<unnamed>': 'check' returned an error: Error: Request failed",
      { cause: mid },
    );
    expect(classifyError(outer)).toEqual({
      state: 'denied',
      message: REPLAY_DENIED_MESSAGE,
    });
  });

  it('classifies the above-threshold assertion result via the cause chain too', () => {
    const wrapped = new Error(
      "Error: 'check' returned an error: Error: Request failed",
      { cause: new Error(`wasm: ${INCOME_DENIED_MESSAGE} at line 26`) },
    );
    expect(classifyError(wrapped)).toEqual({
      state: 'denied',
      message: INCOME_DENIED_MESSAGE,
    });
  });
});