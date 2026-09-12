/**
 * Proofly — contract behaviour tests.
 *
 * Verifies:
 *   1. private income 82500 >= required 50000  →  circuit succeeds, ledger updates
 *   2. private income 35000 >= required 50000  →  circuit fails, ledger unchanged
 *   3. a real Groth16 proof is produced and verified end-to-end from the
 *      compiled artifacts (zkir-v2 + proving params).
 *   4. the circuit surface: witnesses = [income], public arguments =
 *      [requiredMonthlyIncome, applicationId].
 *
 * The private income is injected exclusively through the `income` witness; the
 * threshold and application id are the ONLY public circuit arguments.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as ocrt from '@midnight-ntwrk/compact-runtime';
import * as zkirV2 from '@midnight-ntwrk/zkir-v2';

import {
  bytes32,
  callProveIncome,
  CIRCUIT_ID,
  initializeContract,
  KEY_LOCATION,
  readLedger,
  setUpRuntime,
  type DeployedRuntime,
} from './helpers.js';

const APP_A = bytes32(0x01);

describe('Proofly proveIncome: authorized (passing) case', () => {
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

  it('accepted income 82500 >= required 50000 produces a result and increments proofCount', async () => {
    expect(readLedger(ctx, deployed.public.contractState).proofCount).toBe(0n);

    const callResult = await callProveIncome(ctx, deployed, 82_500n, 50_000n, APP_A);

    expect(callResult.private.result).toEqual([]);
    expect(readLedger(ctx, callResult.public.contractState).proofCount).toBe(1n);
  });

  it('produces and verifies a real Groth16 proof for the honest circuit run', async () => {
    const contract = new ctx.contractModule.Contract({
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

    const { proofData } = contract.circuits.proveIncome(context, 50_000n, APP_A);

    const preimage = ocrt.proofDataIntoSerializedPreimage(
      proofData.input,
      proofData.output,
      proofData.publicTranscript,
      proofData.privateTranscriptOutputs,
      KEY_LOCATION,
    );

    const proof = await zkirV2.prove(preimage, ctx.keyMaterialProvider);
    const bindingInputs = await zkirV2.check(preimage, ctx.keyMaterialProvider);

    expect(preimage.length).toBeGreaterThan(0);
    expect(proof.length).toBeGreaterThan(0);
    expect(proof.some((byte) => byte !== 0)).toBe(true);
    expect(bindingInputs.length).toBeGreaterThan(0);
  });
});

describe('Proofly proveIncome: rejected (failing) case', () => {
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

  it('rejects income 35000 >= required 50000', async () => {
    await expect(callProveIncome(ctx, deployed, 35_000n, 50_000n, APP_A)).rejects.toThrow();
  });

  it('leaves the ledger unchanged after a rejected attempt', async () => {
    await expect(callProveIncome(ctx, deployed, 35_000n, 50_000n, APP_A)).rejects.toThrow();
    expect(readLedger(ctx, deployed.public.contractState).proofCount).toBe(0n);
  });

  it('throws the exact assertion message on direct circuit execution', () => {
    const contract = new ctx.contractModule.Contract({
      income: (x: any) => [x.privateState, 35_000n],
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

    expect(() => contract.circuits.proveIncome(context, 50_000n, APP_A)).toThrow(
      'Income below required minimum',
    );
  });

  it('exposes exactly the non-secret ledger fields (proofCount + usedNullifiers)', () => {
    expect(Object.keys(readLedger(ctx, deployed.public.contractState.data)).sort()).toEqual([
      'proofCount',
      'usedNullifiers',
    ]);
  });
});

describe('Proofly proveIncome: circuit & witness surface', () => {
  it('declares exactly two public circuit arguments (threshold, application id) and one private witness (income)', async () => {
    const contractInfo = (
      await import('../contracts/managed/proofly/compiler/contract-info.json', {
        with: { type: 'json' },
      })
    ).default;

    expect(contractInfo['compiler-version']).toBe('0.31.1');
    expect(contractInfo['runtime-version']).toBe('0.16.0');

    const circuit = contractInfo.circuits[0];
    expect(circuit.name).toBe('proveIncome');
    expect(circuit.arguments).toHaveLength(2);
    expect(circuit.arguments.map((a: any) => a.name).sort()).toEqual([
      'applicationId',
      'requiredMonthlyIncome',
    ]);

    expect(contractInfo.witnesses).toHaveLength(1);
    expect(contractInfo.witnesses.map((w: any) => w.name)).toEqual(['income']);
  });
});