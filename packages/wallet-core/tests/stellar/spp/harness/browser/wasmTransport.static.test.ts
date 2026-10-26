/**
 * Fase 2.31 — Static evidence that SPP 0.2.1 WASM HTTP uses browser fetch bindings.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const pkgRoot = path.resolve('node_modules/stellar-private-payments');

describe('SPP WASM transport (static, offline)', () => {
  it('main glue binds __wbg_fetch to global fetch', () => {
    const glue = path.join(pkgRoot, 'dist/stellar_private_payments_web.js');
    expect(existsSync(glue)).toBe(true);
    const src = readFileSync(glue, 'utf8');
    expect(src).toMatch(/__wbg_fetch_\w+:\s*function/);
    expect(src).toMatch(/const ret = fetch\(getObject\(arg0\)\)/);
    expect(src).toMatch(/getObject\(arg0\)\.fetch\(getObject\(arg1\)\)/);
  });

  it('storage + prover worker modules also expose fetch bindings', () => {
    for (const rel of [
      'dist/workers/storage-worker-module.js',
      'dist/workers/prover-worker-module.js',
    ]) {
      const p = path.join(pkgRoot, rel);
      expect(existsSync(p)).toBe(true);
      const src = readFileSync(p, 'utf8');
      expect(src).toMatch(/__wbg_fetch_/);
      expect(src).toMatch(/\bfetch\(/);
    }
  });

  it('isolation host artifacts exist', () => {
    const dir = path.resolve('tests/stellar/spp/harness/browser');
    expect(existsSync(path.join(dir, 'ro1-isolation-host.html'))).toBe(true);
    expect(existsSync(path.join(dir, 'ro1-isolation-host.mjs'))).toBe(true);
    expect(existsSync(path.join(dir, 'csp-negative-probe.worker.js'))).toBe(true);
    expect(existsSync(path.join(dir, 'csp-wasm-requirement.html'))).toBe(true);
  });
});
