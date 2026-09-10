/**
 * Proofly — verify the compiled Compact contract artifacts exist.
 *
 * The generated artifacts under `contracts/managed/proofly` are gitignored and
 * never committed (fresh clones have none), so every command that depends on
 * them must fail fast with an actionable message instead of an obscure error.
 *
 * Used through npm lifecycle hooks:
 *   npm test            → pretest            → npm run check:compiled
 *   npm run build       → prebuild           → npm run check:compiled
 *   npm run copy-zk-assets → precopy-zk-assets → npm run check:compiled
 *   npm run dev:frontend → predev:frontend   → npm run check:compiled
 *   npm run build:frontend → prebuild:frontend → npm run check:compiled
 *
 * Run `npm run compile` (requires the Compact CLI, toolchain 0.31.1) to
 * regenerate these artifacts.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANAGED = resolve(__dirname, '..', 'contracts', 'managed', 'proofly');

const REQUIRED = [
  'compiler/contract-info.json',
  'contract/index.js',
  'contract/index.d.ts',
  'keys/proveIncome.prover',
  'keys/proveIncome.verifier',
  'zkir/proveIncome.bzkir',
  'zkir/proveIncome.zkir',
];

const missing = REQUIRED.filter((rel) => !existsSync(resolve(MANAGED, rel)));

if (missing.length > 0) {
  console.error('[check-compiled] Missing compiled contract artifacts:');
  for (const rel of missing) {
    console.error(`  - contracts/managed/proofly/${rel}`);
  }
  console.error(
    '[check-compiled] Generated artifacts are gitignored, so a fresh clone has none.',
  );
  console.error('[check-compiled] Fix: run  npm run compile');
  console.error(
    '[check-compiled]   (requires the Compact CLI with the 0.31.1 toolchain selected)',
  );
  process.exit(1);
}