/**
 * Proofly — deployment script for the Midnight Preprod network.
 *
 * Used for the L2 deployment and, after the Level 3 contract surface change, a
 * SECOND deployment of the same project. Each successful deployment APPENDS a
 * clearly separated level entry to docs/evidence/DEPLOYMENT.md while preserving
 * the previous (L2) entry — no identifier is ever fabricated.
 *
 * This script is NOT part of the deployed application. It is an OPERATOR-ONLY,
 * LOCAL-ONLY tool that deploys the compiled Proofly contract to Midnight
 * Preprod with a dedicated deployer wallet. It is never run by Netlify, is
 * never exposed to the frontend, and must be thrown away or retained
 * offline-only after use.
 *
 * ─── Security model ─────────────────────────────────────────────────────────
 *   - The deployer seed is read ONLY from the PROOFLY_DEPLOYER_SEED
 *     environment variable (hex-encoded 32 bytes, 64 hex chars). It is:
 *       * never hardcoded,        * never printed,
 *       * never written to files, * never committed,
 *       * never placed in VITE_* variables, * never sent to Netlify/GitHub CI
 *   - Wallet sync state is persisted under `.midnight-wallet-state/` which is
 *     gitignored (and never committed).
 *   - The mandatory network guard refuses to deploy anywhere but 'preprod'.
 *   - Only NON-SECRET evidence is written to docs/evidence/DEPLOYMENT.md.
 *   - `--validate` mode performs local preflight checks only. It creates NO
 *     wallet, syncs NOTHING, and submits NO transaction.
 *
 * ─── Prerequisites ──────────────────────────────────────────────────────────
 *   1. Docker running with the local proof server:  npm run proof-server:start
 *   2. Node.js 22+, Compact toolchain 0.31.1, compiled artifacts:
 *        npm run compile
 *   3. The deployer wallet funded with tNIGHT / tDUST (official Preprod
 *      faucet — no real money).
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *   Preflight only (no network, no wallet, no transactions):
 *       npm run deploy:proofly:validate
 *   Derive the public Preprod deployer address from the local seed (read-only,
 *       no wallet, no network, no transactions):
 *       PROOFLY_DEPLOYER_SEED=<64-hex> npm run deploy:proofly:address
 *   Read-only funded-wallet check (creates wallet, syncs, reads balances; NO
 *       transactions, NO DUST registration, NO proof-server needed):
 *       PROOFLY_DEPLOYER_SEED=<64-hex> npm run deploy:proofly:check-funds
 *   Actual deployment:
 *       PROOFLY_DEPLOYER_SEED=<64-hex> npm run deploy:proofly
 *
 * ─── Environment variables ───────────────────────────────────────────────────
 *   PROOFLY_DEPLOYER_SEED            — hex 32-byte deployer seed (REQUIRED)
 *   PROOFLY_NETWORK_ID               — must be 'preprod' (default 'preprod')
 *   PROOFLY_INDEXER_URL              — public Preprod indexer override
 *   PROOFLY_INDEXER_WS_URL           — public Preprod indexer WS override
 *   PROOFLY_NODE_URL                 — public Preprod RPC override
 *   PROOFLY_PROOF_SERVER_URL         — local proof server (default :6300)
 *   PROOFLY_PRIVATE_STATE_PASSWORD   — password for the deployer private-state
 *                                      store (recommended; has a local-only
 *                                      placeholder default for compatibility)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Buffer } from 'buffer';
import * as Rx from 'rxjs';

// Wallet SDK (barrel package, pinned to the documented 1.2.0)
import {
  WalletFacade,
  HDWallet,
  ShieldedWallet,
  UnshieldedWallet,
  DustWallet,
  Roles,
  createKeystore,
  NoOpTransactionHistoryStorage,
  PublicKey,
} from '@midnight-ntwrk/wallet-sdk';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

// Wallet state persistence (no SDK imports)
import {
  loadWalletState,
  saveWalletState,
  type PersistedWalletState,
  type ChildKind,
  CHILD_KINDS,
} from './deploy-wallet-state.js';

// Contract deployment
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

// The privacy boundary is reused verbatim: the income witness is wired as in
// the frontend (placeholder `0n` — deployment never invokes `proveIncome`, so
// the exact income never enters this process at all).
import { createProoflyWitnesses } from '../frontend/src/midnight/witnesses.js';

// ─── Enable WebSocket for GraphQL subscriptions ────────────────────────────────
import { WebSocket } from 'ws';
(globalThis as any).WebSocket = WebSocket;

// ─── Network Configuration (Midnight Preprod — testnet, no real money) ────────
const DEFAULT_NETWORK_CONFIG = {
  indexer:   'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWS: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  node:      'https://rpc.preprod.midnight.network',
  proofServer: 'http://127.0.0.1:6300',
};

function networkConfig() {
  return {
    indexer: process.env.PROOFLY_INDEXER_URL?.trim() || DEFAULT_NETWORK_CONFIG.indexer,
    indexerWS: process.env.PROOFLY_INDEXER_WS_URL?.trim() || DEFAULT_NETWORK_CONFIG.indexerWS,
    node: process.env.PROOFLY_NODE_URL?.trim() || DEFAULT_NETWORK_CONFIG.node,
    proofServer: process.env.PROOFLY_PROOF_SERVER_URL?.trim() || DEFAULT_NETWORK_CONFIG.proofServer,
  };
}

const CONTRACT_NAME = 'proofly';
const CONTRACT_PRIVATE_STATE_ID = 'proofly';
const ALLOWED_NETWORK_ID = 'preprod';

// ─── Paths ─────────────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const zkConfigPath = path.resolve(REPO_ROOT, 'contracts', 'managed', 'proofly');
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');
const evidencePath = path.resolve(REPO_ROOT, 'docs', 'evidence', 'DEPLOYMENT.md');

// ─── Optional local .env loader (gitignored; never committed) ─────────────────
// Mirrors the ShadowPass custom parser. Only KEY=VALUE lines; never overwrites
// a variable that is already set in the environment.
function loadEnvFileIfPresent(file: string): void {
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// ─── Seed Handling (SECURITY-CRITICAL) ────────────────────────────────────────
function getSeed(): string | null {
  const seed = process.env.PROOFLY_DEPLOYER_SEED;
  if (!seed) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(seed)) {
    throw new Error(
      'PROOFLY_DEPLOYER_SEED must be exactly 64 hex characters (32 bytes).',
    );
  }
  return seed.toLowerCase();
}

// ─── Preflight (no wallet, no network, no transactions) ───────────────────────
interface PreflightReport {
  ok: boolean;
  problems: string[];
  info: string[];
}

function runPreflight(): PreflightReport {
  const problems: string[] = [];
  const info: string[] = [];

  loadEnvFileIfPresent(path.join(REPO_ROOT, '.env'));
  loadEnvFileIfPresent(path.join(REPO_ROOT, '.env.local'));

  // 1. Seed presence + format
  const configuredNetwork =
    process.env.PROOFLY_NETWORK_ID?.trim() || ALLOWED_NETWORK_ID;
  info.push(`PROOFLY_NETWORK_ID: ${configuredNetwork}`);

  const seed = process.env.PROOFLY_DEPLOYER_SEED;
  if (!seed) {
    problems.push(
      'PROOFLY_DEPLOYER_SEED is not set. Set it to a 64-hex-char random seed you control.',
    );
  } else if (!/^[0-9a-fA-F]{64}$/.test(seed.trim())) {
    problems.push('PROOFLY_DEPLOYER_SEED must be exactly 64 hex characters (32 bytes).');
  } else {
    info.push('PROOFLY_DEPLOYER_SEED: set (format valid).');
  }

  // 2. Network must be preprod
  if (configuredNetwork !== ALLOWED_NETWORK_ID) {
    problems.push(
      `REFUSED: PROOFLY_NETWORK_ID must be '${ALLOWED_NETWORK_ID}' (got '${configuredNetwork}').`,
    );
  }

  // 3. Compiled contract artifacts
  const requiredArtifacts = [
    ['contract/index.js', 'compiled contract JS'],
    ['contract/index.d.ts', 'compiled contract types'],
    ['zkir/proveIncome.zkir', 'proveIncome ZKIR'],
    ['zkir/proveIncome.bzkir', 'proveIncome bZKIR'],
    ['keys/proveIncome.prover', 'proveIncome proving key'],
    ['keys/proveIncome.verifier', 'proveIncome verifying key'],
    ['compiler/contract-info.json', 'contract compiler manifest'],
  ] as const;
  for (const [rel, label] of requiredArtifacts) {
    const full = path.join(zkConfigPath, rel);
    if (!fs.existsSync(full)) {
      problems.push(`Missing ${label}: ${rel} (run: npm run compile)`);
    }
  }

  // 4. Tool versions from the compile manifest
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(zkConfigPath, 'compiler', 'contract-info.json'), 'utf-8'),
    );
    info.push(
      `Compiler version: ${manifest['compiler-version']} · Runtime version: ${manifest['runtime-version']}`,
    );
  } catch {
    // Reported by the artifact check above; no extra problem here.
  }

  return { ok: problems.length === 0, problems, info };
}

// ─── Wallet Creation ───────────────────────────────────────────────────────────
function deriveKeys(seed: string) {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hdWallet.type !== 'seedOk') throw new Error('Invalid seed');
  const result = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (result.type !== 'keysDerived') throw new Error('Key derivation failed');
  hdWallet.hdWallet.clear();
  return result.keys;
}

interface WalletContext {
  wallet: Awaited<ReturnType<typeof WalletFacade.init>>;
  shieldedSecretKeys: ReturnType<typeof ledger.ZswapSecretKeys.fromSeed>;
  dustSecretKey: ReturnType<typeof ledger.DustSecretKey.fromSeed>;
  unshieldedKeystore: ReturnType<typeof createKeystore>;
  restored: { shielded: boolean; unshielded: boolean; dust: boolean };
}

function warnRestoreFailure(kind: ChildKind, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`  Warning: Could not restore ${kind} wallet state (${msg}); falling back to fresh sync.\n`);
}

async function createWallet(seed: string, cfg: ReturnType<typeof networkConfig>, restore = true): Promise<WalletContext> {
  setNetworkId(ALLOWED_NETWORK_ID);

  const keys = deriveKeys(seed);
  const networkId = getNetworkId();
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], networkId);

  const saved: PersistedWalletState = restore ? loadWalletState(ALLOWED_NETWORK_ID) : {};
  const restored = { shielded: false, unshielded: false, dust: false };

  const walletConfig = {
    networkId,
    indexerClientConnection: {
      indexerHttpUrl: cfg.indexer,
      indexerWsUrl: cfg.indexerWS,
    },
    provingServerUrl: new URL(cfg.proofServer),
    relayURL: new URL(cfg.node.replace(/^http/, 'ws')),
    txHistoryStorage: new NoOpTransactionHistoryStorage(),
    costParameters: {
      additionalFeeOverhead: 300_000_000_000_000n,
      feeBlocksMargin: 5,
    },
  };

  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded: async (config) => {
      const cls = ShieldedWallet(config);
      if (saved.shielded !== undefined) {
        try {
          const restoredWallet = cls.restore(saved.shielded as string);
          restored.shielded = true;
          return restoredWallet;
        } catch (err) {
          warnRestoreFailure('shielded', err);
        }
      }
      return cls.startWithSecretKeys(shieldedSecretKeys);
    },
    unshielded: async (config) => {
      const cls = UnshieldedWallet(config);
      if (saved.unshielded !== undefined) {
        try {
          const restoredWallet = cls.restore(saved.unshielded as string);
          restored.unshielded = true;
          return restoredWallet;
        } catch (err) {
          warnRestoreFailure('unshielded', err);
        }
      }
      return cls.startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore));
    },
    dust: async (config) => {
      const cls = DustWallet(config);
      if (saved.dust !== undefined) {
        try {
          const restoredWallet = cls.restore(saved.dust);
          restored.dust = true;
          return restoredWallet;
        } catch (err) {
          warnRestoreFailure('dust', err);
        }
      }
      return cls.startWithSecretKey(
        dustSecretKey,
        ledger.LedgerParameters.initialParameters().dust,
      );
    },
  });

  await wallet.start(shieldedSecretKeys, dustSecretKey);

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore, restored };
}

// ─── Proof Server Readiness ────────────────────────────────────────────────────
async function isProofServerUp(cfg: ReturnType<typeof networkConfig>): Promise<boolean> {
  try {
    await fetch(cfg.proofServer, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    return true;
  } catch {
    return false;
  }
}

// ─── Wallet State Persistence ─────────────────────────────────────────────
/** 4h Preprod sync budget for a cold start; seconds thereafter with saved state. */
const SYNC_TIMEOUT_MS = 4 * 60 * 60 * 1000;

async function persistWalletState(ctx: WalletContext): Promise<void> {
  const next: PersistedWalletState = {};
  for (const kind of CHILD_KINDS) {
    try {
      const child = (ctx.wallet as unknown as Record<ChildKind, { serializeState: () => Promise<unknown> }>)[kind];
      const serialized = await child.serializeState();
      if (kind === 'dust') {
        next.dust = serialized as string;
      } else {
        next[kind] = serialized;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  Warning: Could not serialize ${kind} wallet state (${msg}); next run will re-sync.\n`);
    }
  }
  saveWalletState(ALLOWED_NETWORK_ID, next);
}

// ─── Provider Setup ────────────────────────────────────────────────────────────
function createProviders(walletCtx: WalletContext, cfg: ReturnType<typeof networkConfig>) {
  const privateStatePassword =
    process.env.PROOFLY_PRIVATE_STATE_PASSWORD?.trim() ||
    'Local-Devnet-Development-Placeholder-1';

  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        {
          shieldedSecretKeys: walletCtx.shieldedSecretKeys,
          dustSecretKey: walletCtx.dustSecretKey,
        },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return walletCtx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const accountId = walletCtx.unshieldedKeystore.getBech32Address().toString();

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'proofly-deploy-state',
      accountId,
      privateStoragePasswordProvider: () => privateStatePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(cfg.indexer, cfg.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(cfg.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

// ─── Compiled Contract (income witness wired as the frontend) ──────────────
// Deployment only initializes the ledger (proofCount = 0); proveIncome is never
// invoked here, so the placeholder income is never used.
// Built lazily so the validate/preflight path never touches the compiled artifacts.
const CC: any = CompiledContract;

async function buildCompiledContract() {
  const Proofly = await import(pathToFileURL(contractPath).href);
  return CC.make(CONTRACT_NAME, Proofly.Contract).pipe(
    CC.withWitnesses(createProoflyWitnesses<{}>(0n)),
    CC.withCompiledFileAssets(zkConfigPath),
  );
}

// ─── Evidence (NON-SECRET ONLY) ────────────────────────────────────────────────
interface DeploymentEvidence {
  /** Level tag; appended as a section header in the evidence file. */
  level: 'L2' | 'L3';
  contractAddress: string;
  txId: string;
  blockHeight?: string | number;
  blockHash?: string;
  network: string;
  deployedAt: string;
  compilerVersion: string;
  runtimeVersion: string;
  deployerAddress: string;
  /** Extra markdown lines appended after the standard table. */
  additionalMarkdown?: string[];
}

/**
 * Append a clearly separated level entry to the evidence file.
 *
 * If the file already contains L2 evidence, the new entry is appended after a
 * horizontal rule separator — the existing content is never removed or modified.
 */
function writeEvidence(evidence: DeploymentEvidence): void {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });

  // Preserve any existing evidence (e.g., the L2 deployment record).
  let existingContent = '';
  if (fs.existsSync(evidencePath)) {
    existingContent = fs.readFileSync(evidencePath, 'utf-8').trimEnd();
  }

  const separator = existingContent ? '\n\n---\n\n' : '';
  const levelLabel = evidence.level;

  const sectionLines = [
    `## Level ${levelLabel} Deployment — Proofly ${levelLabel === 'L3' ? 'with Replay Protection' : 'private proof-of-income'}`,
    '',
    `| Item | Value |`,
    `|---|---|`,
    `| **Network** | Midnight ${evidence.network.toUpperCase()} (testnet; no real funds) |`,
    `| **Contract address** | \`${evidence.contractAddress}\` |`,
    `| **Transaction ID** | \`${evidence.txId}\` |`,
    `| **Block height** | ${evidence.blockHeight ?? 'n/a'} |`,
    `| **Block hash** | \`${evidence.blockHash ?? 'n/a'}\` |`,
    `| **Compact compiler** | ${evidence.compilerVersion} |`,
    `| **Compact runtime** | ${evidence.runtimeVersion} |`,
    `| **Deployed at** | ${evidence.deployedAt} |`,
    `| **Deployer address (public)** | \`${evidence.deployerAddress}\` |`,
    '',
    ...(evidence.additionalMarkdown ?? []),
  ];

  const output = existingContent + separator + sectionLines.join('\n') + '\n';
  fs.writeFileSync(evidencePath, output);
  process.stdout.write(`  ✓ Non-secret evidence written to ${path.relative(REPO_ROOT, evidencePath)}\n`);
}

// ─── Derive the public Preprod deployer address (read-only) ───────────────────
// Pure local HD derivation + address formatting. Creates NO wallet, syncs
// NOTHING, contacts NO network, and submits NO transaction. The seed is read
// from PROOFLY_DEPLOYER_SEED and is never printed.
function deriveDeployerAddress(): void {
  loadEnvFileIfPresent(path.join(REPO_ROOT, '.env'));
  loadEnvFileIfPresent(path.join(REPO_ROOT, '.env.local'));

  const configuredNetwork = process.env.PROOFLY_NETWORK_ID?.trim() || ALLOWED_NETWORK_ID;
  const seed = getSeed();

  if (!seed) {
    console.error('\n  ✗ PROOFLY_DEPLOYER_SEED is required to derive the deployer address.\n');
    process.exit(1);
  }
  if (configuredNetwork !== ALLOWED_NETWORK_ID) {
    console.error(
      `\n  ✗ REFUSED: PROOFLY_NETWORK_ID must be '${ALLOWED_NETWORK_ID}' (got '${configuredNetwork}').\n`,
    );
    process.exit(1);
  }

  setNetworkId(ALLOWED_NETWORK_ID);
  const keys = deriveKeys(seed);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());

  console.log('\n  Proofly deployer — derived PUBLIC Preprod address (fundable):\n');
  console.log(`  ${unshieldedKeystore.getBech32Address().toString()}`);
  console.log('\n  This is the only address to fund with tNIGHT via the official\n  Midnight Preprod faucet (report.md/docs/LEVEL2-DEPLOYMENT.md).\n');
}

// ─── Validate / Dry-Run Mode ──────────────────────────────────────────────────
async function validateMode(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Proofly — Deployment PREFLIGHT (validate/dry-run mode)      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  console.log('  No wallet is created. No network is contacted. No transaction\n  is submitted.\n');

  const report = runPreflight();
  for (const line of report.info) console.log(`  ℹ  ${line}`);
  for (const line of report.problems) console.log(`  ✗  ${line}`);

  const proofServerUp = await isProofServerUp(networkConfig());
  console.log(
    proofServerUp
      ? '  ℹ  Local proof server http://127.0.0.1:6300 is responding (ok).'
      : '  ⚠  Local proof server http://127.0.0.1:6300 is NOT responding —\n      start it with:  npm run proof-server:start  (required before a real deploy).',
  );

  console.log(
    report.ok
      ? '\n  ✓ All local preflight checks pass.'
      : `\n  ✗ ${report.problems.length} preflight problem(s). Fix and re-run.`,
  );
  console.log('');
  process.exit(report.ok ? 0 : 1);
}

// ─── Read-Only Funded-Wallet Check (Step 30) ─────────────────────────────────
// Purpose: verify the derived deployer address, that faucet tNIGHT is visible
// on-chain, and the current DUST/resource state — WITHOUT deploying and WITHOUT
// submitting any transaction (no DUST registration, no faucet call, no
// submitTransaction). Sync is a read from the public Preprod indexer. No local
// proof server is needed for this check (no proving occurs).
async function checkFundsMode(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Proofly — READ-ONLY deployer wallet/funds verification      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  console.log('  No transaction is submitted. No DUST registration. No faucet\n  call. No proof-server required.\n');

  loadEnvFileIfPresent(path.join(REPO_ROOT, '.env'));
  loadEnvFileIfPresent(path.join(REPO_ROOT, '.env.local'));

  const configuredNetwork = process.env.PROOFLY_NETWORK_ID?.trim() || ALLOWED_NETWORK_ID;
  if (configuredNetwork !== ALLOWED_NETWORK_ID) {
    console.error(
      `\n  ✗ REFUSED: PROOFLY_NETWORK_ID must be '${ALLOWED_NETWORK_ID}' (got '${configuredNetwork}').\n`,
    );
    process.exit(1);
  }

  const seed = getSeed();
  if (!seed) {
    console.error('\n  ✗ PROOFLY_DEPLOYER_SEED is not set or malformed.');
    console.error('    Export it in YOUR local shell only (never paste/commit it) and re-run:\n');
    console.error('    PROOFLY_DEPLOYER_SEED="<64-hex>" npm run deploy:proofly:check-funds\n');
    process.exit(1);
  }

  // 1. Derived public address (the same address the faucet funded).
  setNetworkId(ALLOWED_NETWORK_ID);
  const keys = deriveKeys(seed);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());
  const address = unshieldedKeystore.getBech32Address();
  console.log(`  Derived deployer (public) address: ${address}`);
  console.log('  ⇢ Compare this with the address you funded in the official\n    Midnight Preprod faucet.\n');

  // 2. Read-only wallet + sync to observe balances.
  console.log('  Creating read-only wallet session and syncing with Preprod...');
  console.log(`  Sync timeout: ${SYNC_TIMEOUT_MS / 3600_000} hours\n`);

  const walletCtx = await createWallet(seed, networkConfig());
  const syncStart = Date.now();
  const syncProgressInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - syncStart) / 1000);
    process.stdout.write(`\r  ⏳ Syncing... (${elapsed}s elapsed; cold sync can be slow)   `);
  }, 5000);

  let state;
  try {
    state = await Rx.firstValueFrom(
      walletCtx.wallet.state().pipe(
        Rx.filter((s) => s.isSynced),
        Rx.timeout(SYNC_TIMEOUT_MS),
      ),
    );
  } catch {
    clearInterval(syncProgressInterval);
    console.log('\n  ✗ Sync timed out or failed. No transaction was submitted.');
    console.log('    Re-run the check (state checkpoints locally on success).');
    await walletCtx.wallet.stop();
    process.exit(1);
  }
  clearInterval(syncProgressInterval);
  process.stdout.write('  ✓ Synced with Preprod.                                \n');

  // 3. Balances + resource state (read-only).
  const tnightBalance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
  const dustBalance = state.dust.balance(new Date());
  const availableCoins = state.unshielded.availableCoins ?? [];
  const unregistered = availableCoins.filter((c: any) => !c.meta?.registeredForDustGeneration);

  console.log(`\n  ── Resource Status (read-only) ──────────────────────────────\n`);
  console.log(`  tNIGHT balance (visible on Preprod): ${tnightBalance.toLocaleString()}`);
  console.log(`  DUST balance (ready now):            ${dustBalance.toLocaleString()}`);
  console.log(`  Unshielded UTXOs:                     ${availableCoins.length}`);
  console.log(`    └ of which not yet DUST-registered: ${unregistered.length}`);

  // 4. Verdict + exact next action (no action performed).
  if (tnightBalance === 0n) {
    console.log('\n  ✗ tNIGHT is NOT yet visible at the deployer address.');
    console.log('    Next action (manual, official only): fund the address above');
    console.log('    through the official Midnight Preprod faucet, then re-run');
    console.log('    deploy:proofly:check-funds before deploying.\n');
  } else if (dustBalance === 0n) {
    console.log('\n  ⚠ tNIGHT IS funded, but no DUST is available yet.');
    console.log('    Required next step (from the Flash Loan / ShadowPass reference');
    console.log('    flow used by deploy-proofly.ts): when you run the deployment, the');
    console.log('    standard wallet flow will generate DUST by registering tNIGHT');
    console.log('    UTXOs via waitForGeneratedDust + registerNightUtxosForDustGeneration');
    console.log('    (a real network transaction — executed ONLY if/when you run');
    console.log('    `npm run deploy:proofly`). Alternatively, holding/delegating');
    console.log('    tNIGHT generates tDUST over time per Midnight docs. No action');
    console.log('    was taken by this read-only check.\n');
  } else {
    console.log('\n  ✓ Deployer wallet is funded AND has DUST available.');
    console.log('    The deploy:proofly flow should be able to run when you are ready.\n');
  }

  // Persist sync state locally (no transaction) so future runs are fast.
  await persistWalletState(walletCtx);
  process.stdout.write('  ✓ Wallet sync state checkpointed locally (gitignored).\n');

  await walletCtx.wallet.stop();
  console.log('  (Wallet session stopped. No transaction was submitted.)\n');
}

// ─── Main (real deployment) ────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--derive-address')) {
    deriveDeployerAddress();
    return;
  }
  if (args.includes('--check-funds')) {
    await checkFundsMode();
    return;
  }
  if (args.includes('--validate') || args.includes('--dry-run')) {
    await validateMode();
    return;
  }

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Proofly — L2/L3 Deployment to Midnight Preprod             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Preflight gate — abort before any wallet or network activity.
  const report = runPreflight();
  if (report.problems.length > 0) {
    console.error('  REFUSING TO DEPLOY — preflight failed:');
    for (const line of report.problems) console.error(`    ✗  ${line}`);
    console.error('  Fix the issues and re-run.\n');
    process.exit(1);
  }
  for (const line of report.info) console.log(`  ℹ  ${line}`);

  const seed = getSeed();
  if (!seed) {
    console.error('\n  ✗ PROOFLY_DEPLOYER_SEED is required.\n');
    process.exit(1);
  }

  const cfg = networkConfig();
  const proofServerUp = await isProofServerUp(cfg);
  if (!proofServerUp) {
    console.error(
      '\n  ✗ Local proof server not responding. Run: npm run proof-server:start\n',
    );
    process.exit(1);
  }

  console.log('\n  ── Wallet Setup ───────────────────────────────────────────-\n');
  const walletCtx = await createWallet(seed, cfg);

  if (walletCtx.restored.shielded || walletCtx.restored.unshielded || walletCtx.restored.dust) {
    console.log('  Restored wallet state from disk — sync will be fast.');
  } else {
    console.log('  No persisted state found — fresh sync can take a long time on Preprod.');
  }

  console.log('  Syncing with network...');
  console.log(`  Sync timeout: ${SYNC_TIMEOUT_MS / 3600_000} hours\n`);
  const syncStart = Date.now();
  const syncProgressInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - syncStart) / 1000);
    process.stdout.write(`\r  ⏳ Syncing... (${elapsed}s elapsed)   `);
  }, 5000);

  let state;
  try {
    state = await Rx.firstValueFrom(
      walletCtx.wallet.state().pipe(
        Rx.filter((s) => s.isSynced),
        Rx.timeout(SYNC_TIMEOUT_MS),
      ),
    );
  } catch {
    clearInterval(syncProgressInterval);
    console.log('\n  ✗ Sync timed out. Re-run the script — state checkpoints on the next success.');
    await walletCtx.wallet.stop();
    process.exit(1);
  }
  clearInterval(syncProgressInterval);
  process.stdout.write('  ✓ Synced.                                              \n');

  console.log('  Saving wallet state...');
  await persistWalletState(walletCtx);
  process.stdout.write('  ✓ Wallet state saved.                               \n');

  const address = walletCtx.unshieldedKeystore.getBech32Address();
  let tnightBalance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;

  console.log(`\n  Deployer (public) address: ${address}`);
  console.log(`  tNIGHT balance: ${tnightBalance.toLocaleString()}`);

  // ── Resource verification (no fake funding) ────────────────────────────────
  // We do NOT mint, proxy, or fake funds. If tNIGHT is missing, the operator
  // must fund the deployer wallet through the official Midnight Preprod
  // process before re-running.
  if (tnightBalance === 0n) {
    console.log('\n  ✗ Deployer wallet has no tNIGHT.');
    console.log('    Fund it through the official Midnight testnet/faucet process,');
    console.log('    then re-run this script. See docs/LEVEL2-DEPLOYMENT.md.\n');
    await persistWalletState(walletCtx);
    await walletCtx.wallet.stop();
    process.exit(1);
  }

  // ── Register unshielded UTXOs for DUST generation (standard wallet flow) ───
  const dustState = await Rx.firstValueFrom(
    walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)),
  );
  const unregisteredUtxos = dustState.unshielded.availableCoins.filter(
    (c: any) => !c.meta?.registeredForDustGeneration,
  );
  if (unregisteredUtxos.length > 0) {
    console.log(`\n  Registering ${unregisteredUtxos.length} tNIGHT UTXO(s) for DUST generation...`);
    const { fee } = await walletCtx.wallet.estimateRegistration(unregisteredUtxos);
    await walletCtx.wallet.waitForGeneratedDust(unregisteredUtxos, fee, {
      timeoutMs: 600_000,
    });
    const recipe = await walletCtx.wallet.registerNightUtxosForDustGeneration(
      unregisteredUtxos,
      walletCtx.unshieldedKeystore.getPublicKey(),
      (payload) => walletCtx.unshieldedKeystore.signData(payload),
    );
    const finalized = await walletCtx.wallet.finalizeRecipe(recipe);
    await walletCtx.wallet.submitTransaction(finalized);
  }

  let dustBalance = 0n;
  if (dustState.dust.balance(new Date()) === 0n) {
    console.log('  Waiting for DUST tokens...');
    try {
      await Rx.firstValueFrom(
        walletCtx.wallet.state().pipe(
          Rx.throttleTime(5000),
          Rx.filter((s) => s.isSynced),
          Rx.filter((s) => s.dust.balance(new Date()) > 0n),
        ),
      );
    } catch {
      dustBalance = 0n;
    }
    const latest = await walletCtx.wallet.waitForSyncedState();
    dustBalance = latest.dust.balance(new Date());
  } else {
    dustBalance = dustState.dust.balance(new Date());
  }
  console.log(`\n  DUST balance: ${dustBalance.toLocaleString()}`);
  if (dustBalance === 0n) {
    console.log('\n  ✗ No DUST available for transaction fees.');
    console.log('    Ensure the wallet holds (and delegates) tNIGHT so DUST can be');
    console.log('    generated, then re-run.\n');
    await persistWalletState(walletCtx);
    await walletCtx.wallet.stop();
    process.exit(1);
  }

  // ── MANDATORY NETWORK SAFETY ASSERTION ────────────────────────────────────
  const resolvedNetwork = getNetworkId();
  if (resolvedNetwork !== ALLOWED_NETWORK_ID) {
    console.error(
      `\n  ✗ REFUSING DEPLOYMENT: Proofly must be deployed to Midnight Preprod.\n` +
      `    Resolved network: ${resolvedNetwork} · Expected: ${ALLOWED_NETWORK_ID}\n`,
    );
    await walletCtx.wallet.stop();
    process.exit(1);
  }

  console.log('\n  ── Confirm Deployment ──────────────────────────────────────');
  console.log(`  Network : MIDNIGHT ${ALLOWED_NETWORK_ID.toUpperCase()} (testnet)`);
  console.log('  Contract: Proofly Level 3 (proofCount + usedNullifiers, proveIncome circuit)');
  console.log('');
  process.stdout.write('  Type DEPLOY to confirm: ');
  const confirmed = await new Promise<boolean>((resolve) => {
    process.stdin.once('data', (data) => resolve(String(data).trim() === 'DEPLOY'));
  });
  if (!confirmed) {
    console.log('\n  Aborted. No transaction was submitted.\n');
    await walletCtx.wallet.stop();
    process.exit(1);
  }

  console.log('\n  Deploying the Proofly contract...\n');

  // Retry loop for DUST shortage (same pattern as the Flash Loan reference).
  const MAX_RETRIES = 20;
  const RETRY_DELAY_MS = 5000;
  const providers = createProviders(walletCtx, cfg);
  const compiledContract = await buildCompiledContract();

  let deployed: Awaited<ReturnType<typeof deployContract>> | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      deployed = await deployContract(providers, {
        compiledContract: compiledContract as any,
        args: [],
        privateStateId: CONTRACT_PRIVATE_STATE_ID,
        initialPrivateState: {},
      });
      break;
    } catch (err: any) {
      const errMsg = err?.message || err?.toString() || '';
      const errCause = err?.cause?.message || err?.cause?.toString() || '';
      const fullError = `${errMsg} ${errCause}`;

      const isDustShortage =
        fullError.includes('Not enough Dust') ||
        fullError.includes('Insufficient Funds') ||
        fullError.includes('could not balance dust');

      if (isDustShortage) {
        if (attempt < MAX_RETRIES) {
          console.log(`  ⏳ DUST not yet ready; retrying in ${RETRY_DELAY_MS / 1000}s (${attempt}/${MAX_RETRIES})...`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        console.error(`  ✗ Not enough DUST after ${MAX_RETRIES} retries.`);
        await walletCtx.wallet.stop();
        process.exit(1);
      }

      if (
        fullError.includes('Failed to connect to Proof Server') ||
        fullError.includes('connect ECONNREFUSED 127.0.0.1:6300')
      ) {
        console.error('  ✗ Proof server unreachable. Run: npm run proof-server:start\n');
        await walletCtx.wallet.stop();
        process.exit(1);
      }

      throw err;
    }
  }

  if (!deployed) throw new Error('Deployment failed after all retries');

  const publicTx = (deployed as any).deployTxData?.public ?? {};
  const contractAddress = publicTx.contractAddress as string;
  const txId = publicTx.txId as string;
  const blockHeight = publicTx.blockHeight as string | number | undefined;
  const blockHash = publicTx.blockHash as string | undefined;

  console.log('  ✅ Proofly contract deployed successfully!\n');

  await persistWalletState(walletCtx);

  // ── Evidence (non-secret only) ─────────────────────────────────────────────
  let compilerVersion = 'n/a';
  let runtimeVersion = 'n/a';
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(zkConfigPath, 'compiler', 'contract-info.json'), 'utf-8'),
    );
    compilerVersion = manifest['compiler-version'] ?? 'n/a';
    runtimeVersion = manifest['runtime-version'] ?? 'n/a';
  } catch {
    // keep n/a
  }

  // L3 contract surface + privacy summary (non-secret, filled only from the
  // actual deployment identifiers above — never fabricated).
  const l3EvidenceExtra = [
    '### Contract Surface (Level 3)',
    '',
    '- Circuit: `proveIncome(requiredMonthlyIncome: Uint<32>, applicationId: Bytes<32>)`',
    '- Ledger: `proofCount: Field`, `usedNullifiers: Map<Bytes<32>, Boolean>`',
    '- Private witnesses: `income(): Uint<32>`',
    '',
    '### Privacy & Replay Protection',
    '',
    '- Income is a private witness; only `requiredMonthlyIncome` and `applicationId`',
    '  are public circuit arguments. Exact income is never on-chain.',
    '- One deterministic, income/threshold-independent nullifier per claim:',
    '  `persistentHash(["proofly:claim:", applicationId])`.',
    '- An Application ID is SINGLE-USE: re-claiming the same `applicationId` is',
    '  rejected in-circuit with "Claim already used for this application", even',
    '  with a different threshold or income.',
    '- Cross-application claims are independent: each `applicationId` has its own',
    '  nullifier scope, so different applications never block each other.',
    '- No `applicantId` witness and no device/browser identity exist: the only',
    '  private input is the exact `income()`.',
    '',
    '### Security / Secrets',
    '',
    'The deployer seed and all private credentials are intentionally NOT',
    'included. Reuses the existing dedicated L2 deployer wallet (same seed); no',
    'new credentials were generated for this deployment.',
    '',
  ];

  writeEvidence({
    level: 'L3',
    contractAddress,
    txId,
    blockHeight,
    blockHash,
    network: ALLOWED_NETWORK_ID,
    deployedAt: new Date().toISOString(),
    compilerVersion,
    runtimeVersion,
    deployerAddress: address.toString(),
    additionalMarkdown: l3EvidenceExtra,
  });

  console.log('  ── Deployment Result ────────────────────────────────────────\n');
  console.log(`  Contract address : ${contractAddress}`);
  console.log(`  Transaction ID   : ${txId}`);
  console.log(`  Block height     : ${blockHeight ?? 'n/a'}`);
  console.log(`  Block hash       : ${blockHash ?? 'n/a'}`);
  console.log('\n  ── Next Steps ───────────────────────────────────────────────\n');
  console.log('  1. The contract address is now in docs/evidence/DEPLOYMENT.md.');
  console.log('  2. Set VITE_CONTRACT_ADDRESS in frontend/.env');
  console.log('     (the frontend reads it via frontend/src/config.ts).');
  console.log('  3. Rebuild the frontend: npm run build:frontend');
  console.log('  4. Deploy frontend/dist to Netlify (static only).\n');

  await walletCtx.wallet.stop();
  console.log('─── Deployment complete ───────────────────────────────────────\n');
}

// ─── Entry ─────────────────────────────────────────────────────────────────────
main().catch((err) => {
  console.error(err);
  process.exit(1);
});