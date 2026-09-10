/**
 * Proofly — shared test harness (Node/vitest only).
 *
 * Reuses the proven ShadowPass-V2 test wiring, adapted to Proofly's single
 * `income` witness. Everything here is *local*: the compiled contract files
 * are read from `contracts/managed/proofly`, the Groth16 proving params (SRS)
 * are fetched from Midnight's public S3 bucket exactly like the reference
 * projects do.
 */
import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { makeContractExecutableRuntime } from '@midnight-ntwrk/midnight-js-types';
import * as CompactJS from '@midnight-ntwrk/compact-js';
import type { ContractExecutable } from '@midnight-ntwrk/compact-js/effect/ContractExecutable';
import * as ContractAddress from '@midnight-ntwrk/platform-js/effect/ContractAddress';
import * as ocrt from '@midnight-ntwrk/compact-runtime';
import * as ledgerModule from '@midnight-ntwrk/ledger-v8';
import * as zkirV2 from '@midnight-ntwrk/zkir-v2';

import type * as ProoflyContract from '../contracts/managed/proofly/contract/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Root of the compiled contract artifacts. */
export const ASSETS_DIR = path.resolve(__dirname, '..', 'contracts', 'managed', 'proofly');
/** Compiled contract JavaScript (runtime executable module). */
export const CONTRACT_JS_PATH = path.join(ASSETS_DIR, 'contract', 'index.js');
/** Public Groth16 parameter (SRS) fileshare used by the reference projects. */
export const S3_PARAMS_BASE =
  'https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com';

/**
 * Deterministic-but-arbitrary local demo key seed. This is NOT a secret and
 * NOT a wallet credential — it merely produces the coin public key used to
 * bind the local circuit execution context.
 */
export const KEY_SEED = Buffer.from(
  '6e0f4a3c9b1d7e5a2f8c0b4d1e9a6f3c2b5d8a1e7c4f9b0d6a3e8c1f5b2a7d4e9',
  'hex',
);

/** Public circuit id for the `proveIncome` circuit. */
export const CIRCUIT_ID = CompactJS.ProvableCircuitId<ProoflyContract.Contract<any, any>>(
  'proveIncome',
);
/** Opaque location string embedded in the preimage (matches the key files). */
export const KEY_LOCATION = 'proofly/proveIncome';

export function random32(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

/**
 * Remote + local key material provider for zkir-v2 proving.
 * Reads the compiled proving/verifying keys + zkIR from disk and fetches the
 * Groth16 SRS params for the required circuit size from Midnight's public S3.
 */
export function makeKeyMaterialProvider(): zkirV2.KeyMaterialProvider {
  const paramsCache = new Map<number, Uint8Array>();
  return {
    async lookupKey(_keyLocation: string) {
      const [proverKey, verifierKey, ir] = await Promise.all([
        readFile(path.join(ASSETS_DIR, 'keys', `${CIRCUIT_ID}.prover`)),
        readFile(path.join(ASSETS_DIR, 'keys', `${CIRCUIT_ID}.verifier`)),
        readFile(path.join(ASSETS_DIR, 'zkir', `${CIRCUIT_ID}.bzkir`)),
      ]);
      return { proverKey, verifierKey, ir };
    },
    async getParams(k: number) {
      let params = paramsCache.get(k);
      if (!params) {
        const response = await fetch(`${S3_PARAMS_BASE}/bls_midnight_2p${k}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch proving params for k=${k}: ${response.status}`);
        }
        params = new Uint8Array(await response.arrayBuffer());
        paramsCache.set(k, params);
      }
      return params;
    },
  };
}

/**
 * Build the compiled contract with the given private income wired through the
 * `income` WITNESS — the income is never a circuit argument.
 */
export function makeCompiledContract(income: bigint, Contract: typeof ProoflyContract.Contract) {
  const compiled = CompactJS.CompiledContract.make('proofly', Contract).pipe(
    CompactJS.CompiledContract.withWitnesses({
      income: (ctx: any) => [ctx.privateState, income],
    } as any),
    CompactJS.CompiledContract.withCompiledFileAssets(ASSETS_DIR),
  );
  return compiled as any;
}

/** Contract executable bound to a specific private income (witness). */
export function makeExecutable(income: bigint, Contract: typeof ProoflyContract.Contract) {
  return CompactJS.ContractExecutable.make(makeCompiledContract(income, Contract));
}

export interface DeployedRuntime {
  runtime: ReturnType<typeof makeContractExecutableRuntime>;
  keyMaterialProvider: zkirV2.KeyMaterialProvider;
  contractModule: typeof ProoflyContract;
  encodedCoinPublicKey: ocrt.EncodedCoinPublicKey;
  coinPublicKeyHex: string;
}

/** Wire the executable runtime + key material provider (once per suite). */
export async function setUpRuntime(): Promise<DeployedRuntime> {
  const contractModule = (await import(
    pathToFileURL(CONTRACT_JS_PATH).href
  )) as typeof ProoflyContract;

  const secretKeys = ledgerModule.ZswapSecretKeys.fromSeed(KEY_SEED);
  const encodedCoinPublicKey = { bytes: ocrt.encodeCoinPublicKey(secretKeys.coinPublicKey) };
  const coinPublicKeyHex = toHex(encodedCoinPublicKey.bytes);
  const signingKeyHex = ocrt.sampleSigningKey();

  const zkConfigProvider = new NodeZkConfigProvider(ASSETS_DIR);
  const runtime = makeContractExecutableRuntime(zkConfigProvider, {
    coinPublicKey: coinPublicKeyHex,
    signingKey: signingKeyHex,
  });

  const keyMaterialProvider = makeKeyMaterialProvider();

  return { runtime, keyMaterialProvider, contractModule, encodedCoinPublicKey, coinPublicKeyHex };
}

/** Compute the initial (deployed) contract state with an empty constructor. */
export async function initializeContract(
  ctx: DeployedRuntime,
): Promise<Awaited<ReturnType<ContractExecutable<any, any, any, any>['initialize']>>> {
  const executable = makeExecutable(1n, ctx.contractModule.Contract);
  return ctx.runtime.runPromise(executable.initialize({}));
}

/** Execute the `proveIncome` circuit against a deployed state. */
export async function callProveIncome(
  ctx: DeployedRuntime,
  deployResult: any,
  income: bigint,
  requiredMonthlyIncome: bigint,
) {
  const executable = makeExecutable(income, ctx.contractModule.Contract);
  return ctx.runtime.runPromise(
    executable.circuit(
      CIRCUIT_ID,
      {
        address: ContractAddress.ContractAddress('00'.repeat(32)),
        contractState: deployResult.public.contractState,
        privateState: {},
        zswapLocalState: deployResult.private.zswapLocalState,
      },
      requiredMonthlyIncome,
    ),
  );
}