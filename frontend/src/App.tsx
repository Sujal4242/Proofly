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
  const [mode, setMode] = useState<Mode>('local');

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

  const handleProve = async (income: bigint, threshold: bigint) => {
    if (!providers) return;
    reset();
    await prove(providers, income, threshold);
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
    <main className="page">
      <header>
        <div className="eyebrow">Midnight · Compact · Zero-Knowledge</div>
        <h1>
          Proofly<span className="muted"> — private proof-of-income</span>
        </h1>
        <p className="lede">
          Prove <strong>monthlyIncome ≥ requiredThreshold</strong> without ever
          revealing the income. Two modes:
        </p>
      </header>

      <div className="mode-switch" role="tablist" aria-label="Proofly mode">
        <button
          className={mode === 'local' ? 'active' : ''}
          onClick={() => setMode('local')}
          role="tab"
        >
          Local Demo
        </button>
        <button
          className={mode === 'live' ? 'active' : ''}
          onClick={() => setMode('live')}
          role="tab"
        >
          Live Preprod
        </button>
      </div>
      <p className="mode-note">
        {mode === 'local'
          ? 'Local Demo — everything runs client-side in this tab. No wallet, no Preprod, no chain calls.'
          : 'Live Preprod — real proof with the Lace wallet on the Midnight Preprod testnet. Requires a deployed Proofly contract (test funds only, no real money).'}
      </p>

      {mode === 'local' ? (
        <LocalDemo />
      ) : (
        <>
          <section className="card">
            <h2>1 · Connect Lace wallet</h2>
            <WalletConnect
              wallets={wallets}
              connection={connection}
              onConnect={connect}
              onDisconnect={() => {
                reset();
                disconnect();
              }}
            />
            <ProofCounter configured={configured} proofCount={proofCount} error={proofCountError} />
          </section>

          <section className="card">
            <h2>2 · Prove income on Preprod</h2>
            <ProofPanel
              disabled={!isLiveReady}
              disabledReason={busy ? null : liveDisabledReason}
              busy={busy}
              onProve={handleProve}
            />
            <ProofStatus state={verification} connection={connection} />
          </section>

          <p className="mode-note privacy-note">
            <strong>Live mode privacy:</strong> the exact income is never shown
            again after proof submission — only the public outcome (proof
            generated, threshold met, proofCount incremented) appears here. See
            the Local Demo tab for a visual demonstration of this property.
          </p>
        </>
      )}

      <footer className="page-footer">
        <p className="note">
          No backend. Only Midnight/Lace infrastructure and the public indexer.
          Income remains a zero-knowledge witness in every mode.
        </p>
      </footer>
    </main>
  );
}