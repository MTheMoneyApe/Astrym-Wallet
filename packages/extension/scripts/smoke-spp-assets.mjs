/**
 * Fase 1 — Smoke-test packaged SPP assets under dist/spp/ (post Vite build)
 * or under public/spp/ when SPP_SMOKE_ROOT is set / --public flag.
 *
 * Usage (from packages/extension):
 *   node scripts/smoke-spp-assets.mjs
 *   node scripts/smoke-spp-assets.mjs --public
 *   SPP_SMOKE_ROOT=path node scripts/smoke-spp-assets.mjs
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_ROOT = resolve(__dirname, '..');

const EXPECTED_VERSION = '0.2.1';
const EXPECTED_NAME = 'stellar-private-payments';
const MANAGED_BY = 'solanym-extension-copy-spp-assets';
const META_NAME = 'SPP_ASSET_META.json';
const PROFILE_FULL = 'full';

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

/** @returns {never} */
function fail(message) {
  console.error(`[smoke-spp-assets] FAIL: ${message}`);
  process.exit(1);
}

function toPosix(p) {
  return p.split(sep).join('/');
}

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
 * @param {string[]} argv
 */
function resolveSmokeRoot(argv) {
  if (process.env.SPP_SMOKE_ROOT) {
    return resolve(process.env.SPP_SMOKE_ROOT);
  }
  if (argv.includes('--public')) {
    return join(EXTENSION_ROOT, 'public', 'spp');
  }
  return join(EXTENSION_ROOT, 'dist', 'spp');
}

/**
 * @param {string} root
 * @param {string} rel
 */
function assertNonEmptyFile(root, rel) {
  const full = join(root, ...rel.split('/'));
  if (!existsSync(full)) fail(`Missing required asset: ${rel} (under ${root})`);
  const st = statSync(full);
  if (!st.isFile() || st.size <= 0) fail(`Asset empty or not a file: ${rel}`);
  return { full, size: st.size };
}

async function main() {
  const root = resolveSmokeRoot(process.argv.slice(2));
  if (!existsSync(root)) {
    fail(
      `SPP asset root not found: ${root}. Run copy-spp-assets then extension build, or pass --public.`,
    );
  }

  const metaPath = join(root, META_NAME);
  if (!existsSync(metaPath)) fail(`Missing ${META_NAME} under ${root}`);

  let meta;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch (e) {
    fail(`Invalid ${META_NAME}: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (meta.managedBy !== MANAGED_BY) {
    fail(`${META_NAME}.managedBy expected ${MANAGED_BY}, got ${JSON.stringify(meta.managedBy)}`);
  }
  if (meta.name !== EXPECTED_NAME) {
    fail(`${META_NAME}.name expected ${EXPECTED_NAME}, got ${JSON.stringify(meta.name)}`);
  }
  if (meta.version !== EXPECTED_VERSION) {
    fail(`${META_NAME}.version expected ${EXPECTED_VERSION}, got ${JSON.stringify(meta.version)}`);
  }
  if (meta.profile !== PROFILE_FULL) {
    fail(`${META_NAME}.profile expected ${PROFILE_FULL}, got ${JSON.stringify(meta.profile)}`);
  }
  if (!Array.isArray(meta.files) || meta.files.length === 0) {
    fail(`${META_NAME}.files must be a non-empty array`);
  }

  // Layout checks
  for (const rel of REQUIRED_PATHS) {
    assertNonEmptyFile(root, rel);
  }

  const storageWorker = readFileSync(join(root, 'dist/workers/storage-worker.js'), 'utf8');
  if (!storageWorker.includes('storage-worker-module')) {
    fail('dist/workers/storage-worker.js does not reference storage-worker-module');
  }
  const proverWorker = readFileSync(join(root, 'dist/workers/prover-worker.js'), 'utf8');
  if (!proverWorker.includes('circuits')) {
    fail('dist/workers/prover-worker.js does not reference circuits base URL');
  }
  const facade = readFileSync(join(root, 'js/index.js'), 'utf8');
  if (!facade.includes('../dist/workers/storage-worker.js')) {
    fail('js/index.js missing import.meta.url worker path to ../dist/workers/storage-worker.js');
  }

  const lock = JSON.parse(readFileSync(join(root, 'dist/circuits/circuits.json'), 'utf8'));
  /** @type {string[]} */
  const circuitIds = [];
  for (const [key, value] of Object.entries(lock)) {
    if (key === 'version' || key === 'meta') continue;
    if (!value || typeof value !== 'object') continue;
    circuitIds.push(key);
    for (const artifact of [`${key}.r1cs`, `${key}.graph.bin`, `${key}_proving_key.bin`]) {
      assertNonEmptyFile(root, `dist/circuits/${artifact}`);
    }
  }
  if (circuitIds.length === 0) fail('circuits.json contained no circuit entries');

  // Meta inventory must match on-disk (excluding meta itself)
  const onDisk = listFilesRecursive(root).filter((p) => p !== META_NAME);
  const metaPaths = new Set(meta.files.map((/** @type {{ path: string }} */ f) => toPosix(f.path)));
  for (const p of onDisk) {
    if (!metaPaths.has(p)) fail(`On-disk file not listed in ${META_NAME}: ${p}`);
  }
  for (const p of metaPaths) {
    if (!onDisk.includes(p)) fail(`${META_NAME} lists missing file: ${p}`);
  }

  // Spot-check SHA-256 for required core assets against meta
  const metaByPath = new Map(
    meta.files.map((/** @type {{ path: string, sha256: string, size: number }} */ f) => [f.path, f]),
  );
  for (const rel of REQUIRED_PATHS) {
    const entry = metaByPath.get(rel);
    if (!entry) fail(`Meta missing required path entry: ${rel}`);
    const { full, size } = assertNonEmptyFile(root, rel);
    if (size !== entry.size) {
      fail(`Size mismatch for ${rel}: disk=${size} meta=${entry.size}`);
    }
    const digest = await sha256File(full);
    if (digest !== entry.sha256) {
      fail(`SHA-256 mismatch for ${rel}: disk=${digest} meta=${entry.sha256}`);
    }
  }

  // Forbidden leftovers
  const forbidden = onDisk.filter(
    (p) =>
      p.endsWith('.d.ts') ||
      p === 'dist/circuits/source-bundle.tar.gz' ||
      p === 'js/freighter.js' ||
      p.startsWith('js/types/'),
  );
  if (forbidden.length > 0) {
    fail(`Forbidden artifacts present:\n${forbidden.map((f) => `  - ${f}`).join('\n')}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        root,
        version: meta.version,
        profile: meta.profile,
        fileCount: meta.files.length,
        totalBytes: meta.totalBytes,
        circuitCount: circuitIds.length,
        checkedSha256: REQUIRED_PATHS.length,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  fail(err instanceof Error ? err.stack || err.message : String(err));
});
