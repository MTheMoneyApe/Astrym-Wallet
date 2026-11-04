import { afterEach, describe, expect, it, vi } from 'vitest';
import { withSppHostNymFetchProxy } from '../../src/spp-host/sppHostNymFetchProxy.js';
import { SPP_HOST_BRIDGE_CHANNEL } from '../../src/shared/sppHostBridge.js';

describe('withSppHostNymFetchProxy', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('routes same-origin Soroban requests through the SW sender', async () => {
    const send = vi.fn().mockImplementation(async (message: { id: string }) => ({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_NYM_FETCH_RESULT',
      id: message.id,
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      bodyText: '{"jsonrpc":"2.0","result":"healthy"}',
    }));

    const clearnet = vi.fn().mockResolvedValue(new Response('clearnet'));
    globalThis.fetch = clearnet as typeof fetch;

    const rpcUrl = 'https://soroban-testnet.stellar.org';
    const body = await withSppHostNymFetchProxy(
      rpcUrl,
      async () => {
        const res = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        return res.text();
      },
      send,
    );

    expect(body).toContain('healthy');
    expect(send).toHaveBeenCalledOnce();
    expect(clearnet).not.toHaveBeenCalled();
  });

  it('leaves other origins on the previous fetch', async () => {
    const send = vi.fn();
    const clearnet = vi.fn().mockResolvedValue(new Response('other'));
    globalThis.fetch = clearnet as typeof fetch;

    await withSppHostNymFetchProxy(
      'https://soroban-testnet.stellar.org',
      async () => {
        await fetch('https://example.com/');
      },
      send,
    );

    expect(send).not.toHaveBeenCalled();
    expect(clearnet).toHaveBeenCalledOnce();
  });
});
