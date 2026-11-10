import { afterEach, describe, expect, it, vi } from 'vitest';

import { NymRuntimeController } from '../../src/background/nym/NymRuntimeController.js';
import { NymGatewayConfigService } from '../../src/background/nym/NymGatewayConfigService.js';
import { NymHostPermissionService } from '../../src/background/nym/NymHostPermissionService.js';
import type { NymSessionBridge } from '../../src/background/nym/NymRuntimeController.js';
import {
  NYM_PRIVACY_PREFERENCE_STORAGE_KEY,
  type NymPrivacyPreferenceStore,
} from '../../src/shared/nymPrivacyPreference.js';
import { installAndroidChromeShim } from '../../src/webapp/installChromeShim.js';

const KEY = NYM_PRIVACY_PREFERENCE_STORAGE_KEY;
const LOCAL_KEY = 'astrym.chrome.storage.local.v1';
const HORIZON = 'https://horizon-testnet.stellar.org/fee_stats';

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

/**
 * Shared localStorage whose cross-document events stay queued until flush.
 * That is the real browser's task queue, which the synchronous test harness
 * otherwise collapses into the writer's setItem.
 */
function queuedSharedStorage(peers: EventTarget[]) {
  const data = new Map<string, string>();
  const queued: Array<{ peer: EventTarget; event: Event }> = [];
  return {
    forPeer(self: EventTarget) {
      const enqueue = (key: string, oldValue: string | null, newValue: string | null) => {
        for (const peer of peers) {
          if (peer === self) continue;
          const event = new Event('storage');
          Object.assign(event, { key, oldValue, newValue });
          queued.push({ peer, event });
        }
      };
      return {
        getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
        setItem: (key: string, value: string) => {
          const oldValue = data.has(key) ? data.get(key)! : null;
          data.set(key, value);
          enqueue(key, oldValue, value);
        },
        removeItem: (key: string) => {
          const oldValue = data.has(key) ? data.get(key)! : null;
          data.delete(key);
          enqueue(key, oldValue, null);
        },
      };
    },
    storedChoice(): string | null {
      const raw = data.get(LOCAL_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const value = parsed[KEY];
      return typeof value === 'string' ? value : null;
    },
    flush(peer?: EventTarget) {
      const ready = queued.splice(0).filter((item) => peer == null || item.peer === peer);
      for (const item of ready) item.peer.dispatchEvent(item.event);
    },
  };
}

function instance(
  storage: ReturnType<ReturnType<typeof queuedSharedStorage>['forPeer']>,
  events: EventTarget,
  holdReads: { current: Promise<void> | null },
) {
  const host: { chrome?: Record<string, unknown> } = {};
  installAndroidChromeShim({ host, localStorage: storage, storageEvents: events });
  const chromeApi = host.chrome as {
    storage: { local: ChromeStorage; onChanged: ChromeOnChanged };
  };
  const preferenceStore: NymPrivacyPreferenceStore = {
    get: async (keys) => {
      if (holdReads.current) await holdReads.current;
      return chromeApi.storage.local.get(keys ?? null);
    },
    set: (items) => chromeApi.storage.local.set(items),
  };
  return new NymRuntimeController({
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
        if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, KEY)) {
          const change = changes[KEY] as { newValue?: unknown } | undefined;
          listener({ newValue: change?.newValue });
        }
      };
      chromeApi.storage.onChanged.addListener(wrapped);
      return () => chromeApi.storage.onChanged.removeListener(wrapped);
    },
  });
}

async function refuseClearnet(ctrl: NymRuntimeController, clearnet: ReturnType<typeof vi.fn>) {
  await expect(ctrl.getStellarFetch()(HORIZON)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  await expect(ctrl.getRouter().fetch(HORIZON)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  await expect(ctrl.fetchPublicData({ transport: 'direct' })).resolves.toMatchObject({
    transportFetchInvoked: false,
  });
  await expect(ctrl.probeStellarHorizon({ transport: 'direct' })).resolves.toMatchObject({
    transportFetchInvoked: false,
  });
  expect(clearnet).not.toHaveBeenCalled();
}

describe('stale foreign Direct notice', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not authorize Direct when a delayed Direct event arrives after local Nym is saved', async () => {
    const eventsA = new EventTarget();
    const eventsB = new EventTarget();
    const backing = queuedSharedStorage([eventsA, eventsB]);
    const holdReads = { current: null as Promise<void> | null };
    const writer = instance(backing.forPeer(eventsA), eventsA, holdReads);
    const peer = instance(backing.forPeer(eventsB), eventsB, holdReads);
    await writer.whenPrivacyReady();
    await peer.whenPrivacyReady();

    await writer.setMode('direct');
    expect(backing.storedChoice()).toBe('direct');
    expect(peer.getSnapshot().privacyPreference).not.toBe('direct');

    await peer.setMode('nym');
    expect(backing.storedChoice()).toBe('nym');
    expect(peer.getSnapshot()).toMatchObject({
      mode: 'nym',
      privacyPreference: 'nym',
      preferenceDurable: true,
      egressBlocked: true,
    });

    let release: () => void = () => {};
    holdReads.current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const clearnet = vi.fn(async () => new Response('horizon', { status: 200 }));
    vi.stubGlobal('fetch', clearnet);
    backing.flush(eventsB);
    expect(peer.mode).not.toBe('direct');
    expect(peer.getSnapshot().egressBlocked).toBe(true);
    expect(peer.getSnapshot().privacyPreference).toBe('nym');

    const whileReadPending = refuseClearnet(peer, clearnet);
    release();
    holdReads.current = null;
    await whileReadPending;
    await peer.whenPrivacyReady();
    await Promise.resolve();

    expect(backing.storedChoice()).toBe('nym');
    expect(peer.getSnapshot()).toMatchObject({
      mode: 'nym',
      privacyPreference: 'nym',
      preferenceDurable: true,
      egressBlocked: true,
    });
    expect(clearnet).not.toHaveBeenCalled();

    const reloaded = instance(backing.forPeer(eventsB), eventsB, { current: null });
    await reloaded.whenPrivacyReady();
    expect(reloaded.getSnapshot().privacyPreference).toBe('nym');
    expect(reloaded.getSnapshot().preferenceDurable).toBe(true);
    expect(reloaded.getSnapshot().egressBlocked).toBe(true);
    await expect(reloaded.getStellarFetch()(HORIZON)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    expect(clearnet).not.toHaveBeenCalled();
  });

  it('keeps Nym when two queued Direct notices are delivered before their reads finish', async () => {
    const eventsA = new EventTarget();
    const eventsB = new EventTarget();
    const backing = queuedSharedStorage([eventsA, eventsB]);
    const holdReads = { current: null as Promise<void> | null };
    const writer = instance(backing.forPeer(eventsA), eventsA, holdReads);
    const peer = instance(backing.forPeer(eventsB), eventsB, holdReads);
    await writer.whenPrivacyReady();
    await peer.whenPrivacyReady();

    await writer.setMode('direct');
    await writer.setMode('direct');
    await peer.setMode('nym');
    expect(backing.storedChoice()).toBe('nym');

    let release: () => void = () => {};
    holdReads.current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const clearnet = vi.fn(async () => new Response('horizon', { status: 200 }));
    vi.stubGlobal('fetch', clearnet);
    backing.flush(eventsB);
    expect(peer.getSnapshot().egressBlocked).toBe(true);
    expect(peer.mode).not.toBe('direct');
    const pending = refuseClearnet(peer, clearnet);
    release();
    holdReads.current = null;
    await pending;

    expect(peer.getSnapshot()).toMatchObject({
      privacyPreference: 'nym',
      preferenceDurable: true,
      egressBlocked: true,
    });
    expect(backing.storedChoice()).toBe('nym');
    expect(clearnet).not.toHaveBeenCalled();
  });

  it('keeps a failed local Nym when a queued Direct notice rereads the previous Direct', async () => {
    const eventsA = new EventTarget();
    const eventsB = new EventTarget();
    const backing = queuedSharedStorage([eventsA, eventsB]);
    const peerStorage = backing.forPeer(eventsB);
    let failNym = false;
    const throwingPeerStorage = {
      ...peerStorage,
      setItem: (key: string, value: string) => {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        if (failNym && parsed[KEY] === 'nym') {
          const error = new Error('QuotaExceededError');
          error.name = 'QuotaExceededError';
          throw error;
        }
        peerStorage.setItem(key, value);
      },
    };
    const holdReads = { current: null as Promise<void> | null };
    const writer = instance(backing.forPeer(eventsA), eventsA, holdReads);
    const peer = instance(throwingPeerStorage, eventsB, holdReads);
    await writer.whenPrivacyReady();
    await peer.whenPrivacyReady();

    await writer.setMode('direct');
    await writer.setMode('direct');
    expect(backing.storedChoice()).toBe('direct');

    failNym = true;
    await expect(peer.setMode('nym')).rejects.toThrow(/QuotaExceededError/);
    expect(backing.storedChoice()).toBe('direct');
    expect(peer.getSnapshot()).toMatchObject({
      mode: 'nym',
      privacyPreference: 'nym',
      preferenceDurable: false,
      egressBlocked: true,
      diagnosticCode: 'PRIVACY_PREFERENCE_PERSIST_FAILED',
    });

    let release: () => void = () => {};
    holdReads.current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const clearnet = vi.fn(async () => new Response('horizon', { status: 200 }));
    vi.stubGlobal('fetch', clearnet);
    backing.flush(eventsB);
    expect(peer.getSnapshot()).toMatchObject({
      privacyPreference: 'nym',
      preferenceDurable: false,
      egressBlocked: true,
      diagnosticCode: 'PRIVACY_PREFERENCE_PERSIST_FAILED',
    });
    expect(peer.mode).not.toBe('direct');
    const pending = refuseClearnet(peer, clearnet);
    release();
    holdReads.current = null;
    await pending;

    expect(backing.storedChoice()).toBe('direct');
    expect(peer.getSnapshot()).toMatchObject({
      mode: 'nym',
      privacyPreference: 'nym',
      preferenceDurable: false,
      egressBlocked: true,
      diagnosticCode: 'PRIVACY_PREFERENCE_PERSIST_FAILED',
    });
    expect(clearnet).not.toHaveBeenCalled();

    const reloaded = instance(backing.forPeer(eventsB), eventsB, { current: null });
    await reloaded.whenPrivacyReady();
    expect(reloaded.getSnapshot()).toMatchObject({
      privacyPreference: 'direct',
      preferenceDurable: true,
      egressBlocked: false,
    });
    expect((await reloaded.getStellarFetch()(HORIZON)).status).toBe(200);
    expect(clearnet).toHaveBeenCalledTimes(1);
    expect(peer.getSnapshot()).toMatchObject({
      privacyPreference: 'nym',
      preferenceDurable: false,
      diagnosticCode: 'PRIVACY_PREFERENCE_PERSIST_FAILED',
      egressBlocked: true,
    });

    failNym = false;
    clearnet.mockClear();
    await peer.setMode('direct');
    expect(peer.getSnapshot()).toMatchObject({
      mode: 'direct',
      privacyPreference: 'direct',
      preferenceDurable: true,
      egressBlocked: false,
      diagnosticCode: 'OK',
    });
    expect((await peer.getStellarFetch()(HORIZON)).status).toBe(200);
    expect(clearnet).toHaveBeenCalledTimes(1);
  });
});
