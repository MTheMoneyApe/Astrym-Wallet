/**
 * Offscreen runtime state machine — mocked mix-fetch module, no network.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NymOffscreenRuntime } from '../../src/nym-offscreen/runtime.js';

const DOC_IDENTITY = 'q2A2cbooyC16YJzvdYaSMH9X3cSiieZNtfBr8cE8Fi1';
const DOC_WSS = 'wss://nym-node-cli.devrel.nymte.ch:9001';

describe('NymOffscreenRuntime', () => {
  beforeEach(() => {
    // Official mix-fetch requires window; offscreen document provides it.
    (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
  });

  it('starts disconnected and not connected', () => {
    const rt = new NymOffscreenRuntime();
    const status = rt.getStatus();
    expect(status.connected).toBe(false);
    expect(status.state).toBe('disconnected');
    expect(status.documentReady).toBe(true);
    expect(status.diagnosticCode).toBe('OK');
    expect(status.gatewayAllowlistConfigured).toBe(false);
  });

  it('rejects connect when WSS allowlist is empty', async () => {
    const rt = new NymOffscreenRuntime();
    await expect(
      rt.connect({ preferredGateway: DOC_IDENTITY }),
    ).rejects.toMatchObject({ code: 'GATEWAY_ALLOWLIST_EMPTY' });
    expect(rt.getStatus().connected).toBe(false);
    expect(rt.getStatus().diagnosticCode).toBe('GATEWAY_ALLOWLIST_EMPTY');
  });

  it('rejects WSS URL passed as MixFetch preferredGateway', async () => {
    const rt = new NymOffscreenRuntime({
      bootstrapApiOrigins: ['https://validator.nymtech.net'],
      gatewayOrigins: [DOC_WSS],
    });
    await expect(
      rt.connect({ preferredGateway: DOC_WSS }),
    ).rejects.toMatchObject({ code: 'BAD_IDENTITY' });
    expect(rt.getStatus().connected).toBe(false);
  });

  it('rejects connect without identity even if allowlist is set', async () => {
    const rt = new NymOffscreenRuntime({
      bootstrapApiOrigins: ['https://validator.nymtech.net'],
      gatewayOrigins: [DOC_WSS],
    });
    await expect(rt.connect({})).rejects.toMatchObject({
      code: 'GATEWAY_IDENTITY_REQUIRED',
    });
  });

  it('protected request before connect refuses with NOT_CONNECTED', async () => {
    const rt = new NymOffscreenRuntime();
    await expect(rt.performProtectedRequest('https://example.invalid/x')).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
  });

  it('connect success passes identity to createMixFetch, not WSS', async () => {
    const mixFetch = vi.fn(async () => new Response('ok', { status: 200 }));
    const disconnectMixFetch = vi.fn(async () => undefined);
    const createMixFetch = vi.fn(async () => ({ mixFetch, disconnectMixFetch }));

    const rt = new NymOffscreenRuntime();
    (rt as unknown as { ensureModule: () => Promise<unknown> }).ensureModule = async () => ({
      createMixFetch,
      disconnectMixFetch,
    });
    (rt as unknown as { probePackagedAssets: () => Promise<boolean> }).probePackagedAssets =
      async () => true;

    const status = await rt.connect({
      preferredGateway: DOC_IDENTITY,
      gatewayAllowlist: [DOC_WSS],
    });
    expect(createMixFetch).toHaveBeenCalledOnce();
    const createOpts = createMixFetch.mock.calls.at(0)?.at(0) as Record<
      string,
      unknown
    >;
    expect(createOpts.preferredGateway).toBe(DOC_IDENTITY);
    expect(createOpts.forceTls).toBe(true);
    expect(createOpts.mixFetchOverride).toEqual({ requestTimeoutMs: 90_000 });
    expect(createOpts.responseBodyConfigMap).toMatchObject({
      fallback: 'uint8array',
    });
    expect(createOpts).not.toHaveProperty('gatewayAllowlist');
    expect(status.connected).toBe(true);
    expect(status.state).toBe('connected');
    expect(status.diagnosticCode).toBe('OK');

    const result = await rt.performProtectedRequest('https://example.invalid/accounts/G', {
      method: 'GET',
    });
    expect(result.status).toBe(200);
    expect(mixFetch).toHaveBeenCalledOnce();
  });

  it('connect without gateway allowlist refuses silent fallback', async () => {
    const rt = new NymOffscreenRuntime();
    (rt as unknown as { ensureModule: () => Promise<unknown> }).ensureModule = async () => ({
      createMixFetch: async () => ({
        mixFetch: async () => new Response('ok'),
        disconnectMixFetch: async () => undefined,
      }),
      disconnectMixFetch: async () => undefined,
    });
    await expect(rt.connect({ preferredGateway: DOC_IDENTITY })).rejects.toMatchObject({
      code: 'GATEWAY_ALLOWLIST_EMPTY',
    });
    expect(rt.getStatus().connected).toBe(false);
  });

  it('disconnect returns to disconnected and allows reconnect', async () => {
    const disconnectMixFetch = vi.fn(async () => undefined);
    const createMixFetch = vi.fn(async () => ({
      mixFetch: async () => new Response('ok'),
      disconnectMixFetch,
    }));
    const rt = new NymOffscreenRuntime({
      bootstrapApiOrigins: ['https://validator.nymtech.net'],
      gatewayOrigins: [DOC_WSS],
    });
    (rt as unknown as { ensureModule: () => Promise<unknown> }).ensureModule = async () => ({
      createMixFetch,
      disconnectMixFetch,
    });
    (rt as unknown as { probePackagedAssets: () => Promise<boolean> }).probePackagedAssets =
      async () => true;

    await rt.connect({ preferredGateway: DOC_IDENTITY });
    const after = await rt.disconnect();
    expect(disconnectMixFetch).toHaveBeenCalled();
    expect(after.connected).toBe(false);
    expect(after.state).toBe('disconnected');

    const again = await rt.connect({ preferredGateway: DOC_IDENTITY });
    expect(createMixFetch).toHaveBeenCalledTimes(2);
    expect(again.connected).toBe(true);
    expect(again.state).toBe('connected');
  });

  it('deduplicates concurrent identical mixFetch requests by method:url and cleans up after settlement', async () => {
    let resolveFirst!: (res: Response) => void;
    const firstGate = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    let callCount = 0;
    const mixFetch = vi.fn(async (url: string, init?: RequestInit) => {
      callCount += 1;
      if (callCount === 1) return firstGate;
      return new Response(`${init?.method ?? 'GET'}:${url}:${callCount}`, { status: 200 });
    });
    const disconnectMixFetch = vi.fn(async () => undefined);
    const createMixFetch = vi.fn(async () => ({ mixFetch, disconnectMixFetch }));

    const rt = new NymOffscreenRuntime({
      bootstrapApiOrigins: ['https://validator.nymtech.net'],
      gatewayOrigins: [DOC_WSS],
    });
    (rt as unknown as { ensureModule: () => Promise<unknown> }).ensureModule = async () => ({
      createMixFetch,
      disconnectMixFetch,
    });
    (rt as unknown as { probePackagedAssets: () => Promise<boolean> }).probePackagedAssets =
      async () => true;

    await rt.connect({ preferredGateway: DOC_IDENTITY });

    const accountUrl = 'https://horizon-testnet.stellar.org/accounts/GABC';
    const p1 = rt.performProtectedRequest(accountUrl, { method: 'GET' });
    const p2 = rt.performProtectedRequest(accountUrl);
    const p3 = rt.performProtectedRequest(accountUrl, { method: 'get' });
    const otherUrlPromise = rt.performProtectedRequest(
      'https://horizon-testnet.stellar.org/fee_stats',
      { method: 'GET' },
    );
    const postPromise = rt.performProtectedRequest(accountUrl, {
      method: 'POST',
      bodyText: 'tx=1',
    });

    // Three identical GET /accounts/GABC calls collapse into a single mixFetch invocation,
    // while different URL or method run independently.
    expect(mixFetch).toHaveBeenCalledTimes(3);

    resolveFirst(new Response('{"balance":"100"}', { status: 200 }));
    const [r1, r2, r3, otherRes, postRes] = await Promise.all([
      p1,
      p2,
      p3,
      otherUrlPromise,
      postPromise,
    ]);

    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
    expect(atob(r1.bodyBase64)).toBe('{"balance":"100"}');
    expect(otherRes.status).toBe(200);
    expect(postRes.status).toBe(200);

    // After settlement, a subsequent identical GET performs a fresh mixFetch call.
    const after = await rt.performProtectedRequest(accountUrl, { method: 'GET' });
    expect(mixFetch).toHaveBeenCalledTimes(4);
    expect(after.status).toBe(200);
  });

  it('cleans up inflightRequests entry when a mixFetch request fails so retries run fresh', async () => {
    let rejectFirst!: (err: Error) => void;
    const firstGate = new Promise<Response>((_, reject) => {
      rejectFirst = reject;
    });
    const mixFetch = vi
      .fn()
      .mockImplementationOnce(() => firstGate)
      .mockImplementationOnce(async () => new Response('recovered', { status: 200 }));
    const disconnectMixFetch = vi.fn(async () => undefined);
    const createMixFetch = vi.fn(async () => ({ mixFetch, disconnectMixFetch }));

    const rt = new NymOffscreenRuntime({
      bootstrapApiOrigins: ['https://validator.nymtech.net'],
      gatewayOrigins: [DOC_WSS],
    });
    (rt as unknown as { ensureModule: () => Promise<unknown> }).ensureModule = async () => ({
      createMixFetch,
      disconnectMixFetch,
    });
    (rt as unknown as { probePackagedAssets: () => Promise<boolean> }).probePackagedAssets =
      async () => true;

    await rt.connect({ preferredGateway: DOC_IDENTITY });

    const url = 'https://horizon-testnet.stellar.org/accounts/GFAIL';
    const p1 = rt.performProtectedRequest(url, { method: 'GET' });
    const p2 = rt.performProtectedRequest(url, { method: 'GET' });
    expect(mixFetch).toHaveBeenCalledTimes(1);

    rejectFirst(new Error('transient mixnet error'));
    await expect(p1).rejects.toThrow(/transient mixnet error/);
    await expect(p2).rejects.toThrow(/transient mixnet error/);

    const retry = await rt.performProtectedRequest(url, { method: 'GET' });
    expect(mixFetch).toHaveBeenCalledTimes(2);
    expect(atob(retry.bodyBase64)).toBe('recovered');
  });
});
