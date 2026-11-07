import { afterEach, describe, expect, it, vi } from 'vitest';

import { installAndroidChromeShim } from '../../src/webapp/installChromeShim.js';
import { NymRuntimeController } from '../../src/background/nym/NymRuntimeController.js';
import { NymGatewayConfigService } from '../../src/background/nym/NymGatewayConfigService.js';
import { NymHostPermissionService } from '../../src/background/nym/NymHostPermissionService.js';
import type { NymSessionBridge } from '../../src/background/nym/NymRuntimeController.js';
import {
  NYM_PRIVACY_PREFERENCE_STORAGE_KEY,
  type NymPrivacyPreferenceStore,
} from '../../src/shared/nymPrivacyPreference.js';

const HORIZON = 'https://horizon-testnet.stellar.org/fee_stats';
const LOCAL_KEY = 'astrym.chrome.storage.local.v1';

type ChromeStorage = {
  get: (keys?: string | string[] | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

type ChromeOnChanged = {
  addListener: (fn: (changes: Record<string, unknown>, area: string) => void) => void;
  removeListener: (fn: (changes: Record<string, unknown>, area: string) => void) => void;
};

function stubBridge(): NymSessionBridge {
  return {
    setup: async () => {},
    disconnect: async () => {},
    mixFetch: async () => new Response('ok'),
    queryStatus: async () => null,
  };
}

function sharedLocalStorage(peers: EventTarget[]) {
  const data = new Map<string, string>();
  return {
    forPeer(self: EventTarget) {
      const notify = (key: string, oldValue: string | null, newValue: string | null) => {
        for (const peer of peers) {
          if (peer === self) continue;
          const event = new Event('storage');
          Object.assign(event, { key, oldValue, newValue });
          peer.dispatchEvent(event);
        }
      };
      return {
        getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
        setItem: (key: string, value: string) => {
          const oldValue = data.has(key) ? data.get(key)! : null;
          data.set(key, value);
          notify(key, oldValue, value);
        },
        removeItem: (key: string) => {
          const oldValue = data.has(key) ? data.get(key)! : null;
          data.delete(key);
          notify(key, oldValue, null);
        },
      };
    },
    clear() {
      data.clear();
      for (const peer of peers) {
        const event = new Event('storage');
        Object.assign(event, { key: null, oldValue: null, newValue: null });
        peer.dispatchEvent(event);
      }
    },
  };
}

function instance(storage: ReturnType<ReturnType<typeof sharedLocalStorage>['forPeer']>, events: EventTarget) {
  const host: { chrome?: Record<string, unknown> } = {};
  installAndroidChromeShim({ host, localStorage: storage, storageEvents: events });
  const chromeApi = host.chrome as {
    storage: { local: ChromeStorage; onChanged: ChromeOnChanged };
  };
  const preferenceStore: NymPrivacyPreferenceStore = {
    get: (keys) => chromeApi.storage.local.get(keys ?? null),
    set: (items) => chromeApi.storage.local.set(items),
  };
  const controller = new NymRuntimeController({
    bridge: stubBridge(),
    gatewayConfig: new NymGatewayConfigService({
      get: async () => ({}),
      set: async () => {},
    }),
    hostPermissions: new NymHostPermissionService({
      contains: async () => false,
      request: async () => false,
      remove: async () => true,
    }),
    privacyPreferenceStore: preferenceStore,
    onPrivacyStoreChanged: (listener) => {
      const wrapped = (changes: Record<string, unknown>, area: string) => {
        if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, NYM_PRIVACY_PREFERENCE_STORAGE_KEY)) {
          const change = changes[NYM_PRIVACY_PREFERENCE_STORAGE_KEY] as { newValue?: unknown } | undefined;
          listener({ newValue: change?.newValue });
        }
      };
      chromeApi.storage.onChanged.addListener(wrapped);
      return () => chromeApi.storage.onChanged.removeListener(wrapped);
    },
  });
  return controller;
}

describe('webapp privacy sync across instances', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('revokes Direct on a live peer when another instance saves Nym', async () => {
    const eventsA = new EventTarget();
    const eventsB = new EventTarget();
    const backing = sharedLocalStorage([eventsA, eventsB]);
    const writer = instance(backing.forPeer(eventsA), eventsA);
    await writer.setMode('direct');

    const peer = instance(backing.forPeer(eventsB), eventsB);
    await peer.whenPrivacyReady();
    expect(peer.getSnapshot().privacyPreference).toBe('direct');
    expect(peer.getSnapshot().egressBlocked).toBe(false);

    const clearnet = vi.fn(async () => new Response('horizon', { status: 200 }));
    vi.stubGlobal('fetch', clearnet);
    expect((await peer.getStellarFetch()(HORIZON)).status).toBe(200);
    expect(clearnet).toHaveBeenCalledTimes(1);
    clearnet.mockClear();

    await writer.setMode('nym');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(peer.mode).toBe('nym');
    expect(peer.getSnapshot().privacyPreference).toBe('nym');
    expect(peer.getSnapshot().egressBlocked).toBe(true);
    await expect(peer.getStellarFetch()(HORIZON)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    await expect(
      peer.fetchPublicData({ transport: 'direct', url: 'https://postman-echo.com/get' }),
    ).resolves.toMatchObject({ transportFetchInvoked: false });
    expect(clearnet).not.toHaveBeenCalled();
    expect(writer.getSnapshot().privacyPreference).toBe('nym');
  });

  it('revokes Direct on the peer when storage is cleared (key null)', async () => {
    const eventsA = new EventTarget();
    const eventsB = new EventTarget();
    const backing = sharedLocalStorage([eventsA, eventsB]);
    const writer = instance(backing.forPeer(eventsA), eventsA);
    await writer.setMode('direct');
    const peer = instance(backing.forPeer(eventsB), eventsB);
    await peer.whenPrivacyReady();
    expect(peer.getSnapshot().egressBlocked).toBe(false);

    backing.clear();
    expect(peer.getSnapshot().egressBlocked).toBe(true);
    expect(peer.mode).not.toBe('direct');

    const clearnet = vi.fn(async () => new Response('horizon', { status: 200 }));
    vi.stubGlobal('fetch', clearnet);
    await expect(peer.getStellarFetch()(HORIZON)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    await expect(peer.getRouter().fetch(HORIZON)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    await expect(
      peer.fetchPublicData({ transport: 'direct', url: 'https://postman-echo.com/get' }),
    ).resolves.toMatchObject({ transportFetchInvoked: false });
    expect(clearnet).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(peer.getSnapshot().privacyPreference).toBeNull();
    expect(peer.getSnapshot().egressBlocked).toBe(true);
    expect(clearnet).not.toHaveBeenCalled();
  });
});
