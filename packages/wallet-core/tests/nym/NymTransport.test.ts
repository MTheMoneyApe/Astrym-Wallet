/**
 * NymTransport lifecycle + fail-closed policy (mocked mix-fetch bridge).
 * Does not connect to public mixnet or Horizon.
 */

import { describe, expect, it, vi } from 'vitest';

import type { NymMixFetchBridge } from '../../src/nym/NymMixFetchBridge.js';
import { tryLoadOfficialMixFetchBridge } from '../../src/nym/NymMixFetchBridge.js';
import {
  MixFetchNymTransport,
  NymTransportError,
  UnavailableNymTransport,
  createMixFetchNymTransport,
  createNymTransport,
  createNymTransportAsync,
} from '../../src/nym/NymTransport.js';
import {
  FailClosedTransportRouter,
  STELLAR_HTTP_OPERATIONS_VIA_POLICY,
  createFailClosedTransportRouter,
} from '../../src/nym/NymTransportPolicy.js';

function mockBridge(
  overrides: Partial<NymMixFetchBridge> = {},
): NymMixFetchBridge {
  return {
    setup: vi.fn(async () => undefined),
    mixFetch: vi.fn(async () => new Response('ok', { status: 200 })),
    disconnect: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('createNymTransport / UnavailableNymTransport', () => {
  it('starts disconnected and not connected', () => {
    const t = createNymTransport();
    const snap = t.getSnapshot();
    expect(snap.implementation).toBe('unavailable');
    expect(snap.connected).toBe(false);
    expect(snap.state).toBe('disconnected');
    expect(snap.lastError).toMatch(/mix-fetch|not available/i);
  });

  it('connect rejects and never flips connected', async () => {
    const t = new UnavailableNymTransport();
    await expect(t.connect({ gatewayUrl: 'https://example.invalid' })).rejects.toBeInstanceOf(
      NymTransportError,
    );
    const snap = t.getSnapshot();
    expect(snap.connected).toBe(false);
    expect(snap.state).toBe('error');
    expect(snap.lastError).toMatch(/unavailable/i);
  });

  it('send and fetch reject without clearnet', async () => {
    const t = createNymTransport();
    await expect(t.send(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
    await expect(t.fetch('https://example.invalid/x')).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
  });

  it('close moves to closed without claiming prior connection', async () => {
    const t = createNymTransport();
    await t.close();
    expect(t.getSnapshot().state).toBe('closed');
    expect(t.getSnapshot().connected).toBe(false);
  });
});

describe('MixFetchNymTransport (mocked bridge)', () => {
  it('ready only after successful setup', async () => {
    const bridge = mockBridge();
    const t = createMixFetchNymTransport(bridge);
    expect(t.getSnapshot().connected).toBe(false);
    expect(t.getSnapshot().state).toBe('disconnected');

    await t.connect();
    expect(bridge.setup).toHaveBeenCalledOnce();
    expect(t.getSnapshot().connected).toBe(true);
    expect(t.getSnapshot().state).toBe('connected');
    expect(t.getSnapshot().implementation).toBe('mix-fetch');
  });

  it('connect failure stays error and not connected', async () => {
    const bridge = mockBridge({
      setup: vi.fn(async () => {
        throw new Error('gateway refused');
      }),
    });
    const t = new MixFetchNymTransport(bridge);
    await expect(t.connect()).rejects.toMatchObject({ code: 'CONNECT_FAILED' });
    expect(t.getSnapshot().connected).toBe(false);
    expect(t.getSnapshot().state).toBe('error');
    expect(t.getSnapshot().lastError).toMatch(/gateway refused/);
  });

  it('fetch before connect refuses clearnet', async () => {
    const bridge = mockBridge();
    const t = new MixFetchNymTransport(bridge);
    await expect(t.fetch('https://horizon.example/accounts/G')).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
    expect(bridge.mixFetch).not.toHaveBeenCalled();
  });

  it('request failure surfaces REQUEST_FAILED without retrying clearnet', async () => {
    const bridge = mockBridge({
      mixFetch: vi.fn(async () => {
        throw new Error('mixnet drop');
      }),
    });
    const t = new MixFetchNymTransport(bridge);
    await t.connect();
    await expect(t.fetch('https://horizon.example/x')).rejects.toMatchObject({
      code: 'REQUEST_FAILED',
      message: expect.stringMatching(/mixnet drop/),
    });
    expect(bridge.mixFetch).toHaveBeenCalledOnce();
  });

  it('disconnect/close returns to disconnected and blocks fetch until reconnect', async () => {
    const bridge = mockBridge();
    const t = new MixFetchNymTransport(bridge);
    await t.connect();
    await t.close();
    expect(bridge.disconnect).toHaveBeenCalledOnce();
    expect(t.getSnapshot().state).toBe('disconnected');
    expect(t.getSnapshot().connected).toBe(false);
    await expect(t.fetch('https://horizon.example/x')).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
    expect(bridge.mixFetch).not.toHaveBeenCalled();
  });

  it('reconnects after close without permanently rejecting Connect', async () => {
    const bridge = mockBridge();
    const t = new MixFetchNymTransport(bridge);
    await t.connect();
    await t.close();
    expect(t.getSnapshot().state).toBe('disconnected');

    await t.connect({ gatewayUrl: 'q2A2cbooyC16YJzvdYaSMH9X3cSiieZNtfBr8cE8Fi1' });
    expect(bridge.setup).toHaveBeenCalledTimes(2);
    expect(t.getSnapshot().connected).toBe(true);
    expect(t.getSnapshot().state).toBe('connected');
  });

  it('retries connect after setup failure', async () => {
    const setup = vi
      .fn()
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValueOnce(undefined);
    const bridge = mockBridge({ setup });
    const t = new MixFetchNymTransport(bridge);
    await expect(t.connect()).rejects.toMatchObject({ code: 'CONNECT_FAILED' });
    expect(t.getSnapshot().state).toBe('error');
    await t.connect();
    expect(t.getSnapshot().connected).toBe(true);
    expect(setup).toHaveBeenCalledTimes(2);
  });

  it('send is unsupported on HTTP mix-fetch path', async () => {
    const t = new MixFetchNymTransport(mockBridge());
    await t.connect();
    await expect(t.send(new Uint8Array([9]))).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
  });
});

describe('tryLoadOfficialMixFetchBridge / createNymTransportAsync', () => {
  it('returns null when importer rejects', async () => {
    const bridge = await tryLoadOfficialMixFetchBridge(async () => {
      throw new Error('MODULE_NOT_FOUND');
    });
    expect(bridge).toBeNull();
  });

  it('adapts official createMixFetch + disconnectMixFetch surface', async () => {
    const instanceMixFetch = vi.fn(async () => new Response('ok'));
    const instanceDisconnect = vi.fn(async () => undefined);
    const createMixFetch = vi.fn(async () => ({
      mixFetch: instanceMixFetch,
      disconnectMixFetch: instanceDisconnect,
    }));
    const bridge = await tryLoadOfficialMixFetchBridge(async () => ({
      createMixFetch,
      mixFetch: vi.fn(),
      disconnectMixFetch: vi.fn(),
    }));
    expect(bridge).not.toBeNull();
    await bridge!.setup({ disableCoverTraffic: true });
    expect(createMixFetch).toHaveBeenCalledWith({
      clientOverride: {
        coverTraffic: { disableLoopCoverTrafficStream: true },
      },
    });
    await bridge!.mixFetch('https://example.invalid');
    expect(instanceMixFetch).toHaveBeenCalled();
    await bridge!.disconnect();
    expect(instanceDisconnect).toHaveBeenCalled();
  });

  it('adapts legacy setupMixTunnel trio', async () => {
    const setupMixTunnel = vi.fn(async () => undefined);
    const mixFetch = vi.fn(async () => new Response('ok'));
    const disconnectMixTunnel = vi.fn(async () => undefined);
    const bridge = await tryLoadOfficialMixFetchBridge(async () => ({
      setupMixTunnel,
      mixFetch,
      disconnectMixTunnel,
    }));
    expect(bridge).not.toBeNull();
    await bridge!.setup();
    await bridge!.mixFetch('https://example.invalid');
    await bridge!.disconnect();
    expect(setupMixTunnel).toHaveBeenCalled();
    expect(mixFetch).toHaveBeenCalled();
    expect(disconnectMixTunnel).toHaveBeenCalled();
  });

  it('createNymTransportAsync falls back to unavailable when load fails', async () => {
    const t = await createNymTransportAsync(async () => {
      throw new Error('nope');
    });
    expect(t.implementation).toBe('unavailable');
    expect(t.getSnapshot().connected).toBe(false);
  });

  it('createNymTransportAsync builds mix-fetch transport when module loads', async () => {
    const t = await createNymTransportAsync(async () => ({
      createMixFetch: async () => ({
        mixFetch: async () => new Response('ok'),
        disconnectMixFetch: async () => undefined,
      }),
      mixFetch: async () => new Response('ok'),
      disconnectMixFetch: async () => undefined,
    }));
    expect(t.implementation).toBe('mix-fetch');
    expect(t.getSnapshot().connected).toBe(false);
  });

  it('resolves installed @nymproject/mix-fetch without connecting', async () => {
    const bridge = await tryLoadOfficialMixFetchBridge();
    expect(bridge).not.toBeNull();
    // Do not call setup() here: official createMixFetch needs browser window + WASM worker.
  });
});

describe('FailClosedTransportRouter', () => {
  it('documents stellar ops covered by policy', () => {
    expect(STELLAR_HTTP_OPERATIONS_VIA_POLICY).toEqual([
      'stellar.getBalance',
      'stellar.fundTestnetAccount',
    ]);
  });

  it('nym mode uses mix-fetch when connected', async () => {
    const bridge = mockBridge();
    const nym = new MixFetchNymTransport(bridge);
    await nym.connect();
    const directFetch = vi.fn(async () => new Response('clearnet'));
    const router = createFailClosedTransportRouter({
      mode: 'nym',
      nym,
      directFetch: directFetch as typeof fetch,
    });
    const res = await router.fetch('https://horizon.example/accounts/G');
    expect(await res.text()).toBe('ok');
    expect(bridge.mixFetch).toHaveBeenCalledOnce();
    expect(directFetch).not.toHaveBeenCalled();
  });

  it('nym mode refuses clearnet when not connected (no fallback)', async () => {
    const bridge = mockBridge();
    const nym = new MixFetchNymTransport(bridge);
    const directFetch = vi.fn(async () => new Response('clearnet'));
    const router = new FailClosedTransportRouter({
      mode: 'nym',
      nym,
      directFetch: directFetch as typeof fetch,
    });
    await expect(router.fetch('https://horizon.example/x')).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
    expect(directFetch).not.toHaveBeenCalled();
    expect(bridge.mixFetch).not.toHaveBeenCalled();
  });

  it('nym mode does not fall back on request failure', async () => {
    const bridge = mockBridge({
      mixFetch: vi.fn(async () => {
        throw new Error('exit timeout');
      }),
    });
    const nym = new MixFetchNymTransport(bridge);
    await nym.connect();
    const directFetch = vi.fn(async () => new Response('clearnet'));
    const router = createFailClosedTransportRouter({
      mode: 'nym',
      nym,
      directFetch: directFetch as typeof fetch,
    });
    await expect(router.fetch('https://horizon.example/x')).rejects.toBeInstanceOf(
      NymTransportError,
    );
    expect(directFetch).not.toHaveBeenCalled();
  });

  it('direct mode only when explicitly set (user disabled Nym)', async () => {
    const bridge = mockBridge();
    const nym = new MixFetchNymTransport(bridge);
    await nym.connect();
    const directFetch = vi.fn(async () => new Response('clearnet-ok'));
    const router = createFailClosedTransportRouter({
      mode: 'direct',
      nym,
      directFetch: directFetch as typeof fetch,
    });
    const res = await router.fetch('https://horizon.example/x');
    expect(await res.text()).toBe('clearnet-ok');
    expect(directFetch).toHaveBeenCalledOnce();
    expect(bridge.mixFetch).not.toHaveBeenCalled();
  });

  it('setMode never auto-flips on error', async () => {
    const bridge = mockBridge({
      mixFetch: vi.fn(async () => {
        throw new Error('fail');
      }),
    });
    const nym = new MixFetchNymTransport(bridge);
    await nym.connect();
    const router = createFailClosedTransportRouter({ mode: 'nym', nym });
    await expect(router.fetch('https://x')).rejects.toBeTruthy();
    expect(router.mode).toBe('nym');
    router.setMode('direct');
    expect(router.mode).toBe('direct');
  });
});
