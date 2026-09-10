import type { VerificationState } from '../midnight/types.js';
import type { ConnectionState } from '../midnight/types.js';

interface Props {
  state: VerificationState;
  connection: ConnectionState;
}

/** Renders the Live Preprod verification state machine. */
export function ProofStatus({ state, connection }: Props) {
  if (connection.state !== 'connected') {
    return (
      <div className="card status">
        <p className="step">Connect a wallet to prove income on Preprod.</p>
      </div>
    );
  }

  switch (state.state) {
    case 'idle':
      return (
        <div className="card status">
          <p className="step">Ready. Enter income & threshold, then prove on-chain.</p>
        </div>
      );

    case 'generating':
      return (
        <div className="card status">
          <p className="step">Generating zero-knowledge proof…</p>
        </div>
      );

    case 'awaiting-wallet':
      return (
        <div className="card status">
          <p className="step">
            Proof generated. Approve and sign the transaction in your Lace
            wallet.
          </p>
        </div>
      );

    case 'submitting':
      return (
        <div className="card status">
          <p className="step">Submitting transaction to Midnight Preprod…</p>
        </div>
      );

    case 'confirming':
      return (
        <div className="card status">
          <p className="step">Waiting for on-chain confirmation…</p>
        </div>
      );

    case 'granted':
      return (
        <div className="card status ok">
          <h2>✓ Proof on-chain</h2>
          <dl>
            <dt>Transaction</dt>
            <dd>
              <code>{state.txId || 'n/a'}</code>
            </dd>
            <dt>Block height</dt>
            <dd>{state.blockHeight}</dd>
            <dt>Public proofCount</dt>
            <dd>
              <code>{state.proofCount}</code>
            </dd>
          </dl>
          <p className="note">
            The verifier only learns that <strong>income ≥ threshold</strong> —
            never the income itself.
          </p>
        </div>
      );

    case 'denied':
      return (
        <div className="card status err">
          <h2>✗ Proof denied</h2>
          <p className="step">{state.message}</p>
        </div>
      );

    case 'error':
      return (
        <div className="card status err">
          <h2>✗ Error</h2>
          <p className="step">{state.message}</p>
        </div>
      );
  }
}