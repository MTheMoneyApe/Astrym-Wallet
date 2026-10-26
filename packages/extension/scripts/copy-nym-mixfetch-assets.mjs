/**
 * Copy official @nymproject/mix-fetch runtime assets into
 * packages/extension/public/nym-mixfetch/ for Vite → dist packaging.
 *
 * Layout MUST keep index.js, web-worker-0.js, and both WASM files as siblings
 * (official client resolves via import.meta.url). No SPP assets.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_ROOT = resolve(__dirname, '..');
const WALLET_CORE_ROOT = resolve(EXTENSION_ROOT, '../wallet-core');
const DEST_ROOT = join(EXTENSION_ROOT, 'public', 'nym-mixfetch');

const EXPECTED_NAME = '@nymproject/mix-fetch';
const EXPECTED_VERSION = '1.4.2';

/** Keep in sync with src/nym-offscreen/assetManifest.ts */
const REQUIRED_FILES = [
  'index.js',
  'web-worker-0.js',
  'go_conn.wasm',
  'mix_fetch_wasm_bg.wasm',
  'package.json',
];

function fail(message) {
  console.error(`[copy-nym-mixfetch-assets] ERROR: ${message}`);
  process.exit(1);
}

function resolvePkgRoot() {
  const candidates = [];
  candidates.push(join(WALLET_CORE_ROOT, 'node_modules', '@nymproject', 'mix-fetch'));
  try {
    const requireFromWallet = createRequire(join(WALLET_CORE_ROOT, 'package.json'));
    candidates.push(dirname(requireFromWallet.resolve(`${EXPECTED_NAME}/package.json`)));
  } catch {
    /* optional */
  }
  try {
    const requireFromExt = createRequire(join(EXTENSION_ROOT, 'package.json'));
    candidates.push(dirname(requireFromExt.resolve(`${EXPECTED_NAME}/package.json`)));
  } catch {
    /* optional */
  }

  for (const c of candidates) {
    if (existsSync(join(c, 'package.json')) && existsSync(join(c, 'index.js'))) {
      return c;
    }
  }
  fail(`Could not resolve ${EXPECTED_NAME}@${EXPECTED_VERSION}`);
}

const srcRoot = resolvePkgRoot();
const pkg = JSON.parse(readFileSync(join(srcRoot, 'package.json'), 'utf8'));
if (pkg.name !== EXPECTED_NAME) {
  fail(`Unexpected package name: ${pkg.name}`);
}
if (pkg.version !== EXPECTED_VERSION) {
  fail(`Unexpected mix-fetch version ${pkg.version}; expected ${EXPECTED_VERSION}`);
}

rmSync(DEST_ROOT, { recursive: true, force: true });
mkdirSync(DEST_ROOT, { recursive: true });

for (const file of REQUIRED_FILES) {
  const from = join(srcRoot, file);
  if (!existsSync(from)) fail(`Missing required asset: ${file}`);
  copyFileSync(from, join(DEST_ROOT, file));
}

/** Sanity: worker URL resolution comment in packaged index.js */
const indexJs = readFileSync(join(DEST_ROOT, 'index.js'), 'utf8');
if (!indexJs.includes("web-worker-0.js")) {
  fail('Packaged index.js does not reference web-worker-0.js (import.meta.url layout broken)');
}
const workerJs = readFileSync(join(DEST_ROOT, 'web-worker-0.js'), 'utf8');
if (!workerJs.includes('mix_fetch_wasm_bg.wasm') || !workerJs.includes('go_conn.wasm')) {
  fail('Packaged web-worker-0.js missing WASM import.meta.url references');
}

writeFileSync(
  join(DEST_ROOT, 'NYM_MIXFETCH_ASSET_META.json'),
  JSON.stringify(
    {
      managedBy: 'solanym-extension-copy-nym-mixfetch-assets',
      package: EXPECTED_NAME,
      version: EXPECTED_VERSION,
      files: REQUIRED_FILES,
      resolution: 'import.meta.url siblings under nym-mixfetch/',
      bootstrapApi: ['https://validator.nymtech.net'],
      copiedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);

console.log(
  `[copy-nym-mixfetch-assets] Copied ${REQUIRED_FILES.length} files → public/nym-mixfetch/`,
);
