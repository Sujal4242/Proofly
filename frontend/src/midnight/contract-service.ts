/**
 * Proofly — contract service (browser-only).
 *
 * Compiles the Proofly `CompiledContract` bound to REAL witness functions
 * (`midnight/witnesses.ts`) so the applicant's exact monthly income flows
 * through the zero-knowledge proofs, then finds the deployed contract.
 *
 * `CC.make('proofly', Contract).pipe(CC.withWitnesses(createProoflyWitnesses(income)))`
 * is the ShadowBid / ShadowPass-Level5 pattern: the income is supplied through
 * the private witness closure, and `requiredMonthlyIncome` remains the ONLY
 * public circuit argument.
 */

import { CompiledContract } from '@midnight-ntwrk/compact-js';
import {
  findDeployedContract,
  type ContractProviders,
  type FoundContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import { asContractAddress } from '@midnight-ntwrk/midnight-js-types';

import { Contract, ledger } from '../compiled-contract.js';
import { CONTRACT_ADDRESS, isContractConfigured, LIVE_DISABLED_REASON } from '../config.js';
import { createProoflyWitnesses } from './witnesses.js';
import { PROOFLY_PRIVATE_STATE_ID } from './in-memory-private-state-provider.js';

const CC: any = CompiledContract;

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
 * Returns a contract whose `callTx.proveIncome(requiredMonthlyIncome)` will
 * generate the proof, ask the wallet to approve/sign, and submit the
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