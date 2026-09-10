import * as ocrt from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger } from '../compiled-contract.js';
import { DEMO_COIN_PUBLIC_KEY_HEX } from './demo-keys.js';

export interface ProofResult {
  outcome: 'accepted' | 'rejected';
  reason?: string;
  requiredIncome: bigint;
  privateIncome: bigint;
  proofCountAfter?: bigint;
  preimage?: { length: number; hex: string };
  elapsedMs: number;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const encodedCoinPublicKey: ocrt.EncodedCoinPublicKey = {
  bytes: hexToBytes(DEMO_COIN_PUBLIC_KEY_HEX),
};

/**
 * Executes the compiled Proofly circuit entirely inside this browser tab.
 * `privateIncome` is passed straight into the `income` witness and never leaves
 * this page: it is not part of the public transcript, the preimage, or any
 * network/console/log/storage call.
 */
export function runProofOfIncome(
  privateIncome: bigint,
  requiredIncome: bigint,
): ProofResult {
  const t0 = performance.now();
  const contract = new Contract({
    income: (ctx: ocrt.WitnessContext<never, any>) => [
      ctx.privateState,
      privateIncome,
    ],
  });

  const initial = contract.initialState(
    ocrt.createConstructorContext({}, encodedCoinPublicKey),
  );
  let context = ocrt.createCircuitContext(
    ocrt.dummyContractAddress(),
    encodedCoinPublicKey,
    initial.currentContractState.data,
    {},
  );

  let proofData: ocrt.ProofData;
  try {
    const res = contract.circuits.proveIncome(context, requiredIncome);
    proofData = res.proofData;
    context = res.context;
  } catch (err) {
    return {
      outcome: 'rejected',
      reason: err instanceof Error ? err.message : String(err),
      requiredIncome,
      privateIncome,
      elapsedMs: Math.round(performance.now() - t0),
    };
  }

  const proofCountAfter = ledger(context.currentQueryContext.state).proofCount;

  const privateTranscriptOutputs = [...proofData.privateTranscriptOutputs.values()];
  const preimage = ocrt.proofDataIntoSerializedPreimage(
    proofData.input,
    proofData.output,
    proofData.publicTranscript,
    privateTranscriptOutputs,
    'Proofly',
  );

  return {
    outcome: 'accepted',
    requiredIncome,
    privateIncome,
    proofCountAfter,
    preimage: { length: preimage.length, hex: bytesToHex(preimage) },
    elapsedMs: Math.round(performance.now() - t0),
  };
}