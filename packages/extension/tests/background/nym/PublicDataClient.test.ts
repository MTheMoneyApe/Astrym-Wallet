/**
 * PublicDataClient — mocked transport fetch only (no Mixnet / clearnet).
 */

import { describe, expect, it, vi } from 'vitest';
import { fetchPublicData } from '../../../src/background/nym/PublicDataClient.js';
import {
  NYM_PUBLIC_DATA_DEFAULT_URL,
  NYM_PUBLIC_DATA_PROBE_FIELD,
  extractPublicDataProbeId,
} from '../../../src/nym-offscreen/publicDataConfig.js';

describe('publicDataConfig', () => {
  it('extracts probe from postman-echo POST json', () => {
    expect(
      extractPublicDataProbeId({
        json: { [NYM_PUBLIC_DATA_PROBE_FIELD]: 'p1' },
      }),
    ).toBe('p1');
  });
});

describe('fetchPublicData (mocked router fetch)', () => {
  const probeId = 'solanym-pub-test-001';

  it('success via nym transport with echo match', async () => {
    const fetchViaTransport = vi.fn(async (url: string, init?: RequestInit & { mode?: string }) => {
      expect(url).toBe(NYM_PUBLIC_DATA_DEFAULT_URL);
      expect(init?.method).toBe('POST');
      expect(init?.mode).toBe('unsafe-ignore-cors');
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      expect(body[NYM_PUBLIC_DATA_PROBE_FIELD]).toBe(probeId);
      return new Response(
        JSON.stringify({ json: { [NYM_PUBLIC_DATA_PROBE_FIELD]: probeId } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await fetchPublicData({
      fetchViaTransport,
      transport: 'nym',
      routerMode: 'nym',
      nymConnected: true,
      randomId: () => probeId,
    });

    expect(fetchViaTransport).toHaveBeenCalledOnce();
    expect(result.state).toBe('success');
    expect(result.transport).toBe('nym');
    expect(result.httpStatus).toBe(200);
    expect(result.probeMatched).toBe(true);
    expect(result.responsePreview).toContain(probeId);
    expect(result.url).toBe(NYM_PUBLIC_DATA_DEFAULT_URL);
  });

  it('refuses nym when not connected without invoking transport', async () => {
    const fetchViaTransport = vi.fn(async () => new Response('no'));
    const result = await fetchPublicData({
      fetchViaTransport,
      transport: 'nym',
      routerMode: 'nym',
      nymConnected: false,
      randomId: () => probeId,
    });
    expect(fetchViaTransport).not.toHaveBeenCalled();
    expect(result.state).toBe('error');
    expect(result.message).toMatch(/not Ready/i);
  });

  it('error on transport exception (no clearnet retry)', async () => {
    const fetchViaTransport = vi.fn(async () => {
      throw new Error('mixnet drop');
    });
    const result = await fetchPublicData({
      fetchViaTransport,
      transport: 'nym',
      routerMode: 'nym',
      nymConnected: true,
      randomId: () => probeId,
    });
    expect(result.state).toBe('error');
    expect(result.message).toBe('mixnet drop');
    expect(result.transportFetchInvoked).toBe(true);
  });

  it('timeout when transport never settles', async () => {
    const fetchViaTransport = vi.fn(
      () =>
        new Promise<Response>(() => {
          /* hang */
        }),
    );
    const result = await fetchPublicData({
      fetchViaTransport,
      transport: 'nym',
      routerMode: 'nym',
      nymConnected: true,
      randomId: () => probeId,
      request: { timeoutMs: 25 },
    });
    expect(result.state).toBe('timeout');
  });

  it('direct mode does not set unsafe-ignore-cors', async () => {
    const fetchViaTransport = vi.fn(async (_url: string, init?: RequestInit & { mode?: string }) => {
      expect(init?.mode).toBeUndefined();
      return new Response(
        JSON.stringify({ json: { [NYM_PUBLIC_DATA_PROBE_FIELD]: probeId } }),
        { status: 200 },
      );
    });
    const result = await fetchPublicData({
      fetchViaTransport,
      transport: 'direct',
      routerMode: 'direct',
      nymConnected: false,
      randomId: () => probeId,
    });
    expect(result.state).toBe('success');
    expect(result.transport).toBe('direct');
  });
});
