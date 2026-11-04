import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getNymRuntimeController,
  NymRuntimeController,
  resetNymRuntimeControllerForTests,
} from '../../../src/background/nym/NymRuntimeController.js';
import { NymGatewayConfigService } from '../../../src/background/nym/NymGatewayConfigService.js';
import { NymHostPermissionService } from '../../../src/background/nym/NymHostPermissionService.js';
import { NymTransportPreferenceService } from '../../../src/background/nym/NymTransportPreferenceService.js';
import { NymHttpSmokeOperationStore } from '../../../src/background/nym/NymHttpSmokeOperationStore.js';
import { OffscreenMixFetchBridge } from '../../../src/background/nym/OffscreenMixFetchBridge.js';
import { NYM_VERIFIED_GATEWAY } from '../../../src/nym-offscreen/verifiedGateway.js';
import {
  createOffscreenBridgeHarness,
  createOffscreenBridgeTestHarness,
} from './offscreenBridgeHarness.js';

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
    seed: (key: string, value: unknown) => mem.set(key, value),
    peek: (key: string) => mem.get(key),
  };
}

async function seededControllerWithPreferenceStorage(
  bridge: OffscreenMixFetchBridge,
  preferredMode: 'nym' | 'direct' | null = 'nym',
  httpSmokeOperationStore?: NymHttpSmokeOperationStore,
): Promise<{
  controller: NymRuntimeController;
  preferenceStorage: ReturnType<typeof memoryStorage>;
  operationStore: NymHttpSmokeOperationStore;
}> {
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
  const preferenceStorage = memoryStorage();
  const operationStore =
    httpSmokeOperationStore ?? new NymHttpSmokeOperationStore(memoryStorage());
  const preferenceService = new NymTransportPreferenceService(preferenceStorage);
  await preferenceService.load();
  if (preferredMode !== null) {
    await preferenceService.setPreferredMode(preferredMode);
  }
  const controller = new NymRuntimeController({
    bridge,
    gatewayConfig,
    hostPermissions,
    preferenceService,
    httpSmokeOperationStore: operationStore,
  });
  await controller.restorePreference();
  return { controller, preferenceStorage, operationStore };
}

async function seededController(
  bridge: OffscreenMixFetchBridge,
  preferredMode: 'nym' | 'direct' | null = 'nym',
  httpSmokeOperationStore?: NymHttpSmokeOperationStore,
): Promise<NymRuntimeController> {
  const { controller } = await seededControllerWithPreferenceStorage(
    bridge,
    preferredMode,
    httpSmokeOperationStore,
  );
  return controller;
}

function mockBridge(setupImpl?: () => Promise<void>): OffscreenMixFetchBridge & {
  setup: ReturnType<typeof vi.fn>;
  setHttpSmokeState: (
    operationId: string,
    state: 'pending' | 'completed' | 'failed' | 'unknown',
    runtimeGeneration?: string,
  ) => void;
  setHttpSmokeStatusMissing: (operationId: string) => void;
} {
  let setupComplete = false;
  const httpSmokeStates = new Map<
    string,
    | {
        state: 'pending' | 'completed' | 'failed' | 'unknown';
        runtimeGeneration?: string;
      }
    | null
  >();
  const statusBridge = createOffscreenBridgeHarness(async (message) => ({
        channel: 'nym-offscreen',
        id: message.id,
        ok: true,
        payload:
          message.type === 'httpSmokeStatus'
            ? httpSmokeStates.get(message.operationId) === null
              ? null
              : {
                  operationId: message.operationId,
                  runtimeGeneration:
                    httpSmokeStates.get(message.operationId)?.runtimeGeneration ??
                    message.runtimeGeneration,
                  state:
                    httpSmokeStates.get(message.operationId)?.state ?? 'unknown',
                }
            : null,
      }));
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
    mixFetch: vi.fn(async (_url: string, init?: RequestInit) => {
      const operationId = (
        init as (RequestInit & { httpSmokeOperationId?: string }) | undefined
      )?.httpSmokeOperationId;
      if (operationId) httpSmokeStates.set(operationId, { state: 'completed' });
      return new Response('ok');
    }),
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
            runtimeGeneration: 'test-offscreen-generation',
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
            runtimeGeneration: 'test-offscreen-generation',
          },
    ),
    queryHttpSmokeOperation: vi.fn((operationId: string, runtimeGeneration: string) =>
      statusBridge.queryHttpSmokeOperation(operationId, runtimeGeneration),
    ),
    setHttpSmokeState: (
      operationId: string,
      state: 'pending' | 'completed' | 'failed' | 'unknown',
      runtimeGeneration?: string,
    ) => httpSmokeStates.set(operationId, { state, runtimeGeneration }),
    setHttpSmokeStatusMissing: (operationId: string) =>
      httpSmokeStates.set(operationId, null),
    get setupComplete() {
      return setupComplete;
    },
  } as unknown as OffscreenMixFetchBridge & {
    setup: ReturnType<typeof vi.fn>;
    setHttpSmokeState: (
      operationId: string,
      state: 'pending' | 'completed' | 'failed' | 'unknown',
      runtimeGeneration?: string,
    ) => void;
    setHttpSmokeStatusMissing: (operationId: string) => void;
  };
}

describe('NymRuntimeController lifecycle', () => {
  afterEach(() => {
    resetNymRuntimeControllerForTests(null);
  });

  it('logs one structured event when the production bridge authenticates its port', async () => {
    const harness = createOffscreenBridgeTestHarness(
      async () => {
        throw new Error('Authentication diagnostic must not send an IPC request');
      },
      { autoConnect: false },
    );
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      new NymRuntimeController({
        preferenceService: new NymTransportPreferenceService(memoryStorage()),
      });
      const port = harness.connectPort();

      await vi.waitFor(() =>
        expect(
          info.mock.calls.filter(
            ([event]) => event === '[Astrym][OffscreenBridge] authenticated',
          ),
        ).toHaveLength(1),
      );

      expect(info).toHaveBeenCalledWith(
        '[Astrym][OffscreenBridge] authenticated',
        expect.objectContaining({
          authenticated: true,
          senderId: 'test-extension',
          senderUrl: 'chrome-extension://test-extension/nym-offscreen.html',
          senderDocumentId: '123e4567-e89b-12d3-a456-426614174000',
          contextType: 'OFFSCREEN_DOCUMENT',
          contextDocumentUrl: 'chrome-extension://test-extension/nym-offscreen.html',
          contextDocumentId: '123e4567-e89b-12d3-a456-426614174000',
        }),
      );
      expect(port.isDisconnected()).toBe(false);
      expect(port.requests).toHaveLength(0);
    } finally {
      info.mockRestore();
    }
  });

  it('registers one bridge listener for the Service Worker controller singleton', () => {
    const harness = createOffscreenBridgeTestHarness(
      async () => {
        throw new Error('This test must not send an IPC request');
      },
      { autoConnect: false },
    );
    const initialListenerCount = harness.getConnectListenerCount();

    const first = getNymRuntimeController(
      new NymTransportPreferenceService(memoryStorage()),
    );
    const second = getNymRuntimeController(
      new NymTransportPreferenceService(memoryStorage()),
    );

    expect(second).toBe(first);
    expect(harness.getConnectListenerCount()).toBe(initialListenerCount + 1);
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

    const again = await ctrl.connect();
    expect(again.connected).toBe(true);
    expect(bridge.setup).toHaveBeenCalledTimes(2);
    expect(again.lastError).toBeNull();
    expect(again.preferredMode).toBe('nym');
  });

  it('uses strict cleanup for live smoke without changing transport preference or mode', async () => {
    const bridge = mockBridge();
    const ctrl = await seededController(bridge, 'direct');
    await ctrl.connect();
    const disconnect = vi.spyOn(bridge, 'disconnect');

    const afterSmokeCleanup = await ctrl.disconnectForLiveSmoke();

    expect(disconnect).toHaveBeenCalledWith({ strict: true });
    expect(afterSmokeCleanup).toMatchObject({
      connected: false,
      documentReady: false,
      mode: 'direct',
      preferredMode: 'direct',
    });
    expect((ctrl as any)._router.mode).toBe('direct');
  });

  it('runs a later Connect after an earlier Disconnect completes', async () => {
    let releaseSetup!: () => void;
    const setupGate = new Promise<void>((resolve) => {
      releaseSetup = resolve;
    });
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const bridge = mockBridge(async () => setupGate);
    vi.spyOn(bridge, 'disconnect').mockImplementation(async () => {
      await closeGate;
    });
    const ctrl = await seededController(bridge, 'direct');
    const syncGatewayConfig = vi.spyOn(ctrl, 'syncGatewayConfigUi');

    const disconnectPromise = ctrl.disconnect();
    await vi.waitFor(() => expect(bridge.disconnect).toHaveBeenCalledOnce());

    const connectPromise = ctrl.connect();
    expect(syncGatewayConfig).not.toHaveBeenCalled();
    expect(bridge.setup).not.toHaveBeenCalled();

    releaseClose();
    await disconnectPromise;
    await vi.waitFor(() => expect(bridge.setup).toHaveBeenCalledOnce());
    expect(syncGatewayConfig).toHaveBeenCalledOnce();
    releaseSetup();
    const connected = await connectPromise;

    expect(ctrl.getSnapshot()).toMatchObject({
      connected: true,
      preferredMode: 'direct',
      mode: 'direct',
    });
    expect((ctrl as any)._router.mode).toBe('direct');
  });

  it('continues queued lifecycle operations after Connect fails', async () => {
    let rejectSetup!: (reason: Error) => void;
    const setupGate = new Promise<void>((_resolve, reject) => {
      rejectSetup = reject;
    });
    const bridge = mockBridge(async () => setupGate);
    const ctrl = await seededController(bridge, 'direct');

    const connectPromise = ctrl.connect();
    await vi.waitFor(() => expect(bridge.setup).toHaveBeenCalledOnce());
    const disconnectPromise = ctrl.disconnect();
    expect(bridge.disconnect).not.toHaveBeenCalled();

    rejectSetup(new Error('setup failed'));
    await expect(connectPromise).rejects.toMatchObject({ code: 'CONNECT_FAILED' });
    const disconnected = await disconnectPromise;

    expect(bridge.disconnect).toHaveBeenCalledOnce();
    expect(disconnected).toMatchObject({
      connected: false,
      preferredMode: 'direct',
      mode: 'direct',
    });
    expect((ctrl as any)._router.mode).toBe('direct');
  });

  it('starts unselected and blocks network operations until explicit selection', async () => {
    const bridge = mockBridge();
    const ctrl = await seededController(bridge, null);

    expect(ctrl.getSnapshot()).toMatchObject({
      preferredMode: null,
      preferenceLoaded: true,
      preferenceError: null,
    });
    await expect(ctrl.connect()).rejects.toMatchObject({
      code: 'TRANSPORT_PREFERENCE_REQUIRED',
    });
    await expect(
      ctrl.getStellarFetch()('https://horizon-testnet.stellar.org'),
    ).rejects.toThrow(/transport preference/i);
    expect(bridge.setup).not.toHaveBeenCalled();
    expect(bridge.mixFetch).not.toHaveBeenCalled();
  });

  it('restores Direct and connection lifecycle does not change the selected preference', async () => {
    const bridge = mockBridge();
    const { controller: ctrl, preferenceStorage } = await seededControllerWithPreferenceStorage(
      bridge,
      'direct',
    );

    expect(ctrl.getSnapshot()).toMatchObject({
      mode: 'direct',
      preferredMode: 'direct',
      preferenceLoaded: true,
    });
    const connected = await ctrl.connect();
    expect(connected.connected).toBe(true);
    expect(connected.preferredMode).toBe('direct');
    expect((ctrl as any)._router.mode).toBe('direct');
    await ctrl.disconnect();
    expect(ctrl.getSnapshot()).toMatchObject({
      connected: false,
      mode: 'direct',
      preferredMode: 'direct',
    });
    expect((ctrl as any)._router.mode).toBe('direct');
    expect(preferenceStorage.peek('solanym_transport_preference_v1')).toEqual({
      version: 1,
      preferredMode: 'direct',
    });
  });

  it('keeps Direct applied when a pending Nym connection completes and routes wallet fetches through Direct', async () => {
    let releaseSetup!: () => void;
    const setupGate = new Promise<void>((resolve) => {
      releaseSetup = resolve;
    });
    const bridge = mockBridge(async () => setupGate);
    const { controller, preferenceStorage } = await seededControllerWithPreferenceStorage(
      bridge,
      'nym',
    );
    const directFetch = vi.fn(async () => new Response('direct response'));
    vi.stubGlobal('fetch', directFetch);

    try {
      expect(controller.getSnapshot()).toMatchObject({
        preferredMode: 'nym',
        mode: 'nym',
        connected: false,
      });
      expect(preferenceStorage.peek('solanym_transport_preference_v1')).toEqual({
        version: 1,
        preferredMode: 'nym',
      });

      const connectPromise = controller.connect();
      await vi.waitFor(() => expect(bridge.setup).toHaveBeenCalledOnce());

      const directSelection = await controller.setPreferredMode('direct');
      expect(directSelection).toMatchObject({
        preferredMode: 'direct',
        mode: 'direct',
        connected: false,
      });
      expect((controller as any)._router.mode).toBe('direct');
      expect(preferenceStorage.peek('solanym_transport_preference_v1')).toEqual({
        version: 1,
        preferredMode: 'direct',
      });

      releaseSetup();
      const connected = await connectPromise;

      expect(connected.connected).toBe(true);
      expect(connected.preferredMode).toBe('direct');
      expect(connected.mode).toBe('direct');
      expect(controller.mode).toBe('direct');
      expect((controller as any)._router.mode).toBe('direct');
      expect(preferenceStorage.peek('solanym_transport_preference_v1')).toEqual({
        version: 1,
        preferredMode: 'direct',
      });

      const walletFetch = controller.getStellarFetch();
      await walletFetch('https://horizon-testnet.stellar.org/accounts/GABC');

      expect(directFetch).toHaveBeenCalledOnce();
      expect(directFetch).toHaveBeenCalledWith(
        'https://horizon-testnet.stellar.org/accounts/GABC',
        undefined,
      );
      expect(bridge.mixFetch).not.toHaveBeenCalled();
      expect(controller.getSnapshot()).toMatchObject({
        preferredMode: 'direct',
        mode: 'direct',
        connected: true,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not fall back to Direct for an ordinary wallet fetch when Nym is selected but disconnected', async () => {
    const bridge = mockBridge();
    const controller = await seededController(bridge, 'nym');
    const directFetch = vi.fn(async () => new Response('unexpected direct response'));
    vi.stubGlobal('fetch', directFetch);

    try {
      await expect(
        controller.getStellarFetch()('https://horizon-testnet.stellar.org/accounts/GABC'),
      ).rejects.toThrow(/refusing clearnet fallback/i);

      expect(directFetch).not.toHaveBeenCalled();
      expect(bridge.mixFetch).not.toHaveBeenCalled();
      expect(controller.getSnapshot()).toMatchObject({
        preferredMode: 'nym',
        mode: 'nym',
        connected: false,
      });
      expect((controller as any)._router.mode).toBe('nym');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not fall back to Direct when an explicit Nym operation fails under Direct preference', async () => {
    const bridge = mockBridge();
    vi.mocked(bridge.mixFetch).mockRejectedValueOnce(new Error('Mixnet request failed'));
    const controller = await seededController(bridge, 'direct');
    const directFetch = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', directFetch);

    try {
      await controller.connect();
      const result = await controller.fetchPublicData({
        transport: 'nym',
        url: 'https://postman-echo.com/post',
        timeoutMs: 100,
      });

      expect(result.state).toBe('error');
      expect(result.transport).toBe('nym');
      expect(result.message).toMatch(/Mixnet request failed/);
      expect(bridge.mixFetch).toHaveBeenCalledOnce();
      expect(directFetch).not.toHaveBeenCalled();
      expect(controller.getSnapshot()).toMatchObject({
        preferredMode: 'direct',
        mode: 'direct',
        connected: true,
      });
      expect((controller as any)._router.mode).toBe('direct');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the last persisted preference when selections change repeatedly during Connect', async () => {
    let releaseSetup!: () => void;
    const setupGate = new Promise<void>((resolve) => {
      releaseSetup = resolve;
    });
    const bridge = mockBridge(async () => setupGate);
    const { controller, preferenceStorage } = await seededControllerWithPreferenceStorage(
      bridge,
      'nym',
    );
    const writtenModes: string[] = [];
    const originalSet = preferenceStorage.set;
    vi.spyOn(preferenceStorage, 'set').mockImplementation(async (items) => {
      const preference = items['solanym_transport_preference_v1'] as {
        preferredMode: 'nym' | 'direct';
      };
      writtenModes.push(preference.preferredMode);
      await originalSet(items);
    });

    const connectPromise = controller.connect();
    await vi.waitFor(() => expect(bridge.setup).toHaveBeenCalledOnce());

    await controller.setPreferredMode('direct');
    await controller.setPreferredMode('nym');
    expect(controller.getSnapshot()).toMatchObject({
      preferredMode: 'nym',
      mode: 'nym',
      connected: false,
    });
    expect(preferenceStorage.peek('solanym_transport_preference_v1')).toEqual({
      version: 1,
      preferredMode: 'nym',
    });

    releaseSetup();
    const connected = await connectPromise;

    expect(writtenModes).toEqual(['direct', 'nym']);
    expect(connected).toMatchObject({
      preferredMode: 'nym',
      mode: 'nym',
      connected: true,
    });
    expect(controller.mode).toBe('nym');
    expect((controller as any)._router.mode).toBe('nym');
    expect(preferenceStorage.peek('solanym_transport_preference_v1')).toEqual({
      version: 1,
      preferredMode: 'nym',
    });
  });

  it('does not apply or publish a mode when persistence fails, and later writes recover', async () => {
    const storage = memoryStorage();
    const preferenceService = new NymTransportPreferenceService(storage);
    await preferenceService.load();
    const bridge = mockBridge();
    const gatewayConfig = new NymGatewayConfigService(memoryStorage());
    const hostPermissions = new NymHostPermissionService({
      contains: async () => true,
      request: async () => true,
      remove: async () => true,
    });
    const ctrl = new NymRuntimeController({
      bridge,
      gatewayConfig,
      hostPermissions,
      preferenceService,
    });
    await ctrl.restorePreference();
    const events: string[] = [];
    const originalSet = storage.set;
    vi.spyOn(storage, 'set').mockImplementation(async (items) => {
      events.push('write-start');
      await originalSet(items);
      events.push('write-committed');
    });
    const routerSetMode = (ctrl as any)._router.setMode.bind((ctrl as any)._router);
    vi.spyOn((ctrl as any)._router, 'setMode').mockImplementation((mode: unknown) => {
      if (mode !== 'nym' && mode !== 'direct') throw new Error('unexpected router mode');
      events.push(`router:${mode}`);
      routerSetMode(mode);
    });

    await ctrl.setPreferredMode('nym');
    expect(events).toEqual(['write-start', 'write-committed', 'router:nym']);
    events.length = 0;
    vi.mocked(storage.set).mockImplementationOnce(async () => {
      events.push('write-failed');
      throw new Error('private storage failure');
    });

    const failed = await ctrl.setPreferredMode('direct');
    expect(events).toEqual(['write-failed']);
    expect(failed).toMatchObject({
      mode: 'nym',
      preferredMode: 'nym',
      preferenceLoaded: true,
      preferenceError: 'STORAGE_WRITE_FAILED',
    });

    events.length = 0;
    const recovered = await ctrl.setPreferredMode('direct');
    expect(events).toEqual(['write-start', 'write-committed', 'router:direct']);
    expect(recovered).toMatchObject({
      mode: 'direct',
      preferredMode: 'direct',
      preferenceLoaded: true,
      preferenceError: null,
    });
  });

  it('serializes concurrent persist-and-apply selections in invocation order', async () => {
    const storage = memoryStorage();
    let releaseFirstWrite!: () => void;
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const originalSet = storage.set;
    const writtenModes: string[] = [];
    let firstWrite = true;
    vi.spyOn(storage, 'set').mockImplementation(async (items) => {
      const record = items['solanym_transport_preference_v1'] as {
        preferredMode: string;
      };
      writtenModes.push(record.preferredMode);
      if (firstWrite) {
        firstWrite = false;
        await firstWriteGate;
      }
      await originalSet(items);
    });
    const preferenceService = new NymTransportPreferenceService(storage);
    await preferenceService.load();
    const bridge = mockBridge();
    const ctrl = new NymRuntimeController({
      bridge,
      gatewayConfig: new NymGatewayConfigService(memoryStorage()),
      hostPermissions: new NymHostPermissionService({
        contains: async () => true,
        request: async () => true,
        remove: async () => true,
      }),
      preferenceService,
    });
    await ctrl.restorePreference();

    const first = ctrl.setPreferredMode('nym');
    const second = ctrl.setPreferredMode('direct');
    await vi.waitFor(() => {
      expect(writtenModes).toEqual(['nym']);
    });
    releaseFirstWrite();
    await Promise.all([first, second]);

    expect(writtenModes).toEqual(['nym', 'direct']);
    expect(ctrl.getSnapshot()).toMatchObject({
      mode: 'direct',
      preferredMode: 'direct',
    });
    expect(await preferenceService.load()).toMatchObject({
      preferredMode: 'direct',
      preferenceLoaded: true,
    });
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

  it('rejects a stale popup snapshot and returns current readiness without fetching', async () => {
    const bridge = mockBridge();
    const ctrl = await seededController(bridge);
    await ctrl.connect();
    const staleToken = ctrl.getSnapshot().readinessToken;
    await ctrl.disconnect();
    await ctrl.connect();

    const result = await ctrl.runHttpSmoke(undefined, staleToken);

    expect(result).toMatchObject({
      state: 'error',
      code: 'STALE_READINESS',
      mixFetchInvoked: false,
      snapshot: { connected: true },
    });
    expect(result.snapshot?.readinessToken).toEqual(ctrl.getSnapshot().readinessToken);
    expect(bridge.mixFetch).not.toHaveBeenCalled();
  });

  it('rejects HTTP smoke when the persisted preference is Direct', async () => {
    const bridge = mockBridge();
    const ctrl = await seededController(bridge, 'direct');
    await ctrl.connect();

    await expect(
      ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken),
    ).rejects.toMatchObject({
      name: 'NymPreferenceRequiredError',
      code: 'NYM_PREFERENCE_REQUIRED',
    });
    expect(bridge.mixFetch).not.toHaveBeenCalled();
  });

  it('rejects HTTP smoke when no transport preference is selected', async () => {
    const bridge = mockBridge();
    const ctrl = await seededController(bridge, null);

    await expect(
      ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken),
    ).rejects.toMatchObject({
      name: 'NymPreferenceRequiredError',
      code: 'NYM_PREFERENCE_REQUIRED',
    });
    expect(bridge.mixFetch).not.toHaveBeenCalled();
  });

  it('rejects HTTP smoke when the persisted preference is invalid', async () => {
    const bridge = mockBridge();
    const { controller: ctrl, preferenceStorage } =
      await seededControllerWithPreferenceStorage(bridge);
    await ctrl.connect();
    await preferenceStorage.set({
      solanym_transport_preference_v1: { version: 1, preferredMode: 'automatic' },
    });

    await expect(
      ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken),
    ).rejects.toMatchObject({
      name: 'NymPreferenceRequiredError',
      code: 'NYM_PREFERENCE_REQUIRED',
    });
    expect(bridge.mixFetch).not.toHaveBeenCalled();
  });

  it('rejects HTTP smoke when reading the persisted preference fails', async () => {
    const bridge = mockBridge();
    const { controller: ctrl, preferenceStorage } =
      await seededControllerWithPreferenceStorage(bridge);
    await ctrl.connect();
    vi.spyOn(preferenceStorage, 'get').mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(
      ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken),
    ).rejects.toMatchObject({
      name: 'NymPreferenceRequiredError',
      code: 'NYM_PREFERENCE_REQUIRED',
    });
    expect(ctrl.getSnapshot().preferenceError).toBe('STORAGE_READ_FAILED');
    expect(bridge.mixFetch).not.toHaveBeenCalled();
  });

  it('rejects HTTP smoke while a preference write error is pending', async () => {
    const bridge = mockBridge();
    const { controller: ctrl, preferenceStorage } =
      await seededControllerWithPreferenceStorage(bridge);
    await ctrl.connect();
    vi.spyOn(preferenceStorage, 'set').mockRejectedValueOnce(new Error('storage unavailable'));
    const preference = await ctrl.setPreferredMode('direct');

    expect(preference).toMatchObject({
      preferredMode: 'nym',
      preferenceError: 'STORAGE_WRITE_FAILED',
    });
    await expect(
      ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken),
    ).rejects.toMatchObject({
      name: 'NymPreferenceRequiredError',
      code: 'NYM_PREFERENCE_REQUIRED',
    });
    expect(bridge.mixFetch).not.toHaveBeenCalled();
  });

  it('rejects HTTP smoke when the effective router mode is Direct despite a Nym preference snapshot', async () => {
    const bridge = mockBridge();
    const ctrl = await seededController(bridge);
    await ctrl.connect();
    (
      ctrl as unknown as { applyMode(mode: 'direct'): void }
    ).applyMode('direct');

    expect(ctrl.getSnapshot()).toMatchObject({
      preferredMode: 'nym',
      mode: 'direct',
    });
    await expect(
      ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken),
    ).rejects.toMatchObject({
      name: 'NymPreferenceRequiredError',
      code: 'NYM_PREFERENCE_REQUIRED',
    });
    expect(bridge.mixFetch).not.toHaveBeenCalled();
  });

  it('rejects if preference changes from Nym to Direct while status is pending', async () => {
    const bridge = mockBridge();
    const ctrl = await seededController(bridge);
    await ctrl.connect();
    let resolveStatus!: (status: Awaited<ReturnType<OffscreenMixFetchBridge['queryStatus']>>) => void;
    const statusPromise = new Promise<
      Awaited<ReturnType<OffscreenMixFetchBridge['queryStatus']>>
    >((resolve) => {
      resolveStatus = resolve;
    });
    const queryStatus = vi.spyOn(bridge, 'queryStatus').mockReturnValueOnce(statusPromise);
    const queryStatusCallsBefore = queryStatus.mock.calls.length;

    const smokePromise = ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken);
    await vi.waitFor(() =>
      expect(queryStatus).toHaveBeenCalledTimes(queryStatusCallsBefore + 1),
    );
    await ctrl.setPreferredMode('direct');
    resolveStatus({
      state: 'connected',
      connected: true,
      lastError: null,
      implementation: 'mix-fetch-offscreen',
      documentReady: true,
      diagnosticCode: 'OK',
      assetsReady: true,
      gatewayAllowlistConfigured: true,
    });

    await expect(smokePromise).rejects.toMatchObject({
      name: 'NymPreferenceRequiredError',
      code: 'NYM_PREFERENCE_REQUIRED',
    });
    expect(bridge.mixFetch).not.toHaveBeenCalled();
  });

  it('does not cancel MixFetch when preference changes after dispatch', async () => {
    const bridge = mockBridge();
    const ctrl = await seededController(bridge);
    await ctrl.connect();
    let resolveResponse!: (response: Response) => void;
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    let probeId = '';
    vi.mocked(bridge.mixFetch).mockImplementationOnce(async (_url, init) => {
      probeId = (
        JSON.parse(String(init?.body)) as { solanymProbeId: string }
      ).solanymProbeId;
      return responsePromise;
    });

    const smokePromise = ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken);
    await vi.waitFor(() => expect(bridge.mixFetch).toHaveBeenCalledOnce());
    await expect(ctrl.setPreferredMode('direct')).resolves.toMatchObject({
      preferredMode: 'direct',
      mode: 'direct',
    });
    resolveResponse(
      new Response(JSON.stringify({ json: { solanymProbeId: probeId } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(smokePromise).resolves.toMatchObject({
      state: 'success',
      mixFetchInvoked: true,
      probeMatched: true,
    });
    expect(ctrl.getSnapshot().preferredMode).toBe('direct');
  });

  it('rejects a readiness token from a different controller epoch', async () => {
    const bridge = mockBridge();
    const ctrl = await seededController(bridge);
    await ctrl.connect();

    const result = await ctrl.runHttpSmoke(undefined, {
      controllerEpoch: 'previous-worker',
      readinessRevision: ctrl.getSnapshot().readinessToken.readinessRevision,
    });

    expect(result.code).toBe('STALE_READINESS');
    expect(result.snapshot?.readinessToken.controllerEpoch).toBe(
      ctrl.getSnapshot().readinessToken.controllerEpoch,
    );
    expect(result.mixFetchInvoked).toBe(false);
    expect(bridge.mixFetch).not.toHaveBeenCalled();
  });

  it('rejects a readiness revision mismatch', async () => {
    const bridge = mockBridge();
    const ctrl = await seededController(bridge);
    const oldToken = ctrl.getSnapshot().readinessToken;
    await ctrl.connect();

    const result = await ctrl.runHttpSmoke(undefined, oldToken);

    expect(result.code).toBe('STALE_READINESS');
    expect(result.snapshot?.readinessToken.readinessRevision).toBeGreaterThan(
      oldToken.readinessRevision,
    );
    expect(result.mixFetchInvoked).toBe(false);
    expect(bridge.mixFetch).not.toHaveBeenCalled();
  });

  it('does not adopt a connected offscreen runtime when the local controller has no transport', async () => {
    const bridge = mockBridge();
    vi.spyOn(bridge, 'queryStatus').mockResolvedValue({
      state: 'connected',
      connected: true,
      lastError: null,
      diagnosticCode: 'OK',
      implementation: 'mix-fetch-offscreen',
      documentReady: true,
      assetsReady: true,
      gatewayAllowlistConfigured: true,
    });
    const ctrl = await seededController(bridge);

    const result = await ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken);

    expect(result.code).toBe('STALE_READINESS');
    expect(result.snapshot?.connected).toBe(false);
    expect(result.snapshot?.documentReady).toBe(true);
    expect(bridge.mixFetch).not.toHaveBeenCalled();
  });

  it('requires explicit Connect after controller recreation and then permits mocked MixFetch', async () => {
    const bridge = mockBridge();
    const ctrl = await seededController(bridge);
    vi.spyOn(bridge, 'queryStatus').mockImplementation(async () => ({
      state: 'connected',
      connected: true,
      lastError: null,
      diagnosticCode: 'OK',
      implementation: 'mix-fetch-offscreen',
      documentReady: true,
      assetsReady: true,
      gatewayAllowlistConfigured: true,
      runtimeGeneration: 'test-offscreen-generation',
    }));

    const beforeConnect = await ctrl.runHttpSmoke(
      undefined,
      ctrl.getSnapshot().readinessToken,
    );
    expect(beforeConnect.code).toBe('STALE_READINESS');
    expect(bridge.mixFetch).not.toHaveBeenCalled();

    await ctrl.connect();
    const token = ctrl.getSnapshot().readinessToken;
    vi.spyOn(bridge, 'mixFetch').mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { solanymProbeId: string };
      return new Response(JSON.stringify({ json: request }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await ctrl.runHttpSmoke(undefined, token);

    expect(result).toMatchObject({
      state: 'success',
      mixFetchInvoked: true,
      probeMatched: true,
    });
    expect(bridge.mixFetch).toHaveBeenCalledOnce();
  });

  it('rejects local transport readiness when its bridge setup is unavailable', async () => {
    const bridge = mockBridge();
    const ctrl = await seededController(bridge);
    await ctrl.connect();
    await bridge.disconnect();

    const result = await ctrl.runHttpSmoke(
      undefined,
      ctrl.getSnapshot().readinessToken,
    );

    expect(result.code).toBe('STALE_READINESS');
    expect(result.snapshot?.connected).toBe(false);
    expect(result.mixFetchInvoked).toBe(false);
    expect(bridge.mixFetch).not.toHaveBeenCalled();
  });

  it('rejects an open but disconnected offscreen runtime', async () => {
    const bridge = mockBridge();
    const ctrl = await seededController(bridge);
    await ctrl.connect();
    vi.spyOn(bridge, 'queryStatus').mockResolvedValue({
      state: 'disconnected',
      connected: false,
      lastError: null,
      diagnosticCode: 'OK',
      implementation: 'mix-fetch-offscreen',
      documentReady: true,
      assetsReady: true,
      gatewayAllowlistConfigured: true,
    });

    const result = await ctrl.runHttpSmoke(
      undefined,
      ctrl.getSnapshot().readinessToken,
    );

    expect(result.code).toBe('STALE_READINESS');
    expect(result.snapshot?.connected).toBe(false);
    expect(result.snapshot?.documentReady).toBe(true);
    expect(result.mixFetchInvoked).toBe(false);
    expect(bridge.mixFetch).not.toHaveBeenCalled();
  });

  it('blocks another HTTP Smoke dispatch while a timed-out operation remains pending', async () => {
    const bridge = mockBridge();
    const ctrl = await seededController(bridge);
    await ctrl.connect();
    vi.mocked(bridge.mixFetch).mockImplementationOnce(
      async () => new Promise<Response>(() => undefined),
    );

    const first = await ctrl.runHttpSmoke(
      { timeoutMs: 1 },
      ctrl.getSnapshot().readinessToken,
    );
    const operationId = (
      bridge.mixFetch.mock.calls[0]?.[1] as
        | (RequestInit & { httpSmokeOperationId?: string })
        | undefined
    )?.httpSmokeOperationId;

    expect(first.state).toBe('timeout');
    expect(operationId).toBeTruthy();
    bridge.setHttpSmokeState(operationId!, 'pending');
    await expect(
      ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken),
    ).rejects.toMatchObject({ code: 'HTTP_SMOKE_OPERATION_PENDING' });
    expect(bridge.mixFetch).toHaveBeenCalledOnce();

    await ctrl.fetchPublicData({
      transport: 'nym',
      url: 'https://postman-echo.com/post',
    });
    expect(bridge.mixFetch).toHaveBeenCalledTimes(2);
    expect(
      (bridge.mixFetch.mock.calls[1]?.[1] as
        | (RequestInit & { httpSmokeOperationId?: string })
        | undefined)?.httpSmokeOperationId,
    ).toBeUndefined();
  });

  it('keeps an unresolved operation blocking when the authenticated status RPC times out', async () => {
    const operationId = 'rpc-timeout-operation';
    const runtimeGeneration = 'test-offscreen-generation';
    let fetchRequestCount = 0;
    const bridgeHarness = createOffscreenBridgeTestHarness(async (request) => {
      if (request.type === 'httpSmokeStatus') {
        return new Promise(() => undefined);
      }
      if (request.type === 'fetch') fetchRequestCount += 1;
      const payload = request.type === 'connect' || request.type === 'status'
        ? {
            state: 'connected',
            connected: true,
            lastError: null,
            diagnosticCode: 'OK',
            implementation: 'mix-fetch-offscreen',
            documentReady: true,
            assetsReady: true,
            gatewayAllowlistConfigured: true,
            runtimeGeneration,
          }
        : { pong: true, documentReady: true };
      return {
        channel: 'nym-offscreen',
        id: request.id,
        ok: true,
        payload,
      };
    }, { rpcTimeoutMs: 20 });
    const storage = memoryStorage();
    const operationStore = new NymHttpSmokeOperationStore(storage);
    await operationStore.save({
      operationId,
      runtimeGeneration,
      state: 'pending',
      createdAt: 1,
      updatedAt: 1,
      callerTimedOut: false,
    });
    const { controller } = await seededControllerWithPreferenceStorage(
      bridgeHarness.bridge,
      'nym',
      operationStore,
    );
    await controller.connect();

    await expect(
      controller.runHttpSmoke(undefined, controller.getSnapshot().readinessToken),
    ).rejects.toMatchObject({ code: 'HTTP_SMOKE_OPERATION_PENDING' });
    expect((await operationStore.loadAll())[0]).toMatchObject({
      operationId,
      state: 'unknown',
    });
    expect(fetchRequestCount).toBe(0);
  });

  it('reserves the Smoke slot synchronously for simultaneous callers', async () => {
    const bridge = mockBridge();
    const ctrl = await seededController(bridge);
    await ctrl.connect();
    vi.mocked(bridge.mixFetch).mockImplementationOnce(
      async () => new Promise<Response>(() => undefined),
    );
    let resolveStatus!: (
      status: Awaited<ReturnType<OffscreenMixFetchBridge['queryStatus']>>,
    ) => void;
    const statusPromise = new Promise<
      Awaited<ReturnType<OffscreenMixFetchBridge['queryStatus']>>
    >((resolve) => {
      resolveStatus = resolve;
    });
    const queryStatus = vi.spyOn(bridge, 'queryStatus').mockReturnValueOnce(statusPromise);

    const first = ctrl.runHttpSmoke(
      { timeoutMs: 1 },
      ctrl.getSnapshot().readinessToken,
    );
    await vi.waitFor(() => expect(queryStatus).toHaveBeenCalledOnce());
    await expect(
      ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken),
    ).rejects.toMatchObject({ code: 'HTTP_SMOKE_OPERATION_PENDING' });
    resolveStatus({
      state: 'connected',
      connected: true,
      lastError: null,
      implementation: 'mix-fetch-offscreen',
      documentReady: true,
      diagnosticCode: 'OK',
      assetsReady: true,
      gatewayAllowlistConfigured: true,
      runtimeGeneration: 'test-offscreen-generation',
    });
    await expect(first).resolves.toMatchObject({ state: 'timeout' });
    expect(bridge.mixFetch).toHaveBeenCalledOnce();
  });

  it('reconciles and preserves late success after controller recreation', async () => {
    const bridge = mockBridge();
    const operationStore = new NymHttpSmokeOperationStore(memoryStorage());
    const firstController = await seededController(bridge, 'nym', operationStore);
    await firstController.connect();
    vi.mocked(bridge.mixFetch).mockImplementationOnce(
      async () => new Promise<Response>(() => undefined),
    );

    const timedOut = await firstController.runHttpSmoke(
      { timeoutMs: 1 },
      firstController.getSnapshot().readinessToken,
    );
    expect(timedOut.state).toBe('timeout');
    const previousOperationId = (
      bridge.mixFetch.mock.calls[0]?.[1] as
        | (RequestInit & { httpSmokeOperationId?: string })
        | undefined
    )?.httpSmokeOperationId;
    expect(previousOperationId).toBeTruthy();
    bridge.setHttpSmokeState(previousOperationId!, 'completed');

    const nextController = await seededController(bridge, 'nym', operationStore);
    await nextController.connect();
    const result = await nextController.runHttpSmoke(
      undefined,
      nextController.getSnapshot().readinessToken,
    );

    expect(result.mixFetchInvoked).toBe(true);
    expect(bridge.queryHttpSmokeOperation).toHaveBeenCalledWith(
      previousOperationId,
      'test-offscreen-generation',
    );
    expect(
      (await operationStore.loadAll()).find(
        (operation) => operation.operationId === previousOperationId,
      )?.state,
    ).toBe('completed');
    expect(bridge.mixFetch).toHaveBeenCalledTimes(2);
  });

  it('reconciles and preserves late failure after controller recreation', async () => {
    const bridge = mockBridge();
    const operationStore = new NymHttpSmokeOperationStore(memoryStorage());
    const firstController = await seededController(bridge, 'nym', operationStore);
    await firstController.connect();
    vi.mocked(bridge.mixFetch).mockImplementationOnce(
      async () => new Promise<Response>(() => undefined),
    );

    await firstController.runHttpSmoke(
      { timeoutMs: 1 },
      firstController.getSnapshot().readinessToken,
    );
    const previousOperationId = (
      bridge.mixFetch.mock.calls[0]?.[1] as
        | (RequestInit & { httpSmokeOperationId?: string })
        | undefined
    )?.httpSmokeOperationId;
    expect(previousOperationId).toBeTruthy();
    bridge.setHttpSmokeState(previousOperationId!, 'failed');

    const nextController = await seededController(bridge, 'nym', operationStore);
    await nextController.connect();
    await nextController.runHttpSmoke(
      undefined,
      nextController.getSnapshot().readinessToken,
    );

    expect(
      (await operationStore.loadAll()).find(
        (operation) => operation.operationId === previousOperationId,
      )?.state,
    ).toBe('failed');
    expect(bridge.mixFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps an operation unknown and blocks dispatch after offscreen recreation', async () => {
    const bridge = mockBridge();
    const operationStore = new NymHttpSmokeOperationStore(memoryStorage());
    const firstController = await seededController(bridge, 'nym', operationStore);
    await firstController.connect();
    vi.mocked(bridge.mixFetch).mockImplementationOnce(
      async () => new Promise<Response>(() => undefined),
    );
    await firstController.runHttpSmoke(
      { timeoutMs: 1 },
      firstController.getSnapshot().readinessToken,
    );
    const oldOperationId = (
      bridge.mixFetch.mock.calls[0]?.[1] as
        | (RequestInit & { httpSmokeOperationId?: string })
        | undefined
    )?.httpSmokeOperationId;
    expect(oldOperationId).toBeTruthy();

    const nextController = await seededController(bridge, 'nym', operationStore);
    await nextController.connect();
    bridge.setHttpSmokeState(
      oldOperationId!,
      'unknown',
      'recreated-offscreen-generation',
    );

    await expect(
      nextController.runHttpSmoke(
        undefined,
        nextController.getSnapshot().readinessToken,
      ),
    ).rejects.toMatchObject({ code: 'HTTP_SMOKE_OPERATION_PENDING' });
    expect(
      (await operationStore.loadAll()).find(
        (operation) => operation.operationId === oldOperationId,
      )?.state,
    ).toBe('unknown');
    expect(bridge.mixFetch).toHaveBeenCalledOnce();
  });

  it('fails closed when operation state cannot be persisted before dispatch', async () => {
    const bridge = mockBridge();
    const brokenStorage = memoryStorage();
    vi.spyOn(brokenStorage, 'set').mockRejectedValue(new Error('storage unavailable'));
    const operationStore = new NymHttpSmokeOperationStore(brokenStorage);
    const ctrl = await seededController(bridge, 'nym', operationStore);
    await ctrl.connect();

    await expect(
      ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken),
    ).rejects.toThrow(/Unable to persist Nym HTTP Smoke operation before dispatch/);
    expect(bridge.mixFetch).not.toHaveBeenCalled();
  });

  it('keeps an IPC-rejected operation pending when offscreen confirms it is active', async () => {
    const bridge = mockBridge();
    const { controller: ctrl, operationStore } =
      await seededControllerWithPreferenceStorage(bridge);
    await ctrl.connect();
    vi.mocked(bridge.mixFetch).mockImplementationOnce(async (_url, init) => {
      const operationId = (
        init as (RequestInit & { httpSmokeOperationId?: string }) | undefined
      )?.httpSmokeOperationId;
      bridge.setHttpSmokeState(operationId!, 'pending');
      throw new Error('IPC channel lost');
    });

    const result = await ctrl.runHttpSmoke(
      undefined,
      ctrl.getSnapshot().readinessToken,
    );
    const operationId = (
      bridge.mixFetch.mock.calls[0]?.[1] as
        | (RequestInit & { httpSmokeOperationId?: string })
        | undefined
    )?.httpSmokeOperationId;

    expect(result).toMatchObject({ state: 'error', mixFetchInvoked: true });
    expect(result.message).toContain('IPC channel lost');
    expect(
      (await operationStore.loadAll()).find(
        (operation) => operation.operationId === operationId,
      )?.state,
    ).toBe('pending');
    bridge.setHttpSmokeState(operationId!, 'pending');
    await expect(
      ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken),
    ).rejects.toMatchObject({ code: 'HTTP_SMOKE_OPERATION_PENDING' });
    expect(bridge.mixFetch).toHaveBeenCalledOnce();
  });

  it('records completion after IPC rejection only when offscreen confirms completion', async () => {
    const bridge = mockBridge();
    const { controller: ctrl, operationStore } =
      await seededControllerWithPreferenceStorage(bridge);
    await ctrl.connect();
    vi.mocked(bridge.mixFetch).mockImplementationOnce(async (_url, init) => {
      const operationId = (
        init as (RequestInit & { httpSmokeOperationId?: string }) | undefined
      )?.httpSmokeOperationId;
      bridge.setHttpSmokeState(operationId!, 'completed');
      throw new Error('reply was lost');
    });

    await ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken);
    const operationId = (
      bridge.mixFetch.mock.calls[0]?.[1] as
        | (RequestInit & { httpSmokeOperationId?: string })
        | undefined
    )?.httpSmokeOperationId;
    expect(
      (await operationStore.loadAll()).find(
        (operation) => operation.operationId === operationId,
      )?.state,
    ).toBe('completed');

    await ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken);
    expect(bridge.mixFetch).toHaveBeenCalledTimes(2);
  });

  it('records failure after IPC rejection only when offscreen confirms terminal failure', async () => {
    const bridge = mockBridge();
    const { controller: ctrl, operationStore } =
      await seededControllerWithPreferenceStorage(bridge);
    await ctrl.connect();
    vi.mocked(bridge.mixFetch).mockImplementationOnce(async (_url, init) => {
      const operationId = (
        init as (RequestInit & { httpSmokeOperationId?: string }) | undefined
      )?.httpSmokeOperationId;
      bridge.setHttpSmokeState(operationId!, 'failed');
      throw new Error('transport rejected');
    });

    await ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken);
    const operationId = (
      bridge.mixFetch.mock.calls[0]?.[1] as
        | (RequestInit & { httpSmokeOperationId?: string })
        | undefined
    )?.httpSmokeOperationId;
    expect(
      (await operationStore.loadAll()).find(
        (operation) => operation.operationId === operationId,
      )?.state,
    ).toBe('failed');
    await ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken);
    expect(bridge.mixFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the operation unknown when the authoritative status query rejects', async () => {
    const bridge = mockBridge();
    const { controller: ctrl, operationStore } =
      await seededControllerWithPreferenceStorage(bridge);
    await ctrl.connect();
    vi.mocked(bridge.mixFetch).mockRejectedValueOnce(new Error('IPC lost'));
    vi.mocked(bridge.queryHttpSmokeOperation).mockRejectedValueOnce(
      new Error('status channel lost'),
    );

    await ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken);
    const operationId = (
      bridge.mixFetch.mock.calls[0]?.[1] as
        | (RequestInit & { httpSmokeOperationId?: string })
        | undefined
    )?.httpSmokeOperationId;
    expect(
      (await operationStore.loadAll()).find(
        (operation) => operation.operationId === operationId,
      )?.state,
    ).toBe('unknown');
    await expect(
      ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken),
    ).rejects.toMatchObject({ code: 'HTTP_SMOKE_OPERATION_PENDING' });
    expect(bridge.mixFetch).toHaveBeenCalledOnce();
  });

  it('keeps the operation unknown when status reports a different runtime generation', async () => {
    const bridge = mockBridge();
    const { controller: ctrl, operationStore } =
      await seededControllerWithPreferenceStorage(bridge);
    await ctrl.connect();
    vi.mocked(bridge.mixFetch).mockRejectedValueOnce(new Error('IPC lost'));

    await ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken);
    const operationId = (
      bridge.mixFetch.mock.calls[0]?.[1] as
        | (RequestInit & { httpSmokeOperationId?: string })
        | undefined
    )?.httpSmokeOperationId;
    bridge.setHttpSmokeState(operationId!, 'failed', 'recreated-generation');
    expect(
      (await operationStore.loadAll()).find(
        (operation) => operation.operationId === operationId,
      )?.state,
    ).toBe('unknown');
  });

  it('keeps an IPC-rejected operation unknown when status is missing', async () => {
    const bridge = mockBridge();
    const { controller: ctrl, operationStore } =
      await seededControllerWithPreferenceStorage(bridge);
    await ctrl.connect();
    vi.mocked(bridge.mixFetch).mockRejectedValueOnce(new Error('IPC lost'));
    vi.mocked(bridge.queryHttpSmokeOperation).mockResolvedValueOnce(null);

    await ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken);
    const operationId = (
      bridge.mixFetch.mock.calls[0]?.[1] as
        | (RequestInit & { httpSmokeOperationId?: string })
        | undefined
    )?.httpSmokeOperationId;
    expect(
      (await operationStore.loadAll()).find(
        (operation) => operation.operationId === operationId,
      )?.state,
    ).toBe('unknown');
    await expect(
      ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken),
    ).rejects.toMatchObject({ code: 'HTTP_SMOKE_OPERATION_PENDING' });
    expect(bridge.mixFetch).toHaveBeenCalledOnce();
  });

  it('releases an IPC-unknown operation slot only after late verified completion', async () => {
    const bridge = mockBridge();
    const { controller: ctrl, operationStore } =
      await seededControllerWithPreferenceStorage(bridge);
    await ctrl.connect();
    vi.mocked(bridge.mixFetch).mockRejectedValueOnce(new Error('IPC lost'));
    vi.mocked(bridge.queryHttpSmokeOperation).mockResolvedValueOnce(null);
    await ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken);
    const operationId = (
      bridge.mixFetch.mock.calls[0]?.[1] as
        | (RequestInit & { httpSmokeOperationId?: string })
        | undefined
    )?.httpSmokeOperationId;
    bridge.setHttpSmokeState(operationId!, 'completed');

    await ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken);

    expect(
      (await operationStore.loadAll()).find(
        (operation) => operation.operationId === operationId,
      )?.state,
    ).toBe('completed');
    expect(bridge.mixFetch).toHaveBeenCalledTimes(2);
  });

  it('releases an IPC-unknown operation slot only after late verified failure', async () => {
    const bridge = mockBridge();
    const { controller: ctrl, operationStore } =
      await seededControllerWithPreferenceStorage(bridge);
    await ctrl.connect();
    vi.mocked(bridge.mixFetch).mockRejectedValueOnce(new Error('IPC lost'));
    vi.mocked(bridge.queryHttpSmokeOperation).mockResolvedValueOnce(null);
    await ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken);
    const operationId = (
      bridge.mixFetch.mock.calls[0]?.[1] as
        | (RequestInit & { httpSmokeOperationId?: string })
        | undefined
    )?.httpSmokeOperationId;
    bridge.setHttpSmokeState(operationId!, 'failed');

    await ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken);

    expect(
      (await operationStore.loadAll()).find(
        (operation) => operation.operationId === operationId,
      )?.state,
    ).toBe('failed');
    expect(bridge.mixFetch).toHaveBeenCalledTimes(2);
  });

  it('blocks dispatch when a legacy terminal migration cannot be persisted', async () => {
    const bridge = mockBridge();
    const storage = memoryStorage();
    const operationStore = new NymHttpSmokeOperationStore(storage);
    const { controller: ctrl } = await seededControllerWithPreferenceStorage(
      bridge,
      'nym',
      operationStore,
    );
    await ctrl.connect();
    storage.seed('solanym_nym_http_smoke_operation_v1', [
      {
        operationId: 'legacy-completed',
        runtimeGeneration: 'test-offscreen-generation',
        state: 'completed',
        createdAt: 1,
        updatedAt: 2,
        callerTimedOut: false,
      },
    ]);
    vi.spyOn(storage, 'set').mockRejectedValueOnce(new Error('migration write failed'));

    await expect(
      ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken),
    ).rejects.toThrow(/Unable to load or migrate Nym HTTP Smoke operation state/);
    expect(bridge.mixFetch).not.toHaveBeenCalled();
  });

  it('reconciles a migrated legacy terminal only with exact operation and generation', async () => {
    const bridge = mockBridge();
    const storage = memoryStorage();
    const operationStore = new NymHttpSmokeOperationStore(storage);
    const { controller: ctrl } = await seededControllerWithPreferenceStorage(
      bridge,
      'nym',
      operationStore,
    );
    await ctrl.connect();
    const legacy = {
      operationId: 'legacy-completed',
      runtimeGeneration: 'test-offscreen-generation',
      state: 'completed',
      createdAt: 1,
      updatedAt: 2,
      callerTimedOut: false,
    };
    storage.seed('solanym_nym_http_smoke_operation_v1', [legacy]);
    bridge.setHttpSmokeState(legacy.operationId, 'completed');

    await ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken);

    expect(bridge.queryHttpSmokeOperation).toHaveBeenCalledWith(
      legacy.operationId,
      legacy.runtimeGeneration,
    );
    expect(
      (await operationStore.loadAll()).find(
        (operation) => operation.operationId === legacy.operationId,
      ),
    ).toMatchObject({
      state: 'completed',
      verification: {
        schemaVersion: 2,
        operationId: legacy.operationId,
        runtimeGeneration: legacy.runtimeGeneration,
        terminalState: 'completed',
        source: 'authoritative_offscreen_status',
      },
    });
    expect(bridge.mixFetch).toHaveBeenCalledOnce();
  });

  it.each([
    ['generation mismatch', 'mismatch'],
    ['missing status', 'missing'],
  ] as const)(
    'keeps a migrated legacy terminal blocking after %s',
    async (_description, statusCase) => {
      const bridge = mockBridge();
      const storage = memoryStorage();
      const operationStore = new NymHttpSmokeOperationStore(storage);
      const { controller: ctrl } = await seededControllerWithPreferenceStorage(
        bridge,
        'nym',
        operationStore,
      );
      await ctrl.connect();
      const legacy = {
        operationId: `legacy-${statusCase}`,
        runtimeGeneration: 'test-offscreen-generation',
        state: 'failed',
        createdAt: 3,
        updatedAt: 4,
        callerTimedOut: false,
      };
      storage.seed('solanym_nym_http_smoke_operation_v1', [legacy]);
      if (statusCase === 'mismatch') {
        bridge.setHttpSmokeState(
          legacy.operationId,
          'completed',
          'recreated-generation',
        );
      } else {
        vi.mocked(bridge.queryHttpSmokeOperation).mockResolvedValueOnce(null);
      }

      await expect(
        ctrl.runHttpSmoke(undefined, ctrl.getSnapshot().readinessToken),
      ).rejects.toMatchObject({ code: 'HTTP_SMOKE_OPERATION_PENDING' });
      expect(
        (await operationStore.loadAll()).find(
          (operation) => operation.operationId === legacy.operationId,
        )?.state,
      ).toBe('unknown');
      expect(bridge.mixFetch).not.toHaveBeenCalled();
    },
  );
});
