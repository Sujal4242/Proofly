interface Props {
  configured: boolean;
  proofCount: number | null;
  error: string | null;
}

/**
 * Reads/draws the public on-chain proofCount via the indexer. Without a
 * configured contract address it stays dormant — no chain state is invented.
 */
export function ProofCounter({ configured, proofCount, error }: Props) {
  if (!configured) {
    return (
      <div className="card counter">
        <h2>Public proofCount</h2>
        <p className="step">
          No deployed Proofly contract configured yet — this counter activates
          after a real Preprod deployment and the Live proof becomes active.
        </p>
      </div>
    );
  }

  return (
    <div className="card counter">
      <h2>Public proofCount</h2>
      {error ? (
        <p className="step err">{error}</p>
      ) : proofCount === null ? (
        <p className="step">Reading contract state from the indexer…</p>
      ) : (
        <p className="step">
          On-chain proofs recorded: <strong className="count">{proofCount}</strong>
        </p>
      )}
    </div>
  );
}