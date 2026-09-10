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
      <div className="card wallet-card">
        <div className="wallet-row">
          <span className="wallet-name">{connection.walletName}</span>
          <span className="badge ok">Connected · Midnight Preprod</span>
        </div>
        <div className="wallet-meta">
          {connection.walletVersion} · Nano TEST is required for transaction fees.
        </div>
        {connection.walletAddress && (
          <div className="wallet-address" title={connection.walletAddress}>
            {connection.walletAddress}
          </div>
        )}
        <div className="actions">
          <button className="ghost" onClick={onDisconnect}>
            Disconnect wallet
          </button>
        </div>
      </div>
    );
  }

  if (connection.state === 'connecting') {
    return (
      <div className="card wallet-card">
        <p className="step">
          Connecting to Lace… approve the connection request in the wallet
          extension.
        </p>
      </div>
    );
  }

  if (connection.state === 'error') {
    return (
      <div className="card wallet-card error">
        <p className="err">Wallet connection failed</p>
        <p className="step">{connection.message}</p>
        <div className="actions">
          <button onClick={() => wallets[0] && onConnect(wallets[0])}>Retry</button>
        </div>
      </div>
    );
  }

  if (wallets.length === 0) {
    return (
      <div className="card wallet-card">
        <p className="step">
          No Midnight wallet detected. Install the Lace Midnight extension,
          enable <strong>Midnight Preprod</strong> in its settings, and reload
          this page.
        </p>
      </div>
    );
  }

  return (
    <div className="card wallet-card">
      <p className="step">Choose a wallet to connect to Live Preprod:</p>
      {wallets.map((wallet) => (
        <div key={wallet.rdns} className="actions">
          <button onClick={() => onConnect(wallet)}>
            Connect {wallet.name}
          </button>
        </div>
      ))}
    </div>
  );
}