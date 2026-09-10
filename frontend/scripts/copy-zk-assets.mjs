/**
 * Proofly — copy ZK assets and compiled contract into the frontend.
 *
 * Copies:
 *   1. compiled contract (index.js / index.d.ts) → frontend/src/compiled-contract.*
 *   2. ZK proving keys + zkIR → frontend/public/midnight/proofly (static serving)
 *
 * Mirrors the ShadowPass-V2 pipeline.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const MANAGED = resolve(ROOT, 'contracts/managed/proofly');
const COMPILED = resolve(ROOT, 'contracts/managed/proofly/contract');

const PUBLIC_ZK = resolve(ROOT, 'frontend/public/midnight/proofly');
const SRC_OUT = resolve(ROOT, 'frontend/src');

for (const dir of ['zkir', 'keys']) {
  const src = resolve(MANAGED, dir);
  const dest = resolve(PUBLIC_ZK, dir);
  if (!existsSync(src)) {
    console.error(`[copy-zk-assets] MISSING: ${src} — run \`npm run compile\` first`);
    process.exit(1);
  }
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[copy-zk-assets] ${dir} → ${dest}`);
}

for (const file of ['index.js', 'index.d.ts']) {
  const src = resolve(COMPILED, file);
  const dest = resolve(SRC_OUT, `compiled-contract.${file === 'index.js' ? 'js' : 'd.ts'}`);
  if (!existsSync(src)) {
    console.error(`[copy-zk-assets] MISSING contract: ${src}`);
    process.exit(1);
  }
  cpSync(src, dest);
  if (file === 'index.js') {
    const content = readFileSync(dest, 'utf8');
    const cleaned = content.replace(/\/\/# sourceMappingURL=.*\n?/g, '');
    writeFileSync(dest, cleaned, 'utf8');
  }
  console.log(`[copy-zk-assets] ${file} → ${dest}`);
}

console.log('[copy-zk-assets] Done.');