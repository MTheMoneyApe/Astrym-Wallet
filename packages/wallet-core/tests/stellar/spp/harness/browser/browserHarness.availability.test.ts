/**
 * Fase 1.9 — documents tooling availability and that the browser harness
 * artifacts exist. Does not launch a browser (Playwright not installed;
 * install requires explicit authorization).
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SPP browser harness availability (offline Node)', () => {
  it('Playwright is not installed in this workspace (no silent install)', () => {
    const roots = [
      path.resolve('node_modules/playwright'),
      path.resolve('node_modules/@playwright/test'),
      path.resolve('../../node_modules/playwright'),
      path.resolve('../../node_modules/@playwright/test'),
    ];
    expect(roots.some((p) => existsSync(p))).toBe(false);
  });

  it('browser harness page + server + mock RPC exist under tests (isolated)', () => {
    const dir = path.resolve('tests/stellar/spp/harness/browser');
    expect(existsSync(path.join(dir, 'index.html'))).toBe(true);
    expect(existsSync(path.join(dir, 'harness.mjs'))).toBe(true);
    expect(existsSync(path.join(dir, 'serve.mjs'))).toBe(true);
    expect(existsSync(path.join(dir, 'mock-rpc.mjs'))).toBe(true);
    expect(existsSync(path.join(dir, 'fixtures/getLatestLedger.result.json'))).toBe(true);
    expect(existsSync(path.join(dir, 'ro1-host.html'))).toBe(true);
    expect(existsSync(path.join(dir, 'ro1-host.mjs'))).toBe(true);
    expect(existsSync(path.join(dir, 'ro1-broker-host.html'))).toBe(true);
    expect(existsSync(path.join(dir, 'ro1-broker.standalone.mjs'))).toBe(true);
    expect(existsSync(path.join(dir, 'worker-network-probe.html'))).toBe(true);
    expect(existsSync(path.join(dir, 'worker-network-probe.worker.js'))).toBe(true);
    expect(existsSync(path.join(dir, 'worker-csp-lifecycle.html'))).toBe(true);
    expect(existsSync(path.join(dir, 'worker-csp-probe.classic.js'))).toBe(true);
    expect(existsSync(path.join(dir, 'workerRegistry.mjs'))).toBe(true);
    expect(existsSync(path.join(dir, 'spp-real-worker-audit.html'))).toBe(true);
    expect(existsSync(path.join(dir, 'spp-real-worker-audit.mjs'))).toBe(true);
    expect(existsSync(path.join(dir, 'host-worker-containment.html'))).toBe(true);
    expect(existsSync(path.join(dir, 'hostWorkerContainment.mjs'))).toBe(true);
  });

  it('local SPP package wasm + storage worker exist for same-origin serving', () => {
    const pkg = path.resolve('node_modules/stellar-private-payments');
    expect(existsSync(path.join(pkg, 'dist/stellar_private_payments_web_bg.wasm'))).toBe(true);
    expect(existsSync(path.join(pkg, 'dist/workers/storage-worker.js'))).toBe(true);
  });
});
