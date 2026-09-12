/**
 * Proofly — contract witness wiring tests.
 *
 * Verifies, against the REAL compiled contract artifact (the identical bytes
 * copied to the frontend by copy-zk-assets), that:
 *   1. the exact income is bound through its WITNESS closure (`income`) via the
 *      LIVE `frontend/src/midnight/witnesses.ts` `createProoflyWitnesses` — and
 *      never passed as a circuit argument — only the threshold and application
 *      id are. The returned witness set contains ONLY `income`: no applicant
 *      id exists anymore;
 *   2. a sub-threshold run surfaces the exact circuit assertion
 *      ("Income below required minimum") → the `denied` classification;
 *   3. the income is absent from the public transcript.
 *
 * These run completely offline — no wallet, no Preprod, no transactions. The
 * managed artifact is imported (same `compact-runtime` instance as the rest of
 * the suite) rather than a frontend copy to avoid dual bundled-runtime copies.
 */
import { describe, expect, it } from 'vitest';

import * as ocrt from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger } from '../contracts/managed/proofly/contract/index.js';
import { classifyError, INCOME_DENIED_MESSAGE } from '../frontend/src/midnight/errors.js';
import { createProoflyWitnesses } from '../frontend/src/midnight/witnesses.js';
import { DEMO_COIN_PUBLIC_KEY_HEX } from '../frontend/src/proofly/demo-keys.js';

const APP_A = new Uint8Array(32).fill(0x01);

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

function makeContext(contract: Contract<any>) {
  const initial = contract.initialState(
    ocrt.createConstructorContext({}, encodedCoinPublicKey),
  );
  return ocrt.createCircuitContext(
    ocrt.dummyContractAddress(),
    encodedCoinPublicKey,
    initial.currentContractState.data,
    {},
  );
}

describe('Proofly contract witness wiring (Level 1 + Level 3 surface)', () => {
  it('returns a witness set containing ONLY income (no applicant id)', () => {
    const witnesses = createProoflyWitnesses(82_500n);
    expect(Object.keys(witnesses).sort()).toEqual(['income']);
  });

  it('binds the income through a single witness; only threshold + application id are arguments', () => {
    const contract = new Contract(createProoflyWitnesses(82_500n));
    const context = makeContext(contract);

    const res = contract.circuits.proveIncome(context, 50_000n, APP_A);
    // The circuit runs: a proofData payload is produced and the public counter
    // increments (read from the NEW query context the circuit returns). The
    // income stays a private witness.
    expect(res.proofData).toBeTruthy();
    expect(ledger(res.context.currentQueryContext.state).proofCount).toBe(1n);
  });

  it('surfaces the exact circuit assertion when income < threshold (sub-threshold → denied)', () => {
    const contract = new Contract(createProoflyWitnesses(35_000n));
    const context = makeContext(contract);

    expect(() => contract.circuits.proveIncome(context, 50_000n, APP_A)).toThrow(
      INCOME_DENIED_MESSAGE,
    );

    // The same message, as surfaced by the Live flow, must classify as DENIED
    // (a proof that could not be produced), distinct from wallet/funds errors.
    const state = classifyError(`${INCOME_DENIED_MESSAGE} (throw@circuit)`);
    expect(state.state).toBe('denied');
    expect(state.state === 'denied' && state.message).toBe(INCOME_DENIED_MESSAGE);
  });

  it('keeps the income out of the public transcript even when accepted', () => {
    const contract = new Contract(createProoflyWitnesses(82_500n));
    const context = makeContext(contract);

    const { proofData } = contract.circuits.proveIncome(context, 50_000n, APP_A);
    const transcript = JSON.stringify(proofData.publicTranscript);
    expect(transcript).not.toContain('82500');
  });
});