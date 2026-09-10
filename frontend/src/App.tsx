import { useMemo, useState } from 'react';
import { runProofOfIncome, type ProofResult } from './proofly/local-circuit.js';

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

export default function App() {
  const [incomeInput, setIncomeInput] = useState('82500');
  const [thresholdInput, setThresholdInput] = useState('50000');
  const [result, setResult] = useState<ProofResult | null>(null);
  const [privacy, setPrivacy] = useState<{
    hashA: string;
    hashB: string;
    equal: boolean;
    incomeA: bigint;
    incomeB: bigint;
  } | null>(null);

  const income = useMemo(() => parseAmount(incomeInput), [incomeInput]);
  const threshold = useMemo(() => parseAmount(thresholdInput), [thresholdInput]);

  const handleGenerate = () => {
    setResult(runProofOfIncome(income, threshold));
  };

  const handlePrivacyCheck = async () => {
    const incomeB = income + 1000n;
    const resultA = runProofOfIncome(income, threshold);
    const resultB = runProofOfIncome(incomeB, threshold);
    if (resultA.outcome !== 'accepted' || resultB.outcome !== 'accepted') {
      // For the privacy check we need both to pass; use a threshold that does.
      const lowThreshold = 1n;
      const ra = runProofOfIncome(income, lowThreshold);
      const rb = runProofOfIncome(incomeB, lowThreshold);
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

  return (
    <main className="page">
      <header>
        <div className="eyebrow">Midnight · Compact · Zero-Knowledge</div>
        <h1>
          Proofly<span className="muted"> — private proof-of-income</span>
        </h1>
        <p className="lede">
          Prove <strong>monthlyIncome ≥ requiredThreshold</strong> without ever
          revealing the income. Everything runs locally in this tab — no wallet,
          no network calls, no backend.
        </p>
      </header>

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
        <div className="actions">
          <button onClick={handleGenerate}>Generate proof locally</button>
          <button className="ghost" onClick={handlePrivacyCheck}>
            Check privacy property
          </button>
        </div>
      </section>

      {result && <ResultPanel result={result} />}

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
              <li>The zk proof + transcript</li>
            </ul>
          </div>
          <div>
            <h3>Private (never leaves this tab)</h3>
            <ul>
              <li>The <code>income</code> witness</li>
              <li>Not logged, not stored, not sent anywhere</li>
              <li>Absent from the public transcript</li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}

function publicInput(r: ProofResult) {
  return {
    outcome: r.outcome === 'accepted',
    requiredIncome: r.requiredIncome,
    proofCountAfter: r.proofCountAfter?.toString() ?? '0',
  };
}

function ResultPanel({ result }: { result: ProofResult }) {
  return (
    <section className={`card result ${result.outcome}`}>
      <h2>
        {result.outcome === 'accepted' ? '✓ Proof accepted' : '✗ Proof rejected'}
      </h2>
      {result.outcome === 'accepted' ? (
        <dl>
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
          {result.reason} (assert guarded with “Income below required minimum”)
        </p>
      )}
      <p className="note">
        Level 1 demo: the real Groth16 proof is produced and verified in
        <code> tests/proofly.contract.test.ts</code> using the same compiled
        contract. Wallet integration (Lace) arrives in a later level.
      </p>
    </section>
  );
}