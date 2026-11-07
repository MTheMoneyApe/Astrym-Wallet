import { afterEach, describe, expect, it } from 'vitest';

import { installAndroidChromeShim } from '../../src/webapp/installChromeShim.js';
import { NymRuntimeController } from '../../src/background/nym/NymRuntimeController.js';
import { NymGatewayConfigService } from '../../src/background/nym/NymGatewayConfigService.js';
import { NymHostPermissionService } from '../../src/background/nym/NymHostPermissionService.js';
import type { NymSessionBridge } from '../../src/background/nym/NymRuntimeController.js';

describe('Android chrome shim', () => {
  it('satisfies webextension-polyfill storage and alarms', async () => {
    installAndroidChromeShim();
    const browser = (await import('webextension-polyfill')).default;
    await browser.storage.local.set({ astrymProbe: 'ok' });
    const stored = await browser.storage.local.get('astrymProbe');
    expect(stored['astrymProbe']).toBe('ok');
    await browser.storage.local.remove('astrymProbe');
    const cleared = await browser.storage.local.get('astrymProbe');
    expect(cleared['astrymProbe']).toBeUndefined();

    await browser.alarms.create('astrym-probe', { when: Date.now() + 60_000 });
    const clearedAlarm = await browser.alarms.clear('astrym-probe');
    expect(clearedAlarm).toBe(true);
  });
});

describe('Android chrome shim storage failures', () => {
  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  function throwingStorage(name: 'QuotaExceededError' | 'SecurityError') {
    const data = new Map<string, string>();
    let fail = true;
    const storage = {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => {
        if (fail) {
          const error = new Error(name);
          error.name = name;
          throw error;
        }
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
      allow() {
        fail = false;
      },
    };
    return storage;
  }

  function stubBridge(): NymSessionBridge {
    return {
      setup: async () => {},
      disconnect: async () => {},
      mixFetch: async () => new Response('ok'),
      queryStatus: async () => null,
    };
  }

  it('rejects a promise set and still completes a later set after quota and security errors', async () => {
    for (const name of ['QuotaExceededError', 'SecurityError'] as const) {
      delete (globalThis as { chrome?: unknown }).chrome;
      const storage = throwingStorage(name);
      installAndroidChromeShim({ localStorage: storage, storageEvents: null });
      const chromeApi = (globalThis as unknown as {
        chrome: {
          storage: {
            local: {
              get: (keys?: string | null) => Promise<Record<string, unknown>>;
              set: (items: Record<string, unknown>) => Promise<void>;
            };
          };
        };
      }).chrome;

      await expect(chromeApi.storage.local.set({ choice: 'direct' })).rejects.toThrow(
        new RegExp(name),
      );
      expect(storage.getItem('astrym.chrome.storage.local.v1')).toBeNull();

      storage.allow();
      await chromeApi.storage.local.set({ choice: 'nym' });
      const stored = await chromeApi.storage.local.get('choice');
      expect(stored['choice']).toBe('nym');
      delete (globalThis as { chrome?: unknown }).chrome;
    }
  });

  it('reports callback lastError and does not grant Direct when the write fails', async () => {
    const storage = throwingStorage('QuotaExceededError');
    installAndroidChromeShim({ localStorage: storage, storageEvents: null });
    const chromeApi = (globalThis as unknown as {
      chrome: {
        runtime: { lastError?: { message: string } };
        storage: {
          local: {
            set: (items: Record<string, unknown>, callback?: () => void) => void;
          };
        };
      };
    }).chrome;

    const message = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('storage set callback never ran')), 500);
      chromeApi.storage.local.set({ choice: 'direct' }, () => {
        clearTimeout(timer);
        const err = chromeApi.runtime.lastError;
        if (!err) {
          reject(new Error('expected lastError'));
          return;
        }
        resolve(err.message);
      });
    });
    expect(message).toMatch(/QuotaExceededError/);
    expect(storage.getItem('astrym.chrome.storage.local.v1')).toBeNull();

    const ctrl = new NymRuntimeController({
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
    });
    await ctrl.whenPrivacyReady();
    await expect(ctrl.setMode('direct')).rejects.toThrow(/QuotaExceededError/);
    expect(ctrl.mode).not.toBe('direct');
    expect(ctrl.getSnapshot().privacyPreference).not.toBe('direct');
    expect(ctrl.getSnapshot().egressBlocked).toBe(true);
    expect(ctrl.getSnapshot().diagnosticCode).toBe('PRIVACY_PREFERENCE_PERSIST_FAILED');

    storage.allow();
    await ctrl.setMode('nym');
    expect(ctrl.getSnapshot().privacyPreference).toBe('nym');
    expect(ctrl.getSnapshot().diagnosticCode).not.toBe('PRIVACY_PREFERENCE_PERSIST_FAILED');
  });
});
