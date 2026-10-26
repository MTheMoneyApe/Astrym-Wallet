/**
 * Fase 2.1 — security tests for the synthetic loopback mock RPC (Node, no browser).
 */
// @ts-nocheck — local harness mock-rpc.mjs has no package declaration file.
import { describe, expect, it, afterEach } from 'vitest';
import type { Server } from 'node:http';
import {
  clearMockRpcLog,
  closeServer,
  getMockRpcLog,
  handleJsonRpcRequest,
  startMockRpcServer,
} from './mock-rpc.mjs';

type LogEntry = { at: string; method: string; outcome: string; synthetic: boolean };

describe('SPP mock RPC security (offline)', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await closeServer(server);
    server = undefined;
    clearMockRpcLog();
  });

  it('listens only on 127.0.0.1', async () => {
    server = await startMockRpcServer(18766);
    const addr = server!.address();
    expect(addr && typeof addr === 'object' && addr.address).toBe('127.0.0.1');
  });

  it('rejects unknown methods and never succeeds sendTransaction', () => {
    clearMockRpcLog();
    const unknown = handleJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'getHealth', params: null });
    expect(unknown.error).toBeTruthy();
    expect(String(unknown.error.message)).toMatch(/not modeled/i);

    const send = handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'sendTransaction',
      params: { transaction: 'AAAA' },
    });
    expect(send.error).toBeTruthy();
    expect(send.result).toBeUndefined();
    expect(String(send.error.message)).toMatch(/sendTransaction is always rejected/);

    const log = getMockRpcLog() as LogEntry[];
    expect(log.every((e) => e.synthetic === true)).toBe(true);
    expect(log.some((e) => e.outcome === 'reject_sendTransaction')).toBe(true);
  });

  it('serves synthetic getLatestLedger with 3-field shape (rpc.rs GetLatestLedgerResponse)', () => {
    clearMockRpcLog();
    const res = handleJsonRpcRequest({ jsonrpc: '2.0', id: 3, method: 'getLatestLedger', params: null });
    expect(res.error).toBeUndefined();
    expect(res.result).toEqual({
      id: '00000000000000000000000000000000000000000000000000000000000000aa',
      sequence: 1000,
      protocolVersion: 22,
    });
    expect(Object.keys(res.result).sort()).toEqual(['id', 'protocolVersion', 'sequence']);
    expect((getMockRpcLog() as LogEntry[])[0]?.synthetic).toBe(true);
  });

  it('HTTP handler has no forwarding — health identifies synthetic mock', async () => {
    server = await startMockRpcServer(18767);
    const res = await fetch('http://127.0.0.1:18767/health');
    const body = await res.json();
    expect(body.synthetic).toBe(true);
    expect(body.bind).toBe('127.0.0.1');
  });
});
