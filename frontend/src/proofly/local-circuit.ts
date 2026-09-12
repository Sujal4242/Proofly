import * as ocrt from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger } from '../compiled-contract.js';
import { INCOME_DENIED_MESSAGE, REPLAY_DENIED_MESSAGE } from '../midnight/errors.js';
import { encodeApplicationId } from '../midnight/application-id.js';
import { DEMO_COIN_PUBLIC_KEY_HEX } from './demo-keys.js';

/** The accumulated exported-ledger state threaded between proof runs. */
type LedgerState = ocrt.StateValue | ocrt.ChargedState;

export interface ProofResult {
  outcome: 'accepted' | 'rejected';
  rejectedAs?: 'below-threshold' | 'replay' | 'other';
  reason?: string;
  applicationId: string;
  requiredIncome: bigint;
  privateIncome: bigint;
  proofCountAfter?: bigint;
  preimage?: { length: number; hex: string };
  elapsedMs: number;
}

export interface ClaimInput {
  privateIncome: bigint;
  requiredIncome: bigint;
  applicationId: string;
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
 * Run one `proveIncome` circuit execution.
 *
 * `privateIncome` is passed straight into its WITNESS and never leaves this
 * page: it is not part of the public transcript, the preimage, or any
 * network/console/log/storage call. The nullifier is application-scoped
 * (`persistentHash(["proofly:claim:", applicationId])`), so the same
 * `applicationId` always produces the same nullifier regardless of income or
 * threshold — that is what makes an Application ID single-use. `state` is the
 * accumulated exported-ledger state to prove against (null for a fresh
 * deployment).
 */
function runProve(
  state: LedgerState | null,
  privateIncome: bigint,
  requiredIncome: bigint,
  applicationId: string,
): { result: ProofResult; nextState: LedgerState | null } {
  const t0 = performance.now();
  const appIdBytes = encodeApplicationId(applicationId);
  const contract = new Contract({
    income: (ctx: ocrt.WitnessContext<never, any>) => [ctx.privateState, privateIncome],
  });

  const initial = contract.initialState(
    ocrt.createConstructorContext({}, encodedCoinPublicKey),
  );
  let context = ocrt.createCircuitContext(
    ocrt.dummyContractAddress(),
    encodedCoinPublicKey,
    state ?? initial.currentContractState.data,
    {},
  );

  let proofData: ocrt.ProofData;
  try {
    const res = contract.circuits.proveIncome(context, requiredIncome, appIdBytes);
    proofData = res.proofData;
    context = res.context;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const rejectedAs = message.includes(REPLAY_DENIED_MESSAGE)
      ? ('replay' as const)
      : message.includes(INCOME_DENIED_MESSAGE)
        ? ('below-threshold' as const)
        : ('other' as const);
    return {
      result: {
        outcome: 'rejected',
        rejectedAs,
        reason: message,
        applicationId,
        requiredIncome,
        privateIncome,
        elapsedMs: Math.round(performance.now() - t0),
      },
      nextState: state,
    };
  }

  const nextState: LedgerState = context.currentQueryContext.state;
  const proofCountAfter = ledger(nextState).proofCount;

  const privateTranscriptOutputs = [...proofData.privateTranscriptOutputs.values()];
  const preimage = ocrt.proofDataIntoSerializedPreimage(
    proofData.input,
    proofData.output,
    proofData.publicTranscript,
    privateTranscriptOutputs,
    'Proofly',
  );

  return {
    result: {
      outcome: 'accepted',
      applicationId,
      requiredIncome,
      privateIncome,
      proofCountAfter,
      preimage: { length: preimage.length, hex: bytesToHex(preimage) },
      elapsedMs: Math.round(performance.now() - t0),
    },
    nextState,
  };
}

/**
 * Single, independent proof run (Level 1 experience): always proved against a
 * FRESH deployment state so repeated runs are directly comparable.
 */
export function runProofOfIncome(
  privateIncome: bigint,
  requiredIncome: bigint,
  applicationId: string,
): ProofResult {
  return runProve(null, privateIncome, requiredIncome, applicationId).result;
}

/**
 * Run a SEQUENCE of claims against ONE accumulated on-chain state. Because the
 * nullifier is scoped to `applicationId` alone, this exercises the real
 * application-scoped replay semantics:
 *   - repeating the same `applicationId` → REJECTED as `replay`
 *     ("Claim already used for this application"), even with a different
 *     threshold or income — the application, not the inputs, is the claim unit;
 *   - switching to a different `applicationId` → ACCEPTED (independent claim).
 */
export function runClaimSequence(claims: ClaimInput[]): ProofResult[] {
  let state: LedgerState | null = null;
  return claims.map((claim) => {
    const { result, nextState } = runProve(
      state,
      claim.privateIncome,
      claim.requiredIncome,
      claim.applicationId,
    );
    state = nextState;
    return result;
  });
}