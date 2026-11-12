import { describe, expect, it } from 'vitest';

import { installAndroidChromeShim } from '../../src/webapp/installChromeShim.js';

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
