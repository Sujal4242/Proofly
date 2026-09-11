/**
 * Proofly — verification and connection state machines for the Live Preprod
 * mode. Modeled on ShadowPass's `midnight/types.ts`.
 */

export type ConnectionState =
  | { state: 'disconnected' }
  | { state: 'connecting' }
  | {
      state: 'connected';
      walletName: string;
      walletVersion: string;
      walletAddress: string;
    }
  | { state: 'error'; message: string };

export type VerificationState =
  | { state: 'idle' }
  | { state: 'generating' }
  | { state: 'awaiting-wallet' }
  | { state: 'submitting' }
  | { state: 'confirming' }
  | {
      state: 'granted';
      txId: string;
      blockHeight: number;
      proofCount: number;
      applicationId: string;
    }
  | { state: 'denied'; message: string }
  | { state: 'error'; message: string };