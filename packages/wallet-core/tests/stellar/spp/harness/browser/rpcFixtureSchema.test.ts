/**
 * Fase 2.5 — structural fixture validation against version-matched rpc.rs schemas.
 * These are NOT Rust serde / WASM deserialization tests.
 */
// @ts-nocheck — mock-rpc.mjs has no package declaration file.
import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import {
  clearMockRpcLog,
  closeServer,
  handleJsonRpcRequest,
  startMockRpcServer,
} from './mock-rpc.mjs';
import {
  assertGetEventsResult,
  assertGetLatestLedgerResult,
  assertGetLedgerEntriesResult,
  assertLedgerEntryResult,
  assertGetTransactionResult,
  assertSendTransactionResult,
  assertSimulateTransactionResult,
  BLOCKED_SUCCESS_METHODS,
} from './rpcFixtureSchema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

function loadFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

describe('SPP RPC fixtures — structural schema (Fase 2.5, offline)', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await closeServer(server);
    server = undefined;
    clearMockRpcLog();
  });

  it('getLatestLedger fixture matches GetLatestLedgerResponse field contract', () => {
    const fixture = loadFixture('getLatestLedger.result.json');
    const check = assertGetLatestLedgerResult(fixture);
    expect(check).toEqual({ ok: true });

    const res = handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'getLatestLedger',
      params: {},
    });
    expect(res.error).toBeUndefined();
    expect(assertGetLatestLedgerResult(res.result)).toEqual({ ok: true });
  });

  it('getLedgerEntries empty fixture file remains schema-valid (structural archive)', () => {
    const fixture = loadFixture('getLedgerEntries.empty.result.json');
    expect(assertGetLedgerEntriesResult(fixture)).toEqual({ ok: true });
    expect(fixture.entries).toEqual([]);
  });

  it('getLedgerEntries aspMinimal fixture remains schema-valid (structural archive)', () => {
    const fixture = loadFixture('getLedgerEntries.aspMinimal.result.json');
    const { _comment, ...servedShape } = fixture as Record<string, unknown>;
    expect(assertGetLedgerEntriesResult(servedShape)).toEqual({ ok: true });
    expect(Array.isArray(servedShape.entries)).toBe(true);
    expect((servedShape.entries as unknown[]).length).toBeGreaterThanOrEqual(4);
    for (const entry of servedShape.entries as unknown[]) {
      expect(assertLedgerEntryResult(entry)).toEqual({ ok: true });
    }
  });

  it('getLedgerEntries allContractsMinimal fixture matches response contract and is served by mock', () => {
    const fixture = loadFixture('getLedgerEntries.allContractsMinimal.result.json');
    const { _comment, ...servedShape } = fixture as Record<string, unknown>;
    expect(assertGetLedgerEntriesResult(servedShape)).toEqual({ ok: true });
    expect(Array.isArray(servedShape.entries)).toBe(true);
    // pool Admin+State+instance (3) + ASP membership (3) + ASP non-membership (2) = 8
    expect((servedShape.entries as unknown[]).length).toBe(8);
    for (const entry of servedShape.entries as unknown[]) {
      expect(assertLedgerEntryResult(entry)).toEqual({ ok: true });
    }

    const res = handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'getLedgerEntries',
      params: { keys: [] },
    });
    expect(res.error).toBeUndefined();
    expect(assertGetLedgerEntriesResult(res.result)).toEqual({ ok: true });
    expect(res.result.entries.length).toBe(8);
    expect(res.result._comment).toBeUndefined();
  });

  it('rejects malformed getLatestLedger shapes (structural)', () => {
    expect(assertGetLatestLedgerResult({ sequence: 1, protocolVersion: 22 }).ok).toBe(false);
    expect(
      assertGetLatestLedgerResult({
        id: 'aa',
        sequence: 1,
        protocolVersion: 22,
        headerXdr: 'EXTRA',
      }).ok,
    ).toBe(false);
    expect(
      assertGetLatestLedgerResult({
        id: '',
        sequence: 1,
        protocolVersion: 22,
      }).ok,
    ).toBe(false);
    expect(
      assertGetLatestLedgerResult({
        id: 'aa',
        sequence: -1,
        protocolVersion: 22,
      }).ok,
    ).toBe(false);
  });

  it('rejects incomplete getEvents / getTransaction / simulate shapes', () => {
    expect(assertGetEventsResult({ events: [], latestLedger: 1 }).ok).toBe(false);
    expect(assertGetEventsResult({ events: [], cursor: '' }).ok).toBe(false);
    expect(assertGetTransactionResult({}).ok).toBe(false);
    expect(assertGetTransactionResult({ status: 'SUCCESS', envelopeXdr: 'nope' }).ok).toBe(false);
    expect(assertSimulateTransactionResult({ results: [] }).ok).toBe(false);
    expect(assertGetTransactionResult({ status: 'SUCCESS' }).ok).toBe(true);
  });

  it('keeps blocked methods fail-closed (no success result)', () => {
    clearMockRpcLog();
    for (const method of BLOCKED_SUCCESS_METHODS) {
      const res = handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: method,
        method,
        params: {},
      });
      expect(res.result, method).toBeUndefined();
      expect(res.error, method).toBeTruthy();
    }
    const send = handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 'send',
      method: 'sendTransaction',
      params: { transaction: 'AAAA' },
    });
    expect(send.result).toBeUndefined();
    expect(String(send.error.message)).toMatch(/always rejected/i);
    // Even a structurally valid send body must never be returned by the mock.
    expect(
      assertSendTransactionResult({
        hash: '00',
        status: 'PENDING',
        latestLedger: 1,
      }).ok,
    ).toBe(true);
  });

  it('rejects unknown methods and invalid envelopes', () => {
    const unknown = handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 9,
      method: 'getHealth',
      params: null,
    });
    expect(unknown.error).toBeTruthy();
    expect(String(unknown.error.message)).toMatch(/not modeled/i);

    const batch = handleJsonRpcRequest([{ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' }]);
    expect(batch.error).toBeTruthy();
  });

  it('loopback bind remains 127.0.0.1', async () => {
    server = await startMockRpcServer(18768);
    const addr = server!.address();
    expect(addr && typeof addr === 'object' && addr.address).toBe('127.0.0.1');
  });
});
