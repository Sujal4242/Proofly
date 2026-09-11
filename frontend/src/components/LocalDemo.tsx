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
  const accepted = result.outcome === 'accepted';
  const replay = result.rejectedAs === 'replay';
  const below = result.rejectedAs === 'below-threshold';

  return (
    <section className={`verdict ${accepted ? '-good' : '-warn'}`}>
      <p className={`verdict-title ${accepted ? '-good' : ''}`}>
        <span className="ico" aria-hidden="true">
          {accepted ? '\u2713' : '\u2717'}
        </span>
        {accepted
          ? 'Proof accepted'
          : replay
            ? 'Replay denied — already claimed'
            : below
              ? 'Income below the required threshold'
              : 'Proof rejected'}
      </p>
      {accepted ? (
        <dl className="kv">
          <dt>Application ID</dt>
          <dd>
            <code>{result.applicationId}</code>
          </dd>
          <dt>Assertion verified</dt>
          <dd>
            local income <strong>{result.privateIncome.toString()}</strong> &#8805;{' '}
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
          <dd>
            {result.elapsedMs} ms (local, no prover server)
          </dd>
        </dl>
      ) : (
        <p className="verdict-body">
          {result.reason}{' '}
          {replay
            ? '— the per-claim identity re-used the same application'
            : below
              ? '— asserted locally with "Income below required minimum"'
              : ''}
        </p>
      )}
      <p className="privacy-note">
        Local demo: the real Groth16 proof is produced and verified in{' '}
        <code>tests/proofly.contract.test.ts</code> using the same compiled
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
    <section className="pane">
      <div className="pane-head">
        <h2 className="pane-title">Replay protection &amp; cross-application check</h2>
        <span className="pane-kicker">Same identity</span>
      </div>
      <p className="step">
        All claims share <strong>one per-claim identity</strong> (held fixed,
        in-memory only). The second claim with the same application ID is
        denied; switching to a different application ID succeeds.
      </p>
      <dl className="kv" style={{ marginTop: 10 }}>
        <dt>Accepted</dt>
        <dd className="ok-text">{success}</dd>
        <dt>Replay denied</dt>
        <dd className="err-text">{denied}</dd>
        {failed > 0 && (
          <>
            <dt>Other failures</dt>
            <dd className="err-text">{failed}</dd>
          </>
        )}
      </dl>
      <ol className="timeline">
        {results.map((r, i) => (
          <li key={i} className={r.outcome === 'accepted' ? 'ok' : r.rejectedAs === 'replay' ? 'denied' : 'rejected'}>
            <span className="dot" aria-hidden="true" />
            <span>
              <code>{r.applicationId}</code> —{' '}
              {r.outcome === 'accepted'
                ? `accepted (proofCount = ${r.proofCountAfter})`
                : r.rejectedAs === 'replay'
                  ? `replay denied — ${r.reason}`
                  : `rejected — ${r.reason}`}
            </span>
          </li>
        ))}
      </ol>
      <p className="privacy-note">
        This mirrors the contract-level replay tests using one fixed applicant
        identity across claims. In Live mode each claim generates a fresh
        identity per call; only contract-level replay is observable there.
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
      <section className="pane demo-note">
        <div className="pane-head">
          <h2 className="pane-title">Explore the proof pipeline locally</h2>
          <span className="pane-kicker">In this tab</span>
        </div>
        <p className="step" style={{ marginTop: 8 }}>
          Enter income, threshold and application ID, then run the proof,
          the privacy property check, or the replay check. Everything runs
          offline — this is the only surface that shows the income value,
          because it is an explicit demonstration.
        </p>

        <div className="demo-grid" style={{ marginTop: 18 }}>
          <fieldset className="fieldset-card -private">
            <legend className="hidden">Private input</legend>
            <div className="set-head">
              <span className="set-title">
                <span className="tag -private" aria-hidden="true">
                  <span className="dot" />
                  Private
                </span>
                Your monthly income
              </span>
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label className="field-label" htmlFor="demo-income">
                Monthly income
              </label>
              <input
                id="demo-income"
                className="input"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                value={incomeInput}
                onChange={(e) => setIncomeInput(e.target.value)}
                placeholder="e.g. 82500"
              />
            </div>
          </fieldset>

          <fieldset className="fieldset-card">
            <legend className="hidden">Public inputs</legend>
            <div className="set-head">
              <span className="set-title">
                <span className="tag -public" aria-hidden="true">
                  <span className="dot" />
                  Public
                </span>
                Threshold &amp; application
              </span>
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label className="field-label" htmlFor="demo-threshold">
                Required monthly income
              </label>
              <input
                id="demo-threshold"
                className="input"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
                placeholder="e.g. 50000"
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="demo-application">
                Application ID
              </label>
              <input
                id="demo-application"
                className="input"
                autoComplete="off"
                spellCheck={false}
                value={applicationId}
                onChange={(e) => setApplicationId(e.target.value)}
                placeholder="loan-app-2026-01"
              />
            </div>
          </fieldset>
        </div>

        <div className="actions-line" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={!applicationIdValid}
          >
            Generate proof
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handlePrivacyCheck}
            disabled={!applicationIdValid}
          >
            Check privacy property
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleReplayCheck}
            disabled={!applicationIdValid}
          >
            Check replay protection
          </button>
        </div>
        {!applicationIdValid && (
          <p className="field-err" style={{ fontSize: 13, marginTop: 10 }}>
            Enter an application ID to run the checks.
          </p>
        )}
      </section>

      {result && <ResultPanel result={result} />}

      {sequence && <SequencePanel results={sequence} />}

      {privacy && (
        <section className="pane" style={{ marginTop: 16, maxWidth: 820 }}>
          <div className="pane-head">
            <h2 className="pane-title">Privacy property check</h2>
            <span className="pane-kicker">Two incomes, one public record</span>
          </div>
          <p className="step" style={{ marginTop: 8 }}>
            Two different incomes (<strong>{privacy.incomeA.toString()}</strong>{' '}
            and <strong>{privacy.incomeB.toString()}</strong>) result in
            byte-identical <em>public</em> inputs:
          </p>
          <dl className="kv">
            <dt>Public-input hash</dt>
            <dd className="hash-code">{privacy.hashA}</dd>
            <dt>Public-input hash</dt>
            <dd className="hash-code">{privacy.hashB}</dd>
          </dl>
          <p
            className={`result-line ${privacy.equal ? '-good' : '-bad'}`}
            style={{ marginTop: 12 }}
          >
            {privacy.equal
              ? 'Identical — the verifier cannot tell the two incomes apart.'
              : 'Differ — that would be a privacy leak!'}
          </p>
        </section>
      )}

      <section className="pane" style={{ marginTop: 16, maxWidth: 820 }}>
        <div className="pane-head">
          <h2 className="pane-title">What is in the proof?</h2>
          <span className="pane-kicker">Public vs private</span>
        </div>
        <div className="demo-grid" style={{ marginTop: 14 }}>
          <div className="why-item" style={{ border: 0, padding: 0, background: 'transparent' }}>
            <h3>Public — visible to the verifier</h3>
            <ul>
              <li>Ledger state: <code>proofCount</code></li>
              <li>Circuit argument: <code>requiredMonthlyIncome</code></li>
              <li>Circuit argument: <code>applicationId</code></li>
              <li>The zero-knowledge proof + transcript</li>
            </ul>
          </div>
          <div className="why-item" style={{ border: 0, padding: 0, background: 'transparent' }}>
            <h3>Private — never leaves this tab</h3>
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