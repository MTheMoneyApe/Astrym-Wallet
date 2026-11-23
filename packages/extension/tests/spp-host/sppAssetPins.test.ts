import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { candidateRoots, defaultSppBuildRoot } from '../../scripts/copy-spp-assets.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const extension = join(repo, 'packages/extension');
const manifestPath = join(
  repo,
  'packages/wallet-core/src/stellar/spp/nethermind/spp-runtime-manifest.json',
);
const commit = 'e6ce95c2a71ed6313f78bb19cfdd0de1d9663120';

function sha(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

const ENV_KEYS = ['SPP_BUILD_ROOT', 'SPP_SDK_ROOT', 'XDG_CACHE_HOME'] as const;

describe('spp cache pins and dist smoke', () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    saved.clear();
    for (const key of ENV_KEYS) saved.set(key, process.env[key]);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('defaults the asset root to the user cache and honors SPP_BUILD_ROOT', () => {
    delete process.env.SPP_BUILD_ROOT;
    delete process.env.SPP_SDK_ROOT;
    delete process.env.XDG_CACHE_HOME;
    expect(defaultSppBuildRoot()).toBe(join(homedir(), '.cache', 'astrym', 'spp-path-a'));
    expect(candidateRoots().join('\n')).not.toContain('/tmp/spp-path-a/cache');

    process.env.XDG_CACHE_HOME = '/var/cache/tester';
    expect(defaultSppBuildRoot()).toBe('/var/cache/tester/astrym/spp-path-a');
    expect(candidateRoots()).toContain('/var/cache/tester/astrym/spp-path-a/stellar-private-payments/sdk/web');

    process.env.SPP_BUILD_ROOT = '/explicit/spp-build';
    expect(candidateRoots()).toContain('/explicit/spp-build/stellar-private-payments/sdk/web');
    expect(candidateRoots().join('\n')).not.toContain('/tmp/spp-path-a/cache');

    const script = readFileSync(join(repo, 'scripts/prepare-spp-runtime.sh'), 'utf8');
    const probe = spawnSync('bash', ['-c', `
      set -euo pipefail
      unset SPP_BUILD_ROOT
      export HOME=/home/tester
      export XDG_CACHE_HOME=/var/cache/tester
      eval "$(sed -n '/^spp_default_build_root()/,/^}/p' scripts/prepare-spp-runtime.sh)"
      spp_default_build_root
      unset XDG_CACHE_HOME
      spp_default_build_root
    `], { cwd: repo, encoding: 'utf8' });
    expect(probe.status, probe.stderr).toBe(0);
    expect(probe.stdout).toBe(
      '/var/cache/tester/astrym/spp-path-a\n/home/tester/.cache/astrym/spp-path-a\n',
    );
    expect(script).not.toContain('SPP_BUILD_ROOT:-/tmp/spp-path-a/cache');
  });

  it('rejects a tampered cache against the versioned manifest', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const expected = manifest.files['js/index.js'];
    expect(expected).toEqual({
      sha256: 'c149a8eff5345f7685b40e84deeb94ce49aec5080bbf022b754b57e78af1d3e1',
      size: 9336,
    });
    expect(manifest.files['dist/circuits/keyOwnership.r1cs'].sha256).toMatch(/^[0-9a-f]{64}$/);
    const root = mkdtempSync(join(tmpdir(), 'spp-tamper-'));
    const dest = mkdtempSync(join(tmpdir(), 'spp-dest-'));
    try {
      mkdirSync(join(root, 'js'), { recursive: true });
      writeFileSync(join(root, 'package.json'), JSON.stringify({
        name: 'stellar-private-payments',
        version: '0.2.1',
      }));
      writeFileSync(join(root, 'SPP_SOURCE_PROVENANCE.json'), JSON.stringify({ sourceCommit: commit }));
      writeFileSync(join(root, 'js/index.js'), 'tampered\n');
      const result = spawnSync(process.execPath, ['scripts/copy-spp-assets.mjs'], {
        cwd: extension,
        env: { ...process.env, SPP_SDK_ROOT: root, SPP_ASSET_DEST: dest },
        encoding: 'utf8',
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('js/index.js');
      expect(result.stderr).toContain(expected.sha256);
      expect(result.stderr).toContain('versioned manifest');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(dest, { recursive: true, force: true });
    }
  });

  it('rejects an unpinned copied file absent from the versioned manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'spp-unpinned-'));
    const dest = mkdtempSync(join(tmpdir(), 'spp-unpinned-dest-'));
    try {
      mkdirSync(join(root, 'js'), { recursive: true });
      writeFileSync(join(root, 'package.json'), JSON.stringify({
        name: 'stellar-private-payments',
        version: '0.2.1',
      }));
      writeFileSync(join(root, 'SPP_SOURCE_PROVENANCE.json'), JSON.stringify({ sourceCommit: commit }));
      writeFileSync(join(root, 'js/index.js'), 'tampered\n');
      writeFileSync(join(root, 'js/unpinned-injected.js'), 'unpinned\n');
      const result = spawnSync(process.execPath, ['scripts/copy-spp-assets.mjs'], {
        cwd: extension,
        env: { ...process.env, SPP_SDK_ROOT: root, SPP_ASSET_DEST: dest },
        encoding: 'utf8',
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('unpinned js/unpinned-injected.js');
      expect(result.stderr).toContain('versioned manifest');
      expect(result.stderr).toContain('js/index.js');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(dest, { recursive: true, force: true });
    }
  });

  it('smokes the built tree and refuses public/', () => {
    const root = mkdtempSync(join(tmpdir(), 'spp-smoke-'));
    const built = join(root, 'built');
    const manifestFile = join(root, 'manifest.json');
    const indexBody = "import '../dist/workers/storage-worker.js';\n";
    const files = {
      'js/index.js': indexBody,
      'dist/stellar_private_payments_web.js': 'glue',
      'dist/stellar_private_payments_web_bg.wasm': 'wasm',
      'dist/workers/storage-worker.js': 'import storage-worker-module;\n',
      'dist/workers/storage-worker-module.js': 'mod',
      'dist/workers/storage-worker-module_bg.wasm': 'sw',
      'dist/workers/prover-worker.js': 'circuits base\n',
      'dist/workers/prover-worker-module.js': 'pm',
      'dist/workers/prover-worker-module_bg.wasm': 'pw',
      'dist/circuits/circuits.json': JSON.stringify({ version: '0.7', keyOwnership: { setup: 'local' } }),
      'dist/circuits/keyOwnership.r1cs': 'r',
      'dist/circuits/keyOwnership.graph.bin': 'g',
      'dist/circuits/keyOwnership_proving_key.bin': 'k',
      'dist/LICENSE.txt': 'license',
    };
    try {
      const metaFiles = [];
      for (const [rel, body] of Object.entries(files)) {
        const full = join(built, rel);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, body);
        metaFiles.push({ path: rel, size: Buffer.byteLength(body), sha256: sha(body) });
      }
      writeFileSync(join(built, 'SPP_ASSET_META.json'), JSON.stringify({
        managedBy: 'solanym-extension-copy-spp-assets',
        name: 'stellar-private-payments',
        sourceCommit: commit,
        profile: 'full',
        files: metaFiles,
      }));
      writeFileSync(manifestFile, JSON.stringify({
        sourceCommit: commit,
        files: {
          'js/index.js': {
            sha256: sha(indexBody),
            size: Buffer.byteLength(indexBody),
          },
        },
      }));
      const smoked = spawnSync(process.execPath, ['scripts/smoke-spp-assets.mjs'], {
        cwd: extension,
        env: { ...process.env, SPP_SMOKE_ROOT: built, SPP_SMOKE_MANIFEST: manifestFile },
        encoding: 'utf8',
      });
      expect(smoked.status, smoked.stderr).toBe(0);
      const pub = spawnSync(process.execPath, ['scripts/smoke-spp-assets.mjs', '--public'], {
        cwd: extension,
        encoding: 'utf8',
      });
      expect(pub.status).not.toBe(0);
      expect(pub.stderr).toMatch(/public\/ is not the packaged dist/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
