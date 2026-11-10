/**
 * Copy the SPP runtime built by scripts/prepare-spp-runtime.sh into
 * packages/extension/public/spp/ for Vite → dist/spp/ packaging.
 *
 * The npm tarball stellar-private-payments@0.2.1 is not this runtime.
 * If SPP_SOURCE_PROVENANCE.json is missing, this script runs the prepare
 * script once, then copies. It does not fall back to node_modules.
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
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_ROOT = resolve(__dirname, '..');
const WALLET_CORE_ROOT = resolve(EXTENSION_ROOT, '../wallet-core');
const MANIFEST_PATH = join(
  WALLET_CORE_ROOT,
  'src/stellar/spp/nethermind/spp-runtime-manifest.json',
);
const DEST_ROOT = process.env.SPP_ASSET_DEST
  ? resolve(process.env.SPP_ASSET_DEST)
  : join(EXTENSION_ROOT, 'public', 'spp');

const EXPECTED_NAME = 'stellar-private-payments';
const SOURCE_COMMIT = 'e6ce95c2a71ed6313f78bb19cfdd0de1d9663120';
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
function repoRoot() {
  return resolve(EXTENSION_ROOT, '../..');
}

function candidateRoots() {
  const buildRoot = process.env.SPP_BUILD_ROOT;
  return [
    process.env.SPP_SDK_ROOT,
    buildRoot ? join(buildRoot, 'stellar-private-payments/sdk/web') : '',
    join(repoRoot(), '.cache/spp-upstream/stellar-private-payments/sdk/web'),
  ].filter((value) => typeof value === 'string' && value.length > 0);
}

function assertVersionedPins(sdkRoot) {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  if (manifest.sourceCommit !== SOURCE_COMMIT) {
    fail(`Versioned manifest sourceCommit is not ${SOURCE_COMMIT}`);
  }
  const problems = [];
  for (const [rel, expect] of Object.entries(manifest.files ?? {})) {
    const file = join(sdkRoot, ...rel.split('/'));
    if (!existsSync(file)) {
      problems.push(`missing ${rel}; expected sha256 ${expect.sha256} from the versioned manifest`);
      continue;
    }
    const data = readFileSync(file);
    const sha256 = createHash('sha256').update(data).digest('hex');
    if (sha256 !== expect.sha256 || data.length !== expect.size) {
      problems.push(
        `mismatch ${rel}: got ${sha256} ${data.length} expected ${expect.sha256} ${expect.size} from the versioned manifest`,
      );
    }
  }
  if (problems.length > 0) {
    fail(
      `Refusing cache. npm stellar-private-payments@0.2.1 is not this runtime.\n${problems.join('\n')}`,
    );
  }
}

function acceptProvenance(candidate) {
  const abs = resolve(candidate);
  const pkgPath = join(abs, 'package.json');
  const provenancePath = join(abs, 'SPP_SOURCE_PROVENANCE.json');
  if (!existsSync(pkgPath) || !existsSync(provenancePath)) return null;
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
  if (provenance.sourceCommit !== SOURCE_COMMIT) {
    fail(
      `SPP source commit ${JSON.stringify(provenance.sourceCommit)} is not ${SOURCE_COMMIT}. ` +
        'npm stellar-private-payments@0.2.1 is not this runtime.',
    );
  }
  assertVersionedPins(abs);
  return abs;
}

function findBuiltSdk() {
  for (const candidate of candidateRoots()) {
    const accepted = acceptProvenance(candidate);
    if (accepted) return accepted;
  }
  return null;
}

function prepareRuntime() {
  const script = join(repoRoot(), 'scripts/prepare-spp-runtime.sh');
  if (!existsSync(script)) {
    fail(`Missing ${script}. npm stellar-private-payments@0.2.1 is not accepted.`);
  }
  console.log('[copy-spp-assets] no provenance yet; running scripts/prepare-spp-runtime.sh');
  const result = spawnSync('bash', [script], {
    cwd: repoRoot(),
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    fail(
      `prepare-spp-runtime.sh exited ${String(result.status)}. ` +
        'npm stellar-private-payments@0.2.1 is not accepted.',
    );
  }
}

function resolveSdkRoot() {
  const existing = findBuiltSdk();
  if (existing) return existing;
  prepareRuntime();
  const built = findBuiltSdk();
  if (built) return built;
  fail(
    'prepare-spp-runtime.sh finished without SPP_SOURCE_PROVENANCE.json for ' +
      `${SOURCE_COMMIT}. npm stellar-private-payments@0.2.1 is not accepted.`,
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
const WEB_PROFILE = process.argv.includes('--web');

function shouldExclude(relPosix) {
  if (relPosix.endsWith('.d.ts')) return true;
  if (relPosix === 'dist/circuits/source-bundle.tar.gz') return true;
  if (relPosix === 'js/freighter.js') return true;
  if (relPosix === 'js/types' || relPosix.startsWith('js/types/')) return true;
  // Public web deploys cannot ship the ~272MB proving-key tree.
  // WASM, workers, and circuits.json still copy so the host can boot.
  if (
    WEB_PROFILE &&
    relPosix.startsWith('dist/circuits/') &&
    relPosix !== 'dist/circuits/circuits.json'
  ) {
    return true;
  }
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
  const provenance = JSON.parse(readFileSync(join(sdkRoot, 'SPP_SOURCE_PROVENANCE.json'), 'utf8'));
  if (provenance.sourceCommit !== SOURCE_COMMIT) {
    fail(`Refusing runtime whose sourceCommit is not ${SOURCE_COMMIT}`);
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

  const staging = `${DEST_ROOT}.staging-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  const jsFiles = await copyTreeFiltered(sdkRoot, staging, 'js');
  const distFiles = await copyTreeFiltered(sdkRoot, staging, 'dist');
  const files = [...jsFiles, ...distFiles].sort((a, b) => a.path.localeCompare(b.path));

  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const req of REQUIRED_PATHS) {
    if (!byPath.has(req)) fail(`Required asset missing after copy: ${req}`);
  }

  if (WEB_PROFILE) {
    console.log('[copy-spp-assets] web profile: runtime without proving-key binaries');
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
    if (WEB_PROFILE) continue;
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
    version: pkg.version,
    sourceCommit: SOURCE_COMMIT,
    runtimeNote: 'Built from the pinned Nethermind commit. The npm 0.2.1 tarball is not this runtime even if package.json version matches.',
    profile: WEB_PROFILE ? 'web-runtime' : PROFILE,
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

  writeFileSync(join(staging, META_NAME), JSON.stringify(meta, null, 2) + '\n', 'utf8');
  const backup = `${DEST_ROOT}.bak-${process.pid}`;
  if (existsSync(DEST_ROOT)) renameSync(DEST_ROOT, backup);
  try {
    renameSync(staging, DEST_ROOT);
  } catch (cause) {
    if (existsSync(backup) && !existsSync(DEST_ROOT)) renameSync(backup, DEST_ROOT);
    throw cause;
  }
  if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });

  console.log(
    JSON.stringify(
      {
        ok: true,
        profile: WEB_PROFILE ? 'web-runtime' : PROFILE,
        version: pkg.version,
        sourceCommit: SOURCE_COMMIT,
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
