/**
 * Proofly — Level 3 public-input wiring on the frontend surface.
 *
 * Verifies, against the REAL frontend module (`frontend/src/proofly/local-circuit.ts`
 * + `frontend/src/midnight/application-id.ts`), that:
 *   1. the free-form `applicationId` encodes to exactly 32 bytes
 *      (Compact `pad(32, str)` semantics) and is rejected when blank;
 *   2. `runClaimSequence` — holding ONE in-memory claim identity — denies a
 *      repeated `applicationId` as `replay`, allows different application ids,
 *      and keeps the exact threshold/incomes flowing to the circuit;
 *   3. `runProofOfIncome` classifies a sub-threshold run as `below-threshold`.
 *
 * Runs completely offline in this vitest environment. The public inputs are
 * exactly the ones Live mode sends to `callTx.proveIncome(threshold, applicationId)`.
 */
import { describe, expect, it } from 'vitest';

import {
  encodeApplicationId,
  isValidApplicationId,
} from '../frontend/src/midnight/application-id.js';
import {
  runClaimSequence,
  runProofOfIncome,
} from '../frontend/src/proofly/local-circuit.js';
import { INCOME_DENIED_MESSAGE, REPLAY_DENIED_MESSAGE } from '../frontend/src/midnight/errors.js';

/** One fixed in-memory claim identity for the replay scenarios (mirrors the contract tests). */
const IDENTITY = new Uint8Array(32).fill(0x42);

describe('applicationId public input encoding', () => {
  it('encodes ASCII text to exactly 32 zero-padded bytes', () => {
    const id = encodeApplicationId('loan-app-2026-01');
    const expected = new TextEncoder().encode('loan-app-2026-01');
    expect(id.length).toBe(32);
    expect(id.slice(0, expected.length)).toEqual(expected);
    expect(id.slice(expected.length).every((b) => b === 0)).toBe(true);
  });

  it('truncates over-long input at 32 bytes without error', () => {
    const id = encodeApplicationId('a'.repeat(100));
    expect(id.length).toBe(32);
    expect(id.every((b) => b === 0x61)).toBe(true);
  });

  it('requires a non-blank application id', () => {
    expect(isValidApplicationId('loan-app-001')).toBe(true);
    expect(isValidApplicationId('')).toBe(false);
    expect(isValidApplicationId('   ')).toBe(false);
  });
});

describe('runClaimSequence — Level 3 replay + cross-application behavior', () => {
  it('rejects a repeated applicationId for the same claim identity as replay', () => {
    const results = runClaimSequence(
      [
        { privateIncome: 82_500n, requiredIncome: 50_000n, applicationId: 'app-A' },
        { privateIncome: 82_500n, requiredIncome: 50_000n, applicationId: 'app-A' },
      ],
      IDENTITY,
    );

    expect(results[0].outcome).toBe('accepted');
    expect(results[1].outcome).toBe('rejected');
    expect(results[1].rejectedAs).toBe('replay');
    expect(results[1].reason).toContain(REPLAY_DENIED_MESSAGE);
  });

  it('allows independent claims for different applicationIds under one identity', () => {
    const results = runClaimSequence(
      [
        { privateIncome: 82_500n, requiredIncome: 50_000n, applicationId: 'app-A' },
        { privateIncome: 82_500n, requiredIncome: 50_000n, applicationId: 'app-B' },
        { privateIncome: 82_500n, requiredIncome: 50_000n, applicationId: 'app-C' },
      ],
      IDENTITY,
    );

    expect(results.every((r) => r.outcome === 'accepted')).toBe(true);
    expect(results.map((r) => r.proofCountAfter)).toEqual([1n, 2n, 3n]);
    expect(results.map((r) => r.applicationId)).toEqual(['app-A', 'app-B', 'app-C']);
  });

  it('a sub-threshold rerun of the same application is reported as below-threshold, not replay', () => {
    const results = runClaimSequence(
      [
        { privateIncome: 82_500n, requiredIncome: 50_000n, applicationId: 'app-A' },
        { privateIncome: 20_000n, requiredIncome: 50_000n, applicationId: 'app-A' },
      ],
      IDENTITY,
    );

    expect(results[0].outcome).toBe('accepted');
    expect(results[1].outcome).toBe('rejected');
    expect(results[1].rejectedAs).toBe('below-threshold');
    expect(results[1].reason).toContain(INCOME_DENIED_MESSAGE);
  });
});

describe('runProofOfIncome — single independent proof', () => {
  it('rejects a sub-threshold income against a fresh state', () => {
    const r = runProofOfIncome(10_000n, 50_000n, 'app-A');
    expect(r.outcome).toBe('rejected');
    expect(r.rejectedAs).toBe('below-threshold');
    expect(r.reason).toContain(INCOME_DENIED_MESSAGE);
  });

  it('accepts an income at/above the threshold and records the applicationId', () => {
    const r = runProofOfIncome(82_500n, 50_000n, 'app-A');
    expect(r.outcome).toBe('accepted');
    expect(r.applicationId).toBe('app-A');
    expect(r.proofCountAfter).toBe(1n);
    expect(r.preimage).toBeDefined();
  });
});