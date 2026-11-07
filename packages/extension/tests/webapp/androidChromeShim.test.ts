import { describe, expect, it } from 'vitest';

import { installAndroidChromeShim } from '../../src/webapp/installChromeShim.js';

function installOnPath(pathname: string): { runtime: { sendMessage: (...args: unknown[]) => Promise<unknown>; onMessage: { addListener: (fn: (...args: unknown[]) => unknown) => void } } } {
  delete (globalThis as { chrome?: unknown }).chrome;
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: {
      protocol: 'http:',
      pathname,
      origin: 'http://127.0.0.1:5173',
    },
  });
  installAndroidChromeShim();
  return (globalThis as { chrome: { runtime: { sendMessage: (...args: unknown[]) => Promise<unknown>; onMessage: { addListener: (fn: (...args: unknown[]) => unknown) => void } } } }).chrome;
}

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

  it('stamps the sender with the current document, not a fixed webapp url', async () => {
    const host = installOnPath('/spp-host.html');
    let sppSender = '';
    host.runtime.onMessage.addListener((_message: unknown, sender: unknown) => {
      sppSender = (sender as { url?: string }).url ?? '';
      return Promise.resolve({ ok: true });
    });
    await host.runtime.sendMessage({ ping: true });
    expect(sppSender).toBe('/spp-host.html');

    const webapp = installOnPath('/webapp.html');
    let webSender = '';
    webapp.runtime.onMessage.addListener((_message: unknown, sender: unknown) => {
      webSender = (sender as { url?: string }).url ?? '';
      return Promise.resolve({ ok: true });
    });
    await webapp.runtime.sendMessage({ ping: true });
    expect(webSender).toBe('/webapp.html');
  });
});
