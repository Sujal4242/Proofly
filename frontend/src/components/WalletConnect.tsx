import type { InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import type { ConnectionState } from '../midnight/types.js';

interface Props {
  wallets: InitialAPI[];
  connection: ConnectionState;
  onConnect: (wallet: InitialAPI) => void;
  onDisconnect: () => void;
}

/** Lace wallet connect/disconnect panel for Live Preprod mode. */
export function WalletConnect({ wallets, connection, onConnect, onDisconnect }: Props) {
  if (connection.state === 'connected') {
    return (
      <div className="wallet-panel">
        <div className="wallet-row">
          <span className="wallet-name">{connection.walletName}</span>
          <span className="badge">Connected · Preprod</span>
        </div>
        <p className="wallet-meta">
          Lace version {connection.walletVersion} · Nano TEST is required for
          transaction fees.
        </p>
        {connection.walletAddress && (
          <div className="wallet-addr" title={connection.walletAddress}>
            {connection.walletAddress}
          </div>
        )}
        <div className="actions-line" style={{ marginTop: 14 }}>
          <button type="button" className="btn btn-ghost" onClick={onDisconnect}>
            Disconnect wallet
          </button>
        </div>
      </div>
    );
  }

  if (connection.state === 'connecting') {
    return (
      <div className="status-line">
        <span className="status-dot -pending" aria-hidden="true" />
        <span>
          Connecting to Lace… approve the connection request in the wallet
          extension.
        </span>
      </div>
    );
  }

  if (connection.state === 'error') {
    return (
      <div>
        <div className="verdict -bad">
          <p className="verdict-title -bad">&#215; Wallet connection failed</p>
          <p className="step" style={{ marginTop: 8 }}>
            {connection.message}
          </p>
        </div>
        <div className="actions-line" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              if (wallets[0]) onConnect(wallets[0]);
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (wallets.length === 0) {
    return (
      <p className="step">
        No Midnight wallet detected. Install the <strong>Lace Midnight</strong>{' '}
        extension, enable <strong>Midnight Preprod</strong> in its settings, and
        reload this page.
      </p>
    );
  }

  return (
    <div>
      <p className="step">Choose a wallet to connect to Midnight Preprod:</p>
      <div className="actions-line" style={{ marginTop: 12 }}>
        {wallets.map((wallet) => (
          <button
            key={wallet.rdns}
            type="button"
            className="btn btn-primary"
            onClick={() => onConnect(wallet)}
          >
            Connect {wallet.name}
          </button>
        ))}
      </div>
    </div>
  );
}