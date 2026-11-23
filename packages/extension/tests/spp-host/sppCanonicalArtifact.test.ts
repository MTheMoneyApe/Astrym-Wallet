import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const script = join(repo, 'scripts/verify-spp-canonical-artifact.mjs');
const sourceCommit = 'e6ce95c2a71ed6313f78bb19cfdd0de1d9663120';
const wasmRel = 'dist/stellar_private_payments_web_bg.wasm';

function sha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

function writeFixture(body: Buffer): { root: string; manifestPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'spp-canonical-'));
  const manifestPath = join(root, 'manifest.json');
  const artifact = join(root, 'artifact');
  mkdirSync(artifact);
  writeFileSync(join(artifact, 'stellar_private_payments_web_bg.wasm'), body);
  writeFileSync(join(artifact, 'canonical-artifact.json'), JSON.stringify({
    sourceCommit,
    files: {
      [wasmRel]: 'stellar_private_payments_web_bg.wasm',
    },
  }));
  writeFileSync(manifestPath, JSON.stringify({
    sourceCommit,
    files: {
      [wasmRel]: {
        sha256: sha256(body),
        size: body.length,
      },
    },
  }));
  return { root, manifestPath };
}

function verify(artifact: string, manifestPath: string) {
  return spawnSync(process.execPath, [
    script,
    '--artifact',
    artifact,
    '--manifest',
    manifestPath,
  ], { encoding: 'utf8' });
}

describe('canonical SPP artifact verification', () => {
  it('passes when the canonical artifact matches the pinned sha256', () => {
    const body = Buffer.from('canonical-spp-wasm-bytes');
    const { root, manifestPath } = writeFixture(body);
    try {
      const result = verify(join(root, 'artifact'), manifestPath);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('ok canonical SPP artifact');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when the canonical artifact hash is wrong', () => {
    const body = Buffer.from('canonical-spp-wasm-bytes');
    const { root, manifestPath } = writeFixture(body);
    try {
      const tampered = Buffer.from(body);
      tampered[0] = tampered[0] === 0x63 ? 0x64 : 0x63;
      writeFileSync(join(root, 'artifact', 'stellar_private_payments_web_bg.wasm'), tampered);
      const result = verify(join(root, 'artifact'), manifestPath);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('hash mismatch');
      expect(result.stderr).toContain(wasmRel);
      expect(result.stderr).toContain('refusing to compile');
      expect(result.stdout).not.toContain('ok canonical SPP artifact');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when the canonical artifact is missing', () => {
    const body = Buffer.from('canonical-spp-wasm-bytes');
    const { root, manifestPath } = writeFixture(body);
    try {
      const missing = join(root, 'does-not-exist');
      const result = verify(missing, manifestPath);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('canonical SPP artifact is missing');
      expect(result.stderr).toContain(missing);
      expect(result.stderr).toContain('refusing to compile');
      expect(result.stdout).not.toContain('ok canonical SPP artifact');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
