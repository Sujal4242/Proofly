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
      <div>
        <p className="step">
          Proofs recorded by the contract appear here once a Proofly contract
          address is configured and Live proving is active.
        </p>
      </div>
    );
  }

  return (
    <div>
      {error ? (
        <p className="step err-text">{error}</p>
      ) : proofCount === null ? (
        <p className="step">Reading contract state from the indexer…</p>
      ) : (
        <>
          <span className="counter-num">{proofCount}</span>
          <p className="counter-muted">
            public proofCount recorded on-chain by the deployed Proofly contract
          </p>
        </>
      )}
    </div>
  );
}