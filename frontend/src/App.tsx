import { useEffect, useMemo, useState } from 'react';

import { LocalDemo } from './components/LocalDemo.js';
import { WalletConnect } from './components/WalletConnect.js';
import { ProofPanel } from './components/ProofPanel.js';
import { ProofStatus } from './components/ProofStatus.js';
import { ProofCounter } from './components/ProofCounter.js';
import { useMidnight } from './hooks/useMidnight.js';
import { useProofly } from './hooks/useProofly.js';
import { isContractConfigured, LIVE_DISABLED_REASON } from './config.js';

type Mode = 'local' | 'live';

const POLL_MS = 5000;

export default function App() {
  const [mode, setMode] = useState<Mode>('live');

  const { wallets, connection, providers, deployed, connect, disconnect } = useMidnight();
  const { verification, proofCount, proofCountError, prove, reset, refreshProofCount } =
    useProofly();

  const configured = useMemo(() => isContractConfigured(), []);

  // Poll the public proofCount while a provider (wallet) is connected.
  useEffect(() => {
    if (!providers) return;
    refreshProofCount(providers);
    const timer = setInterval(() => {
      void refreshProofCount(providers);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [providers, refreshProofCount]);

  const connected = connection.state === 'connected';
  const isLiveReady = connected && providers !== null && deployed !== null;
  const busy =
    verification.state === 'generating' ||
    verification.state === 'awaiting-wallet' ||
    verification.state === 'submitting' ||
    verification.state === 'confirming';

  const handleProve = async (income: bigint, threshold: bigint, applicationId: string) => {
    if (!providers) return;
    reset();
    await prove(providers, income, threshold, applicationId);
    if (verification.state === 'granted') {
      void refreshProofCount(providers);
    }
  };

  const liveDisabledReason = !configured
    ? LIVE_DISABLED_REASON
    : deployed === null
      ? connection.state === 'connected'
        ? 'The deployed contract could not be located on Preprod.'
        : 'Connect a wallet to prove income on Preprod.'
      : null;

  return (
    <>
      <header className="site-header">
        <div className="inner">
          <span className="brand">
            <span className="brand-mark">Proofly</span>
            <span className="brand-tag">private proof-of-income</span>
          </span>
          <span className={`net-pill${connected ? ' -connected' : ''}`} title="Midnight Preprod testnet">
            <span className="dot" aria-hidden="true" />
            {connected ? 'Preprod · wallet connected' : 'Midnight Preprod'}
          </span>
        </div>
      </header>

      <main className="page">
        <section className="hero">
          <p className="hero-eyebrow">Zero-knowledge · Midnight Preprod</p>
          <h1 className="hero-title">
            Prove your income.
            <br />
            <span className="dim">Don&rsquo;t reveal your income.</span>
          </h1>
          <p className="hero-sub">
            Proofly lets you prove that your monthly income meets a required
            threshold — for a specific application — without ever sending the
            exact amount anywhere. The proof is verified on-chain, your number
            stays in this tab.
          </p>

          <div className="flow" aria-hidden="true">
            <div className="flow-step -private">
              <span className="fs-kicker">Private</span>
              <strong>Your income</strong>
              <small>stays in this tab</small>
            </div>
            <span className="flow-arrow">&#8594;</span>
            <div className="flow-step">
              <span className="fs-kicker">Local</span>
              <strong>Zero-knowledge proof</strong>
              <small>generated on this device</small>
            </div>
            <span className="flow-arrow">&#8594;</span>
            <div className="flow-step">
              <span className="fs-kicker">Public</span>
              <strong>Required threshold</strong>
              <small>revealed to the verifier</small>
            </div>
            <span className="flow-arrow">&#8594;</span>
            <div className="flow-step -verify">
              <span className="fs-kicker">Verified</span>
              <strong>Income &#8805; threshold</strong>
              <small>recorded on-chain</small>
            </div>
          </div>
        </section>

        <div className="mode-switch" role="group" aria-label="Proofly mode">
          <button
            type="button"
            aria-pressed={mode === 'live' ? 'true' : 'false'}
            onClick={() => setMode('live')}
          >
            Prove on Preprod
          </button>
          <button
            type="button"
            aria-pressed={mode === 'local' ? 'true' : 'false'}
            onClick={() => setMode('local')}
          >
            Explore locally
          </button>
        </div>
        <p className="mode-note">
          {mode === 'live'
            ? 'Prove on Preprod — real proof with the Lace wallet on the Midnight Preprod testnet. Test funds only; no real money, no account created.'
            : 'Explore locally — the full proof pipeline runs in this tab. No wallet, no Preprod, no network, nothing leaves the page.'}
        </p>

        {mode === 'live' ? (
          <>
            <div className="workspace">
              <div className="workspace-main">
                <section className="pane">
                  <div className="pane-head">
                    <h2 className="pane-title">Prove income privately</h2>
                    <span className="pane-kicker">Live · Preprod</span>
                  </div>
                  <ProofPanel
                    disabled={!isLiveReady}
                    disabledReason={busy ? null : liveDisabledReason}
                    busy={busy}
                    onProve={handleProve}
                  />
                </section>
              </div>

              <aside className="workspace-side" aria-label="Connection and proof status">
                <section className="pane" aria-label="Wallet">
                  <div className="pane-head">
                    <h2 className="pane-title">Wallet</h2>
                    <span className="pane-kicker">Step 1</span>
                  </div>
                  <WalletConnect
                    wallets={wallets}
                    connection={connection}
                    onConnect={connect}
                    onDisconnect={() => {
                      reset();
                      disconnect();
                    }}
                  />
                </section>

                <section className="pane" aria-label="Proof status">
                  <div className="pane-head">
                    <h2 className="pane-title">Proof status</h2>
                    <span className="pane-kicker">Step 2</span>
                  </div>
                  <ProofStatus state={verification} connection={connection} />
                  <p className="privacy-note">
                    After submission the exact income is never shown again here —
                    only the public outcome.
                  </p>
                </section>

                <section className="pane" aria-label="On-chain record">
                  <div className="pane-head">
                    <h2 className="pane-title">On-chain record</h2>
                    <span className="pane-kicker">Public</span>
                  </div>
                  <ProofCounter
                    configured={configured}
                    proofCount={proofCount}
                    error={proofCountError}
                  />
                </section>
              </aside>
            </div>
          </>
        ) : (
          <LocalDemo />
        )}

        <section className="explain">
          <h2 className="kicker">How it stays private</h2>
          <div className="why-grid">
            <div className="why-item">
              <h3>&#128274;&#160; On this device</h3>
              <p>
                Your exact income exists only inside the proof as a
                zero-knowledge witness. It is not stored, not logged, and never
                sent anywhere.
              </p>
            </div>
            <div className="why-item">
              <h3>&#128065;&#160; Only the threshold is public</h3>
              <p>
                The verifier sees the required threshold, the application id,
                the proof, and the resulting on-chain record — never the income.
                The application id is a public, single-use claim scope: one
                claim per application.
              </p>
            </div>
            <div className="why-item">
              <h3>&#9989;&#160; Verified on-chain</h3>
              <p>
                A Midnight provider verifies the proof and writes the outcome to
                a public Proofly contract. Anyone can check that a claim for an
                application exists.
              </p>
            </div>
            <div className="why-item">
              <h3>&#9432;&#160; No backend</h3>
              <p>
                The app is a static site with no server of its own. The only
                infrastructure touched is Midnight/Lace and the public indexer.
              </p>
            </div>
          </div>

          <div className="replay-note">
            <span className="ttl">Replay protection</span>
            Because each claim is scoped to one application, the same claim
            cannot be reused to reach two verifiers or two applications.
            Re-claiming an already-used application — with any income or
            threshold — is rejected: <strong>&ldquo;This claim has already been
            used for this application.&rdquo;</strong>
          </div>
        </section>

        <footer className="site-footer">
          <p className="foot-line">
            Proofly · privacy-preserving proof-of-income on{' '}
            <strong>Midnight Preprod</strong>. No backend, no data collection,
            no account.
          </p>
          <div className="foot-links">
            <a
              href="https://github.com/Sujal4242/Proofly"
              target="_blank"
              rel="noreferrer noopener"
            >
              Source on GitHub
            </a>
            <a
              href="https://docs.midnight.network"
              target="_blank"
              rel="noreferrer noopener"
            >
              Midnight docs
            </a>
          </div>
        </footer>
      </main>
    </>
  );
}