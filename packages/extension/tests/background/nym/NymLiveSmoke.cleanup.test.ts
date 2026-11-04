import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/nym-offscreen/liveSmokeAuth.js', () => ({
  NYM_LIVE_SMOKE_EXECUTION_AUTHORIZED: true,
  assertNymLiveSmokeAuthorized: vi.fn(),
}));

import { runNymLiveSmoke } from '../../../src/background/nym/NymLiveSmoke.js';
import { NymGatewayConfigService } from '../../../src/background/nym/NymGatewayConfigService.js';
import { NymHostPermissionService } from '../../../src/background/nym/NymHostPermissionService.js';
import type { NymRuntimeController } from '../../../src/background/nym/NymRuntimeController.js';
import { NYM_VERIFIED_GATEWAY } from '../../../src/nym-offscreen/verifiedGateway.js';

function memoryStorage() {
  const values = new Map<string, unknown>();
  return {
    get: async (keys?: string | string[] | null) => {
      const requested = keys == null ? [...values.keys()] : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(requested.flatMap((key) => (
        values.has(key) ? [[key, values.get(key)]] : []
      )));
    },
    set: async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) values.set(key, value);
    },
  };
}

const connectedSnapshot = {
  state: 'connected',
  lastError: null,
  connected: true,
  implementation: 'mix-fetch-offscreen',
  mode: 'nym',
  documentReady: true,
  assetsReady: true,
};

const disconnectedSnapshot = {
  ...connectedSnapshot,
  state: 'disconnected',
  connected: false,
  documentReady: false,
};

async function createDependencies(connect: ReturnType<typeof vi.fn>, disconnectForLiveSmoke: ReturnType<typeof vi.fn>) {
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
  const controller = {
    refreshStatus: vi.fn(async () => disconnectedSnapshot),
    getSnapshot: vi.fn(() => disconnectedSnapshot),
    connect,
    disconnectForLiveSmoke,
  } as unknown as NymRuntimeController;

  return {
    controller,
    gatewayConfig,
    hostPermissions,
    request: { confirmLiveSmoke: true },
  };
}

describe('runNymLiveSmoke cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('attempts disconnect after connect rejects and preserves the connection error', async () => {
    const connectionError = Object.assign(new Error('createMixFetch failed'), {
      code: 'CONNECT_FAILED',
    });
    const connect = vi.fn().mockRejectedValue(connectionError);
    const disconnectForLiveSmoke = vi.fn().mockResolvedValue(disconnectedSnapshot);
    const dependencies = await createDependencies(connect, disconnectForLiveSmoke);

    await expect(runNymLiveSmoke(dependencies)).rejects.toBe(connectionError);
    expect(disconnectForLiveSmoke).toHaveBeenCalledOnce();
  });

  it('preserves the original connection error when disconnect also rejects', async () => {
    const connectionError = Object.assign(new Error('setup failed'), {
      code: 'CONNECT_FAILED',
    });
    const connect = vi.fn().mockRejectedValue(connectionError);
    const disconnectForLiveSmoke = vi.fn().mockRejectedValue(new Error('offscreen close failed'));
    const dependencies = await createDependencies(connect, disconnectForLiveSmoke);

    await expect(runNymLiveSmoke(dependencies)).rejects.toBe(connectionError);
    expect(disconnectForLiveSmoke).toHaveBeenCalledOnce();
  });

  it('reports cleanup failure after a successful connection', async () => {
    const connect = vi.fn().mockResolvedValue(connectedSnapshot);
    const disconnectForLiveSmoke = vi.fn().mockRejectedValue(new Error('offscreen close failed'));
    const dependencies = await createDependencies(connect, disconnectForLiveSmoke);

    await expect(runNymLiveSmoke(dependencies)).rejects.toMatchObject({
      code: 'SMOKE_CLEANUP_FAILED',
      message: expect.stringContaining('offscreen close failed'),
    });
    expect(disconnectForLiveSmoke).toHaveBeenCalledOnce();
  });

  it('rejects a resolved cleanup that returns a connected or document-ready snapshot', async () => {
    const connect = vi.fn().mockResolvedValue(connectedSnapshot);
    const disconnectForLiveSmoke = vi.fn().mockResolvedValue(connectedSnapshot);
    const dependencies = await createDependencies(connect, disconnectForLiveSmoke);

    await expect(runNymLiveSmoke(dependencies)).rejects.toMatchObject({
      code: 'SMOKE_CLEANUP_FAILED',
      message: expect.stringContaining('remained active'),
    });
  });
});
