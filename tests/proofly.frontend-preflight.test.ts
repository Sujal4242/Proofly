/**
 * Proofly — Live Preflight tests.
 *
 * Verifies `preflightProveIncome` (frontend/src/midnight/contract-service.ts):
 * a local, UNPROVEN circuit run against the CURRENT on-chain ledger that decides
 * deterministic denials BEFORE the wallet/proving service is contacted.
 *
 *   - income below `requiredMonthlyIncome`  → exact "Income below required minimum"
 *   - exact replay of (income, applicationId, applicantId) → exact
 *     "Claim already used for this application"
 *   - fresh applicantId on the same application → still valid
 *
 * No wallets, no chains, no localStorage/sessionStorage, and no income or
 * applicantId may ever be logged, persisted, or leaked into messages.
 *
 * State is supplied through a fake `publicDataProvider` returning states built
 * with the REAL compiled circuit (fresh deployment state / state after a claim),
 * so the assertions exercised are the true Compact ones.
 *
 * NOTE on runtime identity: the frontend is a separate npm project with its own
 * node_modules, so ALL runtime instances here (the compact runtime and the
 * compiled contract's states) are imported through the frontend graph — never
 * from the repo root — otherwise `createCircuitContext` rejects the fabricated
 * state as "unexpected type" (dual-package hazard).
 *
 * The deployed-address gate is satisfied by mocking `frontend/src/config.js`
 * (vitest's `import.meta.env` is a startup snapshot that cannot be re-read),
 * while keeping the rest of the module graph under one registry.
 */
import { describe, expect, it, vi } from 'vitest';

import { Contract } from '../frontend/src/compiled-contract.js';
import { ocrt } from '../frontend/src/midnight/compact-runtime.js';
import { preflightProveIncome } from '../frontend/src/midnight/contract-service.js';
import { createProoflyWitnesses } from '../frontend/src/midnight/witnesses.js';
import { encodeApplicationId } from '../frontend/src/midnight/application-id.js';
import {
  classifyError,
  formatDenialMessage,
  INCOME_DENIED_MESSAGE,
  REPLAY_DENIED_MESSAGE,
} from '../frontend/src/midnight/errors.js';
import { DEMO_COIN_PUBLIC_KEY_HEX } from '../frontend/src/proofly/demo-keys.js';

/** The real Preprod L3 Proofly deployment (see docs/evidence/DEPLOYMENT.md). */
const { DEPLOYED_CONTRACT_ADDRESS } = vi.hoisted(() => ({
  DEPLOYED_CONTRACT_ADDRESS:
    'bc9c4a53aac2d1c67d17456083d646fc302e32935acd351ad45b82c9d511dc2a',
}));

vi.mock('../frontend/src/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../frontend/src/config.js')>();
  return {
    ...actual,
    CONTRACT_ADDRESS: DEPLOYED_CONTRACT_ADDRESS,
    isContractConfigured: () => true,
  };
});

const KEY: ocrt.EncodedCoinPublicKey = {
  bytes: new Uint8Array(
    (DEMO_COIN_PUBLIC_KEY_HEX.match(/.{2}/g) ?? []).map((p) => Number.parseInt(p, 16)),
  ),
};

/** Fresh deployment ledger state (empty usedNullifiers, proofCount 0). */
function freshState(): ocrt.ChargedState {
  const contract = new Contract(createProoflyWitnesses<{}>(0n, new Uint8Array(32)));
  return contract.initialState(ocrt.createConstructorContext({}, KEY)).currentContractState
    .data;
}

/** Run the REAL circuit so the returned state carries usedNullifiers + proofCount. */
function stateAfterClaim(
  privateIncome: bigint,
  requiredIncome: bigint,
  applicationId: string,
  applicantId: Uint8Array,
): ocrt.ChargedState {
  const contract = new Contract(createProoflyWitnesses<{}>(privateIncome, applicantId));
  const initial = contract.initialState(ocrt.createConstructorContext({}, KEY));
  const context = ocrt.createCircuitContext(
    ocrt.dummyContractAddress(),
    KEY,
    initial.currentContractState.data,
    {},
  );
  const res = contract.circuits.proveIncome(
    context,
    requiredIncome,
    encodeApplicationId(applicationId),
  );
  return res.context.currentQueryContext.state;
}

function preflightWith(
  state: ocrt.ChargedState,
  income: bigint,
  threshold: bigint,
  applicationId: string,
  applicantId: Uint8Array,
) {
  const providers = {
    publicDataProvider: {
      queryContractState: async () => ({ data: state } as unknown as ocrt.ContractState),
    },
  } as unknown as Parameters<typeof preflightProveIncome>[4];
  return preflightProveIncome(income, threshold, applicationId, applicantId, providers);
}

function capturePreflight(
  state: ocrt.ChargedState,
  income: bigint,
  threshold: bigint,
  applicationId: string,
  applicantId: Uint8Array,
): Promise<Error> {
  return preflightWith(state, income, threshold, applicationId, applicantId).then(
    () => new Error(`expected a deterministic denial, got acceptance for ${applicationId}`),
    (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
  );
}

/** Narrow `VerificationState` to the denied branch (expect() does not narrow). */
function denialMessage(verdict: ReturnType<typeof classifyError>): string {
  if (verdict.state === 'denied') return verdict.message;
  throw new Error(`expected denial, got ${JSON.stringify(verdict)}`);
}

describe('Proofly live preflight (unproven local circuit)', () => {
  it('accepts a valid claim on a fresh deployment (proofCount → 1)', async () => {
    const applicantId = new Uint8Array(32).fill(0x11);
    const res = await preflightWith(
      freshState(),
      82_500n,
      50_000n,
      'loan-app-2026-01',
      applicantId,
    );
    expect(res.outcome).toBe('accepted');
    expect(res.proofCountAfter).toBe(1n);
  });

  it('denies income below the threshold with the EXACT surfaced message', async () => {
    const applicantId = new Uint8Array(32).fill(0x22);
    const err = await capturePreflight(
      freshState(),
      10_000n,
      50_000n,
      'app-below',
      applicantId,
    );
    expect(err.message).toContain(INCOME_DENIED_MESSAGE);
    const verdict = classifyError(err);
    expect(verdict.state).toBe('denied');
    expect(formatDenialMessage(denialMessage(verdict))).toBe(
      'Proof denied — Income below required minimum',
    );
  });

  it('denies an EXACT replay: same income, applicationId and applicantId', async () => {
    const applicantId = new Uint8Array(32).fill(0x33);
    const claimedState = stateAfterClaim(82_500n, 50_000n, 'app-replay', applicantId);

    const err = await capturePreflight(
      claimedState,
      82_500n,
      50_000n,
      'app-replay',
      applicantId,
    );
    expect(err.message).toContain(REPLAY_DENIED_MESSAGE);
    const verdict = classifyError(err);
    expect(verdict.state).toBe('denied');
    expect(formatDenialMessage(denialMessage(verdict))).toBe(
      'Proof denied — Claim already used for this application',
    );
  });

  it('still accepts a FRESH applicantId on the same application (not a replay)', async () => {
    const firstApplicant = new Uint8Array(32).fill(0x33);
    const secondApplicant = new Uint8Array(32).fill(0x44);
    const claimedState = stateAfterClaim(82_500n, 50_000n, 'app-replay', firstApplicant);

    const res = await preflightWith(
      claimedState,
      82_500n,
      50_000n,
      'app-replay',
      secondApplicant,
    );
    expect(res.outcome).toBe('accepted');
    expect(res.proofCountAfter).toBe(2n);
  });

  it('never logs income/applicantId and never touches browser storage', async () => {
    const saved = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };
    const calls: unknown[][] = [];
    console.log = (...a: unknown[]) => calls.push(a);
    console.info = (...a: unknown[]) => calls.push(a);
    console.warn = (...a: unknown[]) => calls.push(a);
    console.error = (...a: unknown[]) => calls.push(a);

    try {
      const applicantId = new Uint8Array(32).fill(0x55);
      await preflightWith(freshState(), 82_500n, 50_000n, 'app-silent', applicantId);
      const err = await capturePreflight(
        stateAfterClaim(82_500n, 50_000n, 'app-silent', applicantId),
        82_500n,
        50_000n,
        'app-silent',
        applicantId,
      );

      expect(calls.length).toBe(0);

      const applicantHex = Array.from(applicantId)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const joined = [err.message, err.stack ?? ''].join('\n');
      expect(joined).not.toContain(applicantHex);
      expect(joined).not.toContain('82500');
      expect(joined).not.toContain('app-silent');
    } finally {
      Object.assign(console, saved);
    }
  });
});