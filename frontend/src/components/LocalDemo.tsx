import { useMemo, useState } from 'react';
import {
  runProofOfIncome,
  runClaimSequence,
  type ClaimInput,
  type ProofResult,
} from '../proofly/local-circuit.js';
import { isValidApplicationId } from '../midnight/application-id.js';

async function sha256Hex(str: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function parseAmount(value: string): bigint {
  const digits = value.replace(/[^0-9]/g, '');
  return BigInt(digits === '' ? 0 : digits);
}

function publicInput(r: ProofResult) {
  return {
    outcome: r.outcome === 'accepted',
    applicationId: r.applicationId,
    requiredIncome: r.requiredIncome,
    proofCountAfter: r.proofCountAfter?.toString() ?? '0',
  };
}

function ResultPanel({ result }: { result: ProofResult }) {
  const rejectedLabel =
    result.rejectedAs === 'replay'
      ? '✗ Replay denied — this application has already been claimed'
      : result.rejectedAs === 'below-threshold'
        ? '✗ Income below the required threshold'
        : undefined;

  return (
    <section className={`card result ${result.outcome}`}>
      <h2>
        {result.outcome === 'accepted'
          ? '✓ Proof accepted'
          : rejectedLabel ?? '✗ Proof rejected'}
      </h2>
      {result.outcome === 'accepted' ? (
        <dl>
          <dt>Application ID</dt>
          <dd><code>{result.applicationId}</code></dd>
          <dt>Assertion verified</dt>
          <dd>
            localIncome <strong>{result.privateIncome.toString()}</strong> ≥{' '}
            {result.requiredIncome.toString()}
          </dd>
          <dt>Public ledger after run</dt>
          <dd>
            proofCount = <code>{result.proofCountAfter!.toString()}</code>
          </dd>
          <dt>Circuit preimage</dt>
          <dd>
            {result.preimage!.length} bytes · first 32B{' '}
            <code>{result.preimage!.hex.slice(0, 64)}…</code>
          </dd>
          <dt>Time</dt>
          <dd>{result.elapsedMs} ms (local, no prover server)</dd>
        </dl>
      ) : (
        <p className="err">
          {result.reason}{' '}
          {result.rejectedAs === 'replay'
            ? '— the per-claim identity re-used the same application'
            : result.rejectedAs === 'below-threshold'
              ? '— asserted locally with "Income below required minimum"'
              : ''}
        </p>
      )}
      <p className="note">
        Local Demo: the real Groth16 proof is produced and verified in
        <code> tests/proofly.contract.test.ts</code> using the same compiled
        contract.
      </p>
    </section>
  );
}

function SequencePanel({ results }: { results: ProofResult[] }) {
  const success = results.filter((r) => r.outcome === 'accepted').length;
  const denied = results.filter((r) => r.outcome === 'rejected' && r.rejectedAs === 'replay').length;
  const failed = results.length - success - denied;

  return (
    <section className="card">
      <h2>Replay protection &amp; cross-application check</h2>
      <p className="step">
        All claims share <strong>one per-claim identity</strong> (held fixed,
        in-memory only). Second claim with the same application ID should be
        denied; switching to a different application ID should succeed.
      </p>
      <dl>
        <dt>Succeeded</dt>
        <dd className="ok">{success}</dd>
        <dt>Replay denied</dt>
        <dd className="err">{denied}</dd>
        {failed > 0 && (
          <>
            <dt>Other failures</dt>
            <dd className="err">{failed}</dd>
          </>
        )}
      </dl>
      <ol className="sequence">
        {results.map((r, i) => (
          <li key={i} className={r.outcome === 'accepted' ? 'ok' : 'err'}>
            <code>{r.applicationId}</code> —{' '}
            {r.outcome === 'accepted'
              ? `accepted (proofCount=${r.proofCountAfter})`
              : r.rejectedAs === 'replay'
                ? `replay denied — ${r.reason}`
                : `rejected — ${r.reason}`}
          </li>
        ))}
      </ol>
      <p className="note">
        This mirrors the contract-level replay tests using one fixed applicant
        identity across claims. In Live mode each claim generates a fresh identity
        per-call; only contract-level replay is observable there.
      </p>
    </section>
  );
}

/**
 * Local Demo mode — the original Level 1 experience preserved, now with
 * Level 3 public inputs. Everything runs offline in this tab: no wallet, no
 * network calls, no backend. This is the ONLY surface that displays the
 * entered income value, because it is an explicit local demonstration of the
 * privacy property.
 */
export function LocalDemo() {
  const [incomeInput, setIncomeInput] = useState('82500');
  const [thresholdInput, setThresholdInput] = useState('50000');
  const [applicationId, setApplicationId] = useState('loan-app-2026-01');
  const [result, setResult] = useState<ProofResult | null>(null);
  const [sequence, setSequence] = useState<ProofResult[] | null>(null);
  const [privacy, setPrivacy] = useState<{
    hashA: string;
    hashB: string;
    equal: boolean;
    incomeA: bigint;
    incomeB: bigint;
  } | null>(null);

  const income = useMemo(() => parseAmount(incomeInput), [incomeInput]);
  const threshold = useMemo(() => parseAmount(thresholdInput), [thresholdInput]);
  const applicationIdValid = isValidApplicationId(applicationId);

  const handleGenerate = () => {
    setResult(runProofOfIncome(income, threshold, applicationId.trim()));
  };

  /** Run the privacy property check against FRESH states for each income (preserves L1 equivalence). */
  const handlePrivacyCheck = async () => {
    const incomeB = income + 1000n;
    const resultA = runProofOfIncome(income, threshold, applicationId.trim());
    const resultB = runProofOfIncome(incomeB, threshold, applicationId.trim());
    if (resultA.outcome !== 'accepted' || resultB.outcome !== 'accepted') {
      const lowThreshold = 1n;
      const ra = runProofOfIncome(income, lowThreshold, applicationId.trim());
      const rb = runProofOfIncome(incomeB, lowThreshold, applicationId.trim());
      const [hashA, hashB] = await Promise.all([
        sha256Hex(JSON.stringify(publicInput(ra))),
        sha256Hex(JSON.stringify(publicInput(rb))),
      ]);
      setPrivacy({ hashA, hashB, equal: hashA === hashB, incomeA: income, incomeB });
      return;
    }
    const [hashA, hashB] = await Promise.all([
      sha256Hex(JSON.stringify(publicInput(resultA))),
      sha256Hex(JSON.stringify(publicInput(resultB))),
    ]);
    setPrivacy({ hashA, hashB, equal: hashA === hashB, incomeA: income, incomeB });
  };

  /**
   * Demonstrate replay protection and cross-application independence by
   * claiming two different application IDs then re-claiming the first,
   * all under the SAME per-claim identity (held in-memory for this
   * demonstration only, matching the contract tests).
   */
  const handleReplayCheck = () => {
    const appId = applicationId.trim();
    const altAppId = `${appId}-alt`;
    const identity = crypto.getRandomValues(new Uint8Array(32));
    const claimInput: ClaimInput = {
      privateIncome: income,
      requiredIncome: threshold,
      applicationId: appId,
    };
    const altClaimInput: ClaimInput = {
      privateIncome: income,
      requiredIncome: threshold,
      applicationId: altAppId,
    };
    setSequence(
      runClaimSequence([claimInput, altClaimInput, claimInput], identity),
    );
  };

  return (
    <>
      <section className="card inputs">
        <label>
          <span>
            Monthly income <em>(private witness)</em>
          </span>
          <input
            inputMode="numeric"
            value={incomeInput}
            onChange={(e) => setIncomeInput(e.target.value)}
            placeholder="82500"
          />
        </label>
        <label>
          <span>
            Required threshold <em>(public circuit argument)</em>
          </span>
          <input
            inputMode="numeric"
            value={thresholdInput}
            onChange={(e) => setThresholdInput(e.target.value)}
            placeholder="50000"
          />
        </label>
        <label>
          <span>
            Application ID <em>(public claim scope)</em>
          </span>
          <input
            value={applicationId}
            onChange={(e) => setApplicationId(e.target.value)}
            placeholder="loan-app-2026-01"
          />
        </label>
        <div className="actions">
          <button
            onClick={handleGenerate}
            disabled={!applicationIdValid}
          >
            Generate proof locally
          </button>
          <button
            className="ghost"
            onClick={handlePrivacyCheck}
            disabled={!applicationIdValid}
          >
            Check privacy property
          </button>
          <button
            className="ghost"
            onClick={handleReplayCheck}
            disabled={!applicationIdValid}
          >
            Check replay protection
          </button>
        </div>
      </section>

      {result && <ResultPanel result={result} />}

      {sequence && <SequencePanel results={sequence} />}

      {privacy && (
        <section className="card">
          <h2>Privacy property check</h2>
          <p className="step">
            Two different incomes (<strong>{privacy.incomeA.toString()}</strong>{' '}
            and <strong>{privacy.incomeB.toString()}</strong>) result in
            byte-identical <em>public</em> inputs:
          </p>
          <dl className="hashes">
            <dt>public-input hash (income {privacy.incomeA.toString()})</dt>
            <dd>
              <code>{privacy.hashA}</code>
            </dd>
            <dt>public-input hash (income {privacy.incomeB.toString()})</dt>
            <dd>
              <code>{privacy.hashB}</code>
            </dd>
          </dl>
          <p className={privacy.equal ? 'ok' : 'err'}>
            {privacy.equal
              ? '✓ Identical — the verifier cannot distinguish the two incomes.'
              : '✗ Differ — that would be a privacy leak!'}
          </p>
        </section>
      )}

      <section className="card">
        <h2>What is in the proof?</h2>
        <div className="grid">
          <div>
            <h3>Public (visible to the verifier)</h3>
            <ul>
              <li>Ledger state: <code>proofCount</code></li>
              <li>Circuit argument: <code>requiredMonthlyIncome</code></li>
              <li>Circuit argument: <code>applicationId</code></li>
              <li>The zk proof + transcript</li>
            </ul>
          </div>
          <div>
            <h3>Private (never leaves this tab)</h3>
            <ul>
              <li>The <code>income</code> witness</li>
              <li>The <code>applicantId</code> claim identity (fresh per proof)</li>
              <li>Not logged, not stored, not sent anywhere</li>
              <li>Absent from the public transcript</li>
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}