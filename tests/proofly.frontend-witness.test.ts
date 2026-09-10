/**
 * Proofly — L2 witness wiring tests.
 *
 * Verifies, against the REAL compiled contract artifact (the identical bytes
 * copied to the frontend by copy-zk-assets), that:
 *   1. the exact income is bound through the `income` WITNESS closure and
 *      never passed as a circuit argument;
 *   2. a sub-threshold run surfaces the exact circuit assertion
 *      ("Income below required minimum") → the `denied` classification.
 *
 * These run completely offline — no wallet, no Preprod, no transactions. They
 * are NOT fake "a wallet transaction happened" tests. They import the managed
 * artifact (same `compact-runtime` instance as the rest of the suite) rather
 * than the frontend copy solely to avoid dual bundled-runtime copies.
 */
import { describe, expect, it } from 'vitest';

import * as ocrt from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger } from '../contracts/managed/proofly/contract/index.js';
import { createProoflyWitnesses } from '../frontend/src/midnight/witnesses.js';
import { classifyError, INCOME_DENIED_MESSAGE } from '../frontend/src/midnight/errors.js';
import { DEMO_COIN_PUBLIC_KEY_HEX } from '../frontend/src/proofly/demo-keys.js';

const encodedCoinPublicKey: ocrt.EncodedCoinPublicKey = {
  bytes: hexToBytes(DEMO_COIN_PUBLIC_KEY_HEX),
};

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

describe('Proofly witness wiring (frontend compiled contract)', () => {
  it('binds the exact income through the income witness, not a circuit argument', () => {
    const witnesses = createProoflyWitnesses<{}>(82_500n);
    expect(Object.keys(witnesses)).toEqual(['income']);

    const contract = new Contract(witnesses);
    const initial = contract.initialState(
      ocrt.createConstructorContext({}, encodedCoinPublicKey),
    );
    const context = ocrt.createCircuitContext(
      ocrt.dummyContractAddress(),
      encodedCoinPublicKey,
      initial.currentContractState.data,
      {},
    );

    const res = contract.circuits.proveIncome(context, 50_000n);
    // The circuit runs: a proofData payload is produced and the public ledger
    // counter increments (read from the NEW query context the circuit returns).
    // Income stays a private witness, never a public argument.
    expect(res.proofData).toBeTruthy();
    expect(ledger(res.context.currentQueryContext.state).proofCount).toBe(1n);
  });

  it('surfaces the exact circuit assertion when income < threshold (sub-threshold → denied)', () => {
    const contract = new Contract(createProoflyWitnesses<{}>(35_000n));
    const initial = contract.initialState(
      ocrt.createConstructorContext({}, encodedCoinPublicKey),
    );
    const context = ocrt.createCircuitContext(
      ocrt.dummyContractAddress(),
      encodedCoinPublicKey,
      initial.currentContractState.data,
      {},
    );

    expect(() => contract.circuits.proveIncome(context, 50_000n)).toThrow(
      INCOME_DENIED_MESSAGE,
    );

    // The same message, as surfaced by the Live flow, must classify as DENIED
    // (a proof that could not be produced), distinct from wallet/funds errors.
    const state = classifyError(`${INCOME_DENIED_MESSAGE} (throw@circuit)`);
    expect(state.state).toBe('denied');
    expect(state.state === 'denied' && state.message).toBe(INCOME_DENIED_MESSAGE);
  });

  it('keeps the income out of the public transcript even when accepted', () => {
    const contract = new Contract(createProoflyWitnesses<{}>(82_500n));
    const initial = contract.initialState(
      ocrt.createConstructorContext({}, encodedCoinPublicKey),
    );
    const context = ocrt.createCircuitContext(
      ocrt.dummyContractAddress(),
      encodedCoinPublicKey,
      initial.currentContractState.data,
      {},
    );

    const { proofData } = contract.circuits.proveIncome(context, 50_000n);
    const transcript = JSON.stringify(proofData.publicTranscript);
    expect(transcript).not.toContain('82500');
  });
});