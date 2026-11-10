import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NymRuntimeController,
  resetNymRuntimeControllerForTests,
} from '../../../src/background/nym/NymRuntimeController.js';
import { NymGatewayConfigService } from '../../../src/background/nym/NymGatewayConfigService.js';
import { NymHostPermissionService } from '../../../src/background/nym/NymHostPermissionService.js';
import type { OffscreenMixFetchBridge } from '../../../src/background/nym/OffscreenMixFetchBridge.js';
import { NYM_VERIFIED_GATEWAY } from '../../../src/nym-offscreen/verifiedGateway.js';

function memoryStorage() {
  const mem = new Map<string, unknown>();
  return {
    get: async (keys?: string | string[] | null) => {
      const list = keys == null ? [...mem.keys()] : Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) {
        if (mem.has(k)) out[k] = mem.get(k);
      }
      return out;
    },
    set: async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) mem.set(k, v);
    },
  };
}

async function seededController(bridge: OffscreenMixFetchBridge): Promise<NymRuntimeController> {
  const gatewayConfig = new NymGatewayConfigService(memoryStorage());
  await gatewayConfig.addGateway(
    NYM_VERIFIED_GATEWAY.wssOrigin,
    NYM_VERIFIED_GATEWAY.identityKey,
  );
  const hostPermissions = new NymHostPermissionService({
    contains: async () => true,
    request: async () => true,
    remove: async () => true,
  });
  return new NymRuntimeController({ bridge, gatewayConfig, hostPermissions });
}

function mockBridge(setupImpl?: () => Promise<void>): OffscreenMixFetchBridge & {
  setup: ReturnType<typeof vi.fn>;
  emitLost: () => void;
} {
  let setupComplete = false;
  let onLost: (() => void) | null = null;
  const setup = vi.fn(async () => {
    if (setupImpl) await setupImpl();
    setupComplete = true;
  });
  const disconnect = vi.fn(async () => {
    setupComplete = false;
  });
  return {
    setup,
    disconnect,
    mixFetch: vi.fn(async () => new Response('ok')),
    queryStatus: vi.fn(async () =>
      setupComplete
        ? {
            state: 'connected' as const,
            connected: true,
            lastError: null,
            implementation: 'mix-fetch-offscreen',
            documentReady: true,
            diagnosticCode: 'OK',
            assetsReady: true,
            gatewayAllowlistConfigured: true,
          }
        : {
            state: 'disconnected' as const,
            connected: false,
            lastError: null,
            implementation: 'mix-fetch-offscreen',
            documentReady: false,
            diagnosticCode: 'OK',
            assetsReady: true,
            gatewayAllowlistConfigured: true,
          },
    ),
    watchConnection(cb: () => void) {
      onLost = cb;
      return () => {
        onLost = null;
      };
    },
    emitLost() {
      onLost?.();
    },
    get setupComplete() {
      return setupComplete;
    },
  } as unknown as OffscreenMixFetchBridge & {
    setup: ReturnType<typeof vi.fn>;
    emitLost: () => void;
  };
}

describe('NymRuntimeController lifecycle', () => {
  afterEach(() => {
    resetNymRuntimeControllerForTests(null);
  });

  it('reconnects after disconnect without MixFetchNymTransport is closed', async () => {
    const bridge = mockBridge();
    const ctrl = await seededController(bridge);

    const connected = await ctrl.connect();
    expect(connected.connected).toBe(true);
    expect(connected.documentReady).toBe(true);
    expect(bridge.setup).toHaveBeenCalledOnce();

    const afterDisc = await ctrl.disconnect();
    expect(afterDisc.connected).toBe(false);
    expect(afterDisc.documentReady).toBe(false);
    expect(afterDisc.state).toBe('disconnected');
    // Disconnect closes MixFetch and keeps the Nym choice. Clearnet stays closed.
    expect(afterDisc.mode).toBe('nym');
    expect(afterDisc.privacyPreference).toBe('nym');
    expect(afterDisc.egressBlocked).toBe(true);
    expect(ctrl.mode).toBe('nym');
    const clearnet = vi.fn(async () => new Response('clearnet'));
    vi.stubGlobal('fetch', clearnet);
    try {
      await expect(
        ctrl.getStellarFetch()('https://horizon-testnet.stellar.org/fee_stats'),
      ).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
      expect(clearnet).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }

    const again = await ctrl.connect();
    expect(again.connected).toBe(true);
    expect(bridge.setup).toHaveBeenCalledTimes(2);
    expect(again.lastError).toBeNull();
  });

  it('publishes MixFetch loss to listeners without a storage write', async () => {
    const bridge = mockBridge();
    const ctrl = await seededController(bridge);
    const published: Array<{ connected: boolean; egressBlocked: boolean; mode: string }> = [];
    ctrl.subscribeRuntimeStatus((snap) => {
      published.push({
        connected: snap.connected,
        egressBlocked: snap.egressBlocked,
        mode: snap.mode,
      });
    });
    await ctrl.connect();
    expect(ctrl.getSnapshot().connected).toBe(true);
    published.length = 0;
    bridge.emitLost();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ctrl.getSnapshot().connected).toBe(false);
    expect(ctrl.getSnapshot().egressBlocked).toBe(true);
    expect(ctrl.mode).toBe('nym');
    expect(published.some((snap) => snap.connected === false && snap.egressBlocked && snap.mode === 'nym')).toBe(
      true,
    );
  });

  it('serializes concurrent Connect into a single setup', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bridge = mockBridge(async () => {
      await gate;
    });
    const ctrl = await seededController(bridge);

    const p1 = ctrl.connect();
    const p2 = ctrl.connect();
    release();
    const [a, b] = await Promise.all([p1, p2]);
    expect(bridge.setup).toHaveBeenCalledOnce();
    expect(a.connected).toBe(true);
    expect(b.connected).toBe(true);
  });

  it('keeps error state retryable after failed setup', async () => {
    let setupComplete = false;
    const setup = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error('wasm boom');
      })
      .mockImplementationOnce(async () => {
        setupComplete = true;
      });
    const bridge = {
      setup,
      disconnect: vi.fn(async () => {
        setupComplete = false;
      }),
      mixFetch: vi.fn(async () => new Response('ok')),
      queryStatus: vi.fn(async () => ({
        state: setupComplete ? ('connected' as const) : ('disconnected' as const),
        connected: setupComplete,
        lastError: null,
        implementation: 'mix-fetch-offscreen',
        documentReady: setupComplete,
        diagnosticCode: 'OK',
        assetsReady: true,
        gatewayAllowlistConfigured: true,
      })),
      get setupComplete() {
        return setupComplete;
      },
    } as unknown as OffscreenMixFetchBridge;

    const ctrl = await seededController(bridge);

    await expect(ctrl.connect()).rejects.toMatchObject({ code: 'CONNECT_FAILED' });
    expect(ctrl.getSnapshot().connected).toBe(false);
    expect(ctrl.getSnapshot().documentReady).toBe(false);

    const ok = await ctrl.connect();
    expect(ok.connected).toBe(true);
    expect(setup).toHaveBeenCalledTimes(2);
  });

  it('bootstraps the verified gateway and connects without MV3 permissions on Android', async () => {
    const bridge = mockBridge();
    const gatewayConfig = new NymGatewayConfigService(memoryStorage());
    const ctrl = new NymRuntimeController({
      bridge,
      gatewayConfig,
      hostPermissions: new NymHostPermissionService(null),
      allowConnectWithoutHostPermission: true,
    });

    const snap = await ctrl.connect();
    expect(snap.connected).toBe(true);
    expect(snap.mode).toBe('nym');
    const saved = await gatewayConfig.load();
    expect(saved.selectedGateway).toBe(NYM_VERIFIED_GATEWAY.wssOrigin);
    expect(saved.identityKey).toBe(NYM_VERIFIED_GATEWAY.identityKey);
    expect(bridge.setup).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredGateway: NYM_VERIFIED_GATEWAY.identityKey,
        preferredNetworkRequester: NYM_VERIFIED_GATEWAY.networkRequesterAddress,
        disableCoverTraffic: true,
      }),
    );
  });

  it('fail-closes connect when the permission API is missing and the Android flag is off', async () => {
    const bridge = mockBridge();
    const gatewayConfig = new NymGatewayConfigService(memoryStorage());
    await gatewayConfig.addGateway(
      NYM_VERIFIED_GATEWAY.wssOrigin,
      NYM_VERIFIED_GATEWAY.identityKey,
    );
    const ctrl = new NymRuntimeController({
      bridge,
      gatewayConfig,
      hostPermissions: new NymHostPermissionService(null),
    });

    await expect(ctrl.connect()).rejects.toMatchObject({ code: 'CONNECT_FAILED' });
    expect(bridge.setup).not.toHaveBeenCalled();
    // Connect is an explicit Nym choice. Failure must not fall through to clearnet.
    expect(ctrl.mode).toBe('nym');
    expect(ctrl.getSnapshot().privacyPreference).toBe('nym');
    expect(ctrl.getSnapshot().egressBlocked).toBe(true);
    const clearnet = vi.fn(async () => new Response('clearnet'));
    vi.stubGlobal('fetch', clearnet);
    try {
      await expect(
        ctrl.getStellarFetch()('https://horizon-testnet.stellar.org/fee_stats'),
      ).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
      expect(clearnet).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
