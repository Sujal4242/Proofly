/**
 * Proofly — Level 3 replay-protection (nullifier) suite.
 *
 * Against the REAL compiled circuit + a fresh deployment _per scenario_:
 *
 * Nullifier determinism (application-scoped) — the nullifier derives ONLY from
 * the application id:
 *   1. same applicationId + same threshold → SAME nullifier;
 *   2. same applicationId + different threshold → SAME nullifier;
 *   3. same applicationId + different income → SAME nullifier and
 *      byte-identical public transcript (income is not part of the preimage);
 *   4. different applicationId → DIFFERENT nullifier.
 *
 * Replay rejection — a repeated claim with the same nullifier is rejected with
 * "Claim already used for this application" and the ledger reflects exactly one
 * successful insertion. HEADLINE regression: the same Application ID is
 * single-use even when the threshold changes (a lower but passing threshold
 * cannot reset an already-claimed application).
 *
 * Cross-application separation — a different application id yields a different
 * nullifier, so both claims succeed independently.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as ocrt from '@midnight-ntwrk/compact-runtime';
import { Contract } from '../contracts/managed/proofly/contract/index.js';

import {
  bytes32,
  callProveIncome,
  initializeContract,
  readLedger,
  readNullifiers,
  setUpRuntime,
  type DeployedRuntime,
} from './helpers.js';

const APP_A = bytes32(0x01);
const APP_B = bytes32(0x02);
const THRESHOLD = 50_000n;
const LOWER_THRESHOLD = 40_000n;

/** BigInt-safe JSON serialization so public transcripts are actually compared. */
function safeJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    typeof v === 'bigint' ? `${v.toString()}n` : v,
  );
}

describe('Proofly Level 3: nullifier determinism (application-scoped)', () => {
  const ctx = {} as DeployedRuntime;

  beforeAll(async () => {
    Object.assign(ctx, await setUpRuntime());
  });

  afterAll(async () => {
    if (ctx.runtime) {
      await ctx.runtime.dispose();
    }
  });

  it('same applicationId + same threshold produces the same nullifier', async () => {
    const deploymentA = await initializeContract(ctx);
    const deploymentB = await initializeContract(ctx);

    const resultA = await callProveIncome(ctx, deploymentA, 82_500n, THRESHOLD, APP_A);
    const resultB = await callProveIncome(ctx, deploymentB, 82_500n, THRESHOLD, APP_A);

    const [nullifierA] = readNullifiers(ctx, resultA.public.contractState);
    const [nullifierB] = readNullifiers(ctx, resultB.public.contractState);

    expect(nullifierA).toBeDefined();
    expect(nullifierA).toEqual(nullifierB);
  });

  it('same applicationId + DIFFERENT threshold produces the SAME nullifier', async () => {
    const deploymentHigh = await initializeContract(ctx);
    const deploymentLow = await initializeContract(ctx);

    const resultHigh = await callProveIncome(ctx, deploymentHigh, 82_500n, THRESHOLD, APP_A);
    const resultLow = await callProveIncome(ctx, deploymentLow, 82_500n, LOWER_THRESHOLD, APP_A);

    const [nullifierHigh] = readNullifiers(ctx, resultHigh.public.contractState);
    const [nullifierLow] = readNullifiers(ctx, resultLow.public.contractState);

    // The threshold is NOT part of the nullifier preimage, so a lower (but
    // still passing) threshold cannot mint a fresh nullifier for APP_A.
    expect(nullifierHigh).toBeDefined();
    expect(nullifierLow).toBeDefined();
    expect(nullifierHigh).toEqual(nullifierLow);
  });

  it('same applicationId + different income produces the SAME nullifier and an identical public transcript (income independence)', async () => {
    const deploymentLow = await initializeContract(ctx);
    const deploymentHigh = await initializeContract(ctx);

    const resultLow = await callProveIncome(ctx, deploymentLow, 80_000n, THRESHOLD, APP_A);
    const resultHigh = await callProveIncome(ctx, deploymentHigh, 820_000n, THRESHOLD, APP_A);

    const [nullifierLow] = readNullifiers(ctx, resultLow.public.contractState);
    const [nullifierHigh] = readNullifiers(ctx, resultHigh.public.contractState);

    // The nullifier must not depend on the income at all.
    expect(nullifierLow).toEqual(nullifierHigh);

    // Same ledger, same arguments, same nullifier → byte-identical transcript.
    expect(safeJson(resultLow.public.publicTranscript)).toEqual(
      safeJson(resultHigh.public.publicTranscript),
    );
    expect(safeJson(resultLow.public.partitionedTranscript)).toEqual(
      safeJson(resultHigh.public.partitionedTranscript),
    );
  });

  it('DIFFERENT applicationId produces a DIFFERENT nullifier', async () => {
    const deploymentA = await initializeContract(ctx);
    const deploymentB = await initializeContract(ctx);

    const resultA = await callProveIncome(ctx, deploymentA, 82_500n, THRESHOLD, APP_A);
    const resultB = await callProveIncome(ctx, deploymentB, 82_500n, THRESHOLD, APP_B);

    const [nullifierA] = readNullifiers(ctx, resultA.public.contractState);
    const [nullifierB] = readNullifiers(ctx, resultB.public.contractState);

    expect(nullifierA).toBeDefined();
    expect(nullifierB).toBeDefined();
    expect(nullifierA.toString()).not.toBe(nullifierB.toString());
  });
});

describe('Proofly Level 3: replay rejection', () => {
  const ctx = {} as DeployedRuntime;

  beforeAll(async () => {
    Object.assign(ctx, await setUpRuntime());
  });

  afterAll(async () => {
    if (ctx.runtime) {
      await ctx.runtime.dispose();
    }
  });

  it('submitting the same claim twice rejects and records exactly one insertion', async () => {
    const deployment = await initializeContract(ctx);

    const first = await callProveIncome(ctx, deployment, 82_500n, THRESHOLD, APP_A);

    const ledgerAfterFirst = readLedger(ctx, first.public.contractState);
    expect(ledgerAfterFirst.proofCount).toBe(1n);
    expect(readNullifiers(ctx, first.public.contractState)).toHaveLength(1);

    // The executable-runtime path rejects the replay (the circuit assertion
    // fires before any ledger change).
    await expect(
      callProveIncome(ctx, first, 82_500n, THRESHOLD, APP_A),
    ).rejects.toThrow();

    // The ledger is unchanged: still exactly one successful claim.
    const ledgerAfterReplay = readLedger(ctx, first.public.contractState);
    expect(ledgerAfterReplay.proofCount).toBe(1n);
    expect(readNullifiers(ctx, first.public.contractState)).toHaveLength(1);
  });

  it('HEADLINE: the same Application ID is single-use even when the threshold changes', () => {
    // Uses direct in-circuit execution so the EXACT assertion message is
    // observable (the executable-runtime path wraps circuit errors generically).
    const contract = new Contract({
      income: (x: any) => [x.privateState, 82_500n],
    });
    const initial = contract.initialState(
      ocrt.createConstructorContext({}, ctx.encodedCoinPublicKey),
    );

    // 1. First claim for application A succeeds at the full threshold.
    const firstA = contract.circuits.proveIncome(
      ocrt.createCircuitContext(
        ocrt.dummyContractAddress(),
        ctx.encodedCoinPublicKey,
        initial.currentContractState.data,
        {},
      ),
      THRESHOLD,
      APP_A,
    );
    const stateAfterA = firstA.context.currentQueryContext.state;
    expect(readLedger(ctx, stateAfterA).proofCount).toBe(1n);
    expect(readNullifiers(ctx, stateAfterA)).toHaveLength(1);

    // 2. Second claim for the SAME application A with a LOWER (but still
    //    passing) threshold is rejected in-circuit: the Application ID is
    //    single-use regardless of the threshold.
    expect(() =>
      contract.circuits.proveIncome(
        ocrt.createCircuitContext(
          ocrt.dummyContractAddress(),
          ctx.encodedCoinPublicKey,
          stateAfterA,
          {},
        ),
        LOWER_THRESHOLD,
        APP_A,
      ),
    ).toThrow('Claim already used for this application');

    // The denied re-claim left the ledger untouched.
    expect(readLedger(ctx, stateAfterA).proofCount).toBe(1n);
    expect(readNullifiers(ctx, stateAfterA)).toHaveLength(1);

    // 3. A DIFFERENT application B is independently claimable; the denied
    //    re-claim consumed no counter slot, so proofCount advances 1 → 2.
    const firstB = contract.circuits.proveIncome(
      ocrt.createCircuitContext(
        ocrt.dummyContractAddress(),
        ctx.encodedCoinPublicKey,
        stateAfterA,
        {},
      ),
      THRESHOLD,
      APP_B,
    );
    const stateAfterB = firstB.context.currentQueryContext.state;
    expect(readLedger(ctx, stateAfterB).proofCount).toBe(2n);
    expect(readNullifiers(ctx, stateAfterB)).toHaveLength(2);
  });

  it('throws the exact replay assertion on a direct in-circuit replay', () => {
    const contract = new Contract({
      income: (x: any) => [x.privateState, 82_500n],
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

    // First claim with this nullifier succeeds.
    const first = contract.circuits.proveIncome(context, THRESHOLD, APP_A);

    // Replaying the identical claim against the resulting state must be
    // rejected in-circuit with the exact message.
    const ctxAfter = ocrt.createCircuitContext(
      ocrt.dummyContractAddress(),
      ctx.encodedCoinPublicKey,
      first.context.currentQueryContext.state,
      {},
    );
    expect(() => contract.circuits.proveIncome(ctxAfter, THRESHOLD, APP_A)).toThrow(
      'Claim already used for this application',
    );
  });

  it('even the successful claim does not touch the public transcript with income bytes', async () => {
    const deployment = await initializeContract(ctx);
    const result = await callProveIncome(ctx, deployment, 82_500n, THRESHOLD, APP_A);

    const transcriptJson = safeJson(result.public.publicTranscript);
    expect(transcriptJson).not.toContain('82500');

    // The on-chain public output exposes only the nullifier (a hash) and the
    // counter — never the income. (There is no applicant id at all anymore.)
    const ledger = readLedger(ctx, result.public.contractState);
    expect(Object.keys(ledger).sort()).toEqual(['proofCount', 'usedNullifiers']);
  });
});

describe('Proofly Level 3: cross-application separation', () => {
  const ctx = {} as DeployedRuntime;

  beforeAll(async () => {
    Object.assign(ctx, await setUpRuntime());
  });

  afterAll(async () => {
    if (ctx.runtime) {
      await ctx.runtime.dispose();
    }
  });

  it('changing applicationId produces a different nullifier and an independent, valid claim', async () => {
    const deployment = await initializeContract(ctx);

    const resultA = await callProveIncome(ctx, deployment, 82_500n, THRESHOLD, APP_A);
    const resultB = await callProveIncome(ctx, resultA, 82_500n, THRESHOLD, APP_B);

    const [nullifierA] = readNullifiers(ctx, resultA.public.contractState);
    const nullifiersAfterB = readNullifiers(ctx, resultB.public.contractState);

    // APP_B claim succeeds only because its nullifier differs from APP_A's.
    expect(nullifiersAfterB).toHaveLength(2);
    expect(nullifiersAfterB[0].toString()).not.toBe(nullifiersAfterB[1].toString());
    expect(nullifiersAfterB.map((n) => n.toString())).toContain(nullifierA!.toString());

    const ledgerFinal = readLedger(ctx, resultB.public.contractState);
    expect(ledgerFinal.proofCount).toBe(2n);
  });
});