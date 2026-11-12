import { describe, expect, it, vi } from 'vitest';

// Provide mocks for wallet-core paths imported by extension without root node_modules
vi.mock('@solanym/wallet-core/src/stellar/read/StellarReadClient.js', () => ({
  STELLAR_TESTNET_HORIZON_URL: 'https://horizon-testnet.stellar.org',
  STELLAR_TESTNET_FRIENDBOT_URL: 'https://friendbot.stellar.org',
  StellarReadClient: class {},
}));

vi.mock('@solanym/wallet-core/src/nym/NymTransport.js', () => {
  class MockMixFetchNymTransport {
    readonly implementation = 'mix-fetch';
    private _state = 'disconnected';
    private _lastError: string | null = null;
    bridge: any;

    constructor(bridge: any) {
      this.bridge = bridge;
    }

    getSnapshot() {
      return {
        state: this._state,
        lastError: this._lastError,
        connected: this._state === 'connected',
        implementation: this.implementation,
        selfAddress: null,
      };
    }

    async connect() {
      await this.bridge.setup();
      this._state = 'connected';
    }

    async close() {
      this._state = 'disconnected';
      await this.bridge.disconnect();
    }

    async fetch(url: string, init?: RequestInit) {
      if (this._state !== 'connected') {
        throw new Error('Nym mode: mixnet not connected; refusing clearnet fallback');
      }
      return this.bridge.mixFetch(url, init);
    }
  }

  return {
    MixFetchNymTransport: MockMixFetchNymTransport,
    NymTransportError: class extends Error {},
  };
});

vi.mock('@solanym/wallet-core/src/nym/NymTransportPolicy.js', () => {
  class MockFailClosedTransportRouter {
    private _mode: string;
    private readonly _nym: any;
    private readonly _directFetch: any;

    constructor(options: any) {
      this._mode = options.mode;
      this._nym = options.nym;
      this._directFetch = options.directFetch ?? globalThis.fetch;
    }

    get mode() {
      return this._mode;
    }

    setMode(mode: string) {
      this._mode = mode;
    }

    async fetch(url: string, init?: RequestInit) {
      if (this._mode === 'nym') {
        return this._nym.fetch(url, init);
      }
      return this._directFetch(url, init);
    }
  }

  return {
    FailClosedTransportRouter: MockFailClosedTransportRouter,
  };
});

import {
  NymRuntimeController,
  resetNymRuntimeControllerForTests,
} from '../../../src/background/nym/NymRuntimeController.js';
import { NymGatewayConfigService } from '../../../src/background/nym/NymGatewayConfigService.js';
import { NymHostPermissionService } from '../../../src/background/nym/NymHostPermissionService.js';
import { createNymSetModeHandler } from '../../../src/background/handlers/nymHandlers.js';

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

import { NYM_VERIFIED_GATEWAY } from '../../../src/nym-offscreen/verifiedGateway.js';

async function createTestController(bridgeOverrides: any = {}) {
  const bridge = {
    setup: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    mixFetch: vi.fn(async (_url: string, _init?: any) => {
      return new Response(JSON.stringify({ ok: true, data: 'from-mixnet' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
    queryStatus: vi.fn(async () => ({ ready: true })),
    ...bridgeOverrides,
  };

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

  const controller = new NymRuntimeController({
    bridge: bridge as any,
    gatewayConfig,
    hostPermissions,
  });

  return { controller, bridge };
}

describe('Nym Diagnostic Isolation & Direct/Nym mode policy', () => {
  it('controller starts in Direct mode by default (Horizon without Nym)', async () => {
    const { controller } = await createTestController();
    expect(controller.mode).toBe('direct');
    expect(controller.getSnapshot().mode).toBe('direct');
  });

  it('allows switching to Direct and Nym via setMode()', async () => {
    const { controller } = await createTestController();
    expect(() => controller.setMode('nym')).not.toThrow();
    expect(controller.mode).toBe('nym');
    expect(() => controller.setMode('direct')).not.toThrow();
    expect(controller.mode).toBe('direct');
  });

  it('allows Direct mode via createNymSetModeHandler() IPC handler', async () => {
    const { controller } = await createTestController();
    resetNymRuntimeControllerForTests(controller);

    const handler = createNymSetModeHandler();
    await controller.setMode('nym');
    const snap = await handler({ mode: 'direct' });
    expect(snap.mode).toBe('direct');
    expect(controller.mode).toBe('direct');
  });

  it('allows setting Nym mode via setMode("nym")', async () => {
    const { controller } = await createTestController();
    expect(() => controller.setMode('nym')).not.toThrow();
    expect(controller.mode).toBe('nym');
  });

  it('Nym public-data diagnostics call the Nym transport directly (not router.fetch)', async () => {
    const { controller, bridge } = await createTestController();
    await controller.connect();

    // Spy on router fetch
    const routerFetchSpy = vi.spyOn((controller as any)._router, 'fetch');
    const transportFetchSpy = vi.spyOn((controller as any)._transport, 'fetch');

    const result = await controller.fetchPublicData({
      transport: 'nym',
      url: 'https://postman-echo.com/post',
    });

    expect(transportFetchSpy).toHaveBeenCalled();
    expect(bridge.mixFetch).toHaveBeenCalled();
    expect(routerFetchSpy).not.toHaveBeenCalled();
    expect(result.transport).toBe('nym');
  });

  it('Nym Horizon diagnostics call the Nym transport directly (not router.fetch or getStellarFetch)', async () => {
    const { controller, bridge } = await createTestController({
      mixFetch: vi.fn(async () => {
        return new Response(
          JSON.stringify({
            horizon_version: '2.30.0',
            network_passphrase: 'Test SDF Network ; September 2015',
            last_ledger: '12345',
            last_ledger_base_fee: '100',
          }),
          { status: 200, headers: { 'content-type': 'application/hal+json' } },
        );
      }),
    });
    await controller.connect();

    const routerFetchSpy = vi.spyOn((controller as any)._router, 'fetch');
    const transportFetchSpy = vi.spyOn((controller as any)._transport, 'fetch');

    const result = await controller.probeStellarHorizon({
      transport: 'nym',
      horizonUrl: 'https://horizon-testnet.stellar.org',
    });

    expect(transportFetchSpy).toHaveBeenCalled();
    expect(bridge.mixFetch).toHaveBeenCalled();
    expect(routerFetchSpy).not.toHaveBeenCalled();
    expect(result.transport).toBe('nym');
    expect(result.state).toBe('success');
  });

  it('Nym disconnected means no fetch occurs (fail-closed without network call)', async () => {
    const { controller, bridge } = await createTestController();
    // Do NOT connect

    const transportFetchSpy = vi.spyOn((controller as any)._transport, 'fetch');

    const result = await controller.fetchPublicData({
      transport: 'nym',
      url: 'https://postman-echo.com/post',
    });

    expect(result.state).toBe('error');
    expect(result.message).toMatch(/not Ready/i);
    expect(transportFetchSpy).not.toHaveBeenCalled();
    expect(bridge.mixFetch).not.toHaveBeenCalled();
  });

  it('Nym request failure never triggers clearnet fallback', async () => {
    const { controller, bridge } = await createTestController({
      mixFetch: vi.fn(async () => {
        throw new Error('Mixnet drop connection lost');
      }),
    });
    await controller.connect();

    const clearnetFetch = vi.fn();
    vi.stubGlobal('fetch', clearnetFetch);

    try {
      const result = await controller.fetchPublicData({
        transport: 'nym',
        url: 'https://postman-echo.com/post',
      });

      expect(result.state).toBe('error');
      expect(result.message).toMatch(/Mixnet drop connection lost/i);
      expect(clearnetFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Diagnostic calls never mutate the shared router mode', async () => {
    const { controller } = await createTestController();
    await controller.connect();

    expect(controller.mode).toBe('nym');
    expect((controller as any)._router.mode).toBe('nym');

    // Run public data probe
    await controller.fetchPublicData({ transport: 'nym' });
    expect(controller.mode).toBe('nym');
    expect((controller as any)._router.mode).toBe('nym');

    // Run direct diagnostic
    const directMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', directMock);
    try {
      await controller.fetchPublicData({ transport: 'direct' });
      expect(controller.mode).toBe('nym');
      expect((controller as any)._router.mode).toBe('nym');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('A diagnostic explicitly requesting Direct uses isolated clearnet while wallet router is in Nym mode', async () => {
    const { controller, bridge } = await createTestController();
    await controller.connect();

    expect(controller.mode).toBe('nym');

    const directMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, source: 'clearnet' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', directMock);

    try {
      const result = await controller.fetchPublicData({
        transport: 'direct',
        url: 'https://postman-echo.com/post',
      });

      expect(directMock).toHaveBeenCalled();
      expect(bridge.mixFetch).not.toHaveBeenCalled();
      expect(result.transport).toBe('direct');
      expect(controller.mode).toBe('nym');
      expect((controller as any)._router.mode).toBe('nym');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
