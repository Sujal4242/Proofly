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
 * `privateIncome` and `applicantId` are passed straight into their WITNESSES
 * and never leave this page: they are not part of the public transcript, the
 * preimage, or any network/console/log/storage call. `state` is the accumulated
 * exported-ledger state to prove against (null for a fresh deployment).
 */
function runProve(
  state: LedgerState | null,
  privateIncome: bigint,
  requiredIncome: bigint,
  applicationId: string,
  applicantId: Uint8Array,
): { result: ProofResult; nextState: LedgerState | null } {
  const t0 = performance.now();
  const appIdBytes = encodeApplicationId(applicationId);
  const contract = new Contract({
    income: (ctx: ocrt.WitnessContext<never, any>) => [ctx.privateState, privateIncome],
    applicantId: (ctx: ocrt.WitnessContext<never, any>) => [ctx.privateState, applicantId],
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
 * FRESH deployment state so repeated runs are directly comparable. A fresh
 * `applicantId` is generated per call unless an override is supplied.
 */
export function runProofOfIncome(
  privateIncome: bigint,
  requiredIncome: bigint,
  applicationId: string,
  applicantIdOverride?: Uint8Array,
): ProofResult {
  const applicantId = applicantIdOverride ?? crypto.getRandomValues(new Uint8Array(32));
  return runProve(null, privateIncome, requiredIncome, applicationId, applicantId).result;
}

/**
 * Run a SEQUENCE of claims against ONE accumulated on-chain state, all sharing
 * the given `applicantId` claim identity. This is what makes replay-protection
 * observable in the tab:
 *   - repeating the same `applicationId` → REJECTED as `replay`;
 *   - switching to a different `applicationId` → ACCEPTED (independent claim).
 * The identity is supplied by the caller (in-memory only), mirroring how the
 * contract tests hold one identity across a scenario.
 */
export function runClaimSequence(
  claims: ClaimInput[],
  applicantId: Uint8Array,
): ProofResult[] {
  let state: LedgerState | null = null;
  return claims.map((claim) => {
    const { result, nextState } = runProve(
      state,
      claim.privateIncome,
      claim.requiredIncome,
      claim.applicationId,
      applicantId,
    );
    state = nextState;
    return result;
  });
}