import { afterEach, describe, expect, it, vi } from 'vitest';

import { NymRuntimeController } from '../../../src/background/nym/NymRuntimeController.js';
import { NymGatewayConfigService } from '../../../src/background/nym/NymGatewayConfigService.js';
import { NymHostPermissionService } from '../../../src/background/nym/NymHostPermissionService.js';
import type { NymSessionBridge } from '../../../src/background/nym/NymRuntimeController.js';
import {
  NYM_PRIVACY_PREFERENCE_STORAGE_KEY,
  type NymPrivacyPreferenceStore,
} from '../../../src/shared/nymPrivacyPreference.js';

const KEY = NYM_PRIVACY_PREFERENCE_STORAGE_KEY;
const HORIZON = 'https://horizon-testnet.stellar.org/fee_stats';

function bridge(): NymSessionBridge {
  return {
    setup: async () => {},
    disconnect: async () => {},
    mixFetch: async () => new Response('mix'),
    queryStatus: async () => null,
  };
}

function controller(
  store: NymPrivacyPreferenceStore,
  onPrivacyStoreChanged?: (listener: () => void) => () => void,
): NymRuntimeController {
  return new NymRuntimeController({
    bridge: bridge(),
    gatewayConfig: new NymGatewayConfigService({
      get: async () => ({}),
      set: async () => {},
    }),
    hostPermissions: new NymHostPermissionService({
      contains: async () => false,
      request: async () => false,
      remove: async () => true,
    }),
    privacyPreferenceStore: store,
    ...(onPrivacyStoreChanged ? { onPrivacyStoreChanged } : {}),
  });
}

function deferred() {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('Nym privacy revocation races', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drops a stale Direct hydrate when a remote Nym read finishes first', async () => {
    const mem = new Map<string, unknown>([[KEY, 'direct']]);
    const first = deferred();
    let reads = 0;
    const store: NymPrivacyPreferenceStore = {
      get: async () => {
        reads += 1;
        if (reads === 1) {
          const stale = mem.get(KEY);
          await first.promise;
          return { [KEY]: stale };
        }
        return mem.has(KEY) ? { [KEY]: mem.get(KEY) } : {};
      },
      set: async (items) => {
        for (const [key, value] of Object.entries(items)) mem.set(key, value);
      },
    };
    let notify = () => {};
    const ctrl = controller(store, (listener) => {
      notify = listener;
      return () => {};
    });
    const clearnet = vi.fn(async () => new Response('clearnet', { status: 200 }));
    vi.stubGlobal('fetch', clearnet);

    mem.set(KEY, 'nym');
    notify();
    await Promise.resolve();
    expect(ctrl.getSnapshot().egressBlocked).toBe(true);
    await expect(ctrl.getRouter().fetch(HORIZON)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    expect(clearnet).not.toHaveBeenCalled();

    first.release();
    await ctrl.whenPrivacyReady();
    await Promise.resolve();
    expect(ctrl.getSnapshot().privacyPreference).toBe('nym');
    expect(ctrl.mode).not.toBe('direct');
    await expect(ctrl.fetchPublicData({ transport: 'direct' })).resolves.toMatchObject({
      transportFetchInvoked: false,
    });
    await expect(ctrl.probeStellarHorizon({ transport: 'direct' })).resolves.toMatchObject({
      transportFetchInvoked: false,
    });
    expect(clearnet).not.toHaveBeenCalled();
  });

  it('does not rearm Direct when a late Direct write finishes after remote Nym', async () => {
    const mem = new Map<string, unknown>();
    const directWrite = deferred();
    let sawDirectWrite = false;
    const store: NymPrivacyPreferenceStore = {
      get: async () => (mem.has(KEY) ? { [KEY]: mem.get(KEY) } : {}),
      set: async (items) => {
        if (items[KEY] === 'direct') {
          sawDirectWrite = true;
          await directWrite.promise;
        }
        for (const [key, value] of Object.entries(items)) mem.set(key, value);
      },
    };
    let notify = () => {};
    const ctrl = controller(store, (listener) => {
      notify = listener;
      return () => {};
    });
    await ctrl.whenPrivacyReady();
    await ctrl.setMode('nym');

    const pendingDirect = ctrl.setMode('direct');
    await vi.waitFor(() => {
      expect(sawDirectWrite).toBe(true);
    });
    mem.set(KEY, 'nym');
    notify();
    await Promise.resolve();
    await Promise.resolve();

    const clearnet = vi.fn(async () => new Response('clearnet', { status: 200 }));
    vi.stubGlobal('fetch', clearnet);
    const held = ctrl.getRouter();
    await expect(held.fetch(HORIZON)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    await expect(ctrl.getStellarFetch()(HORIZON)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    expect(clearnet).not.toHaveBeenCalled();

    directWrite.release();
    await pendingDirect;
    expect(ctrl.mode).not.toBe('direct');
    expect(ctrl.getSnapshot().privacyPreference).not.toBe('direct');
    await expect(ctrl.fetchPublicData({ transport: 'direct' })).resolves.toMatchObject({
      transportFetchInvoked: false,
    });
    await expect(ctrl.probeStellarHorizon({ transport: 'direct' })).resolves.toMatchObject({
      transportFetchInvoked: false,
    });
    expect(clearnet).not.toHaveBeenCalled();
  });

  it('blocks ordinary, retained-router, and diagnostic egress while a remote read is pending', async () => {
    const mem = new Map<string, unknown>([[KEY, 'direct']]);
    const reloadRead = deferred();
    let reads = 0;
    const store: NymPrivacyPreferenceStore = {
      get: async () => {
        reads += 1;
        if (reads > 1) await reloadRead.promise;
        return mem.has(KEY) ? { [KEY]: mem.get(KEY) } : {};
      },
      set: async (items) => {
        for (const [key, value] of Object.entries(items)) mem.set(key, value);
      },
    };
    let notify = () => {};
    const ctrl = controller(store, (listener) => {
      notify = listener;
      return () => {};
    });
    await ctrl.whenPrivacyReady();
    expect(ctrl.getSnapshot().privacyPreference).toBe('direct');

    mem.set(KEY, 'nym');
    notify();
    expect(ctrl.getSnapshot().egressBlocked).toBe(true);
    expect(ctrl.mode).not.toBe('direct');

    const clearnet = vi.fn(async () => new Response('clearnet', { status: 200 }));
    vi.stubGlobal('fetch', clearnet);
    const held = ctrl.getRouter();
    const diagnostic = ctrl.fetchPublicData({ transport: 'direct' });
    const horizon = ctrl.probeStellarHorizon({ transport: 'direct' });
    await expect(held.fetch(HORIZON)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    await expect(ctrl.getStellarFetch()(HORIZON)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    expect(clearnet).not.toHaveBeenCalled();

    reloadRead.release();
    await expect(diagnostic).resolves.toMatchObject({ transportFetchInvoked: false });
    await expect(horizon).resolves.toMatchObject({ transportFetchInvoked: false });
    expect(ctrl.getSnapshot().privacyPreference).toBe('nym');
    expect(clearnet).not.toHaveBeenCalled();
  });
});
