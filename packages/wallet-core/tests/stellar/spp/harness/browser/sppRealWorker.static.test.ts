/**
 * Fase 2.33 — Static identification of real SPP 0.2.1 workers + dispose/terminate surface.
 * Offline only. Does not prove runtime CSP inside workers.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const pkg = path.resolve('node_modules/stellar-private-payments');

function read(rel: string): string {
  return readFileSync(path.join(pkg, rel), 'utf8');
}

describe('2.33 real SPP workers (static)', () => {
  it('package is stellar-private-payments@0.2.1', () => {
    const meta = JSON.parse(read('package.json')) as { name: string; version: string };
    expect(meta.name).toBe('stellar-private-payments');
    expect(meta.version).toBe('0.2.1');
  });

  it('identifies storage + prover worker entry scripts (SDK_REAL)', () => {
    for (const rel of [
      'dist/workers/storage-worker.js',
      'dist/workers/prover-worker.js',
      'dist/workers/storage-worker-module.js',
      'dist/workers/prover-worker-module.js',
    ]) {
      expect(existsSync(path.join(pkg, rel))).toBe(true);
    }
    const storageEntry = read('dist/workers/storage-worker.js');
    const proverEntry = read('dist/workers/prover-worker.js');
    expect(storageEntry).toMatch(/import\s+init\s+from\s+'\.\/storage-worker-module\.js'/);
    expect(proverEntry).toMatch(/import\s+init\s+from\s+'\.\/prover-worker-module\.js'/);
  });

  it('js/index.js wires Storage.open + ProverBridge.spawn to those URLs', () => {
    const index = read('js/index.js');
    expect(index).toMatch(/storage-worker\.js/);
    expect(index).toMatch(/prover-worker\.js/);
    expect(index).toMatch(/ProverBridge\.spawn/);
    expect(index).toMatch(/WasmStorage\.open|Storage\.open/);
    // Client.dispose frees telemetry + wasmClient — no Worker.terminate in JS facade
    expect(index).toMatch(/dispose:\s*\(\)\s*=>\s*\{/);
    expect(index).toMatch(/wasmClient\.free\(\)/);
  });

  it('wasm-bindgen glue constructs Worker; package JS has zero terminate() calls', () => {
    const glue = read('dist/stellar_private_payments_web.js');
    expect(glue).toMatch(/new Worker\(/);
    // Entire published package: no Worker.terminate
    const allJs = [
      'dist/stellar_private_payments_web.js',
      'js/index.js',
      'dist/workers/storage-worker.js',
      'dist/workers/prover-worker.js',
      'dist/workers/storage-worker-module.js',
      'dist/workers/prover-worker-module.js',
    ];
    for (const rel of allJs) {
      const src = read(rel);
      expect(src.includes('.terminate(') || /\bterminate\s*\(/.test(src)).toBe(false);
    }
  });

  it('worker modules bind __wbg_fetch (egress capable via fetch)', () => {
    for (const rel of [
      'dist/workers/storage-worker-module.js',
      'dist/workers/prover-worker-module.js',
    ]) {
      const src = read(rel);
      expect(src).toMatch(/__wbg_fetch_/);
    }
  });
});
