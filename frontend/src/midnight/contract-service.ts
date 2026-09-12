/**
 * Proofly — contract service (browser-only).
 *
 * Compiles the Proofly `CompiledContract` bound to REAL witness functions
 * (`midnight/witnesses.ts`) so the applicant's exact monthly income flows
 * through the zero-knowledge proofs, then finds the deployed contract.
 *
 * `CC.make('proofly', Contract).pipe(CC.withWitnesses(createProoflyWitnesses(income)))`
 * is the ShadowBid / ShadowPass-Level5 pattern: the income is supplied through
 * the private witness closure, and `requiredMonthlyIncome` + `applicationId`
 * remain the ONLY public circuit arguments.
 */

import { CompiledContract } from '@midnight-ntwrk/compact-js';
import {
  findDeployedContract,
  type ContractProviders,
  type FoundContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import { asContractAddress, type PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';

import { Contract, ledger } from '../compiled-contract.js';
import { ocrt } from './compact-runtime.js';
import { CONTRACT_ADDRESS, isContractConfigured, LIVE_DISABLED_REASON } from '../config.js';
import { createProoflyWitnesses } from './witnesses.js';
import { PROOFLY_PRIVATE_STATE_ID } from './in-memory-private-state-provider.js';
import { encodeApplicationId } from './application-id.js';
import { DEMO_COIN_PUBLIC_KEY_HEX } from '../proofly/demo-keys.js';

const CC: any = CompiledContract;

/** Hex → bytes, mirroring `midnight-key-provider.js` (used for the demo coin key). */
function hexToBytes(hex: string): Uint8Array {
  const pairs = (hex.length % 2 === 1 ? `0${hex}` : hex).match(/.{2}/g) ?? [];
  return new Uint8Array(pairs.map((pair) => Number.parseInt(pair, 16)));
}

export type DeployedContract = FoundContract<Contract>;

/** Build the compiled Proofly contract for a single run, income bound as witness. */
export function buildProoflyContract(income: bigint) {
  return CC.make('proofly', Contract).pipe(
    CC.withWitnesses(createProoflyWitnesses(income)),
  );
}

/**
 * Find the deployed Proofly contract on Preprod.
 *
 * Returns a contract whose `callTx.proveIncome(requiredMonthlyIncome, applicationId)`
 * will generate the proof, ask the wallet to approve/sign, and submit the
 * transaction. Requires `VITE_CONTRACT_ADDRESS` to be configured (a real
 * deployment); otherwise this fails fast with a clear message.
 */
export async function findProoflyContract(
  providers: ContractProviders,
  income: bigint,
): Promise<DeployedContract> {
  if (!isContractConfigured()) {
    throw new Error(LIVE_DISABLED_REASON);
  }
  const deployed = await findDeployedContract(providers as ContractProviders, {
    compiledContract: buildProoflyContract(income),
    contractAddress: asContractAddress(CONTRACT_ADDRESS),
    privateStateId: PROOFLY_PRIVATE_STATE_ID,
    initialPrivateState: {},
  });
  return deployed as DeployedContract;
}

/**
 * Decode the public `proofCount` from a contract state using the generated
 * ledger decoder. Public by design — never decodes income (there is none
 * on-chain).
 */
export function readProofCountFromLedger(stateData: unknown): number {
  const l = ledger(stateData as Parameters<typeof ledger>[0]);
  return Number(l.proofCount);
}

/** Outcome of a successful local preflight run. */
export interface PreflightProofResult {
  outcome: 'accepted';
  /** The `proofCount` that would follow the claim IF it were submitted. */
  proofCountAfter: bigint;
}

/**
 * Local, unproven circuit preflight against the CURRENT on-chain ledger.
 *
 * Runs `Contract.circuits.proveIncome` — the SAME circuit and the SAME witness
 * closure (income) and SAME public args (requiredMonthlyIncome + applicationId)
 * the real Live call uses — but WITHOUT generating a proof, submitting a
 * transaction, or touching the wallet's proving service. The on-chain state
 * comes from the existing `publicDataProvider.queryContractState` path (used
 * by refreshProofCount), so no new endpoint is introduced.
 *
 * Compact assertions throw their EXACT messages here, deterministically: an
 * income below `requiredMonthlyIncome` yields `Income below required minimum`,
 * and a claim whose application-scoped nullifier is already in `usedNullifiers`
 * yields `Claim already used for this application`. Because the nullifier is
 * scoped to `applicationId` alone, ANY second claim for the same application is
 * denied here before the wallet is ever involved. The caller maps those to
 * `Proof denied — <assertion>`.
 *
 * A generic preflight failure (indexer down, decode error) is an ordinary
 * thrown Error; the caller must then fall through to the real wallet flow so
 * wallet/network/prover errors keep their existing handling.
 *
 * No income is logged, persisted, or rendered (the demo coin key is a static,
 * public, throwaway credential — the assertions do not depend on it).
 */
export async function preflightProveIncome(
  income: bigint,
  threshold: bigint,
  applicationId: string,
  providers: { publicDataProvider: PublicDataProvider },
): Promise<PreflightProofResult> {
  if (!isContractConfigured()) {
    throw new Error(LIVE_DISABLED_REASON);
  }

  // Same witness closure the real Live flow binds via `CC.withWitnesses`.
  const contract = new Contract(createProoflyWitnesses<{}>(income));

  // Current public ledger state (existing indexer path, read-only).
  const contractState = await providers.publicDataProvider.queryContractState(
    asContractAddress(CONTRACT_ADDRESS),
  );
  if (!contractState) {
    throw new Error('No public ledger state available for the deployed Proofly contract.');
  }

  const context = ocrt.createCircuitContext(
    ocrt.dummyContractAddress(),
    { bytes: hexToBytes(DEMO_COIN_PUBLIC_KEY_HEX) },
    contractState.data,
    {},
  );

  // Unproven circuit run — assertions surface their exact messages here.
  const result = contract.circuits.proveIncome(
    context,
    threshold,
    encodeApplicationId(applicationId),
  );

  const nextState = result.context.currentQueryContext.state;
  return {
    outcome: 'accepted',
    proofCountAfter: ledger(nextState).proofCount,
  };
}