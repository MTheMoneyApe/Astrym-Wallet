import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const extension = join(repo, 'packages/extension');
const manifestPath = join(
  repo,
  'packages/wallet-core/src/stellar/spp/nethermind/spp-runtime-manifest.json',
);
const commit = 'e6ce95c2a71ed6313f78bb19cfdd0de1d9663120';

function sha(body) {
  return createHash('sha256').update(body).digest('hex');
}

describe('spp cache pins and dist smoke', () => {
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
