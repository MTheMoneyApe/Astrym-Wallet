/**
 * Fase 1 — Copy stellar-private-payments@0.2.1 runtime assets into
 * packages/extension/public/spp/ for Vite → dist/spp/ packaging.
 *
 * Source: packages/wallet-core/node_modules/stellar-private-payments only.
 * Never reads mv3-spike/vendor or prepare-vendor.mjs.
 *
 * Profile: full — Client.new requires circuitsBaseUrl + circuitLock; prover
 * loads .r1cs / .graph.bin / proving keys by circuit id. A reduced tree was
 * not verified safe for Client.new, so we ship the full circuits/ tree
 * (excluding source-bundle.tar.gz and .d.ts).
 *
 * Usage (from packages/extension):
 *   node scripts/copy-spp-assets.mjs
 */
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_ROOT = resolve(__dirname, '..');
const WALLET_CORE_ROOT = resolve(EXTENSION_ROOT, '../wallet-core');
const DEST_ROOT = join(EXTENSION_ROOT, 'public', 'spp');

const EXPECTED_NAME = 'stellar-private-payments';
const EXPECTED_VERSION = '0.2.1';
const PROFILE = 'full';
const MANAGED_BY = 'solanym-extension-copy-spp-assets';

const META_NAME = 'SPP_ASSET_META.json';

/** @returns {never} */
function fail(message) {
  console.error(`[copy-spp-assets] ERROR: ${message}`);
  process.exit(1);
}

function toPosix(p) {
  return p.split(sep).join('/');
}

/**
 * Resolve SDK package root robustly (Windows + CI / pnpm layouts).
 * @returns {string}
 */
function resolveSdkRoot() {
  const candidates = [];

  const direct = join(WALLET_CORE_ROOT, 'node_modules', EXPECTED_NAME);
  candidates.push(direct);

  try {
    const requireFromWallet = createRequire(join(WALLET_CORE_ROOT, 'package.json'));
    const pkgJson = requireFromWallet.resolve(`${EXPECTED_NAME}/package.json`);
    candidates.push(dirname(pkgJson));
  } catch {
    /* optional */
  }

  try {
    const requireFromExt = createRequire(join(EXTENSION_ROOT, 'package.json'));
    // May resolve via workspace → wallet-core dependency graph
    const pkgJson = requireFromExt.resolve(`${EXPECTED_NAME}/package.json`);
    candidates.push(dirname(pkgJson));
  } catch {
    /* optional — extension does not declare the SDK directly */
  }

  // pnpm virtual store symlink under wallet-core
  try {
    const pnpmDir = join(WALLET_CORE_ROOT, 'node_modules', '.pnpm');
    if (existsSync(pnpmDir)) {
      for (const entry of readdirSync(pnpmDir)) {
        if (!entry.startsWith(`${EXPECTED_NAME}@`)) continue;
        const nested = join(pnpmDir, entry, 'node_modules', EXPECTED_NAME);
        candidates.push(nested);
      }
    }
  } catch {
    /* optional */
  }

  const seen = new Set();
  for (const c of candidates) {
    const abs = resolve(c);
    if (seen.has(abs)) continue;
    seen.add(abs);
    const pkgPath = join(abs, 'package.json');
    if (existsSync(pkgPath)) return abs;
  }

  fail(
    `Could not resolve ${EXPECTED_NAME}@${EXPECTED_VERSION}. Tried:\n` +
      [...seen].map((p) => `  - ${p}`).join('\n'),
  );
}

/**
 * @param {string} filePath
 * @returns {Promise<string>}
 */
function sha256File(filePath) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

/**
 * @param {string} dir
 * @returns {string[]} posix-relative paths from dir
 */
function listFilesRecursive(dir) {
  /** @type {string[]} */
  const out = [];
  if (!existsSync(dir)) return out;

  /** @param {string} current */
  function walk(current) {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) out.push(toPosix(relative(dir, full)));
    }
  }
  walk(dir);
  return out.sort();
}

/**
 * Refuse to wipe destinations that contain unmanaged files.
 * @param {string} destRoot
 */
function assertDestinationSafeToReplace(destRoot) {
  if (!existsSync(destRoot)) return;

  const existing = listFilesRecursive(destRoot);
  if (existing.length === 0) return;

  const metaPath = join(destRoot, META_NAME);
  if (!existsSync(metaPath)) {
    fail(
      `Destination ${destRoot} already contains files but no ${META_NAME}. ` +
        `Refusing to delete unmanaged content. Remove the folder manually if intentional.\n` +
        `Files: ${existing.slice(0, 20).join(', ')}${existing.length > 20 ? '…' : ''}`,
    );
  }

  let meta;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch (e) {
    fail(`Cannot parse existing ${META_NAME}: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (meta?.managedBy !== MANAGED_BY) {
    fail(
      `Existing ${META_NAME} is not managed by ${MANAGED_BY} (got managedBy=${JSON.stringify(meta?.managedBy)}). Refusing to overwrite.`,
    );
  }

  /** @type {Set<string>} */
  const managed = new Set(
    Array.isArray(meta.files) ? meta.files.map((/** @type {{ path: string }} */ f) => toPosix(f.path)) : [],
  );
  managed.add(META_NAME);

  const unknown = existing.filter((p) => !managed.has(p));
  if (unknown.length > 0) {
    fail(
      `Destination contains unmanaged files — aborting without delete:\n` +
        unknown.map((u) => `  - ${u}`).join('\n'),
    );
  }
}

/**
 * @param {string} relPosix path under package root
 * @returns {boolean}
 */
function shouldExclude(relPosix) {
  if (relPosix.endsWith('.d.ts')) return true;
  if (relPosix === 'dist/circuits/source-bundle.tar.gz') return true;
  if (relPosix === 'js/freighter.js') return true;
  if (relPosix === 'js/types' || relPosix.startsWith('js/types/')) return true;
  return false;
}

/**
 * @param {string} srcRoot
 * @param {string} destRoot
 * @param {string} subDir e.g. 'js' | 'dist'
 * @returns {Promise<{ path: string, size: number, sha256: string }[]>}
 */
async function copyTreeFiltered(srcRoot, destRoot, subDir) {
  const srcBase = join(srcRoot, subDir);
  if (!existsSync(srcBase)) fail(`Missing source directory: ${srcBase}`);

  const files = listFilesRecursive(srcBase);
  /** @type {{ path: string, size: number, sha256: string }[]} */
  const copied = [];

  for (const relUnderSub of files) {
    const relPosix = toPosix(join(subDir, relUnderSub).split(sep).join('/'));
    if (shouldExclude(relPosix)) continue;

    const srcFile = join(srcRoot, ...relPosix.split('/'));
    const destFile = join(destRoot, ...relPosix.split('/'));
    mkdirSync(dirname(destFile), { recursive: true });
    copyFileSync(srcFile, destFile);

    const size = statSync(destFile).size;
    if (size <= 0) fail(`Copied file is empty: ${relPosix}`);
    const sha256 = await sha256File(destFile);
    copied.push({ path: relPosix, size, sha256 });
  }

  return copied;
}

/** Minimum files required for MV3 import.meta.url layout + Client.new (full). */
const REQUIRED_PATHS = Object.freeze([
  'js/index.js',
  'dist/stellar_private_payments_web.js',
  'dist/stellar_private_payments_web_bg.wasm',
  'dist/workers/storage-worker.js',
  'dist/workers/storage-worker-module.js',
  'dist/workers/storage-worker-module_bg.wasm',
  'dist/workers/prover-worker.js',
  'dist/workers/prover-worker-module.js',
  'dist/workers/prover-worker-module_bg.wasm',
  'dist/circuits/circuits.json',
  'dist/LICENSE.txt',
]);

async function main() {
  const sdkRoot = resolveSdkRoot();
  const pkgPath = join(sdkRoot, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  if (pkg.name !== EXPECTED_NAME) {
    fail(`Package name mismatch at ${pkgPath}: expected ${EXPECTED_NAME}, got ${pkg.name}`);
  }
  if (pkg.version !== EXPECTED_VERSION) {
    fail(`Package version mismatch at ${pkgPath}: expected ${EXPECTED_VERSION}, got ${pkg.version}`);
  }

  // Guard: never copy from spike vendor
  const spikeVendorMarker = join(
    WALLET_CORE_ROOT,
    'tests/stellar/spp/harness/mv3-spike/vendor',
  );
  if (resolve(sdkRoot).startsWith(resolve(spikeVendorMarker))) {
    fail('Refusing to use mv3-spike/vendor as SDK source');
  }

  assertDestinationSafeToReplace(DEST_ROOT);

  if (existsSync(DEST_ROOT)) {
    rmSync(DEST_ROOT, { recursive: true, force: true });
  }
  mkdirSync(DEST_ROOT, { recursive: true });

  const jsFiles = await copyTreeFiltered(sdkRoot, DEST_ROOT, 'js');
  const distFiles = await copyTreeFiltered(sdkRoot, DEST_ROOT, 'dist');
  const files = [...jsFiles, ...distFiles].sort((a, b) => a.path.localeCompare(b.path));

  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const req of REQUIRED_PATHS) {
    if (!byPath.has(req)) fail(`Required asset missing after copy: ${req}`);
  }

  // Full profile: every circuits.json circuit id must have on-disk artifacts
  const lockPath = join(DEST_ROOT, 'dist', 'circuits', 'circuits.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  /** @type {string[]} */
  const circuitIds = [];
  for (const [key, value] of Object.entries(lock)) {
    if (key === 'version' || key === 'meta') continue;
    if (!value || typeof value !== 'object') continue;
    circuitIds.push(key);
    for (const artifact of [
      `${key}.r1cs`,
      `${key}.graph.bin`,
      `${key}_proving_key.bin`,
    ]) {
      const rel = `dist/circuits/${artifact}`;
      if (!byPath.has(rel)) fail(`Full profile missing circuit artifact: ${rel}`);
    }
  }

  const totalBytes = files.reduce((n, f) => n + f.size, 0);

  const meta = {
    managedBy: MANAGED_BY,
    name: EXPECTED_NAME,
    version: EXPECTED_VERSION,
    profile: PROFILE,
    profileReason:
      'full: Client.new requires circuitsBaseUrl + circuitLock; prover loads r1cs/graph/proving keys. Reduced (circuits.json-only) profile was not verified safe for Client.new; matches laboratory RO-1 vendor tree minus .d.ts/source-bundle/freighter/types.',
    resolvedFrom: sdkRoot,
    copiedAt: new Date().toISOString(),
    destination: DEST_ROOT,
    exclusions: ['.d.ts', 'dist/circuits/source-bundle.tar.gz', 'js/freighter.js', 'js/types/**'],
    circuitIds,
    fileCount: files.length,
    totalBytes,
    files,
  };

  writeFileSync(join(DEST_ROOT, META_NAME), JSON.stringify(meta, null, 2) + '\n', 'utf8');

  console.log(
    JSON.stringify(
      {
        ok: true,
        profile: PROFILE,
        version: EXPECTED_VERSION,
        destination: DEST_ROOT,
        resolvedFrom: sdkRoot,
        fileCount: files.length,
        totalBytes,
        totalMB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
        circuitCount: circuitIds.length,
        meta: META_NAME,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  fail(err instanceof Error ? err.stack || err.message : String(err));
});
