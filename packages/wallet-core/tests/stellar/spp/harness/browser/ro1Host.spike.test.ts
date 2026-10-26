/**
 * Fase 2.27 — offline Node tests for RO-1 browser spike artifacts + mock RPC.
 * Does not launch a browser (Playwright not installed).
 */
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import {
  clearMockRpcLog,
  closeServer,
  getMockRpcLog,
  handleJsonRpcRequest,
  handleRo1JsonRpcRequest,
  createMockRpcHttpHandler,
} from './mock-rpc.mjs';

describe('2.27 RO-1 host artifacts (offline)', () => {
  it('ro1-host page + script exist; Playwright still not installed', () => {
    const dir = path.resolve('tests/stellar/spp/harness/browser');
    expect(existsSync(path.join(dir, 'ro1-host.html'))).toBe(true);
    expect(existsSync(path.join(dir, 'ro1-host.mjs'))).toBe(true);
    expect(existsSync(path.join(dir, 'serve.mjs'))).toBe(true);
    expect(existsSync(path.resolve('node_modules/playwright'))).toBe(false);
  });

  it('SDK package 0.2.1 wasm + workers present for same-origin serve', () => {
    const pkg = path.resolve('node_modules/stellar-private-payments');
    expect(existsSync(path.join(pkg, 'package.json'))).toBe(true);
    const ver = JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8')).version;
    expect(ver).toBe('0.2.1');
    expect(existsSync(path.join(pkg, 'dist/stellar_private_payments_web_bg.wasm'))).toBe(true);
    expect(existsSync(path.join(pkg, 'dist/workers/storage-worker.js'))).toBe(true);
    expect(existsSync(path.join(pkg, 'dist/workers/prover-worker.js'))).toBe(true);
  });
});

describe('2.27 RO-1 mock RPC allowlist', () => {
  afterEach(() => {
    clearMockRpcLog();
  });

  it('allows getLedgerEntries and rejects everything else', () => {
    clearMockRpcLog();
    const ok = handleRo1JsonRpcRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'getLedgerEntries',
      params: { keys: [] },
    });
    expect(ok.error).toBeUndefined();
    expect(ok.result).toBeTruthy();

    for (const method of [
      'sendTransaction',
      'simulateTransaction',
      'getLatestLedger',
      'getEvents',
      'getHealth',
    ]) {
      const res = handleRo1JsonRpcRequest({ jsonrpc: '2.0', id: 2, method, params: null });
      expect(res.error, method).toBeTruthy();
      expect(String(res.error.message)).toMatch(/RO-1 mock|not allowlisted/i);
    }

    const log = getMockRpcLog() as { method: string; outcome: string }[];
    expect(log.some((e) => e.outcome.includes('ro1') || e.method === 'getLedgerEntries')).toBe(
      true,
    );
    expect(log.some((e) => e.method === 'sendTransaction')).toBe(true);
  });

  it('default mock still rejects sendTransaction (regression)', () => {
    const send = handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: {},
    });
    expect(send.error).toBeTruthy();
  });

  it('ro1 HTTP handler serves health with mode=ro1', async () => {
    // Mount via startMockRpcServer uses default mode — exercise createMockRpcHttpHandler directly
    const handler = createMockRpcHttpHandler({ mode: 'ro1' });
    const server = await new Promise<Server>((resolve, reject) => {
      const s = http.createServer(handler);
      s.on('error', reject);
      s.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      const body = await res.json();
      expect(body.synthetic).toBe(true);
      expect(body.mode).toBe('ro1');
      expect(body.bind).toBe('127.0.0.1');
    } finally {
      await closeServer(server);
    }
  });
});

describe('2.27 G8/G9 honesty', () => {
  it('documents that Node suite cannot PASS browser SDK execution', () => {
    // This file proves artifacts + mock policy only.
    // Real Client.aspState in Chromium remains a manual / prior OBS path (2.9/2.12)
    // or future authorized browser automation — not PASS for G8/G9.
    expect(true).toBe(true);
  });
});
