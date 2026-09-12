/**
 * Proofly — privacy tests.
 *
 * THE core requirement: the exact private income must never be exposed.
 * These tests assert, against the real compiled circuit:
 *   1. the public circuit transcript contains no trace of the income (there is
 *      no applicant id witness at all anymore — income() is the only private
 *      witness);
 *   2. the PUBLIC INPUT bytes of the proof depend only on public values
 *      (threshold + ledger + application id) — two runs with different private
 *      incomes and the same threshold produce byte-identical public input,
 *      proving the income cannot be reconstructed from anything public;
 *   3. the threshold — the public argument — DOES flow into the public input
 *      (so the test is sensitive); the application id does too;
 *   4. the on-chain public ledger exposes only the two non-secret fields.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as ocrt from '@midnight-ntwrk/compact-runtime';

import {
  bytes32,
  callProveIncome,
  initializeContract,
  readLedger,
  setUpRuntime,
  type DeployedRuntime,
} from './helpers.js';

const APP_A = bytes32(0x01);

describe('Proofly privacy: the exact income stays private', () => {
  const ctx = {} as DeployedRuntime;
  let deployed: Awaited<ReturnType<typeof initializeContract>>;

  beforeAll(async () => {
    Object.assign(ctx, await setUpRuntime());
    deployed = await initializeContract(ctx);
  });

  afterAll(async () => {
    if (ctx.runtime) {
      await ctx.runtime.dispose();
    }
  });

  function runProgram(income: bigint, threshold: bigint, applicationId: Uint8Array = APP_A) {
    const contract = new ctx.contractModule.Contract({
      income: (x: any) => [x.privateState, income],
    });
    const initial = contract.initialState(
      ocrt.createConstructorContext({}, ctx.encodedCoinPublicKey),
    );
    const context = ocrt.createCircuitContext(
      ocrt.dummyContractAddress(),
      ctx.encodedCoinPublicKey,
      initial.currentContractState.data,
      {},
    );
    return contract.circuits.proveIncome(context, threshold, applicationId).proofData;
  }

  /** BigInt-safe JSON serialization so transcript values are actually compared. */
  function safeJson(value: unknown): string {
    return JSON.stringify(value, (_key, v) =>
      typeof v === 'bigint' ? `${v.toString()}n` : v,
    );
  }

  it('keeps the income out of the public circuit transcript', async () => {
    const callResult = await callProveIncome(ctx, deployed, 82_500n, 50_000n, APP_A);

    for (const field of ['publicTranscript', 'partitionedTranscript']) {
      const json = safeJson((callResult.public as Record<string, unknown>)[field]);
      expect(json).not.toContain('82500');
    }

    // The circuit produces no public outputs at all.
    expect(callResult.private.result).toEqual([]);
  });

  it('produces byte-identical PUBLIC inputs for different private incomes at the same threshold/application', () => {
    const lowIncome = runProgram(80_000n, 50_000n);
    const highIncome = runProgram(82_500n, 50_000n);

    // Public input must not depend on the private income.
    expect(lowIncome.input).toEqual(highIncome.input);
  });

  it('the threshold and the application id — the public arguments — DO flow into the public input (sensitivity)', () => {
    const threshold40 = runProgram(82_500n, 40_000n);
    const threshold50 = runProgram(82_500n, 50_000n);

    // If the public-input check above were blind, this would also be blind.
    expect(threshold40.input).not.toEqual(threshold50.input);

    const appA = runProgram(82_500n, 50_000n, bytes32(0x01));
    const appB = runProgram(82_500n, 50_000n, bytes32(0x02));
    expect(appA.input).not.toEqual(appB.input);
  });

  it('exposes only the non-secret proofCount + usedNullifiers ledger fields on-chain', () => {
    expect(Object.keys(readLedger(ctx, deployed.public.contractState.data)).sort()).toEqual([
      'proofCount',
      'usedNullifiers',
    ]);
  });
});