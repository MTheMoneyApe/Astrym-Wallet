import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SPP_HOST_BRIDGE_CHANNEL } from '../../../src/shared/sppHostBridge.js';

vi.mock('../../../src/background/accounts/ActiveAccountManager.js', () => ({
  activeAccountManager: {
    getActiveAccountIndex: () => 0,
  },
}));

vi.mock('../../../src/background/nym/NymRuntimeController.js', () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response('ok-body', { status: 200, statusText: 'OK', headers: { 'x-test': '1' } }),
  );
  return {
    getNymRuntimeController: () => ({
      getSnapshot: () => ({ mode: 'nym', connected: true }),
      getStellarFetch: () => fetchImpl,
    }),
  };
});

describe('handleSppHostNymFetchRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('proxies same-origin Soroban requests when Nym is connected', async () => {
    const { handleSppHostNymFetchRequest } = await import(
      '../../../src/background/spp/sppHostBridgeHandlers.js'
    );
    const result = await handleSppHostNymFetchRequest({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_NYM_FETCH',
      id: 'req-1',
      payload: {
        rpcUrl: 'https://soroban-testnet.stellar.org',
        url: 'https://soroban-testnet.stellar.org',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bodyText).toBe('ok-body');
      expect(result.status).toBe(200);
    }
  });

  it('blocks non-Soroban origins', async () => {
    const { handleSppHostNymFetchRequest } = await import(
      '../../../src/background/spp/sppHostBridgeHandlers.js'
    );
    const result = await handleSppHostNymFetchRequest({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_NYM_FETCH',
      id: 'req-2',
      payload: {
        rpcUrl: 'https://soroban-testnet.stellar.org',
        url: 'https://evil.example/',
        method: 'GET',
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ORIGIN_BLOCKED');
    }
  });
});
