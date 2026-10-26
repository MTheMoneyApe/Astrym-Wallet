/**
 * Assert packaged Nym mix-fetch assets exist (public/ or dist/).
 * Fails if worker/WASM siblings required by import.meta.url are missing.
 *
 * Usage (from packages/extension):
 *   node scripts/smoke-nym-mixfetch-assets.mjs
 *   node scripts/smoke-nym-mixfetch-assets.mjs --public
 *   node scripts/smoke-nym-mixfetch-assets.mjs --dist
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_ROOT = resolve(__dirname, '..');

const EXPECTED_NAME = '@nymproject/mix-fetch';
const EXPECTED_VERSION = '1.4.2';
const META_NAME = 'NYM_MIXFETCH_ASSET_META.json';
const REQUIRED_FILES = [
  'index.js',
  'web-worker-0.js',
  'go_conn.wasm',
  'mix_fetch_wasm_bg.wasm',
  'package.json',
];

function fail(message) {
  console.error(`[smoke-nym-mixfetch-assets] FAIL: ${message}`);
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const preferPublic = args.has('--public') || process.env.NYM_SMOKE_ROOT === 'public';
const preferDist = args.has('--dist') || (!preferPublic && existsSync(join(EXTENSION_ROOT, 'dist', 'nym-mixfetch')));

const root = preferPublic
  ? join(EXTENSION_ROOT, 'public', 'nym-mixfetch')
  : preferDist
    ? join(EXTENSION_ROOT, 'dist', 'nym-mixfetch')
    : join(EXTENSION_ROOT, 'public', 'nym-mixfetch');

if (!existsSync(root)) {
  fail(`Missing directory ${root} — run: pnpm copy:nym`);
}

const metaPath = join(root, META_NAME);
if (!existsSync(metaPath)) {
  fail(`Missing ${META_NAME} under ${root}`);
}

const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
if (meta.package !== EXPECTED_NAME) {
  fail(`Unexpected meta.package: ${meta.package}`);
}
if (meta.version !== EXPECTED_VERSION) {
  fail(`Unexpected meta.version: ${meta.version}`);
}

for (const file of REQUIRED_FILES) {
  const full = join(root, file);
  if (!existsSync(full)) fail(`Missing required asset: ${file}`);
  const st = statSync(full);
  if (!st.isFile() || st.size <= 0) fail(`Asset empty or not a file: ${file}`);
}

const indexJs = readFileSync(join(root, 'index.js'), 'utf8');
if (!indexJs.includes('web-worker-0.js')) {
  fail('index.js does not reference web-worker-0.js');
}
if (!indexJs.includes('createMixFetch')) {
  fail('index.js missing createMixFetch export surface');
}

const workerJs = readFileSync(join(root, 'web-worker-0.js'), 'utf8');
if (!workerJs.includes('mix_fetch_wasm_bg.wasm') || !workerJs.includes('go_conn.wasm')) {
  fail('web-worker-0.js missing WASM sibling references');
}

console.log(`[smoke-nym-mixfetch-assets] OK — ${root}`);
console.log(`[smoke-nym-mixfetch-assets] files=${REQUIRED_FILES.join(',')}`);
