import { afterEach, describe, expect, it, vi } from 'vitest';

import { NymRuntimeController } from '../../../src/background/nym/NymRuntimeController.js';
import { NymGatewayConfigService } from '../../../src/background/nym/NymGatewayConfigService.js';
import { NymHostPermissionService } from '../../../src/background/nym/NymHostPermissionService.js';
import type { NymSessionBridge } from '../../../src/background/nym/NymRuntimeController.js';
import { NYM_PRIVACY_PREFERENCE_STORAGE_KEY } from '../../../src/shared/nymPrivacyPreference.js';
import { installAndroidChromeShim } from '../../../src/webapp/installChromeShim.js';

const KEY = NYM_PRIVACY_PREFERENCE_STORAGE_KEY;
const LOCAL_KEY = 'astrym.chrome.storage.local.v1';
const HORIZON = 'https://horizon-testnet.stellar.org/fee_stats';

type TraceEntry = { step: 'intent' | 'write' | 'echo'; detail: string };

function bridge(): NymSessionBridge {
  return {
    setup: async () => {},
    disconnect: async () => {},
    mixFetch: async () => new Response('mix'),
    queryStatus: async () => null,
  };
}

function controller(): NymRuntimeController {
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
  });
}

function install(failNym: () => boolean) {
  const data = new Map<string, string>();
  const trace: TraceEntry[] = [];
  const storage = {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      const choice = parsed[KEY];
      trace.push({ step: 'write', detail: String(choice) });
      if (choice === 'nym' && failNym()) {
        const error = new Error('QuotaExceededError');
        error.name = 'QuotaExceededError';
        throw error;
      }
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  installAndroidChromeShim({ localStorage: storage, storageEvents: null });
  return {
    trace,
    stored(): string | null {
      const raw = data.get(LOCAL_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const value = parsed[KEY];
      return typeof value === 'string' ? value : null;
    },
  };
}

function watchEchoes(trace: TraceEntry[], ctrl: NymRuntimeController) {
  const snaps: Array<{ mode: string; preference: string | null; blocked: boolean; durable: boolean }> = [];
  const chromeApi = (globalThis as unknown as {
    chrome: {
      storage: {
        onChanged: {
          addListener: (fn: (changes: Record<string, unknown>, area: string) => void) => void;
        };
      };
    };
  }).chrome;
  chromeApi.storage.onChanged.addListener(() => {
    const snap = ctrl.getSnapshot();
    snaps.push({
      mode: snap.mode,
      preference: snap.privacyPreference,
      blocked: snap.egressBlocked,
      durable: snap.preferenceDurable,
    });
    trace.push({ step: 'echo', detail: snap.privacyPreference ?? 'null' });
  });
  return snaps;
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

describe('privacy durable self-echo', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('drops a queued Direct write when Nym is requested before the shim drains', async () => {
    const { trace, stored } = install(() => false);
    const ctrl = controller();
    const snaps = watchEchoes(trace, ctrl);
    await ctrl.whenPrivacyReady();

    trace.push({ step: 'intent', detail: 'direct' });
    const pendingDirect = ctrl.setMode('direct');
    trace.push({ step: 'intent', detail: 'nym' });
    const pendingNym = ctrl.setMode('nym');
    expect(ctrl.mode).not.toBe('direct');
    expect(ctrl.getSnapshot().egressBlocked).toBe(true);

    const clearnet = vi.fn(async () => new Response('clearnet', { status: 200 }));
    vi.stubGlobal('fetch', clearnet);
    await refuseClearnet(ctrl, clearnet);
    await pendingDirect;
    await pendingNym;

    const nymAt = trace.findIndex((entry) => entry.step === 'intent' && entry.detail === 'nym');
    const writesAfter = trace.slice(nymAt + 1).filter((entry) => entry.step === 'write');
    expect(writesAfter.map((entry) => entry.detail)).toEqual(['nym']);
    expect(stored()).toBe('nym');
    expect(ctrl.getSnapshot()).toMatchObject({
      mode: 'nym',
      privacyPreference: 'nym',
      preferenceDurable: true,
      egressBlocked: true,
    });
    for (const snap of snaps) {
      expect(snap.blocked).toBe(true);
      expect(snap.mode).not.toBe('direct');
    }
    expect(clearnet).not.toHaveBeenCalled();

    const reloaded = controller();
    await reloaded.whenPrivacyReady();
    expect(reloaded.getSnapshot().privacyPreference).toBe('nym');
    expect(reloaded.getSnapshot().egressBlocked).toBe(true);
    await expect(reloaded.getStellarFetch()(HORIZON)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    expect(clearnet).not.toHaveBeenCalled();
  });

  it('keeps Nym revoked when the Nym save fails after an obsolete Direct echo', async () => {
    let failNym = false;
    const { trace, stored } = install(() => failNym);
    const ctrl = controller();
    await ctrl.whenPrivacyReady();
    await ctrl.setMode('direct');
    expect(stored()).toBe('direct');
    expect(ctrl.getSnapshot().egressBlocked).toBe(false);

    failNym = true;
    const snaps = watchEchoes(trace, ctrl);
    const clearnet = vi.fn(async () => new Response('clearnet', { status: 200 }));
    vi.stubGlobal('fetch', clearnet);
    trace.push({ step: 'intent', detail: 'direct' });
    const pendingDirect = ctrl.setMode('direct');
    trace.push({ step: 'intent', detail: 'nym' });
    const pendingNym = ctrl.setMode('nym');
    expect(ctrl.mode).not.toBe('direct');
    expect(ctrl.getSnapshot().egressBlocked).toBe(true);

    await refuseClearnet(ctrl, clearnet);
    await pendingDirect;
    await expect(pendingNym).rejects.toThrow(/QuotaExceededError/);

    expect(stored()).toBe('direct');
    expect(ctrl.getSnapshot()).toMatchObject({
      mode: 'nym',
      privacyPreference: 'nym',
      preferenceDurable: false,
      egressBlocked: true,
      diagnosticCode: 'PRIVACY_PREFERENCE_PERSIST_FAILED',
    });
    for (const snap of snaps) {
      expect(snap.blocked).toBe(true);
      expect(snap.mode).not.toBe('direct');
    }
    const nymAt = trace.findIndex((entry) => entry.step === 'intent' && entry.detail === 'nym');
    expect(trace.slice(nymAt + 1).some((entry) => entry.step === 'write' && entry.detail === 'direct')).toBe(
      false,
    );
    expect(clearnet).not.toHaveBeenCalled();

    const reloaded = controller();
    await reloaded.whenPrivacyReady();
    expect(reloaded.getSnapshot().privacyPreference).toBe('direct');
    expect(reloaded.getSnapshot().preferenceDurable).toBe(true);
    expect(reloaded.getSnapshot().egressBlocked).toBe(false);
    expect(ctrl.getSnapshot().egressBlocked).toBe(true);
    expect(ctrl.getSnapshot().diagnosticCode).toBe('PRIVACY_PREFERENCE_PERSIST_FAILED');
  });

  it('does not rearm when an in-flight Direct write echoes after Nym was requested', async () => {
    const { trace, stored } = install(() => false);
    const ctrl = controller();
    await ctrl.whenPrivacyReady();
    await ctrl.setMode('direct');
    const snaps = watchEchoes(trace, ctrl);

    const chromeApi = (globalThis as unknown as {
      chrome: {
        storage: {
          local: {
            set: (items: Record<string, unknown>, callback?: () => void) => void;
          };
        };
      };
    }).chrome;
    const realSet = chromeApi.storage.local.set.bind(chromeApi.storage.local);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    chromeApi.storage.local.set = (items, callback) => {
      if (items[KEY] === 'direct') {
        trace.push({ step: 'write', detail: 'direct-entered' });
        entered();
        void gate.then(() => {
          realSet(items, callback);
        });
        return;
      }
      realSet(items, callback);
    };

    trace.push({ step: 'intent', detail: 'direct' });
    const pendingDirect = ctrl.setMode('direct');
    await started;
    trace.push({ step: 'intent', detail: 'nym' });
    const pendingNym = ctrl.setMode('nym');
    expect(ctrl.getSnapshot().egressBlocked).toBe(true);
    expect(ctrl.mode).not.toBe('direct');

    const clearnet = vi.fn(async () => new Response('clearnet', { status: 200 }));
    vi.stubGlobal('fetch', clearnet);
    release();
    await refuseClearnet(ctrl, clearnet);
    await pendingDirect;
    await pendingNym;

    expect(stored()).toBe('nym');
    expect(ctrl.getSnapshot()).toMatchObject({
      privacyPreference: 'nym',
      preferenceDurable: true,
      egressBlocked: true,
    });
    expect(ctrl.mode).not.toBe('direct');
    for (const snap of snaps) {
      expect(snap.blocked).toBe(true);
      expect(snap.mode).not.toBe('direct');
    }
    expect(clearnet).not.toHaveBeenCalled();

    const reloaded = controller();
    await reloaded.whenPrivacyReady();
    expect(reloaded.getSnapshot().privacyPreference).toBe('nym');
    expect(reloaded.getSnapshot().egressBlocked).toBe(true);
    await expect(reloaded.getStellarFetch()(HORIZON)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    expect(clearnet).not.toHaveBeenCalled();
  });
});
