import type { VerificationState } from '../midnight/types.js';
import type { ConnectionState } from '../midnight/types.js';
import {
  INCOME_DENIED_MESSAGE,
  REPLAY_DENIED_MESSAGE,
} from '../midnight/errors.js';

interface Props {
  state: VerificationState;
  connection: ConnectionState;
}

/** Renders the Live Preprod verification state machine. */
export function ProofStatus({ state, connection }: Props) {
  if (connection.state !== 'connected') {
    return (
      <div aria-live="polite">
        <div className="status-line">
          <span className="status-dot" aria-hidden="true" />
          <span>
            Connect a wallet to prove income on Preprod.
          </span>
        </div>
      </div>
    );
  }

  switch (state.state) {
    case 'idle':
      return (
        <div aria-live="polite">
          <div className="status-line">
            <span className="status-dot -ok" aria-hidden="true" />
            <span>
              Ready to prove. Enter your income and threshold, then press{' '}
              <strong>Prove privately</strong>.
            </span>
          </div>
        </div>
      );

    case 'generating':
      return (
        <div aria-live="assertive">
          <div className="status-line">
            <span className="status-dot -pending" aria-hidden="true" />
            <span>
              <strong>Preparing your proof…</strong> generating the zero-knowledge
              proof on this device. Your income is not revealed.
            </span>
          </div>
        </div>
      );

    case 'awaiting-wallet':
      return (
        <div aria-live="assertive">
          <div className="status-line">
            <span className="status-dot -pending" aria-hidden="true" />
            <span>
              <strong>Waiting for your wallet.</strong> Approve and sign the
              transaction in Lace.
            </span>
          </div>
        </div>
      );

    case 'submitting':
      return (
        <div aria-live="assertive">
          <div className="status-line">
            <span className="status-dot -pending" aria-hidden="true" />
            <span>
              <strong>Submitting</strong> the proof to Midnight Preprod…
            </span>
          </div>
        </div>
      );

    case 'confirming':
      return (
        <div aria-live="assertive">
          <div className="status-line">
            <span className="status-dot -pending" aria-hidden="true" />
            <span>
              <strong>Confirming on-chain.</strong> Waiting for the block.
            </span>
          </div>
        </div>
      );

    case 'granted':
      return (
        <div aria-live="assertive">
          <div className="verdict -good">
            <p className="verdict-title -good">
              <span className="ico" aria-hidden="true">&#10003;</span>
              Income requirement verified
            </p>
            <p className="verdict-body">
              Proof accepted for application <strong>{state.applicationId}</strong>{' '}
              and recorded on-chain. Your exact income was not disclosed anywhere
              in the proof.
            </p>
            <dl className="kv">
              <dt>Application</dt>
              <dd>
                <code>{state.applicationId}</code>
              </dd>
              <dt>Block height</dt>
              <dd>{state.blockHeight}</dd>
              <dt>Transaction</dt>
              <dd>
                {state.txId ? <code>{state.txId}</code> : 'n/a'}
              </dd>
              <dt>Recorded proofs</dt>
              <dd>
                <code>{state.proofCount}</code>
              </dd>
            </dl>
          </div>
        </div>
      );

    case 'denied': {
      const replay = state.message.includes(REPLAY_DENIED_MESSAGE);
      const income = state.message.includes(INCOME_DENIED_MESSAGE);
      return (
        <div aria-live="assertive">
          <div className="verdict -warn">
            <p className="verdict-title">
              <span className="ico" aria-hidden="true">&#10007;</span>
              {replay
                ? 'This claim has already been used'
                : income
                  ? 'Income below the required threshold'
                  : 'Proof denied'}
            </p>
            <p className="verdict-body">
              {replay
                ? 'The claim for this application was already recorded. Proofly prevents the same claim from being reused — replay protection is enforced.'
                : income
                  ? 'The income you entered did not meet the required threshold. Nothing about your income was sent to the verifier or stored anywhere.'
                  : state.message}
            </p>
          </div>
        </div>
      );
    }

    case 'error':
      return (
        <div aria-live="assertive">
          <div className="verdict -bad">
            <p className="verdict-title -bad">
              <span className="ico" aria-hidden="true">&#10007;</span>
              Couldn&rsquo;t complete the proof
            </p>
            <p className="verdict-body">
              {state.message || 'An unknown problem occurred.'}
            </p>
            <p className="verdict-body">
              Check that your wallet approved the request and that Preprod is
              reachable, then try again.
            </p>
          </div>
        </div>
      );
  }
}