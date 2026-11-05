import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { isSppTestnetBroadcastAuthorized } from '@solanym/wallet-core/src/stellar/spp/sppBroadcastGate.js';
import {
  NymRuntimeController,
  resetNymRuntimeControllerForTests,
  type NymSessionBridge,
} from '../../../src/background/nym/NymRuntimeController.js';
import { createNymSetModeHandler } from '../../../src/background/handlers/nymHandlers.js';
import { NymGatewayConfigService } from '../../../src/background/nym/NymGatewayConfigService.js';
import { NymHostPermissionService } from '../../../src/background/nym/NymHostPermissionService.js';
import { STORAGE_LAB_EXECUTION_AUTHORIZED } from '../../../src/spp-host/storageLabPrep.js';
import {
  NYM_PRIVACY_PREFERENCE_STORAGE_KEY,
  parseStoredNymPrivacyPreference,
  type NymPrivacyPreferenceStore,
} from '../../../src/shared/nymPrivacyPreference.js';

const HORIZON = 'https://horizon-testnet.stellar.org/fee_stats';

function memoryStore(initial?: Record<string, unknown>): NymPrivacyPreferenceStore & {
  snapshot(): Record<string, unknown>;
} {
  const mem = new Map<string, unknown>(Object.entries(initial ?? {}));
  return {
    get: async (keys) => {
      const list = keys == null ? [...mem.keys()] : Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const key of list) {
        if (mem.has(key)) out[key] = mem.get(key);
      }
      return out;
    },
    set: async (items) => {
      for (const [key, value] of Object.entries(items)) mem.set(key, value);
    },
    snapshot: () => Object.fromEntries(mem),
  };
}

function gatedStore(): {
  store: NymPrivacyPreferenceStore;
  release: () => void;
  seed: (value: unknown) => void;
} {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const mem = new Map<string, unknown>();
  return {
    release,
    seed: (value) => {
      mem.set(NYM_PRIVACY_PREFERENCE_STORAGE_KEY, value);
    },
    store: {
      get: async (keys) => {
        await gate;
        const list = keys == null ? [...mem.keys()] : Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const key of list) {
          if (mem.has(key)) out[key] = mem.get(key);
        }
        return out;
      },
      set: async (items) => {
        for (const [key, value] of Object.entries(items)) mem.set(key, value);
      },
    },
  };
}

function stubBridge(): NymSessionBridge {
  return {
    setup: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    mixFetch: vi.fn(async () => new Response('mix', { status: 200 })),
    queryStatus: vi.fn(async () => null),
  };
}

function controllerFor(store: NymPrivacyPreferenceStore): NymRuntimeController {
  return new NymRuntimeController({
    bridge: stubBridge(),
    gatewayConfig: new NymGatewayConfigService(memoryStore()),
    hostPermissions: new NymHostPermissionService({
      contains: async () => true,
      request: async () => true,
      remove: async () => true,
    }),
    privacyPreferenceStore: store,
  });
}

async function expectNoClearnet(run: () => Promise<unknown>): Promise<void> {
  const clearnet = vi.fn(async () => new Response('clearnet', { status: 200 }));
  vi.stubGlobal('fetch', clearnet);
  try {
    await expect(run()).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    expect(clearnet).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
}

describe('Nym privacy persistence', () => {
  afterEach(() => {
    resetNymRuntimeControllerForTests(null);
    vi.unstubAllGlobals();
  });

  it('keeps the broadcast gate off and does not persist an authorization', () => {
    expect(isSppTestnetBroadcastAuthorized()).toBe(false);
    expect(STORAGE_LAB_EXECUTION_AUTHORIZED).toBe(false);
    const controllerSrc = fs.readFileSync(
      path.resolve(__dirname, '../../../src/background/nym/NymRuntimeController.ts'),
      'utf8',
    );
    const preferenceSrc = fs.readFileSync(
      path.resolve(__dirname, '../../../src/shared/nymPrivacyPreference.ts'),
      'utf8',
    );
    expect(controllerSrc).not.toMatch(/setSppTestnetBroadcastAuthorized/);
    expect(preferenceSrc).not.toMatch(/setSppTestnetBroadcastAuthorized/);
    expect(controllerSrc).not.toMatch(/this\.setMode\(\s*'direct'\s*\)/);
    expect(controllerSrc).not.toMatch(/STORAGE_LAB_EXECUTION_AUTHORIZED\s*=\s*true/);
    const dashboardSrc = fs.readFileSync(
      path.resolve(__dirname, '../../../src/popup/Dashboard.tsx'),
      'utf8',
    );
    expect(dashboardSrc).not.toMatch(/mode:\s*res\.transport/);
  });

  it('blocks wallet egress while the persisted choice is loading, then allows Direct only if unset', async () => {
    const gated = gatedStore();
    const ctrl = controllerFor(gated.store);
    expect(ctrl.mode).toBe('nym');
    expect(ctrl.getSnapshot().preferenceHydrated).toBe(false);
    expect(ctrl.getSnapshot().egressBlocked).toBe(true);
    expect(ctrl.getSnapshot().privacyPreference).toBeNull();

    const clearnet = vi.fn(async () => new Response('clearnet', { status: 200 }));
    vi.stubGlobal('fetch', clearnet);
    const pending = ctrl.getStellarFetch()(HORIZON);
    await Promise.resolve();
    expect(clearnet).not.toHaveBeenCalled();

    gated.release();
    const response = await pending;
    expect(response.status).toBe(200);
    expect(clearnet).toHaveBeenCalledTimes(1);
    expect(ctrl.mode).toBe('direct');
    expect(ctrl.getSnapshot().privacyPreference).toBeNull();
    expect(ctrl.getSnapshot().egressBlocked).toBe(false);
    expect(isSppTestnetBroadcastAuthorized()).toBe(false);
  });

  it('blocks wallet egress for the whole boot when the stored choice is Nym', async () => {
    const gated = gatedStore();
    gated.seed('nym');
    const ctrl = controllerFor(gated.store);
    const clearnet = vi.fn(async () => new Response('clearnet', { status: 200 }));
    vi.stubGlobal('fetch', clearnet);
    const pending = ctrl.getStellarFetch()(HORIZON);
    await Promise.resolve();
    expect(clearnet).not.toHaveBeenCalled();
    gated.release();
    await expect(pending).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    expect(clearnet).not.toHaveBeenCalled();
    expect(ctrl.getSnapshot().preferenceHydrated).toBe(true);
    expect(ctrl.mode).toBe('nym');
    expect(ctrl.getSnapshot().egressBlocked).toBe(true);
    expect(isSppTestnetBroadcastAuthorized()).toBe(false);
  });

  it('restores Nym across a service-worker restart and a webapp reload and blocks egress', async () => {
    const store = memoryStore();
    const first = controllerFor(store);
    await first.setMode('nym');
    expect(store.snapshot()[NYM_PRIVACY_PREFERENCE_STORAGE_KEY]).toBe('nym');
    await first.disconnect();
    expect(first.mode).toBe('nym');
    expect(store.snapshot()[NYM_PRIVACY_PREFERENCE_STORAGE_KEY]).toBe('nym');

    const restarted = controllerFor(store);
    await restarted.whenPrivacyReady();
    expect(restarted.mode).toBe('nym');
    expect(restarted.getSnapshot().privacyPreference).toBe('nym');
    expect(restarted.getSnapshot().egressBlocked).toBe(true);
    await expectNoClearnet(() => restarted.getStellarFetch()(HORIZON));

    const reloaded = controllerFor(store);
    await reloaded.whenPrivacyReady();
    expect(reloaded.getSnapshot()).toMatchObject({
      mode: 'nym',
      privacyPreference: 'nym',
      preferenceHydrated: true,
      egressBlocked: true,
    });
    await expectNoClearnet(() => reloaded.getStellarFetch()(HORIZON));
    expect(isSppTestnetBroadcastAuthorized()).toBe(false);
  });

  it('keeps Nym egress closed when chosen but MixFetch is disconnected', async () => {
    const store = memoryStore();
    const ctrl = controllerFor(store);
    await ctrl.setMode('nym');
    expect(ctrl.getSnapshot().connected).toBe(false);
    await expectNoClearnet(() => ctrl.getStellarFetch()(HORIZON));
    expect(ctrl.mode).toBe('nym');
    expect(isSppTestnetBroadcastAuthorized()).toBe(false);
  });

  it('opens clearnet only after an explicit Direct choice and restores that choice', async () => {
    const store = memoryStore();
    const ctrl = controllerFor(store);
    await ctrl.setMode('nym');
    await expectNoClearnet(() => ctrl.getStellarFetch()(HORIZON));

    resetNymRuntimeControllerForTests(ctrl);
    const handler = createNymSetModeHandler();
    const snap = await handler({ mode: 'direct' });
    expect(snap.mode).toBe('direct');
    expect(snap.privacyPreference).toBe('direct');
    expect(snap.egressBlocked).toBe(false);
    expect(store.snapshot()[NYM_PRIVACY_PREFERENCE_STORAGE_KEY]).toBe('direct');

    const clearnet = vi.fn(async () => new Response('horizon', { status: 200 }));
    vi.stubGlobal('fetch', clearnet);
    const response = await ctrl.getStellarFetch()(HORIZON);
    expect(response.status).toBe(200);
    expect(clearnet).toHaveBeenCalledTimes(1);

    const restarted = controllerFor(store);
    await restarted.whenPrivacyReady();
    expect(restarted.mode).toBe('direct');
    expect(restarted.getSnapshot().privacyPreference).toBe('direct');
    expect(restarted.getSnapshot().egressBlocked).toBe(false);
    const again = vi.fn(async () => new Response('horizon', { status: 200 }));
    vi.stubGlobal('fetch', again);
    expect((await restarted.getStellarFetch()(HORIZON)).status).toBe(200);
    expect(again).toHaveBeenCalledTimes(1);
    expect(isSppTestnetBroadcastAuthorized()).toBe(false);
  });

  it('does not let a direct diagnostic probe rewrite the persisted Nym choice', async () => {
    const store = memoryStore();
    const ctrl = controllerFor(store);
    await ctrl.setMode('nym');
    const probe = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', probe);
    const result = await ctrl.fetchPublicData({
      transport: 'direct',
      url: 'https://postman-echo.com/get',
    });
    expect(result.transport).toBe('direct');
    expect(ctrl.mode).toBe('nym');
    expect(store.snapshot()[NYM_PRIVACY_PREFERENCE_STORAGE_KEY]).toBe('nym');
    probe.mockClear();
    await expect(ctrl.getStellarFetch()(HORIZON)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    expect(probe).not.toHaveBeenCalled();
    expect(isSppTestnetBroadcastAuthorized()).toBe(false);
  });

  it('fail-closes when the stored choice is corrupt or unreadable', async () => {
    expect(parseStoredNymPrivacyPreference('NYM').kind).toBe('corrupt');
    expect(parseStoredNymPrivacyPreference(true).kind).toBe('corrupt');
    expect(parseStoredNymPrivacyPreference('direct').kind).toBe('chosen');

    const corrupt = controllerFor(memoryStore({ [NYM_PRIVACY_PREFERENCE_STORAGE_KEY]: 'clearnet' }));
    await corrupt.whenPrivacyReady();
    expect(corrupt.mode).toBe('nym');
    expect(corrupt.getSnapshot().diagnosticCode).toBe('PRIVACY_PREFERENCE_CORRUPT');
    expect(corrupt.getSnapshot().egressBlocked).toBe(true);
    await expectNoClearnet(() => corrupt.getStellarFetch()(HORIZON));

    const broken: NymPrivacyPreferenceStore = {
      get: async () => {
        throw new Error('storage unavailable');
      },
      set: async () => {},
    };
    const unreadable = controllerFor(broken);
    await unreadable.whenPrivacyReady();
    expect(unreadable.mode).toBe('nym');
    expect(unreadable.getSnapshot().diagnosticCode).toBe('PRIVACY_PREFERENCE_UNREADABLE');
    await expectNoClearnet(() => unreadable.getStellarFetch()(HORIZON));
    expect(isSppTestnetBroadcastAuthorized()).toBe(false);
  });
});
