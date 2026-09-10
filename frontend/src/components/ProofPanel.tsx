import { useState } from 'react';

interface Props {
  disabled: boolean;
  disabledReason: string | null;
  busy: boolean;
  onProve: (income: bigint, threshold: bigint) => void;
}

function parseAmount(value: string): bigint {
  const digits = value.replace(/[^0-9]/g, '');
  return BigInt(digits === '' ? 0 : digits);
}

/**
 * Live Preprod proof panel: the applicant enters their exact monthly income
 * (PRIVATE witness) and the required threshold (PUBLIC circuit argument).
 *
 * After submission the exact income is never re-shown in Live mode — only the
 * public outcome. The income is handed to the witness closure directly.
 */
export function ProofPanel({ disabled, disabledReason, busy, onProve }: Props) {
  const [incomeInput, setIncomeInput] = useState('82500');
  const [thresholdInput, setThresholdInput] = useState('50000');

  const handleProve = () => {
    if (disabled || busy) return;
    onProve(parseAmount(incomeInput), parseAmount(thresholdInput));
  };

  return (
    <div className="card inputs">
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
        <button onClick={handleProve} disabled={disabled || busy}>
          {disabled ? 'Live proof unavailable' : busy ? 'Proving…' : 'Prove income on Preprod'}
        </button>
      </div>
      {disabledReason && <p className="note">{disabledReason}</p>}
      <p className="note privacy-note">
        <strong>Privacy:</strong> your exact income stays in this tab — it is
        only ever inside the zero-knowledge witness. It is not displayed after
        submission, not stored, not logged, and never sent anywhere.
      </p>
    </div>
  );
}