import { describe, expect, it, vi } from 'vitest';

import { runNymLiveSmoke } from '../../../src/background/nym/NymLiveSmoke.js';
import { NymGatewayConfigService } from '../../../src/background/nym/NymGatewayConfigService.js';
import { NymHostPermissionService } from '../../../src/background/nym/NymHostPermissionService.js';
import type { NymRuntimeController } from '../../../src/background/nym/NymRuntimeController.js';
import { NYM_LIVE_SMOKE_EXECUTION_AUTHORIZED } from '../../../src/nym-offscreen/liveSmokeAuth.js';
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

describe('runNymLiveSmoke', () => {
  it('keeps createMixFetch gated when confirmLiveSmoke=false', async () => {
    expect(NYM_LIVE_SMOKE_EXECUTION_AUTHORIZED).toBe(false);
    const connect = vi.fn();
    const controller = {
      refreshStatus: vi.fn(async () => ({
        state: 'disconnected',
        connected: false,
        lastError: null,
        implementation: 'mix-fetch-offscreen',
        mode: 'direct',
        documentReady: false,
        assetsReady: true,
        gatewayAllowlistConfigured: false,
      })),
      getSnapshot: vi.fn(() => ({
        state: 'disconnected',
        connected: false,
        lastError: null,
        implementation: 'mix-fetch-offscreen',
        mode: 'direct',
        documentReady: false,
        assetsReady: true,
      })),
      connect,
      disconnect: vi.fn(),
    } as unknown as NymRuntimeController;

    const gatewayConfig = new NymGatewayConfigService(memoryStorage());
    const hostPermissions = new NymHostPermissionService({
      contains: async () => false,
      request: async () => false,
      remove: async () => true,
    });

    const result = await runNymLiveSmoke({
      controller,
      gatewayConfig,
      hostPermissions,
      request: { confirmLiveSmoke: false },
    });

    expect(result.executedCreateMixFetch).toBe(false);
    expect(result.authorizedFlag).toBe(false);
    expect(connect).not.toHaveBeenCalled();
    expect(result.steps).toContain('assets-ready');
    expect(result.steps).toContain('smoke-dry-run');
    expect(result.snapshot.diagnosticCode).toBe('SMOKE_DRY_RUN');
    expect(result.snapshot.connected).toBe(false);
  });

  it('refuses authorized path while flag is false even if confirmLiveSmoke=true', async () => {
    const controller = {
      refreshStatus: vi.fn(async () => ({
        state: 'disconnected',
        connected: false,
        lastError: null,
        implementation: 'mix-fetch-offscreen',
        mode: 'direct',
        documentReady: false,
        assetsReady: true,
        gatewayAllowlistConfigured: true,
      })),
      connect: vi.fn(),
      disconnect: vi.fn(),
      getSnapshot: vi.fn(),
    } as unknown as NymRuntimeController;

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

    await expect(
      runNymLiveSmoke({
        controller,
        gatewayConfig,
        hostPermissions,
        request: { confirmLiveSmoke: true },
      }),
    ).rejects.toMatchObject({ code: 'SMOKE_NOT_AUTHORIZED' });
    expect(controller.connect).not.toHaveBeenCalled();
  });

  it('dry-run with verified gateway probes permission without createMixFetch', async () => {
    expect(NYM_LIVE_SMOKE_EXECUTION_AUTHORIZED).toBe(false);
    const connect = vi.fn();
    const controller = {
      refreshStatus: vi.fn(async () => ({
        state: 'disconnected',
        connected: false,
        lastError: null,
        implementation: 'mix-fetch-offscreen',
        mode: 'direct',
        documentReady: false,
        assetsReady: true,
        gatewayAllowlistConfigured: true,
      })),
      getSnapshot: vi.fn(() => ({
        state: 'disconnected',
        connected: false,
        lastError: null,
        implementation: 'mix-fetch-offscreen',
        mode: 'direct',
        documentReady: false,
        assetsReady: true,
      })),
      connect,
      disconnect: vi.fn(),
    } as unknown as NymRuntimeController;

    const gatewayConfig = new NymGatewayConfigService(memoryStorage());
    await gatewayConfig.addGateway(
      NYM_VERIFIED_GATEWAY.wssOrigin,
      NYM_VERIFIED_GATEWAY.identityKey,
    );
    const hostPermissions = new NymHostPermissionService({
      contains: async (perm) =>
        perm.origins?.[0] === NYM_VERIFIED_GATEWAY.hostPermissionPattern,
      request: async () => false,
      remove: async () => true,
    });

    const result = await runNymLiveSmoke({
      controller,
      gatewayConfig,
      hostPermissions,
      request: { confirmLiveSmoke: false },
    });

    expect(result.executedCreateMixFetch).toBe(false);
    expect(result.gatewayConfigured).toBe(true);
    expect(result.hostPermissionGranted).toBe(true);
    expect(result.steps).toContain('host-permission-granted');
    expect(result.steps).toContain('gateway-identity-present');
    expect(result.steps).toContain('smoke-dry-run');
    expect(result.snapshot.diagnosticCode).toBe('SMOKE_DRY_RUN');
    expect(connect).not.toHaveBeenCalled();
  });
});
